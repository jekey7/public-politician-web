import { MockAiVerifier, type AiVerifier } from "./ai";
import type {
  DiscrepancyClassificationRequest,
  DiscrepancyKind,
  EntityMatchRequest,
  EntityMatchResult,
  EvidenceValue,
  RagAnswer,
} from "./types";

/**
 * 자기 일관성 투표(self-consistency voting) 래퍼.
 *
 * 배경(Iteration 25/26): qwen3 등 thinking 모델은 temperature 0 / seed 0에도 GPU 부동소수점
 * 비결정성 때문에 같은 입력에서 **파싱된 분류 라벨이 간헐적으로 뒤집힌다**. 이는 모델 내부에서
 * 프롬프트로 없앨 수 있는 버그가 아니라 알려진 한계다. 그래서 모델을 "잡음 섞인 분류기"로 보고
 * 파이프라인을 그 잡음에 강건하게 만든다.
 *
 * 메커니즘: 각 분류/정합 호출을 N회 샘플링해 **다수결 라벨**을 채택한다. 표가 갈리거나(동률)
 * 다수표가 임계치 미만이면 **저신뢰(low-confidence)** 로 표시해 정직하게 surface 한다
 * (불변 원칙 #3: 모르면 모른다 — 한쪽을 조용히 고르지 않는다).
 *
 * 불변 원칙 준수:
 * - #1(AI는 사실을 만들지 않는다): 투표는 라벨(같은 항목 여부 / 불일치 종류)만 안정화한다.
 *   새로운 사실이나 문장을 생성하지 않는다. 후보 라벨은 wrapped verifier가 낸 것뿐이다.
 * - #8(객관성은 증명): 모든 표 분포를 검사 가능한 ledger로 기록한다(블랙박스 아님).
 *
 * 결정성: 표 multiset이 주어지면 다수결 계산은 순수·결정적이다. CI 게이트는 이 성질을 검증한다.
 * 즉 모델 raw 출력이 흔들려도, 충분한 표가 모이면 최종 라벨이 안정된다(통계적 안정화).
 */

export interface VotingConfig {
  /** 분류/정합 1건당 샘플 수. 홀수 권장(동률 회피). */
  samples: number;
  /**
   * 다수표 비율이 이 값 미만이면 저신뢰로 본다. 예: 0.6 이면 5표 중 3표(0.6)는 통과, 2표는 저신뢰.
   * 동률(최다 라벨이 둘 이상)도 항상 저신뢰다.
   */
  confidenceThreshold: number;
}

export const DEFAULT_VOTING_CONFIG: VotingConfig = { samples: 5, confidenceThreshold: 0.6 };

export function votingConfigFromEnv(
  env: Partial<Record<"AI_VOTE_SAMPLES" | "AI_VOTE_THRESHOLD", string>> = readVotingEnv(),
): VotingConfig {
  const samples = toPositiveInt(env.AI_VOTE_SAMPLES, DEFAULT_VOTING_CONFIG.samples);
  const threshold = toRatio(env.AI_VOTE_THRESHOLD, DEFAULT_VOTING_CONFIG.confidenceThreshold);
  return { samples, confidenceThreshold: threshold };
}

/** 한 번의 투표 결과: 채택 라벨 + 표 분포 + 저신뢰 여부. 전부 검사 가능(불변 #8). */
export interface VoteOutcome<Label extends string> {
  /** 채택된 다수결 라벨. */
  label: Label;
  /** 라벨별 득표 수(정렬된 형태로 직렬화). */
  tally: Record<string, number>;
  /** 총 표 수(= samples). */
  totalVotes: number;
  /** 최다 득표 수. */
  winnerVotes: number;
  /** winnerVotes / totalVotes. */
  confidence: number;
  /** 동률 또는 다수표가 임계치 미만이면 true. 저신뢰는 검수 대상으로 surface 한다. */
  lowConfidence: boolean;
}

/** ledger 한 줄: 어떤 호출이 어떤 표 분포로 어떤 라벨을 냈는지 기록(검사 가능). */
export interface VoteRecord {
  kind: "entity_match" | "classify_discrepancy";
  /** 입력 식별 키(증거 id 쌍 또는 field) — 어떤 항목의 투표인지 추적용. */
  inputKey: string;
  label: string;
  tally: Record<string, number>;
  totalVotes: number;
  winnerVotes: number;
  confidence: number;
  lowConfidence: boolean;
}

/**
 * 투표 기록을 모으는 inspectable ledger. 배치 스크립트가 이를 내부(gitignore) 아티팩트로 기록해
 * 표 분포를 사후 검증할 수 있게 한다. 공개 스냅샷과는 분리된다(불변 #5).
 */
export class VoteLedger {
  private readonly entries: VoteRecord[] = [];

  record(entry: VoteRecord): void {
    this.entries.push(entry);
  }

  all(): readonly VoteRecord[] {
    return this.entries;
  }

  /** 저신뢰(검수중) 기록만 추린다. */
  lowConfidence(): VoteRecord[] {
    return this.entries.filter((entry) => entry.lowConfidence);
  }

  summary(): VoteLedgerSummary {
    const total = this.entries.length;
    const low = this.entries.filter((entry) => entry.lowConfidence).length;
    return { total, lowConfidence: low, confident: total - low };
  }
}

export interface VoteLedgerSummary {
  total: number;
  lowConfidence: number;
  confident: number;
}

/**
 * 표 multiset에서 다수결 라벨과 신뢰 지표를 계산한다. **순수·결정적** — 같은 표면 같은 결과.
 *
 * 동률 처리: 최다 득표가 둘 이상이면 lowConfidence=true로 표시하고, 동률 후보 중
 * **사전순으로 가장 앞선** 라벨을 안정적 대표값으로 고른다(결정성 보장 — 입력 순서에 의존하지 않음).
 * 이 대표값은 표시용일 뿐이며, lowConfidence 플래그가 "신뢰할 수 없음"을 함께 전달한다.
 */
export function tallyVotes<Label extends string>(votes: Label[], threshold: number): VoteOutcome<Label> {
  if (votes.length === 0) throw new Error("tallyVotes requires at least one vote");

  const tally: Record<string, number> = {};
  for (const vote of votes) tally[vote] = (tally[vote] ?? 0) + 1;

  const winnerVotes = Math.max(...Object.values(tally));
  const topLabels = Object.keys(tally)
    .filter((label) => tally[label] === winnerVotes)
    .sort();
  const isTie = topLabels.length > 1;
  const label = topLabels[0] as Label;

  const totalVotes = votes.length;
  const confidence = winnerVotes / totalVotes;
  // 동률이거나 다수표가 임계치 미만이면 저신뢰.
  const lowConfidence = isTie || confidence < threshold;

  return {
    label,
    tally: sortedTally(tally),
    totalVotes,
    winnerVotes,
    confidence,
    lowConfidence,
  };
}

/**
 * 호출 단위 회복력(resilience) 래퍼.
 *
 * 배치 중 라이브 LLM 호출 1건이 실패해도(타임아웃·404·파싱 거부 등) 전체 스냅샷을 멈추지 않는다.
 * 실패한 호출만 규칙 기반 mock으로 떨어뜨리고(목 우선 원칙), 몇 건이 fallback 됐는지 센다(정직성).
 *
 * 이는 Iteration 25에서 분리됐던 fallback 취약점의 근본 해법이기도 하다: `/api/tags`는 떠 있지만
 * chat이 (모델 부재든 과부하든) 실패하는 환경에서, 이전에는 `npm run snapshot`이 크래시했다.
 * 이제는 per-call mock fallback으로 흡수하고 backend 라벨/실패 수를 surface 한다.
 *
 * 불변 #1: fallback 경로(mockSyncVerifier)도 사실을 만들지 않는다 — 규칙 기반 비교일 뿐이다.
 * 투표 안쪽에 두면(Voting(Resilient(Ollama))), 실패한 샘플 1표가 mock 라벨로 대체돼 투표가 계속된다.
 */
export class ResilientAiVerifier implements AiVerifier {
  private readonly fallback = new MockAiVerifier();
  private matchFallbacks = 0;
  private classifyFallbacks = 0;

  constructor(private readonly inner: AiVerifier) {}

  /** 지금까지 mock으로 떨어진 호출 수(검사·보고용). */
  stats(): { matchFallbacks: number; classifyFallbacks: number; total: number } {
    return {
      matchFallbacks: this.matchFallbacks,
      classifyFallbacks: this.classifyFallbacks,
      total: this.matchFallbacks + this.classifyFallbacks,
    };
  }

  async matchEntity(request: EntityMatchRequest): Promise<EntityMatchResult> {
    try {
      return await this.inner.matchEntity(request);
    } catch {
      this.matchFallbacks += 1;
      return this.fallback.matchEntity(request);
    }
  }

  async classifyDiscrepancy(request: DiscrepancyClassificationRequest): Promise<DiscrepancyKind> {
    try {
      return await this.inner.classifyDiscrepancy(request);
    } catch {
      this.classifyFallbacks += 1;
      return this.fallback.classifyDiscrepancy(request);
    }
  }

  async answerWithCitations(question: string, corpus: EvidenceValue<unknown>[]): Promise<RagAnswer> {
    // RAG는 mock 경로에 위임돼 있어 추가 fallback이 필요 없다.
    return this.inner.answerWithCitations(question, corpus);
  }
}

/**
 * 임의의 AiVerifier를 감싸 self-consistency voting을 적용한다.
 *
 * matchEntity / classifyDiscrepancy를 N회 호출해 다수결 라벨을 낸다. 저신뢰 결과는 ledger에
 * lowConfidence로 기록되고, 호출자는 그 신호로 항목을 검수중(reviewing)으로 surface 할 수 있다.
 *
 * answerWithCitations는 LLM이 문장을 만들지 않으므로(불변 #1) 투표 대상이 아니며 그대로 위임한다.
 */
export class VotingAiVerifier implements AiVerifier {
  constructor(
    private readonly inner: AiVerifier,
    private readonly config: VotingConfig = DEFAULT_VOTING_CONFIG,
    private readonly ledger: VoteLedger = new VoteLedger(),
  ) {}

  /** 이 verifier가 채운 ledger(표 분포 검사용). */
  getLedger(): VoteLedger {
    return this.ledger;
  }

  async matchEntity(request: EntityMatchRequest): Promise<EntityMatchResult> {
    const results: EntityMatchResult[] = [];
    for (let i = 0; i < this.config.samples; i += 1) {
      results.push(await this.inner.matchEntity(request));
    }

    // 라벨은 isSameEntity(true/false)에 투표한다. confidence는 라벨이 합의될 때만 평균으로 보존.
    const votes = results.map((r) => (r.isSameEntity ? "same" : "different"));
    const outcome = tallyVotes(votes, this.config.confidenceThreshold);
    const isSameEntity = outcome.label === "same";

    this.ledger.record({
      kind: "entity_match",
      inputKey: matchInputKey(request),
      ...projectOutcome(outcome),
    });

    // 채택 라벨에 동의한 샘플들의 confidence만 평균낸다(반대 표의 confidence는 섞지 않음).
    const agreeing = results.filter((r) => r.isSameEntity === isSameEntity);
    const avgConfidence =
      agreeing.length > 0 ? agreeing.reduce((sum, r) => sum + r.confidence, 0) / agreeing.length : outcome.confidence;

    return {
      isSameEntity,
      confidence: avgConfidence,
      rationale: `VOTE ${outcome.winnerVotes}/${outcome.totalVotes} → ${outcome.label}${outcome.lowConfidence ? " (low-confidence, 검수중)" : ""}. Underlying: ${agreeing[0]?.rationale ?? results[0].rationale}`,
    };
  }

  async classifyDiscrepancy(request: DiscrepancyClassificationRequest): Promise<DiscrepancyKind> {
    const votes: DiscrepancyKind[] = [];
    for (let i = 0; i < this.config.samples; i += 1) {
      votes.push(await this.inner.classifyDiscrepancy(request));
    }

    const outcome = tallyVotes(votes, this.config.confidenceThreshold);

    this.ledger.record({
      kind: "classify_discrepancy",
      inputKey: `field:${request.field}`,
      ...projectOutcome(outcome),
    });

    return outcome.label as DiscrepancyKind;
  }

  async answerWithCitations(question: string, corpus: EvidenceValue<unknown>[]): Promise<RagAnswer> {
    // RAG 문장은 LLM이 만들지 않는다(불변 #1) — 투표 대상이 아니므로 그대로 위임.
    return this.inner.answerWithCitations(question, corpus);
  }
}

/**
 * ledger의 classify 투표 결과를 field → 저신뢰 여부 맵으로 정리한다.
 * 파이프라인이 이 맵으로 저신뢰 분류가 달린 discrepancy를 검수중으로 표시한다(불변 #3).
 */
export function lowConfidenceFieldsFromLedger(ledger: VoteLedger): Set<string> {
  const lowFields = new Set<string>();
  for (const entry of ledger.all()) {
    if (entry.kind !== "classify_discrepancy") continue;
    const field = entry.inputKey.startsWith("field:") ? entry.inputKey.slice("field:".length) : entry.inputKey;
    if (entry.lowConfidence) lowFields.add(field);
  }
  return lowFields;
}

function projectOutcome<Label extends string>(outcome: VoteOutcome<Label>): Omit<VoteRecord, "kind" | "inputKey"> {
  return {
    label: outcome.label,
    tally: outcome.tally,
    totalVotes: outcome.totalVotes,
    winnerVotes: outcome.winnerVotes,
    confidence: outcome.confidence,
    lowConfidence: outcome.lowConfidence,
  };
}

function matchInputKey(request: EntityMatchRequest): string {
  const a = String((request.candidateA as EvidenceValue<unknown>).evidenceId ?? "");
  const b = String((request.candidateB as EvidenceValue<unknown>).evidenceId ?? "");
  return [a, b].sort().join("|");
}

/** 라벨을 사전순으로 정렬해 직렬화가 결정적이 되게 한다(같은 표 → 같은 JSON). */
function sortedTally(tally: Record<string, number>): Record<string, number> {
  const sorted: Record<string, number> = {};
  for (const key of Object.keys(tally).sort()) sorted[key] = tally[key];
  return sorted;
}

function readVotingEnv(): Partial<Record<"AI_VOTE_SAMPLES" | "AI_VOTE_THRESHOLD", string>> {
  return {
    AI_VOTE_SAMPLES: process.env.AI_VOTE_SAMPLES,
    AI_VOTE_THRESHOLD: process.env.AI_VOTE_THRESHOLD,
  };
}

function toPositiveInt(raw: string | undefined, fallback: number): number {
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function toRatio(raw: string | undefined, fallback: number): number {
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 && parsed <= 1 ? parsed : fallback;
}
