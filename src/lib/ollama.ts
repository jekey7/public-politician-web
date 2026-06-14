import { MockAiVerifier, mockSyncVerifier, type AiVerifier } from "./ai";
import { validateDiscrepancyKindOutput, validateEntityMatchOutput } from "./ai-validators";
import { PinCacheVerifier, type PinCacheArtifact } from "./pin-cache";
import {
  ResilientAiVerifier,
  VoteLedger,
  VotingAiVerifier,
  votingConfigFromEnv,
  type VotingConfig,
} from "./voting-verifier";
import type {
  DiscrepancyClassificationRequest,
  DiscrepancyKind,
  EntityMatchRequest,
  EntityMatchResult,
  EvidenceValue,
  RagAnswer,
} from "./types";

/**
 * Ollama 기반 AiVerifier.
 *
 * 기존 AiVerifier seam 뒤의 구현만 교체한다 — detector core(cross-verification.ts)는 건드리지 않는다.
 * Ollama의 OpenAI 호환 endpoint(/v1/chat/completions)로 로컬 모델(기본 Qwen3 4B Q4)을 호출한다.
 *
 * 불변 원칙 #1: LLM은 entity-matching + 불일치 분류만 한다. 사실을 생성/요약/서술하지 않는다.
 * 모든 LLM 출력은 ai-validators의 hard guard를 통과해야 하며, 실패하면 통과시키지 않고 거부(throw)한다.
 * RAG 답변 조합은 LLM이 문장을 만들지 않도록 규칙 기반 경로(mock)에 위임한다.
 *
 * BATCH 전용: 데이터 갱신 시점에 ~300명을 처리해 결과를 저장한다. 라이브 사이트의 런타임 호출은 없다.
 */

export interface OllamaConfig {
  baseUrl: string;
  model: string;
  /** 호출 타임아웃(ms). batch 처리이므로 넉넉히 둔다. */
  timeoutMs: number;
}

type OllamaEnv = Partial<Record<"OLLAMA_BASE_URL" | "OLLAMA_MODEL" | "OLLAMA_TIMEOUT_MS", string>>;

type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Pick<Response, "ok" | "status" | "json">>;

interface OllamaTagsResponse {
  models?: { name?: string; model?: string }[];
}

export const DEFAULT_OLLAMA_BASE_URL = "http://localhost:11434";
export const DEFAULT_OLLAMA_MODEL = "qwen3:4b";
const DEFAULT_TIMEOUT_MS = 60_000;

export function ollamaConfigFromEnv(env: OllamaEnv = readOllamaEnv()): OllamaConfig {
  const baseUrl = env.OLLAMA_BASE_URL?.trim() || DEFAULT_OLLAMA_BASE_URL;
  const model = env.OLLAMA_MODEL?.trim() || DEFAULT_OLLAMA_MODEL;
  const parsedTimeout = Number(env.OLLAMA_TIMEOUT_MS);
  const timeoutMs = Number.isFinite(parsedTimeout) && parsedTimeout > 0 ? parsedTimeout : DEFAULT_TIMEOUT_MS;
  return { baseUrl: baseUrl.replace(/\/$/, ""), model, timeoutMs };
}

export class OllamaAiVerifier implements AiVerifier {
  // RAG 답변 문장은 LLM이 만들지 않는다(불변 원칙 #1) — 규칙 기반 mock 경로에 위임.
  private readonly ragDelegate = new MockAiVerifier();

  constructor(
    private readonly config: OllamaConfig,
    private readonly fetcher: FetchLike = fetch,
  ) {}

  async matchEntity(request: EntityMatchRequest): Promise<EntityMatchResult> {
    const content = await this.chatJson(buildMatchPrompt(request));
    // hard guard: 형식/범위를 통과하지 못하면 거부.
    return validateEntityMatchOutput(parseJsonObject(content));
  }

  async classifyDiscrepancy(request: DiscrepancyClassificationRequest): Promise<DiscrepancyKind> {
    const content = await this.chatJson(buildClassifyPrompt(request));
    const parsed = parseJsonObject(content);
    // 모델이 {"kind": "..."} 또는 문자열만 반환하는 두 경우 모두 허용한 뒤 guard로 검증.
    const candidate = typeof parsed === "string" ? parsed : (parsed as Record<string, unknown>).kind;
    return validateDiscrepancyKindOutput(candidate);
  }

  async answerWithCitations(question: string, corpus: EvidenceValue<unknown>[]): Promise<RagAnswer> {
    // 인용만 하고 새 사실을 서술하지 않는다 — 규칙 기반 경로를 그대로 사용.
    return this.ragDelegate.answerWithCitations(question, corpus);
  }

  /** OpenAI 호환 chat completion 호출. 결정성을 위해 temperature 0 / seed 고정. */
  private async chatJson(messages: ChatMessage[]): Promise<string> {
    const url = `${this.config.baseUrl}/v1/chat/completions`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.timeoutMs);

    try {
      const response = await this.fetcher(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          model: this.config.model,
          messages,
          temperature: 0,
          seed: 0,
          stream: false,
          response_format: { type: "json_object" },
        }),
      });

      if (!response.ok) {
        throw new Error(`Ollama request failed with status ${response.status}.`);
      }

      const payload = (await response.json()) as OpenAiChatResponse;
      const content = payload?.choices?.[0]?.message?.content;
      if (typeof content !== "string" || !content.trim()) {
        throw new Error("Ollama returned an empty completion.");
      }
      return content;
    } finally {
      clearTimeout(timer);
    }
  }
}

export type AiBackend = "ollama" | "mock";

export interface AiVerifierSelection {
  verifier: AiVerifier;
  backend: AiBackend;
  /** mock으로 떨어진 이유(사람이 상태를 알 수 있게 표면화). ollama 선택 시 undefined. */
  reason?: string;
  /**
   * Ollama backend 선택 시, self-consistency voting의 표 분포를 담는 inspectable ledger.
   * 비결정성 모델을 잡음 분류기로 보고 다수결로 라벨을 안정화한다(불변 #8: 표가 검사 가능).
   * mock backend는 결정적이라 투표하지 않으므로 undefined.
   */
  voteLedger?: VoteLedger;
  /** Ollama backend 선택 시 적용된 투표 설정(샘플 수·임계치). 보고용. */
  votingConfig?: VotingConfig;
  /**
   * Ollama backend 선택 시 per-call 회복력 래퍼. 배치 중 LLM 호출이 실패하면 mock으로 떨어진
   * 횟수를 보고한다(`.stats()`). 크래시 대신 정직한 degrade.
   */
  resilient?: ResilientAiVerifier;
  /**
   * Ollama backend 선택 시 입력 해시 캐시(핀). 동일 입력은 모델/투표를 다시 호출하지 않고 동결된
   * 결과를 반환해 스냅샷 재생성을 byte-identical 하게 만든다(불변 #8). 배치 끝에 `.toArtifact()`로
   * 내부(gitignore) 아티팩트에 저장한다. mock backend는 결정적이라 핀하지 않으므로 undefined.
   */
  pinCache?: PinCacheVerifier;
}

/**
 * Ollama가 닿고 모델이 설치돼 있으면 OllamaAiVerifier를 self-consistency voting으로 감싸 반환한다.
 * 닿지 않거나 모델이 없으면 규칙/mock verifier로 깔끔하게 fallback 한다(목 우선 원칙).
 * 크래시하지 않고 backend/reason을 함께 반환해 호출자가 상태를 surface 할 수 있게 한다.
 *
 * 비결정성 대응(Iteration 26): 라이브 모델은 temp0/seed0에도 라벨이 흔들리므로, 각 분류/정합을
 * N회 샘플링해 다수결로 라벨을 정한다. 표가 갈리면 ledger에 lowConfidence로 기록돼 검수중으로
 * surface 된다. 투표/핀잉은 라벨만 안정화하며 사실을 만들지 않는다(불변 #1).
 */
export async function createAiVerifier(
  env: OllamaEnv = readOllamaEnv(),
  fetcher: FetchLike = fetch,
  /** 이전 배치에서 저장한 핀 캐시. 모델/프롬프트 버전이 맞는 항목만 로드돼 재현성·비용을 살린다. */
  initialPinCache?: PinCacheArtifact,
): Promise<AiVerifierSelection> {
  // 명시적 mock 강제: CI/verify:all이 로컬에 떠 있는 모델 유무와 무관하게 빠르고 결정적으로 돌게 한다.
  // 라이브 배치는 의도적 선택이어야 하므로, 이 opt-out이 있으면 Ollama를 아예 건드리지 않는다.
  // env(SNAPSHOT_AI_BACKEND=mock) 또는 CLI 플래그(--mock) 둘 다 지원(크로스 플랫폼).
  if (process.env.SNAPSHOT_AI_BACKEND === "mock" || process.argv.includes("--mock")) {
    return {
      verifier: new MockAiVerifier(),
      backend: "mock",
      reason: "SNAPSHOT_AI_BACKEND=mock — live LLM intentionally skipped (deterministic rule-based verifier).",
    };
  }

  const config = ollamaConfigFromEnv(env);
  const reachable = await isOllamaReachable(config, fetcher);

  if (!reachable.ok) {
    return {
      verifier: new MockAiVerifier(),
      backend: "mock",
      reason: `Ollama unreachable/model missing at ${config.baseUrl} (${reachable.reason}); falling back to rule-based mock verifier.`,
    };
  }

  // Pin(Voting(Resilient(Ollama))):
  //  - Resilient: 각 샘플이 실패하면 mock으로 떨어진다(크래시 방지).
  //  - Voting: N회 샘플링 다수결로 라벨 안정화. 갈리면 저신뢰(검수중)로 surface.
  //  - Pin: 동일 입력은 모델/투표를 다시 호출하지 않고 동결된 결과 반환(byte-identical 재현성).
  //    핀은 voting **바깥**이라, 저신뢰 결과도 그 검수중 상태 그대로 동결된다 — 승격 없음(불변 #3).
  const votingConfig = votingConfigFromEnv();
  const ledger = new VoteLedger();
  const resilient = new ResilientAiVerifier(new OllamaAiVerifier(config, fetcher));
  const voting = new VotingAiVerifier(resilient, votingConfig, ledger);
  const pinCache = new PinCacheVerifier(voting, config.model, undefined, initialPinCache);
  return { verifier: pinCache, backend: "ollama", voteLedger: ledger, votingConfig, resilient, pinCache };
}

/**
 * 도달성 + 모델 존재 확인.
 *
 * `/api/tags`가 200이어도 **설정된 모델이 목록에 없으면** Ollama backend를 고르지 않는다.
 * 이전(Iteration 25)에는 tags 200만 보고 backend를 선택해, 모델이 다른/없는 환경에서 chat 404로
 * 크래시했다(목 우선 fallback 위반). 이제 tags 응답을 파싱해 configured model이 실제로 있는지
 * 확인하고, 없으면 ok:false를 반환해 호출자가 mock으로 깨끗이 떨어지게 한다.
 */
export async function isOllamaReachable(
  config: OllamaConfig,
  fetcher: FetchLike = fetch,
): Promise<{ ok: boolean; reason: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.min(config.timeoutMs, 5_000));
  try {
    const response = await fetcher(`${config.baseUrl}/api/tags`, { signal: controller.signal });
    if (!response.ok) return { ok: false, reason: `status ${response.status}` };

    const payload = (await response.json()) as OllamaTagsResponse;
    const available = (payload?.models ?? [])
      .flatMap((entry) => [entry.name, entry.model])
      .filter((name): name is string => typeof name === "string" && name.length > 0);

    if (!modelAvailable(config.model, available)) {
      return {
        ok: false,
        reason: `model "${config.model}" not installed (have: ${available.join(", ") || "none"}); pull it or set OLLAMA_MODEL`,
      };
    }
    return { ok: true, reason: "ok" };
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : "fetch failed" };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 설정 모델 태그가 설치 목록에 있는지 판단한다. Ollama는 `qwen3:4b`처럼 명시 태그와
 * 기본 `latest` 태그를 함께 쓰므로, 태그 없는 이름(`qwen3`)은 `qwen3:latest`와도 매칭한다.
 */
function modelAvailable(configured: string, available: string[]): boolean {
  if (available.includes(configured)) return true;
  // 태그를 생략한 설정(`qwen3`)은 `qwen3:latest`로 간주.
  if (!configured.includes(":") && available.includes(`${configured}:latest`)) return true;
  return false;
}

interface ChatMessage {
  role: "system" | "user";
  content: string;
}

interface OpenAiChatResponse {
  choices?: { message?: { content?: string } }[];
}

const MATCH_SYSTEM = [
  "You compare two values that came from different public sources about the same Korean National Assembly member.",
  "Decide ONLY whether they refer to the SAME underlying item (entity matching). Do NOT invent, summarize, or add facts.",
  "Respond with a strict JSON object: {\"isSameEntity\": boolean, \"confidence\": number between 0 and 1, \"rationale\": short string}.",
  "Output JSON only. /no_think",
].join(" ");

const CLASSIFY_SYSTEM = [
  "You classify the inconsistency between public-source values for one field of a Korean National Assembly member.",
  "Choose exactly one kind: notation_variance (same item, different wording), content_conflict (different/contradictory content),",
  "or missing_from_source (some sources lack the value). Do NOT invent, summarize, or add facts.",
  "Respond with strict JSON: {\"kind\": \"notation_variance\" | \"content_conflict\" | \"missing_from_source\"}.",
  "Output JSON only. /no_think",
].join(" ");

function buildMatchPrompt(request: EntityMatchRequest): ChatMessage[] {
  const a = String((request.candidateA as EvidenceValue<unknown>).rawText ?? "");
  const b = String((request.candidateB as EvidenceValue<unknown>).rawText ?? "");
  return [
    { role: "system", content: MATCH_SYSTEM },
    { role: "user", content: `Value A: ${JSON.stringify(a)}\nValue B: ${JSON.stringify(b)}` },
  ];
}

function buildClassifyPrompt(request: DiscrepancyClassificationRequest): ChatMessage[] {
  const items = request.evidences.map((evidence, index) => ({
    index,
    source: evidence.source.sourceOrg,
    text: evidence.rawText,
  }));
  return [
    { role: "system", content: CLASSIFY_SYSTEM },
    { role: "user", content: `Field: ${request.field}\nValues:\n${JSON.stringify(items, null, 2)}` },
  ];
}

/** Qwen3 등은 <think>…</think>나 코드펜스를 섞을 수 있어 JSON 객체만 안전하게 추출한다. */
function parseJsonObject(content: string): unknown {
  const trimmed = content.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fenced ? fenced[1].trim() : trimmed;
  try {
    return JSON.parse(body);
  } catch {
    const start = body.indexOf("{");
    const end = body.lastIndexOf("}");
    if (start >= 0 && end > start) {
      return JSON.parse(body.slice(start, end + 1));
    }
    throw new Error("Ollama output was not valid JSON.");
  }
}

function readOllamaEnv(): OllamaEnv {
  return {
    OLLAMA_BASE_URL: process.env.OLLAMA_BASE_URL,
    OLLAMA_MODEL: process.env.OLLAMA_MODEL,
    OLLAMA_TIMEOUT_MS: process.env.OLLAMA_TIMEOUT_MS,
  };
}

// mockSyncVerifier는 fallback 경로의 규칙 기반 분류와 동일한 로직을 공유한다(참조용 re-export).
export { mockSyncVerifier };
