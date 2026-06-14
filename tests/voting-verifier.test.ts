import assert from "node:assert/strict";
import test from "node:test";
import type { AiVerifier } from "../src/lib/ai";
import {
  classificationFingerprint,
  compareForDeterminism,
  runAllCases,
  type CaseResult,
  type VerificationFixtures,
} from "../src/lib/measure-llm";
import { markDiscrepancyConfidence } from "../src/lib/verification";
import type { Discrepancy, PoliticianProfile } from "../src/lib/types";
import {
  DEFAULT_VOTING_CONFIG,
  lowConfidenceFieldsFromLedger,
  ResilientAiVerifier,
  tallyVotes,
  VoteLedger,
  votingConfigFromEnv,
  VotingAiVerifier,
} from "../src/lib/voting-verifier";
import type {
  DiscrepancyClassificationRequest,
  DiscrepancyKind,
  EntityMatchRequest,
} from "../src/lib/types";

/**
 * self-consistency voting + 결정성 게이트 테스트.
 *
 * Iteration 25에서 라이브 모델(qwen3:8b)이 temp0/seed0에도 파싱된 라벨을 간헐적으로 뒤집는 것이
 * 관측됐다(재현 가능 스냅샷 위반, 불변 #8). 모델을 고칠 수는 없으므로 파이프라인을 강건하게 만든다:
 * 각 분류/정합을 N회 샘플링해 다수결 라벨을 채택한다. 표 multiset이 같으면 다수결은 결정적이므로,
 * **소수 잡음이 다수를 뒤집지 못하는 한 최종 라벨은 안정**된다. 이 테스트는 라이브 LLM 없이
 * 통제된 비결정 stub으로 그 성질을 검증한다(CI 게이트).
 */

// --- pure tally ------------------------------------------------------------

test("tallyVotes picks the majority and is deterministic given the same multiset", () => {
  const a = tallyVotes(["same", "same", "different", "same", "different"], 0.6);
  const b = tallyVotes(["different", "same", "same", "different", "same"], 0.6); // 같은 multiset, 다른 순서
  assert.equal(a.label, "same");
  assert.equal(a.winnerVotes, 3);
  // 3/5 = 0.6 은 임계치 0.6 미만이 아니다(>= 통과) → 저신뢰 아님.
  assert.equal(a.confidence, 0.6);
  assert.equal(a.lowConfidence, false);
  // 순서가 달라도 같은 결과(결정성).
  assert.deepEqual(a.tally, b.tally);
  assert.equal(a.label, b.label);
});

test("tallyVotes flags a tie as low-confidence and picks a stable representative", () => {
  const outcome = tallyVotes(["content_conflict", "notation_variance"], 0.6);
  assert.equal(outcome.lowConfidence, true, "2-way tie must be low-confidence");
  // 동률은 사전순 대표값(content_conflict < notation_variance).
  assert.equal(outcome.label, "content_conflict");
  // 입력 순서를 뒤집어도 같은 대표값(결정성).
  const flipped = tallyVotes(["notation_variance", "content_conflict"], 0.6);
  assert.equal(flipped.label, "content_conflict");
});

test("tallyVotes flags below-threshold majority as low-confidence", () => {
  // 5표 중 2표가 최다(나머지는 분산) → 0.4 < 0.6 → 저신뢰.
  const outcome = tallyVotes(["a", "a", "b", "c", "d"], 0.6);
  assert.equal(outcome.winnerVotes, 2);
  assert.equal(outcome.confidence, 0.4);
  assert.equal(outcome.lowConfidence, true);
});

// --- controlled nondeterministic stub --------------------------------------

/**
 * qwen3의 흔들림을 흉내내는 통제 stub. flipEvery=4면 4호출마다 1번 "틀린" 라벨을 낸다.
 * samples=5에서는 최대 2표만 틀리므로(5/4 올림=2) 다수결은 항상 올바른 라벨로 안정된다.
 * 호출 카운터로 구동돼 **결정적으로 비결정성을 재현**한다 — 라이브 LLM이 필요 없다.
 */
class FlakyVerifier implements AiVerifier {
  private matchCalls = 0;
  private classifyCalls = 0;

  constructor(
    private readonly truthSameEntity: boolean,
    private readonly truthKind: DiscrepancyKind,
    private readonly flipEvery: number,
  ) {}

  async matchEntity(_request: EntityMatchRequest) {
    const n = this.matchCalls++;
    const flip = n % this.flipEvery === this.flipEvery - 1;
    const isSameEntity = flip ? !this.truthSameEntity : this.truthSameEntity;
    return { isSameEntity, confidence: 0.8, rationale: "flaky stub" };
  }

  async classifyDiscrepancy(_request: DiscrepancyClassificationRequest): Promise<DiscrepancyKind> {
    const n = this.classifyCalls++;
    const flip = n % this.flipEvery === this.flipEvery - 1;
    const wrong: DiscrepancyKind = this.truthKind === "content_conflict" ? "notation_variance" : "content_conflict";
    return flip ? wrong : this.truthKind;
  }

  async answerWithCitations() {
    return { answer: "관련 자료 없음", citations: [], status: "no_material" as const };
  }
}

const fixtures: VerificationFixtures = {
  schema_version: "test",
  entity_match_cases: [
    { id: "m1", kind: "entity_match", valueA: "경제학과 졸업", valueB: "경제학 학사", expectedSameEntity: true, category: "synonym", note: "n" },
  ],
  classification_cases: [
    {
      id: "c1",
      kind: "classification",
      field: "education",
      evidences: [
        { sourceOrg: "A", rawText: "경제학과 졸업" },
        { sourceOrg: "B", rawText: "경제학 학사" },
      ],
      expectedKind: "notation_variance",
      category: "synonym",
      note: "n",
    },
  ],
};

const fixedClock = () => {
  let t = 0;
  return () => (t += 10);
};

// --- the CI determinism gate ----------------------------------------------

test("CI GATE: voting makes final labels deterministic despite a flaky model", async () => {
  // 4호출마다 1번 라벨이 뒤집히는 비결정 모델. raw 모델 단독이면 실행마다 라벨이 흔들린다.
  const flaky = new FlakyVerifier(true, "notation_variance", 4);
  // samples=5: 5표 중 최대 2표만 틀리므로 다수결(>=3)은 항상 올바른 라벨.
  const voting = new VotingAiVerifier(flaky, { samples: 5, confidenceThreshold: 0.6 });

  // 같은 fixture를 두 번 돌린다(Iteration 25 하네스의 결정성 검사와 동일한 방식).
  const runA = await runAllCases(fixtures, voting, fixedClock());
  const runB = await runAllCases(fixtures, voting, fixedClock());

  // Iteration 25에서 FAIL 하던 검사가 이제 라벨 수준에서 PASS — 구성상 보장.
  assert.equal(
    classificationFingerprint(runA),
    classificationFingerprint(runB),
    "voted classification fingerprints must be byte-identical across runs",
  );
  assert.equal(compareForDeterminism(runA, runB).deterministic, true);

  // 다수결이 진실 라벨로 수렴했는지 확인(잡음에 굴복하지 않음).
  const match = runA.find((r) => r.id === "m1");
  const classify = runA.find((r) => r.id === "c1");
  assert.equal(match?.llmResult, true);
  assert.equal(classify?.llmResult, "notation_variance");
});

test("CI GATE: a raw flaky model WITHOUT voting is not label-stable (control)", async () => {
  // 대조군: 투표 없이(samples=1) 같은 stub을 돌리면 호출 카운터가 진행되며 라벨이 흔들린다.
  const flaky = new FlakyVerifier(true, "notation_variance", 2); // 2호출마다 1번 뒤집힘
  const single = new VotingAiVerifier(flaky, { samples: 1, confidenceThreshold: 0.6 });

  const runA = await runAllCases(fixtures, single, fixedClock());
  const runB = await runAllCases(fixtures, single, fixedClock());

  // samples=1이면 다수결이 잡음을 흡수하지 못해 두 실행이 갈린다 — 투표의 필요성을 입증.
  assert.notEqual(
    classificationFingerprint(runA),
    classificationFingerprint(runB),
    "without voting the flaky model diverges (this is the Iteration 25 failure mode)",
  );
});

test("CI GATE: label-only determinism ignores entity-match confidence wobble", () => {
  // 같은 라벨(isSameEntity)이지만 정합 confidence float이 흔들린 두 실행.
  const runA: CaseResult[] = [
    { id: "m1", kind: "entity_match", category: "synonym", expected: true, ruleResult: false, llmResult: true, llmConfidence: 0.81, ruleCorrect: false, llmCorrect: true, agreement: false, latencyMs: 1 },
  ];
  const runB: CaseResult[] = [
    { id: "m1", kind: "entity_match", category: "synonym", expected: true, ruleResult: false, llmResult: true, llmConfidence: 0.79, ruleCorrect: false, llmCorrect: true, agreement: false, latencyMs: 1 },
  ];
  // 엄격 비교(confidence 포함)는 발산으로 본다.
  assert.equal(compareForDeterminism(runA, runB).deterministic, false);
  // label-only 비교는 라벨이 같으므로 통과 — 우리가 신경 쓰는 건 라벨이다.
  assert.equal(compareForDeterminism(runA, runB, true).deterministic, true);
  assert.equal(classificationFingerprint(runA, true), classificationFingerprint(runB, true));
});

// --- low-confidence surfacing ----------------------------------------------

test("split votes are recorded as low-confidence in the ledger", async () => {
  // 50/50로 갈리는 모델: 2호출마다 뒤집힘 + samples=4 → 2 vs 2 동률 → 저신뢰.
  const flaky = new FlakyVerifier(false, "content_conflict", 2);
  const ledger = new VoteLedger();
  const voting = new VotingAiVerifier(flaky, { samples: 4, confidenceThreshold: 0.6 }, ledger);

  await voting.classifyDiscrepancy({
    field: "district",
    evidences: fixtures.classification_cases[0].evidences.map((e) => ({
      evidenceId: `ev-${e.sourceOrg}`,
      category: "identity" as const,
      field: "district",
      value: e.rawText,
      rawText: e.rawText,
      source: {
        sourceId: `s-${e.sourceOrg}`,
        sourceKind: "mock" as const,
        sourceOrg: e.sourceOrg,
        sourceUrl: "https://example.invalid",
        fetchedAt: "1970-01-01T00:00:00.000Z",
        licenseNote: "test",
      },
      reviewStatus: "reviewing" as const,
    })),
  });

  const low = ledger.lowConfidence();
  assert.equal(low.length, 1, "the split classification vote must be flagged low-confidence");
  assert.equal(low[0].kind, "classify_discrepancy");

  const lowFields = lowConfidenceFieldsFromLedger(ledger);
  assert.ok(lowFields.has("district"), "low-confidence field must be derivable for pipeline marking");
});

test("a clean majority is NOT flagged low-confidence", async () => {
  const stable = new FlakyVerifier(true, "notation_variance", 1000); // 거의 안 뒤집힘
  const ledger = new VoteLedger();
  const voting = new VotingAiVerifier(stable, { samples: 5, confidenceThreshold: 0.6 }, ledger);

  await voting.matchEntity({
    candidateA: { evidenceId: "a", rawText: "x" } as EntityMatchRequest["candidateA"],
    candidateB: { evidenceId: "b", rawText: "y" } as EntityMatchRequest["candidateB"],
  });

  assert.equal(ledger.summary().lowConfidence, 0);
  assert.equal(ledger.summary().confident, 1);
});

// --- per-call resilience ---------------------------------------------------

/** 호출마다 던지는 verifier — 라이브 LLM 실패(타임아웃·404)를 흉내낸다. */
class AlwaysThrows implements AiVerifier {
  async matchEntity(): Promise<never> {
    throw new Error("simulated chat timeout");
  }
  async classifyDiscrepancy(): Promise<never> {
    throw new Error("simulated chat 404");
  }
  async answerWithCitations() {
    return { answer: "관련 자료 없음", citations: [], status: "no_material" as const };
  }
}

test("ResilientAiVerifier falls back to mock per failing call instead of crashing", async () => {
  const resilient = new ResilientAiVerifier(new AlwaysThrows());

  // 던지지 않고 mock 결과를 돌려준다.
  const match = await resilient.matchEntity({
    candidateA: { evidenceId: "a", rawText: "같은표기" } as EntityMatchRequest["candidateA"],
    candidateB: { evidenceId: "b", rawText: "같은표기" } as EntityMatchRequest["candidateB"],
  });
  assert.equal(match.isSameEntity, true, "mock rule matches identical normalized text");

  const kind = await resilient.classifyDiscrepancy({
    field: "education",
    evidences: [
      { evidenceId: "e1", rawText: "경제학과", source: { sourceId: "s1" } } as never,
      { evidenceId: "e2", rawText: "경영학과", source: { sourceId: "s2" } } as never,
    ],
  });
  assert.ok(["notation_variance", "content_conflict", "missing_from_source"].includes(kind));

  const stats = resilient.stats();
  assert.equal(stats.matchFallbacks, 1);
  assert.equal(stats.classifyFallbacks, 1);
  assert.equal(stats.total, 2);
});

test("Voting(Resilient(flaky-throwing)) keeps the batch alive and votes on mock labels", async () => {
  // 모든 LLM 호출이 실패해도 투표는 mock 표로 계속 돌아 크래시하지 않는다.
  const resilient = new ResilientAiVerifier(new AlwaysThrows());
  const voting = new VotingAiVerifier(resilient, { samples: 3, confidenceThreshold: 0.6 });

  const result = await voting.matchEntity({
    candidateA: { evidenceId: "a", rawText: "같은표기" } as EntityMatchRequest["candidateA"],
    candidateB: { evidenceId: "b", rawText: "같은표기" } as EntityMatchRequest["candidateB"],
  });
  assert.equal(result.isSameEntity, true);
  // 3 샘플 모두 mock으로 떨어졌다.
  assert.equal(resilient.stats().matchFallbacks, 3);
});

// --- config ----------------------------------------------------------------

// --- pipeline marking ------------------------------------------------------

function profileWith(discrepancies: Discrepancy[]): PoliticianProfile {
  const empty = {
    party: [], district: [], position: [], committeeRole: [], contact: [], birthYear: [], gender: [],
    education: [], careers: [], partyHistory: [], elections: [],
    activities: { bills: [], votes: [], committees: [] }, news: [],
  };
  return { politicianId: "p1", displayName: "테스트", discrepancies, ...empty };
}

function discrepancy(field: string): Discrepancy {
  return {
    discrepancyId: `disc-${field}`,
    category: "identity",
    field,
    kind: "content_conflict",
    label: `${field} 내용 충돌`,
    evidenceIds: ["e1", "e2"],
    detectedAt: "1970-01-01T00:00:00.000Z",
    detector: "rule",
  };
}

test("markDiscrepancyConfidence marks split-vote fields as llm_interface_low_confidence", () => {
  const profiles = [profileWith([discrepancy("education"), discrepancy("district")])];
  const lowFields = new Set(["district"]);

  const marked = markDiscrepancyConfidence(profiles, lowFields);

  const byField = new Map(marked[0].discrepancies.map((d) => [d.field, d.detector]));
  assert.equal(byField.get("education"), "llm_interface", "confident LLM classification");
  assert.equal(byField.get("district"), "llm_interface_low_confidence", "split vote → 검수중");

  // 입력 불변(순수 함수).
  assert.equal(profiles[0].discrepancies[0].detector, "rule");
});

test("votingConfigFromEnv parses overrides and falls back to defaults", () => {
  assert.deepEqual(votingConfigFromEnv({}), DEFAULT_VOTING_CONFIG);
  assert.deepEqual(votingConfigFromEnv({ AI_VOTE_SAMPLES: "7", AI_VOTE_THRESHOLD: "0.8" }), {
    samples: 7,
    confidenceThreshold: 0.8,
  });
  // 잘못된 값은 기본값으로.
  assert.deepEqual(votingConfigFromEnv({ AI_VOTE_SAMPLES: "0", AI_VOTE_THRESHOLD: "9" }), DEFAULT_VOTING_CONFIG);
});
