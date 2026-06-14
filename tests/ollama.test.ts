import assert from "node:assert/strict";
import test from "node:test";
import {
  createAiVerifier,
  isOllamaReachable,
  ollamaConfigFromEnv,
  OllamaAiVerifier,
  DEFAULT_OLLAMA_BASE_URL,
  DEFAULT_OLLAMA_MODEL,
} from "../src/lib/ollama";
import type { EntityMatchRequest, EvidenceValue } from "../src/lib/types";

const source = {
  sourceId: "s",
  sourceKind: "mock" as const,
  sourceOrg: "출처",
  sourceUrl: "https://example.invalid/s",
  fetchedAt: "2026-06-11T00:00:00.000Z",
  licenseNote: "MOCK DATA ONLY - test",
};

const evidence = (rawText: string): EvidenceValue<string> => ({
  evidenceId: `ev-${rawText}`,
  category: "education",
  field: "education",
  value: rawText,
  rawText,
  source,
  reviewStatus: "reviewing",
});

const matchRequest = (a: string, b: string): EntityMatchRequest => ({
  candidateA: evidence(a),
  candidateB: evidence(b),
});

const chatResponse = (content: string) => ({
  ok: true,
  status: 200,
  async json() {
    return { choices: [{ message: { content } }] };
  },
});

test("ollama config reads env with localhost defaults", () => {
  const config = ollamaConfigFromEnv({});
  assert.equal(config.baseUrl, DEFAULT_OLLAMA_BASE_URL);
  assert.equal(config.model, DEFAULT_OLLAMA_MODEL);

  const custom = ollamaConfigFromEnv({ OLLAMA_BASE_URL: "http://gpu-host:11434/", OLLAMA_MODEL: "qwen3:8b" });
  assert.equal(custom.baseUrl, "http://gpu-host:11434");
  assert.equal(custom.model, "qwen3:8b");
});

test("matchEntity sends temperature 0 / seed and validates output", async () => {
  let sentBody: Record<string, unknown> = {};
  const verifier = new OllamaAiVerifier(ollamaConfigFromEnv({}), async (input, init) => {
    sentBody = JSON.parse(String(init?.body));
    assert.match(String(input), /\/v1\/chat\/completions$/);
    return chatResponse(JSON.stringify({ isSameEntity: true, confidence: 0.9, rationale: "same school + degree" }));
  });

  const result = await verifier.matchEntity(matchRequest("A대 경제학과 졸업", "A대 경제학 학사"));

  assert.equal(result.isSameEntity, true);
  assert.equal(result.confidence, 0.9);
  assert.equal(sentBody.temperature, 0);
  assert.equal(sentBody.seed, 0);
  assert.equal(sentBody.model, DEFAULT_OLLAMA_MODEL);
});

test("matchEntity tolerates think tags and code fences around JSON", async () => {
  const verifier = new OllamaAiVerifier(ollamaConfigFromEnv({}), async () =>
    chatResponse('<think>comparing</think>```json\n{"isSameEntity": false, "confidence": 0.2, "rationale": "different major"}\n```'),
  );

  const result = await verifier.matchEntity(matchRequest("A대 경제학과", "A대 경영학과"));
  assert.equal(result.isSameEntity, false);
  assert.equal(result.confidence, 0.2);
});

test("classifyDiscrepancy accepts {kind} object and validates against allowed kinds", async () => {
  const verifier = new OllamaAiVerifier(ollamaConfigFromEnv({}), async () =>
    chatResponse(JSON.stringify({ kind: "notation_variance" })),
  );

  const kind = await verifier.classifyDiscrepancy({ field: "education", evidences: [evidence("a"), evidence("b")] });
  assert.equal(kind, "notation_variance");
});

test("invalid LLM output is rejected, not passed through (hard guard)", async () => {
  const badMatch = new OllamaAiVerifier(ollamaConfigFromEnv({}), async () =>
    chatResponse(JSON.stringify({ isSameEntity: true, confidence: 2, rationale: "out of range" })),
  );
  await assert.rejects(() => badMatch.matchEntity(matchRequest("a", "b")), /between 0 and 1/);

  const badKind = new OllamaAiVerifier(ollamaConfigFromEnv({}), async () =>
    chatResponse(JSON.stringify({ kind: "political_opinion" })),
  );
  await assert.rejects(
    () => badKind.classifyDiscrepancy({ field: "education", evidences: [evidence("a"), evidence("b")] }),
    /allowed discrepancy kinds/,
  );
});

test("answerWithCitations does not call the model (LLM must not narrate facts)", async () => {
  let called = false;
  const verifier = new OllamaAiVerifier(ollamaConfigFromEnv({}), async () => {
    called = true;
    return chatResponse("{}");
  });

  const answer = await verifier.answerWithCitations("질문", []);
  assert.equal(called, false);
  assert.equal(answer.status, "no_material");
  assert.equal(answer.answer, "관련 자료 없음");
});

test("failed HTTP response throws", async () => {
  const verifier = new OllamaAiVerifier(ollamaConfigFromEnv({}), async () => ({
    ok: false,
    status: 500,
    async json() {
      return {};
    },
  }));
  await assert.rejects(() => verifier.matchEntity(matchRequest("a", "b")), /status 500/);
});

// tags 응답에 모델 목록을 끼워 도달 가능 + 모델 존재를 흉내낸다.
const tagsResponse = (models: string[]) => ({
  ok: true,
  status: 200,
  async json() {
    return { models: models.map((name) => ({ name, model: name })) };
  },
});

test("createAiVerifier falls back to mock when Ollama is unreachable", async () => {
  const selection = await createAiVerifier({}, async () => {
    throw new Error("ECONNREFUSED");
  });

  assert.equal(selection.backend, "mock");
  assert.match(selection.reason ?? "", /unreachable/);
  // fallback verifier still works (rule-based).
  const result = await selection.verifier.matchEntity(matchRequest("같은표기", "같은표기"));
  assert.equal(result.isSameEntity, true);
});

test("createAiVerifier selects ollama (wrapped in voting) when model is installed", async () => {
  const selection = await createAiVerifier({}, async (input) => {
    if (String(input).endsWith("/api/tags")) return tagsResponse([DEFAULT_OLLAMA_MODEL]);
    return chatResponse(JSON.stringify({ isSameEntity: true, confidence: 0.8, rationale: "ok" }));
  });

  assert.equal(selection.backend, "ollama");
  assert.equal(selection.reason, undefined);
  // self-consistency voting으로 감싸지므로 더 이상 OllamaAiVerifier 인스턴스가 아니다.
  assert.ok(selection.voteLedger, "ollama backend must expose an inspectable vote ledger");
  assert.ok(selection.votingConfig, "ollama backend must report its voting config");
  // 래핑된 verifier는 여전히 동작한다(투표 후 다수결 라벨).
  const result = await selection.verifier.matchEntity(matchRequest("a", "b"));
  assert.equal(result.isSameEntity, true);
});

// Iteration 25에서 발견된 fallback 버그의 회귀 테스트:
// tags는 200이지만 설정된 모델이 목록에 없으면 Ollama를 고르면 안 된다(chat 404 크래시 방지).
test("createAiVerifier falls back to mock when tags responds but the model is absent", async () => {
  let chatCalled = false;
  const selection = await createAiVerifier({}, async (input) => {
    if (String(input).endsWith("/api/tags")) return tagsResponse(["qwen3:8b"]); // 타깃(qwen3:4b) 없음
    chatCalled = true;
    return chatResponse("{}");
  });

  assert.equal(selection.backend, "mock", "must not select Ollama when the target model is missing");
  assert.match(selection.reason ?? "", /not installed/);
  assert.equal(chatCalled, false, "must not reach chat (which would 404) before falling back");
});

// Pin(Voting(Resilient(Ollama))) 배선 확인: ollama backend는 pinCache를 노출하고,
// 저장된 핀을 재로드하면 동일 입력에서 chat을 다시 호출하지 않는다(재현성 + 비용 절감).
test("createAiVerifier exposes a pin cache and reuses it across runs without re-calling chat", async () => {
  let chatCalls = 0;
  const fetcher = async (input: string | URL) => {
    if (String(input).endsWith("/api/tags")) return tagsResponse([DEFAULT_OLLAMA_MODEL]);
    chatCalls += 1;
    return chatResponse(JSON.stringify({ isSameEntity: true, confidence: 0.8, rationale: "ok" }));
  };

  // 1차: 핀 없이 시작 → chat 호출 발생, 핀 채워짐.
  const first = await createAiVerifier({}, fetcher);
  assert.equal(first.backend, "ollama");
  assert.ok(first.pinCache, "ollama backend must expose a pin cache");
  await first.verifier.matchEntity(matchRequest("a", "b"));
  const callsAfterFirst = chatCalls;
  assert.ok(callsAfterFirst > 0, "fresh computation must call chat (voting samples)");
  const savedPin = first.pinCache.toArtifact();

  // 2차: 저장된 핀을 로드 → 같은 입력은 동결 결과로, chat 추가 호출 없음.
  const second = await createAiVerifier({}, fetcher, savedPin);
  await second.verifier.matchEntity(matchRequest("a", "b"));
  assert.equal(chatCalls, callsAfterFirst, "reloaded pin must serve the result without any new chat call");
});

test("isOllamaReachable accepts a model present under its :latest tag", async () => {
  const config = ollamaConfigFromEnv({ OLLAMA_MODEL: "qwen3" });
  const result = await isOllamaReachable(config, async () => tagsResponse(["qwen3:latest"]));
  assert.equal(result.ok, true);
});

test("isOllamaReachable reports unreachable cleanly", async () => {
  const result = await isOllamaReachable(ollamaConfigFromEnv({}), async () => {
    throw new Error("ECONNREFUSED");
  });
  assert.equal(result.ok, false);
  assert.match(result.reason, /ECONNREFUSED/);
});

// Opt-in integration test: only runs against a real local Ollama when explicitly enabled.
// CI stays green without a running model.
test(
  "integration: real Ollama matches synonym education values",
  { skip: process.env.OLLAMA_INTEGRATION !== "1" ? "set OLLAMA_INTEGRATION=1 to run against a live Ollama" : false },
  async () => {
    const selection = await createAiVerifier();
    assert.equal(selection.backend, "ollama", selection.reason ?? "expected reachable Ollama");

    const result = await selection.verifier.matchEntity(matchRequest("A대학교 경제학과 졸업", "A대학교 경제학 학사"));
    // 동의어/표기 차이 케이스를 같은 항목으로 보는지 확인(규칙 matcher가 놓치던 지점).
    assert.equal(result.isSameEntity, true);
    assert.ok(result.confidence >= 0 && result.confidence <= 1);
  },
);
