import assert from "node:assert/strict";
import test from "node:test";
import { mockSyncVerifier } from "../src/lib/ai";
import {
  attachDetectedDiscrepancies,
  detectProfileDiscrepancies,
  detectProfileDiscrepanciesSync,
} from "../src/lib/cross-verification";
import { runVerificationPipeline } from "../src/lib/verification";
import { MockCollector } from "../src/lib/collectors/mock";
import type { EvidenceValue, PoliticianProfile, SourceMeta } from "../src/lib/types";

const source = (sourceId: string): SourceMeta => ({
  sourceId,
  sourceKind: "mock",
  sourceOrg: sourceId,
  sourceUrl: `https://example.invalid/${sourceId}`,
  fetchedAt: "2026-06-11T00:00:00.000Z",
  licenseNote: "MOCK DATA ONLY - test",
});

const evidence = (
  evidenceId: string,
  field: string,
  value: string,
  rawText: string,
  sourceId: string,
  category: EvidenceValue<string>["category"] = "identity",
): EvidenceValue<string> => ({
  evidenceId,
  category,
  field,
  value,
  rawText,
  source: source(sourceId),
  reviewStatus: "reviewing",
});

const emptyProfile = (overrides: Partial<PoliticianProfile>): PoliticianProfile => ({
  politicianId: "p-1",
  displayName: "테스트",
  party: [],
  district: [],
  position: [],
  committeeRole: [],
  contact: [],
  birthYear: [],
  gender: [],
  education: [],
  careers: [],
  partyHistory: [],
  elections: [],
  activities: { bills: [], votes: [], committees: [] },
  discrepancies: [],
  news: [],
  ...overrides,
});

test("no discrepancy when a single source provides the field", () => {
  const profile = emptyProfile({
    education: [evidence("e1", "education", "A대 경제학과", "A대 경제학과", "oa", "education")],
  });

  const discrepancies = detectProfileDiscrepanciesSync(profile, mockSyncVerifier, { detectedAt: "t" });
  assert.equal(discrepancies.length, 0);
});

test("no discrepancy when multiple sources agree exactly (same item, same notation)", () => {
  const profile = emptyProfile({
    party: [
      evidence("p-oa", "party", "가상정당", "가상정당", "oa"),
      evidence("p-nec", "party", "가상정당", "가상정당", "nec"),
    ],
  });

  const discrepancies = detectProfileDiscrepanciesSync(profile, mockSyncVerifier, { detectedAt: "t" });
  assert.equal(discrepancies.length, 0);
});

test("notation_variance: same item, different notation (substring match)", () => {
  const profile = emptyProfile({
    careers: [
      evidence("c-oa", "career", "국회 공개정책연구회 연구위원", "국회 공개정책연구회 연구위원", "oa", "career"),
      evidence("c-rokps", "career", "공개정책연구회 연구위원", "공개정책연구회 연구위원", "rokps", "career"),
    ],
  });

  const [discrepancy] = detectProfileDiscrepanciesSync(profile, mockSyncVerifier, { detectedAt: "t" });
  assert.ok(discrepancy);
  assert.equal(discrepancy.kind, "notation_variance");
  assert.equal(discrepancy.category, "career");
  // 모든 출처 evidence를 보존한다(병합 금지).
  assert.deepEqual(discrepancy.evidenceIds, ["c-oa", "c-rokps"]);
});

test("content_conflict: sources do not match as the same item", () => {
  const profile = emptyProfile({
    education: [
      evidence("e-oa", "education", "A대 행정학과 졸업", "A대 행정학과 졸업", "oa", "education"),
      evidence("e-nec", "education", "A대 정치외교학과 졸업", "A대 정치외교학과 졸업", "nec", "education"),
    ],
  });

  const [discrepancy] = detectProfileDiscrepanciesSync(profile, mockSyncVerifier, { detectedAt: "t" });
  assert.ok(discrepancy);
  assert.equal(discrepancy.kind, "content_conflict");
  assert.equal(discrepancy.evidenceIds.length, 2);
});

test("missing_from_source: same notation but more sources than distinct texts", () => {
  // 세 출처가 모두 같은 표기 → 분류기는 정보 누락으로 본다. 단 같은 표기는 불일치 미발생이므로
  // 분류 로직 자체를 직접 검증한다.
  const evidences = [
    evidence("m1", "committees", "공공정보위원회", "공공정보위원회", "oa", "committee"),
    evidence("m2", "committees", "공공정보위원회", "공공정보위원회", "nec", "committee"),
  ];
  assert.equal(mockSyncVerifier.classifyDiscrepancy("committees", evidences), "missing_from_source");
});

test("all source values are preserved (never merged) in evidenceIds", () => {
  const profile = emptyProfile({
    education: [
      evidence("e-a", "education", "A대 경제학과", "A대 경제학과", "oa", "education"),
      evidence("e-b", "education", "A대 경제학 학사", "A대 경제학 학사", "rokps", "education"),
      evidence("e-c", "education", "A대 경영학과", "A대 경영학과", "nec", "education"),
    ],
  });

  const [discrepancy] = detectProfileDiscrepanciesSync(profile, mockSyncVerifier, { detectedAt: "t" });
  assert.ok(discrepancy);
  assert.deepEqual(discrepancy.evidenceIds.sort(), ["e-a", "e-b", "e-c"]);
});

test("async detect matches the sync core result", async () => {
  const profile = emptyProfile({
    activities: {
      bills: [],
      votes: [],
      committees: [
        evidence("k-oa", "committees", "데이터투명성특별위원회", "데이터투명성특별위원회", "oa", "committee"),
        evidence("k-rokps", "committees", "자료투명성특별위원회", "자료투명성특별위원회", "rokps", "committee"),
      ],
    },
  });

  const sync = detectProfileDiscrepanciesSync(profile, mockSyncVerifier, { detectedAt: "t" });
  const { MockAiVerifier } = await import("../src/lib/ai");
  const asyncResult = await detectProfileDiscrepancies(profile, new MockAiVerifier(), { detectedAt: "t" });
  assert.deepEqual(asyncResult, sync);
});

test("attachDetectedDiscrepancies discards pre-existing discrepancies and re-detects", async () => {
  const { MockAiVerifier } = await import("../src/lib/ai");
  const profile = emptyProfile({
    education: [
      evidence("e-oa", "education", "A대 행정학과", "A대 행정학과", "oa", "education"),
      evidence("e-nec", "education", "A대 정치외교학과", "A대 정치외교학과", "nec", "education"),
    ],
    discrepancies: [
      {
        discrepancyId: "stale",
        category: "education",
        field: "education",
        kind: "notation_variance",
        label: "stale hand-authored",
        evidenceIds: ["e-oa"],
        detectedAt: "old",
        detector: "rule",
      },
    ],
  });

  const detected = await attachDetectedDiscrepancies(profile, new MockAiVerifier(), { detectedAt: "t" });
  assert.ok(!detected.discrepancies.some((d) => d.discrepancyId === "stale"));
  assert.equal(detected.discrepancies[0]?.detectedAt, "t");
});

test("pipeline detects discrepancies from mock collector instead of reading pre-baked ones", async () => {
  const result = await runVerificationPipeline(new MockCollector());

  assert.ok(result.discrepancies.length > 0);
  // 탐지로 생성되었으므로 detector는 rule이고, 모든 discrepancy는 evidence를 2개 이상 참조한다.
  for (const discrepancy of result.discrepancies) {
    assert.equal(discrepancy.detector, "rule");
    assert.ok(discrepancy.evidenceIds.length >= 2);
  }
});
