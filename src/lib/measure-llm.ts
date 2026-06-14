import type { AiVerifier } from "./ai";
import { mockSyncVerifier } from "./ai";
import type {
  DiscrepancyKind,
  EntityMatchResult,
  EvidenceValue,
  SourceMeta,
} from "./types";

/**
 * 로컬 LLM 측정 하네스의 순수 로직.
 *
 * 이 모듈은 사실을 생성하지 않는다(불변 원칙 #1). fixture의 expected 라벨은 모두 사람이 작성한
 * ground truth이며, 하네스는 LLM/규칙의 분류·정합 결과를 그 라벨에 **대조해 측정**할 뿐이다.
 * LLM 출력을 사실로 취급하거나 source-review dossier를 바꾸지 않는다.
 *
 * fixture 로딩/파싱·요약 통계 계산은 전부 순수 함수로 두어 (Ollama 호출을 mock 한 채)
 * 유닛 테스트로 검증한다. 실제 라이브 측정은 scripts/measure-llm.ts에서 opt-in으로만 돈다.
 */

// ---------------------------------------------------------------------------
// Fixture shapes (mirror fixtures/verification-cases.json)
// ---------------------------------------------------------------------------

export type FixtureCategory = "synonym" | "content_conflict" | "missing";

export interface EntityMatchCase {
  id: string;
  kind: "entity_match";
  valueA: string;
  valueB: string;
  expectedSameEntity: boolean;
  category: FixtureCategory;
  note: string;
}

export interface ClassificationCase {
  id: string;
  kind: "classification";
  field: string;
  evidences: { sourceOrg: string; rawText: string }[];
  expectedKind: DiscrepancyKind;
  category: FixtureCategory;
  note: string;
}

export interface VerificationFixtures {
  schema_version: string;
  entity_match_cases: EntityMatchCase[];
  classification_cases: ClassificationCase[];
}

const DISCREPANCY_KINDS: readonly DiscrepancyKind[] = [
  "notation_variance",
  "content_conflict",
  "missing_from_source",
];

/** fixture JSON을 형식 검증하며 로드한다. 잘못된 구조는 통과시키지 않고 throw 한다. */
export function parseFixtures(raw: unknown): VerificationFixtures {
  if (!isRecord(raw)) throw new Error("fixtures must be a JSON object");
  if (typeof raw.schema_version !== "string") throw new Error("fixtures require schema_version string");
  if (!Array.isArray(raw.entity_match_cases)) throw new Error("fixtures require entity_match_cases array");
  if (!Array.isArray(raw.classification_cases)) throw new Error("fixtures require classification_cases array");

  const entity_match_cases = raw.entity_match_cases.map(parseEntityMatchCase);
  const classification_cases = raw.classification_cases.map(parseClassificationCase);

  const ids = [...entity_match_cases, ...classification_cases].map((c) => c.id);
  const duplicate = ids.find((id, index) => ids.indexOf(id) !== index);
  if (duplicate) throw new Error(`duplicate fixture id: ${duplicate}`);

  return { schema_version: raw.schema_version, entity_match_cases, classification_cases };
}

function parseEntityMatchCase(value: unknown, index: number): EntityMatchCase {
  if (!isRecord(value)) throw new Error(`entity_match_cases[${index}] must be an object`);
  const id = requireString(value.id, `entity_match_cases[${index}].id`);
  if (typeof value.valueA !== "string" || typeof value.valueB !== "string") {
    throw new Error(`${id}: valueA/valueB must be strings`);
  }
  if (typeof value.expectedSameEntity !== "boolean") {
    throw new Error(`${id}: expectedSameEntity must be a boolean`);
  }
  return {
    id,
    kind: "entity_match",
    valueA: value.valueA,
    valueB: value.valueB,
    expectedSameEntity: value.expectedSameEntity,
    category: requireCategory(value.category, id),
    note: requireString(value.note, `${id}.note`),
  };
}

function parseClassificationCase(value: unknown, index: number): ClassificationCase {
  if (!isRecord(value)) throw new Error(`classification_cases[${index}] must be an object`);
  const id = requireString(value.id, `classification_cases[${index}].id`);
  const field = requireString(value.field, `${id}.field`);
  if (!Array.isArray(value.evidences) || value.evidences.length < 2) {
    throw new Error(`${id}: evidences must be an array of at least 2 entries`);
  }
  const evidences = value.evidences.map((evidence, i) => {
    if (!isRecord(evidence)) throw new Error(`${id}.evidences[${i}] must be an object`);
    return {
      sourceOrg: requireString(evidence.sourceOrg, `${id}.evidences[${i}].sourceOrg`),
      rawText: requireString(evidence.rawText, `${id}.evidences[${i}].rawText`),
    };
  });
  if (!DISCREPANCY_KINDS.includes(value.expectedKind as DiscrepancyKind)) {
    throw new Error(`${id}: expectedKind must be one of ${DISCREPANCY_KINDS.join(", ")}`);
  }
  return {
    id,
    kind: "classification",
    field,
    evidences,
    expectedKind: value.expectedKind as DiscrepancyKind,
    category: requireCategory(value.category, id),
    note: requireString(value.note, `${id}.note`),
  };
}

// ---------------------------------------------------------------------------
// Building verifier requests from fixtures (no facts created — only restructuring)
// ---------------------------------------------------------------------------

function measurementSource(sourceOrg: string): SourceMeta {
  return {
    sourceId: `measure-${sourceOrg}`,
    sourceKind: "mock",
    sourceOrg,
    sourceUrl: "https://example.invalid/measurement-fixture",
    fetchedAt: "1970-01-01T00:00:00.000Z",
    licenseNote: "MEASUREMENT FIXTURE ONLY - not a published fact",
  };
}

function fixtureEvidence(rawText: string, sourceOrg: string, field = "fixture"): EvidenceValue<string> {
  return {
    evidenceId: `ev-${sourceOrg}-${rawText}`,
    category: "education",
    field,
    value: rawText,
    rawText,
    source: measurementSource(sourceOrg),
    reviewStatus: "reviewing",
  };
}

// ---------------------------------------------------------------------------
// Per-case results
// ---------------------------------------------------------------------------

export interface EntityMatchCaseResult {
  id: string;
  kind: "entity_match";
  category: FixtureCategory;
  expected: boolean;
  ruleResult: boolean;
  llmResult: boolean;
  llmConfidence: number;
  ruleCorrect: boolean;
  llmCorrect: boolean;
  agreement: boolean;
  latencyMs: number;
}

export interface ClassificationCaseResult {
  id: string;
  kind: "classification";
  category: FixtureCategory;
  field: string;
  expected: DiscrepancyKind;
  ruleResult: DiscrepancyKind;
  llmResult: DiscrepancyKind;
  ruleCorrect: boolean;
  llmCorrect: boolean;
  agreement: boolean;
  latencyMs: number;
}

export type CaseResult = EntityMatchCaseResult | ClassificationCaseResult;

/** ms를 재는 시계. 테스트에서 결정적 값으로 주입할 수 있다. */
export type Clock = () => number;

const defaultClock: Clock = () =>
  typeof performance !== "undefined" ? performance.now() : Date.now();

/**
 * 단일 entity-match 케이스를 규칙·LLM 양쪽으로 돌려 결과를 비교한다.
 * 규칙 결과는 mockSyncVerifier(현장의 fallback 경로와 동일 로직)에서 가져온다.
 */
export async function runEntityMatchCase(
  fixture: EntityMatchCase,
  ai: AiVerifier,
  clock: Clock = defaultClock,
): Promise<EntityMatchCaseResult> {
  const candidateA = fixtureEvidence(fixture.valueA, "A");
  const candidateB = fixtureEvidence(fixture.valueB, "B");

  const ruleResult = mockSyncVerifier.matchEntity({ candidateA, candidateB }).isSameEntity;

  const start = clock();
  const llm: EntityMatchResult = await ai.matchEntity({ candidateA, candidateB });
  const latencyMs = clock() - start;

  return {
    id: fixture.id,
    kind: "entity_match",
    category: fixture.category,
    expected: fixture.expectedSameEntity,
    ruleResult,
    llmResult: llm.isSameEntity,
    llmConfidence: llm.confidence,
    ruleCorrect: ruleResult === fixture.expectedSameEntity,
    llmCorrect: llm.isSameEntity === fixture.expectedSameEntity,
    agreement: ruleResult === llm.isSameEntity,
    latencyMs,
  };
}

/** 단일 classification 케이스를 규칙·LLM 양쪽으로 돌려 비교한다. */
export async function runClassificationCase(
  fixture: ClassificationCase,
  ai: AiVerifier,
  clock: Clock = defaultClock,
): Promise<ClassificationCaseResult> {
  const evidences = fixture.evidences.map((evidence) =>
    fixtureEvidence(evidence.rawText, evidence.sourceOrg, fixture.field),
  );

  const ruleResult = mockSyncVerifier.classifyDiscrepancy(fixture.field, evidences);

  const start = clock();
  const llmResult = await ai.classifyDiscrepancy({ field: fixture.field, evidences });
  const latencyMs = clock() - start;

  return {
    id: fixture.id,
    kind: "classification",
    category: fixture.category,
    field: fixture.field,
    expected: fixture.expectedKind,
    ruleResult,
    llmResult,
    ruleCorrect: ruleResult === fixture.expectedKind,
    llmCorrect: llmResult === fixture.expectedKind,
    agreement: ruleResult === llmResult,
    latencyMs,
  };
}

/** fixture 전체를 순서대로 돌려 per-case 결과 배열을 만든다. */
export async function runAllCases(
  fixtures: VerificationFixtures,
  ai: AiVerifier,
  clock: Clock = defaultClock,
): Promise<CaseResult[]> {
  const results: CaseResult[] = [];
  for (const fixture of fixtures.entity_match_cases) {
    results.push(await runEntityMatchCase(fixture, ai, clock));
  }
  for (const fixture of fixtures.classification_cases) {
    results.push(await runClassificationCase(fixture, ai, clock));
  }
  return results;
}

// ---------------------------------------------------------------------------
// Summary math
// ---------------------------------------------------------------------------

export interface CategoryAccuracy {
  category: FixtureCategory;
  total: number;
  llmCorrect: number;
  ruleCorrect: number;
}

export interface MeasurementSummary {
  totalCases: number;
  llmCorrect: number;
  ruleCorrect: number;
  /** LLM이 규칙의 오분류를 바로잡은 케이스 수 (rule wrong, llm right). */
  llmCorrections: number;
  /** 회귀: 규칙은 맞았는데 LLM이 틀린 케이스 수 (rule right, llm wrong). */
  regressions: number;
  perCategory: CategoryAccuracy[];
  latencyP50Ms: number;
  latencyP95Ms: number;
}

export function summarize(results: CaseResult[]): MeasurementSummary {
  const llmCorrect = results.filter((r) => r.llmCorrect).length;
  const ruleCorrect = results.filter((r) => r.ruleCorrect).length;
  const llmCorrections = results.filter((r) => !r.ruleCorrect && r.llmCorrect).length;
  const regressions = results.filter((r) => r.ruleCorrect && !r.llmCorrect).length;

  const categories = [...new Set(results.map((r) => r.category))];
  const perCategory: CategoryAccuracy[] = categories.map((category) => {
    const inCategory = results.filter((r) => r.category === category);
    return {
      category,
      total: inCategory.length,
      llmCorrect: inCategory.filter((r) => r.llmCorrect).length,
      ruleCorrect: inCategory.filter((r) => r.ruleCorrect).length,
    };
  });

  const latencies = results.map((r) => r.latencyMs);

  return {
    totalCases: results.length,
    llmCorrect,
    ruleCorrect,
    llmCorrections,
    regressions,
    perCategory,
    latencyP50Ms: percentile(latencies, 50),
    latencyP95Ms: percentile(latencies, 95),
  };
}

/** nearest-rank percentile. 빈 배열은 0. */
export function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.ceil((p / 100) * sorted.length);
  const index = Math.min(Math.max(rank, 1), sorted.length) - 1;
  return sorted[index];
}

// ---------------------------------------------------------------------------
// Determinism check
// ---------------------------------------------------------------------------

/**
 * 분류/정합 결과만 추려 비교용 정규형으로 직렬화한다(지연 시간은 제외 — 결정성과 무관).
 *
 * `labelOnly`: entity_match의 `llmConfidence`(float)를 지문에서 제외한다. **검증된 분류 라벨만**
 * 결정성의 대상이므로(같은 항목 여부 / 불일치 종류), voting 게이트는 label-only로 비교한다.
 * raw 진단은 기존대로 confidence까지 포함해 모델 단독의 흔들림을 빠짐없이 드러낸다.
 */
export function classificationFingerprint(results: CaseResult[], labelOnly = false): string {
  const projected = results.map((r) =>
    r.kind === "entity_match" && !labelOnly
      ? { id: r.id, kind: r.kind, llmResult: r.llmResult, llmConfidence: r.llmConfidence }
      : { id: r.id, kind: r.kind, llmResult: r.llmResult },
  );
  return JSON.stringify(projected);
}

export interface DeterminismResult {
  deterministic: boolean;
  /** 두 실행에서 분류가 달라진 케이스 id 목록. */
  divergentIds: string[];
}

/**
 * 두 실행의 분류 라벨이 같은지 비교한다.
 * `labelOnly`(기본 false): entity_match의 confidence float까지 비교(raw 진단용 — 엄격).
 * true면 라벨(`llmResult`)만 비교(voting 게이트용 — confidence 흔들림은 무시, 라벨만 본다).
 */
export function compareForDeterminism(
  runA: CaseResult[],
  runB: CaseResult[],
  labelOnly = false,
): DeterminismResult {
  const byIdB = new Map(runB.map((r) => [r.id, r] as const));
  const divergentIds: string[] = [];

  for (const a of runA) {
    const b = byIdB.get(a.id);
    if (!b) {
      divergentIds.push(a.id);
      continue;
    }
    if (a.kind === "entity_match" && b.kind === "entity_match") {
      const confidenceDiverged = !labelOnly && a.llmConfidence !== b.llmConfidence;
      if (a.llmResult !== b.llmResult || confidenceDiverged) divergentIds.push(a.id);
    } else if (a.kind === "classification" && b.kind === "classification") {
      if (a.llmResult !== b.llmResult) divergentIds.push(a.id);
    } else {
      divergentIds.push(a.id);
    }
  }

  return { deterministic: divergentIds.length === 0, divergentIds };
}

// ---------------------------------------------------------------------------
// Machine-readable report
// ---------------------------------------------------------------------------

export interface MeasurementReport {
  generatedAt: string;
  model: string;
  baseUrl: string;
  fixturesSchemaVersion: string;
  summary: MeasurementSummary;
  determinism: DeterminismResult;
  cases: CaseResult[];
}

export interface BuildReportInput {
  generatedAt: string;
  model: string;
  baseUrl: string;
  fixtures: VerificationFixtures;
  results: CaseResult[];
  determinism: DeterminismResult;
}

export function buildReport(input: BuildReportInput): MeasurementReport {
  return {
    generatedAt: input.generatedAt,
    model: input.model,
    baseUrl: input.baseUrl,
    fixturesSchemaVersion: input.fixtures.schema_version,
    summary: summarize(input.results),
    determinism: input.determinism,
    cases: input.results,
  };
}

// ---------------------------------------------------------------------------
// Human-readable table
// ---------------------------------------------------------------------------

export function formatSummaryTable(report: MeasurementReport): string {
  const { summary } = report;
  const lines: string[] = [];

  lines.push(`model: ${report.model}   baseUrl: ${report.baseUrl}`);
  lines.push(`fixtures schema: ${report.fixturesSchemaVersion}   cases: ${summary.totalCases}`);
  lines.push("");
  lines.push("per-category accuracy (LLM vs expected | rule vs expected):");
  for (const cat of summary.perCategory) {
    lines.push(
      `  ${cat.category.padEnd(18)} LLM ${cat.llmCorrect}/${cat.total}   rule ${cat.ruleCorrect}/${cat.total}`,
    );
  }
  lines.push("");
  lines.push(`overall LLM correct:   ${summary.llmCorrect}/${summary.totalCases}`);
  lines.push(`overall rule correct:  ${summary.ruleCorrect}/${summary.totalCases}`);
  lines.push(`LLM corrected rule:    ${summary.llmCorrections}`);
  lines.push(`regressions (LLM worse): ${summary.regressions}`);
  lines.push(`latency p50 / p95 (ms): ${summary.latencyP50Ms.toFixed(0)} / ${summary.latencyP95Ms.toFixed(0)}`);
  lines.push("");
  lines.push(
    `determinism (run x2): ${report.determinism.deterministic ? "PASS (byte-identical classifications)" : `FAIL — divergent: ${report.determinism.divergentIds.join(", ")}`}`,
  );
  lines.push("");
  lines.push("per-case:");
  lines.push(
    `  ${"id".padEnd(34)} ${"cat".padEnd(16)} expected            rule   llm    ✓?`,
  );
  for (const c of report.cases) {
    const expected = String(c.expected);
    const rule = String(c.ruleResult);
    const llm = String(c.llmResult);
    const mark = c.llmCorrect ? "ok" : "X";
    lines.push(
      `  ${c.id.padEnd(34)} ${c.category.padEnd(16)} ${expected.padEnd(19)} ${rule.padEnd(6)} ${llm.padEnd(6)} ${mark}`,
    );
  }

  return lines.join("\n");
}

// ---------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} must be a non-empty string`);
  return value;
}

function requireCategory(value: unknown, id: string): FixtureCategory {
  if (value === "synonym" || value === "content_conflict" || value === "missing") return value;
  throw new Error(`${id}: category must be synonym | content_conflict | missing`);
}
