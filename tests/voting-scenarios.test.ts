import assert from "node:assert/strict";
import test from "node:test";
import type { AiVerifier } from "../src/lib/ai";
import {
  lowConfidenceFieldsFromLedger,
  tallyVotes,
  VoteLedger,
  VotingAiVerifier,
} from "../src/lib/voting-verifier";
import { markDiscrepancyConfidence } from "../src/lib/verification";
import type {
  Discrepancy,
  DiscrepancyClassificationRequest,
  DiscrepancyKind,
  EntityMatchRequest,
  PoliticianProfile,
} from "../src/lib/types";

/**
 * Iteration 28 — 투표 LAYER 검증 (모델 변경 없음).
 *
 * Iter-27은 라이브 qwen3:4b가 현재 fixture에서 너무 안정적이라(control 8/8) voting의 안정화 delta를
 * 귀속하지 못했다(INCONCLUSIVE). 이번 반복은 모델 정확도가 아니라 **투표 계층 자체**를 검증한다:
 *
 *   "raw 라벨이 실행마다 흔들릴 때, 자기 일관성 투표가 (a) 흔들림을 안정적 다수결로 흡수하고,
 *    (b) 진짜로 갈린 표를 조용히 한쪽으로 고르지 않고 검수중/저신뢰로 드러내는가?"
 *
 * 핵심 설계: **ScriptedVerifier** — 호출당 미리 짜인 라벨 시퀀스를 그대로 돌려준다. GPU 비결정성에
 * 의존하지 않으므로 각 시나리오의 표 분포가 정확히 재현 가능하다(과제 2 요구). modulo 기반 FlakyVerifier와
 * 달리 정확한 tally(예: 4-vs-1)를 의도대로 주입할 수 있어 "소수 반대표가 버려지지 않고 관측되는가"를
 * 엄밀히 단언할 수 있다.
 *
 * 불변 원칙 준수(Chapter 0):
 * - #3 모르면 모른다 / #4 불일치는 숨기지 않고 드러낸다: split 표는 반드시 lowConfidence로 surface 된다.
 *   조용한 승자 선택은 기능이 아니라 원칙 위반 — 이 파일이 그것을 FAIL로 잡는다.
 * - #8 객관성은 증명: 모든 표 분포를 검사 가능한 ledger로 기록(tally 보존).
 */

// --- 결정적 주입 stub -------------------------------------------------------

/**
 * 호출 순서대로 짜인 라벨을 그대로 돌려주는 verifier. 라이브 LLM 비결정성에 의존하지 않고
 * 각 시나리오의 표 multiset을 정확히 통제한다. samples 수만큼 호출되며, 시퀀스를 다 쓰면 마지막
 * 라벨을 반복한다(방어적 — 시퀀스 길이는 samples와 일치시키는 게 정상).
 */
class ScriptedVerifier implements AiVerifier {
  private matchIdx = 0;
  private classifyIdx = 0;

  constructor(
    private readonly matchScript: boolean[],
    private readonly classifyScript: DiscrepancyKind[],
  ) {}

  async matchEntity(_request: EntityMatchRequest) {
    const i = Math.min(this.matchIdx, this.matchScript.length - 1);
    this.matchIdx += 1;
    return { isSameEntity: this.matchScript[i], confidence: 0.8, rationale: "scripted" };
  }

  async classifyDiscrepancy(_request: DiscrepancyClassificationRequest): Promise<DiscrepancyKind> {
    const i = Math.min(this.classifyIdx, this.classifyScript.length - 1);
    this.classifyIdx += 1;
    return this.classifyScript[i];
  }

  async answerWithCitations() {
    return { answer: "관련 자료 없음", citations: [], status: "no_material" as const };
  }
}

const matchRequest: EntityMatchRequest = {
  candidateA: { evidenceId: "a", rawText: "x" } as EntityMatchRequest["candidateA"],
  candidateB: { evidenceId: "b", rawText: "y" } as EntityMatchRequest["candidateB"],
};

const classifyRequest = (field: string): DiscrepancyClassificationRequest => ({
  field,
  evidences: [
    { evidenceId: `${field}-a`, rawText: "경제학과" } as never,
    { evidenceId: `${field}-b`, rawText: "경제학 학사" } as never,
  ],
});

/** entity_match 라벨("same"/"different")을 isSameEntity boolean으로 환원. */
const bool = (label: string) => label === "same";

const THRESHOLD = 0.6;

// =========================================================================
// 시나리오 매트릭스 — 두 LLM 역할(entity match / classification)에 대칭 적용.
// 각 시나리오: 주입 표 분포 → 기대 라벨/상태 → 실제 → pass/fail.
// =========================================================================

// --- (1) UNANIMOUS 5/5 → 안정 라벨, verified(저신뢰 아님) -------------------

test("UNANIMOUS 5/5 — entity match: stable true, NOT low-confidence", async () => {
  const ledger = new VoteLedger();
  const voting = new VotingAiVerifier(
    new ScriptedVerifier([true, true, true, true, true], []),
    { samples: 5, confidenceThreshold: THRESHOLD },
    ledger,
  );

  const result = await voting.matchEntity(matchRequest);
  assert.equal(result.isSameEntity, true);

  const rec = ledger.all()[0];
  assert.equal(rec.label, "same");
  assert.equal(rec.winnerVotes, 5);
  assert.equal(rec.confidence, 1);
  assert.equal(rec.lowConfidence, false, "5/5 만장일치는 verified — 저신뢰 아님");
  assert.deepEqual(rec.tally, { same: 5 });
});

test("UNANIMOUS 5/5 — classification: stable notation_variance, NOT low-confidence", async () => {
  const ledger = new VoteLedger();
  const voting = new VotingAiVerifier(
    new ScriptedVerifier(
      [],
      ["notation_variance", "notation_variance", "notation_variance", "notation_variance", "notation_variance"],
    ),
    { samples: 5, confidenceThreshold: THRESHOLD },
    ledger,
  );

  const kind = await voting.classifyDiscrepancy(classifyRequest("education"));
  assert.equal(kind, "notation_variance");

  const rec = ledger.all()[0];
  assert.equal(rec.lowConfidence, false);
  assert.deepEqual(rec.tally, { notation_variance: 5 });
});

// --- (2) CLEAR MAJORITY 4/5 → 다수 라벨 채택 + 소수 반대표가 관측 가능(버려지지 않음) ---

test("CLEAR MAJORITY 4/5 — entity match: true chosen AND the 1 dissent is recorded (not discarded)", async () => {
  const ledger = new VoteLedger();
  const voting = new VotingAiVerifier(
    new ScriptedVerifier([true, true, false, true, true], []),
    { samples: 5, confidenceThreshold: THRESHOLD },
    ledger,
  );

  const result = await voting.matchEntity(matchRequest);
  assert.equal(result.isSameEntity, true, "4/5 다수 라벨 채택");

  const rec = ledger.all()[0];
  assert.equal(rec.winnerVotes, 4);
  assert.equal(rec.confidence, 0.8);
  assert.equal(rec.lowConfidence, false, "0.8 >= 0.6 → 통과");
  // 핵심: 소수 반대표(different:1)가 tally에 보존돼 검사 가능하다 — 조용히 버려지지 않는다(불변 #4·#8).
  assert.deepEqual(rec.tally, { different: 1, same: 4 }, "minority dissent must remain observable in the tally");
  assert.equal(rec.tally.different, 1, "1표의 반대가 ledger에 명시 기록됨");
});

test("CLEAR MAJORITY 4/5 — classification: majority chosen AND minority dissent recorded", async () => {
  const ledger = new VoteLedger();
  const voting = new VotingAiVerifier(
    new ScriptedVerifier(
      [],
      ["content_conflict", "content_conflict", "notation_variance", "content_conflict", "content_conflict"],
    ),
    { samples: 5, confidenceThreshold: THRESHOLD },
    ledger,
  );

  const kind = await voting.classifyDiscrepancy(classifyRequest("district"));
  assert.equal(kind, "content_conflict");

  const rec = ledger.all()[0];
  assert.equal(rec.lowConfidence, false);
  assert.deepEqual(rec.tally, { content_conflict: 4, notation_variance: 1 });
  assert.equal(rec.tally.notation_variance, 1, "소수 분류 의견이 보존됨");
});

// --- (3) BARE MAJORITY 3/5 → 스펙 명시: 0.6 == threshold 는 '미만'이 아니므로 통과(저신뢰 아님) ---
//   스펙: lowConfidence = isTie || confidence < threshold. 3/5 = 0.6 은 < 0.6 이 아니다 → 통과.
//   즉 임계치는 '경계 포함(>=)'으로 통과시킨다. 이 경계 동작을 명시적으로 단언한다.

test("BARE MAJORITY 3/5 — entity match: at threshold (0.6) is accepted, NOT low-confidence (boundary is inclusive)", async () => {
  const ledger = new VoteLedger();
  const voting = new VotingAiVerifier(
    new ScriptedVerifier([true, true, false, true, false], []),
    { samples: 5, confidenceThreshold: THRESHOLD },
    ledger,
  );

  const result = await voting.matchEntity(matchRequest);
  assert.equal(result.isSameEntity, true);

  const rec = ledger.all()[0];
  assert.equal(rec.winnerVotes, 3);
  assert.equal(rec.confidence, 0.6);
  assert.equal(rec.lowConfidence, false, "스펙: 0.6 == threshold 는 < threshold 가 아니므로 통과");
  assert.deepEqual(rec.tally, { different: 2, same: 3 });
});

test("BARE MAJORITY 3/5 BELOW raised threshold (0.7) — classification: flagged 검수중", async () => {
  // 같은 3/5 분포라도 임계치를 0.7로 올리면 0.6 < 0.7 → 저신뢰로 넘어간다(임계치가 실제로 작동함을 증명).
  const ledger = new VoteLedger();
  const voting = new VotingAiVerifier(
    new ScriptedVerifier(
      [],
      ["content_conflict", "content_conflict", "notation_variance", "content_conflict", "notation_variance"],
    ),
    { samples: 5, confidenceThreshold: 0.7 },
    ledger,
  );

  await voting.classifyDiscrepancy(classifyRequest("party"));
  const rec = ledger.all()[0];
  assert.equal(rec.confidence, 0.6);
  assert.equal(rec.lowConfidence, true, "0.6 < 0.7 → 저신뢰(검수중)");
  assert.ok(lowConfidenceFieldsFromLedger(ledger).has("party"));
});

// --- (4) TRUE SPLIT / TIE → 검수중/저신뢰 surface, 조용한 승자 없음 ----------

test("TRUE SPLIT 2/2 tie — entity match: low-confidence, NO silent winner", async () => {
  const ledger = new VoteLedger();
  const voting = new VotingAiVerifier(
    new ScriptedVerifier([true, false, true, false], []),
    { samples: 4, confidenceThreshold: THRESHOLD },
    ledger,
  );

  await voting.matchEntity(matchRequest);
  const rec = ledger.all()[0];
  assert.equal(rec.winnerVotes, 2);
  assert.equal(rec.lowConfidence, true, "2-2 동률은 반드시 저신뢰");
  // 대표 라벨은 표시용(사전순)일 뿐 — lowConfidence 플래그가 '신뢰 불가'를 함께 전달한다.
  assert.deepEqual(rec.tally, { different: 2, same: 2 }, "양쪽 표 모두 보존 — 한쪽을 조용히 고르지 않음");
});

test("TRUE SPLIT 2/2/1 no-majority — classification: low-confidence, NO silent winner", async () => {
  const ledger = new VoteLedger();
  const voting = new VotingAiVerifier(
    new ScriptedVerifier(
      [],
      ["content_conflict", "content_conflict", "notation_variance", "notation_variance", "missing_from_source"],
    ),
    { samples: 5, confidenceThreshold: THRESHOLD },
    ledger,
  );

  await voting.classifyDiscrepancy(classifyRequest("birthYear"));
  const rec = ledger.all()[0];
  // 최다 2표(0.4) < 0.6 + 동률(2-2) → 저신뢰.
  assert.equal(rec.winnerVotes, 2);
  assert.equal(rec.confidence, 0.4);
  assert.equal(rec.lowConfidence, true);
  assert.deepEqual(rec.tally, { content_conflict: 2, missing_from_source: 1, notation_variance: 2 });
  assert.ok(lowConfidenceFieldsFromLedger(ledger).has("birthYear"), "split 분류는 검수중 field로 파이프라인에 전달됨");
});

// --- (5) 안정성 단언 — 흔들리는 입력 → 동일한 voted 출력(실행 간 재현) -------
//   Iter-27이 관측하지 못한 것: 주입으로 raw 라벨을 실행마다 다르게 흔들되 다수결은 일정하게 두면,
//   voted 최종 라벨은 두 실행에서 byte-identical이어야 한다.

test("STABILITY — wavering raw labels with consistent majority produce identical voted output across runs", async () => {
  // 두 실행: raw 시퀀스의 '순서'는 다르지만 multiset(4 same, 1 different)은 같다.
  const runOnce = async (script: boolean[]) => {
    const ledger = new VoteLedger();
    const voting = new VotingAiVerifier(
      new ScriptedVerifier(script, []),
      { samples: 5, confidenceThreshold: THRESHOLD },
      ledger,
    );
    const result = await voting.matchEntity(matchRequest);
    return { result, rec: ledger.all()[0] };
  };

  const runA = await runOnce([true, true, false, true, true]); // different이 3번째
  const runB = await runOnce([false, true, true, true, true]); // different이 1번째 — 순서만 다름

  // voted 최종 라벨/표 분포가 실행 간 동일(흔들림이 안정 라벨로 흡수됨).
  assert.equal(runA.result.isSameEntity, runB.result.isSameEntity);
  assert.equal(runA.rec.label, runB.rec.label);
  assert.deepEqual(runA.rec.tally, runB.rec.tally, "같은 multiset → 같은 tally(결정성)");
  assert.equal(runA.rec.lowConfidence, runB.rec.lowConfidence);
});

test("STABILITY (pure tallyVotes) — same multiset, any order → identical outcome", () => {
  const orders: DiscrepancyKind[][] = [
    ["content_conflict", "content_conflict", "notation_variance", "content_conflict", "notation_variance"],
    ["notation_variance", "content_conflict", "content_conflict", "notation_variance", "content_conflict"],
    ["content_conflict", "notation_variance", "content_conflict", "notation_variance", "content_conflict"],
  ];
  const outcomes = orders.map((o) => tallyVotes(o, THRESHOLD));
  for (const o of outcomes) {
    assert.equal(o.label, outcomes[0].label);
    assert.deepEqual(o.tally, outcomes[0].tally);
    assert.equal(o.lowConfidence, outcomes[0].lowConfidence);
  }
});

// --- (4b) NO-SILENT-MERGE 종단 검증 — split 표가 파이프라인 끝까지 검수중으로 surface ----
//   가장 중요한 불변(#3·#4): tie 라벨이 detector에서 'llm_interface'(확정)로 둔갑하지 않고
//   'llm_interface_low_confidence'(검수중)로 표시되는지 end-to-end로 확인한다.

test("NO SILENT MERGE — a tie vote is surfaced as llm_interface_low_confidence in the final profile, never silently confirmed", async () => {
  // tie를 내는 분류 투표 → 저신뢰 field 도출.
  const ledger = new VoteLedger();
  const voting = new VotingAiVerifier(
    new ScriptedVerifier([], ["content_conflict", "notation_variance", "content_conflict", "notation_variance"]),
    { samples: 4, confidenceThreshold: THRESHOLD },
    ledger,
  );
  await voting.classifyDiscrepancy(classifyRequest("district"));

  const lowFields = lowConfidenceFieldsFromLedger(ledger);
  assert.ok(lowFields.has("district"), "tie 분류는 저신뢰 field로 surface");

  const profiles: PoliticianProfile[] = [profileWith([discrepancy("district"), discrepancy("education")])];
  const marked = markDiscrepancyConfidence(profiles, lowFields);
  const byField = new Map(marked[0].discrepancies.map((d) => [d.field, d.detector]));

  assert.equal(
    byField.get("district"),
    "llm_interface_low_confidence",
    "split/tie field는 검수중으로 표시 — 조용히 확정되지 않음(FAIL이면 원칙 위반)",
  );
  assert.equal(byField.get("education"), "llm_interface", "확정 분류는 그대로 llm_interface");
});

// --- 헬퍼(파이프라인 marking용) --------------------------------------------

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
