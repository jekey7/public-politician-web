import assert from "node:assert/strict";
import test from "node:test";
import type { AiVerifier } from "../src/lib/ai";
import {
  PinCacheVerifier,
  PROMPT_TEMPLATE_VERSION,
  parsePinCacheArtifact,
} from "../src/lib/pin-cache";
import type {
  DiscrepancyClassificationRequest,
  DiscrepancyKind,
  EntityMatchRequest,
  EntityMatchResult,
  EvidenceValue,
  RagAnswer,
} from "../src/lib/types";

const source = {
  sourceId: "s",
  sourceKind: "mock" as const,
  sourceOrg: "출처",
  sourceUrl: "https://example.invalid/s",
  fetchedAt: "2026-06-11T00:00:00.000Z",
  licenseNote: "MOCK DATA ONLY - test",
};

const evidence = (rawText: string, id = `ev-${rawText}`): EvidenceValue<string> => ({
  evidenceId: id,
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

/**
 * 호출 횟수를 세는 스파이 verifier. 매 호출마다 다른 결과를 내도록 카운터를 라벨에 섞어,
 * "캐시 히트면 inner를 다시 부르지 않는다"를 직접 증명한다(부르면 결과가 바뀌어 드러남).
 */
class CountingVerifier implements AiVerifier {
  matchCalls = 0;
  classifyCalls = 0;

  constructor(
    private readonly matchResult: EntityMatchResult = {
      isSameEntity: true,
      confidence: 0.9,
      rationale: "spy",
    },
    private readonly classifyResult: DiscrepancyKind = "notation_variance",
  ) {}

  async matchEntity(): Promise<EntityMatchResult> {
    this.matchCalls += 1;
    return { ...this.matchResult, rationale: `call#${this.matchCalls}` };
  }

  async classifyDiscrepancy(): Promise<DiscrepancyKind> {
    this.classifyCalls += 1;
    return this.classifyResult;
  }

  async answerWithCitations(): Promise<RagAnswer> {
    return { answer: "관련 자료 없음", citations: [], status: "no_material" };
  }
}

const classifyRequest = (field: string, texts: string[]): DiscrepancyClassificationRequest => ({
  field,
  evidences: texts.map((t, i) => evidence(t, `ev-${field}-${i}`)),
});

test("cache HIT returns the pinned result WITHOUT invoking the inner model", async () => {
  const inner = new CountingVerifier();
  const cache = new PinCacheVerifier(inner, "qwen3:4b");

  const first = await cache.matchEntity(matchRequest("A대 경제학과", "A대 경제학 학사"));
  assert.equal(inner.matchCalls, 1, "first call is a miss → inner invoked once");

  // 같은 입력 재호출: 캐시 히트여야 한다 — inner는 다시 불리지 않고, 결과는 동결값과 동일.
  const second = await cache.matchEntity(matchRequest("A대 경제학과", "A대 경제학 학사"));
  assert.equal(inner.matchCalls, 1, "cache HIT must NOT invoke the model again");
  assert.deepEqual(second, first, "pinned result is returned byte-for-byte (rationale frozen)");

  const stats = cache.stats();
  assert.equal(stats.hits, 1);
  assert.equal(stats.misses, 1);
});

test("cache key is order-independent for entity match (A,B) == (B,A)", async () => {
  const inner = new CountingVerifier();
  const cache = new PinCacheVerifier(inner, "qwen3:4b");

  await cache.matchEntity(matchRequest("값1", "값2"));
  await cache.matchEntity(matchRequest("값2", "값1")); // swapped → same pinned entry
  assert.equal(inner.matchCalls, 1, "swapped pair must hit the same pin");
});

test("classify cache HIT skips the model; same field+evidences → pinned kind", async () => {
  const inner = new CountingVerifier(undefined, "content_conflict");
  const cache = new PinCacheVerifier(inner, "qwen3:4b");

  const a = await cache.classifyDiscrepancy(classifyRequest("education", ["x", "y"]));
  const b = await cache.classifyDiscrepancy(classifyRequest("education", ["x", "y"]));
  assert.equal(a, "content_conflict");
  assert.equal(b, "content_conflict");
  assert.equal(inner.classifyCalls, 1, "second classify must be served from the pin");
});

test("cache INVALIDATES when the model changes (different model → miss, recompute)", async () => {
  const inner = new CountingVerifier();
  const artifact = (() => {
    const c = new PinCacheVerifier(inner, "qwen3:4b");
    return c;
  })();
  await artifact.matchEntity(matchRequest("a", "b"));
  const saved = artifact.toArtifact();
  assert.equal(saved.model, "qwen3:4b");

  // 다른 모델로 로드: 핀이 모델 불일치로 로드되지 않아야 한다 → 다시 미스.
  const inner2 = new CountingVerifier();
  const reloaded = new PinCacheVerifier(inner2, "qwen3:8b", PROMPT_TEMPLATE_VERSION, saved);
  await reloaded.matchEntity(matchRequest("a", "b"));
  assert.equal(inner2.matchCalls, 1, "different model must NOT reuse the old pin");
});

test("cache INVALIDATES when the prompt template version changes", async () => {
  const inner = new CountingVerifier();
  const c1 = new PinCacheVerifier(inner, "qwen3:4b", "v1");
  await c1.matchEntity(matchRequest("a", "b"));
  const saved = c1.toArtifact();

  const inner2 = new CountingVerifier();
  const c2 = new PinCacheVerifier(inner2, "qwen3:4b", "v2", saved);
  await c2.matchEntity(matchRequest("a", "b"));
  assert.equal(inner2.matchCalls, 1, "bumped prompt version must invalidate old pins");
});

test("cache INVALIDATES when the input changes (different rawText → miss)", async () => {
  const inner = new CountingVerifier();
  const cache = new PinCacheVerifier(inner, "qwen3:4b");
  await cache.matchEntity(matchRequest("a", "b"));
  await cache.matchEntity(matchRequest("a", "c")); // different input
  assert.equal(inner.matchCalls, 2, "changed input must recompute, not reuse the pin");
});

test("matching model+prompt RELOADS the pin (hit on reload, no recompute)", async () => {
  const inner = new CountingVerifier();
  const c1 = new PinCacheVerifier(inner, "qwen3:4b");
  await c1.matchEntity(matchRequest("a", "b"));
  const saved = c1.toArtifact();

  const inner2 = new CountingVerifier();
  const c2 = new PinCacheVerifier(inner2, "qwen3:4b", PROMPT_TEMPLATE_VERSION, saved);
  await c2.matchEntity(matchRequest("a", "b"));
  assert.equal(inner2.matchCalls, 0, "reloaded matching pin must serve the result without recompute");
});

// 불변 #3·#4: 저신뢰(검수중)로 표시된 결과가 핀을 거치며 "verified"로 승격되면 안 된다.
// 저신뢰는 EntityMatchResult.rationale의 "low-confidence, 검수중" 마커로 보존된다(voting이 붙이는 형태).
test("a LOW-CONFIDENCE (split-vote) result stays 검수중 through pinning — NEVER promoted", async () => {
  const lowConfidenceResult: EntityMatchResult = {
    isSameEntity: true,
    confidence: 0.4,
    rationale: "VOTE 1/2 → same (low-confidence, 검수중). Underlying: borderline case",
  };
  class SplitVoteInner implements AiVerifier {
    calls = 0;
    async matchEntity(): Promise<EntityMatchResult> {
      this.calls += 1;
      return lowConfidenceResult;
    }
    async classifyDiscrepancy(): Promise<DiscrepancyKind> {
      return "content_conflict";
    }
    async answerWithCitations(): Promise<RagAnswer> {
      return { answer: "관련 자료 없음", citations: [], status: "no_material" };
    }
  }

  const inner = new SplitVoteInner();
  const cache = new PinCacheVerifier(inner, "qwen3:4b");

  const fresh = await cache.matchEntity(matchRequest("경계", "사례"));
  const pinned = await cache.matchEntity(matchRequest("경계", "사례"));

  assert.equal(inner.calls, 1, "split-vote result must be served from the pin on re-run");
  // 핀은 결과를 동결할 뿐 바꾸지 않는다 — 검수중 마커가 그대로 보존된다(승격 없음).
  assert.match(pinned.rationale, /검수중/, "pinned low-confidence result must retain the 검수중 marker");
  assert.deepEqual(pinned, fresh, "pin freezes the low-confidence result verbatim, never resolves it");
});

test("toArtifact is deterministic (entries sorted by key) and documents the key composition", async () => {
  const inner = new CountingVerifier();
  const cache = new PinCacheVerifier(inner, "qwen3:4b");
  await cache.matchEntity(matchRequest("z", "a"));
  await cache.matchEntity(matchRequest("m", "b"));
  await cache.classifyDiscrepancy(classifyRequest("party", ["p", "q"]));

  const artifact = cache.toArtifact();
  const keys = artifact.entries.map((e) => e.key);
  assert.deepEqual(keys, [...keys].sort(), "entries must be sorted by key for byte-identical serialization");
  assert.match(artifact.keyComposition, /model.*promptTemplateVersion.*kind.*Payload/s);
  assert.equal(artifact.model, "qwen3:4b");
  assert.equal(artifact.promptTemplateVersion, PROMPT_TEMPLATE_VERSION);
});

test("parsePinCacheArtifact tolerates empty/broken input (starts cold, no crash)", () => {
  assert.equal(parsePinCacheArtifact(undefined), undefined);
  assert.equal(parsePinCacheArtifact(""), undefined);
  assert.equal(parsePinCacheArtifact("{not json"), undefined);
  assert.equal(parsePinCacheArtifact("{}"), undefined, "missing required fields → cold start");

  const valid = JSON.stringify({
    model: "qwen3:4b",
    promptTemplateVersion: "v1",
    keyComposition: "doc",
    entries: [{ key: "k", kind: "entity_match", result: { isSameEntity: true, confidence: 1, rationale: "r" } }],
  });
  const parsed = parsePinCacheArtifact(valid);
  assert.ok(parsed);
  assert.equal(parsed.entries.length, 1);
});

test("answerWithCitations is delegated, never pinned (LLM must not narrate facts)", async () => {
  const inner = new CountingVerifier();
  const cache = new PinCacheVerifier(inner, "qwen3:4b");
  const answer = await cache.answerWithCitations("질문", []);
  assert.equal(answer.status, "no_material");
});
