import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import type { AiVerifier } from "../src/lib/ai";
import {
  buildReport,
  classificationFingerprint,
  compareForDeterminism,
  formatSummaryTable,
  parseFixtures,
  percentile,
  runAllCases,
  runClassificationCase,
  runEntityMatchCase,
  summarize,
  type CaseResult,
  type ClassificationCase,
  type EntityMatchCase,
  type VerificationFixtures,
} from "../src/lib/measure-llm";
import type { DiscrepancyClassificationRequest, DiscrepancyKind, EntityMatchRequest } from "../src/lib/types";

// --- a fully scripted AiVerifier so no Ollama is needed -------------------

interface ScriptedConfig {
  match?: (a: string, b: string) => { isSameEntity: boolean; confidence: number };
  classify?: (field: string, texts: string[]) => DiscrepancyKind;
}

class ScriptedVerifier implements AiVerifier {
  constructor(private readonly cfg: ScriptedConfig) {}

  async matchEntity(request: EntityMatchRequest) {
    const a = String(request.candidateA.rawText);
    const b = String(request.candidateB.rawText);
    const out = this.cfg.match?.(a, b) ?? { isSameEntity: false, confidence: 0 };
    return { ...out, rationale: "scripted" };
  }

  async classifyDiscrepancy(request: DiscrepancyClassificationRequest) {
    const texts = request.evidences.map((e) => String(e.rawText));
    return this.cfg.classify?.(request.field, texts) ?? "content_conflict";
  }

  async answerWithCitations() {
    return { answer: "관련 자료 없음", citations: [], status: "no_material" as const };
  }
}

const fixedClock = () => {
  let t = 0;
  return () => (t += 10);
};

// --- fixture parsing -------------------------------------------------------

test("parseFixtures loads the version-controlled fixture file", async () => {
  const raw = await readFile(join(process.cwd(), "fixtures", "verification-cases.json"), "utf8");
  const fixtures = parseFixtures(JSON.parse(raw));

  assert.ok(fixtures.entity_match_cases.length >= 6, "need the canonical case + >=5 more synonym pairs");
  assert.ok(
    fixtures.classification_cases.filter((c) => c.expectedKind === "content_conflict").length >= 3,
    "need >=3 genuine content_conflict cases",
  );
  // canonical synonym gap present.
  assert.ok(
    fixtures.entity_match_cases.some((c) => c.valueA.includes("경제학과") && c.valueB.includes("경제학 학사")),
    "canonical 경제학과 ≈ 경제학 학사 case must be present",
  );
});

test("parseFixtures rejects malformed input", () => {
  assert.throws(() => parseFixtures(null), /must be a JSON object/);
  assert.throws(() => parseFixtures({ schema_version: "1", entity_match_cases: [], classification_cases: {} }), /classification_cases/);
  assert.throws(
    () =>
      parseFixtures({
        schema_version: "1",
        entity_match_cases: [{ id: "x", valueA: "a", valueB: "b", expectedSameEntity: "yes", category: "synonym", note: "n" }],
        classification_cases: [],
      }),
    /expectedSameEntity must be a boolean/,
  );
  assert.throws(
    () =>
      parseFixtures({
        schema_version: "1",
        entity_match_cases: [{ id: "x", valueA: "a", valueB: "b", expectedSameEntity: true, category: "bad", note: "n" }],
        classification_cases: [],
      }),
    /category must be/,
  );
});

test("parseFixtures rejects duplicate ids", () => {
  assert.throws(
    () =>
      parseFixtures({
        schema_version: "1",
        entity_match_cases: [{ id: "dup", valueA: "a", valueB: "b", expectedSameEntity: true, category: "synonym", note: "n" }],
        classification_cases: [
          { id: "dup", field: "f", evidences: [{ sourceOrg: "x", rawText: "a" }, { sourceOrg: "y", rawText: "b" }], expectedKind: "content_conflict", category: "content_conflict", note: "n" },
        ],
      }),
    /duplicate fixture id: dup/,
  );
});

// --- per-case execution ----------------------------------------------------

const matchCase: EntityMatchCase = {
  id: "m1",
  kind: "entity_match",
  valueA: "A대 경제학과 졸업",
  valueB: "A대 경제학 학사",
  expectedSameEntity: true,
  category: "synonym",
  note: "n",
};

const classifyCase: ClassificationCase = {
  id: "c1",
  kind: "classification",
  field: "education",
  evidences: [
    { sourceOrg: "열린국회정보", rawText: "A대 경제학과 졸업" },
    { sourceOrg: "헌정회", rawText: "A대 경제학 학사" },
  ],
  expectedKind: "notation_variance",
  category: "synonym",
  note: "n",
};

test("runEntityMatchCase records rule vs llm vs expected and latency", async () => {
  // 규칙은 substring 미포함이라 false(오분류), LLM은 same으로 교정.
  const verifier = new ScriptedVerifier({ match: () => ({ isSameEntity: true, confidence: 0.88 }) });
  const result = await runEntityMatchCase(matchCase, verifier, fixedClock());

  assert.equal(result.ruleResult, false, "rule matcher misses this synonym pair");
  assert.equal(result.ruleCorrect, false);
  assert.equal(result.llmResult, true);
  assert.equal(result.llmCorrect, true);
  assert.equal(result.llmConfidence, 0.88);
  assert.equal(result.agreement, false);
  assert.equal(result.latencyMs, 10);
});

test("runClassificationCase compares rule and llm classification", async () => {
  const verifier = new ScriptedVerifier({ classify: () => "notation_variance" });
  const result = await runClassificationCase(classifyCase, verifier, fixedClock());

  assert.equal(result.expected, "notation_variance");
  assert.equal(result.llmResult, "notation_variance");
  assert.equal(result.llmCorrect, true);
  // rule classifier treats non-substring different texts as content_conflict → wrong here.
  assert.equal(result.ruleResult, "content_conflict");
  assert.equal(result.ruleCorrect, false);
});

// --- summary math ----------------------------------------------------------

test("summarize counts corrections, regressions, per-category accuracy", () => {
  const results: CaseResult[] = [
    { id: "a", kind: "entity_match", category: "synonym", expected: true, ruleResult: false, llmResult: true, llmConfidence: 0.9, ruleCorrect: false, llmCorrect: true, agreement: false, latencyMs: 100 },
    { id: "b", kind: "entity_match", category: "synonym", expected: true, ruleResult: true, llmResult: false, llmConfidence: 0.4, ruleCorrect: true, llmCorrect: false, agreement: false, latencyMs: 200 },
    { id: "c", kind: "classification", category: "content_conflict", field: "education", expected: "content_conflict", ruleResult: "content_conflict", llmResult: "content_conflict", ruleCorrect: true, llmCorrect: true, agreement: true, latencyMs: 300 },
  ];

  const summary = summarize(results);
  assert.equal(summary.totalCases, 3);
  assert.equal(summary.llmCorrect, 2);
  assert.equal(summary.ruleCorrect, 2);
  assert.equal(summary.llmCorrections, 1, "case a: rule wrong, llm right");
  assert.equal(summary.regressions, 1, "case b: rule right, llm wrong");

  const synonym = summary.perCategory.find((c) => c.category === "synonym");
  assert.deepEqual(synonym, { category: "synonym", total: 2, llmCorrect: 1, ruleCorrect: 1 });

  assert.equal(summary.latencyP50Ms, 200);
  assert.equal(summary.latencyP95Ms, 300);
});

test("percentile uses nearest-rank and handles empty", () => {
  assert.equal(percentile([], 50), 0);
  assert.equal(percentile([10], 95), 10);
  assert.equal(percentile([1, 2, 3, 4], 50), 2);
  assert.equal(percentile([1, 2, 3, 4], 100), 4);
});

// --- determinism -----------------------------------------------------------

test("compareForDeterminism passes on identical runs and flags divergence", async () => {
  const stable = new ScriptedVerifier({
    match: () => ({ isSameEntity: true, confidence: 0.8 }),
    classify: () => "notation_variance",
  });
  const fixtures: VerificationFixtures = {
    schema_version: "1",
    entity_match_cases: [matchCase],
    classification_cases: [classifyCase],
  };

  const runA = await runAllCases(fixtures, stable, fixedClock());
  const runB = await runAllCases(fixtures, stable, fixedClock());
  assert.equal(classificationFingerprint(runA), classificationFingerprint(runB));
  assert.equal(compareForDeterminism(runA, runB).deterministic, true);

  // flip one classification on the second run.
  const mutated = runB.map((r) =>
    r.id === "c1" && r.kind === "classification" ? { ...r, llmResult: "content_conflict" as DiscrepancyKind } : r,
  );
  const cmp = compareForDeterminism(runA, mutated);
  assert.equal(cmp.deterministic, false);
  assert.deepEqual(cmp.divergentIds, ["c1"]);
});

// --- report / table --------------------------------------------------------

test("buildReport and formatSummaryTable produce a readable report", async () => {
  const verifier = new ScriptedVerifier({
    match: () => ({ isSameEntity: true, confidence: 0.8 }),
    classify: () => "notation_variance",
  });
  const fixtures: VerificationFixtures = {
    schema_version: "1.0.0",
    entity_match_cases: [matchCase],
    classification_cases: [classifyCase],
  };
  const results = await runAllCases(fixtures, verifier, fixedClock());
  const report = buildReport({
    generatedAt: "2026-06-12T00:00:00.000Z",
    model: "qwen3:4b",
    baseUrl: "http://localhost:11434",
    fixtures,
    results,
    determinism: { deterministic: true, divergentIds: [] },
  });

  assert.equal(report.model, "qwen3:4b");
  assert.equal(report.fixturesSchemaVersion, "1.0.0");
  assert.equal(report.summary.totalCases, 2);

  const table = formatSummaryTable(report);
  assert.match(table, /qwen3:4b/);
  assert.match(table, /per-category accuracy/);
  assert.match(table, /determinism \(run x2\): PASS/);
  assert.match(table, /m1/);
});
