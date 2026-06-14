import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  classificationFingerprint,
  parseFixtures,
  runAllCases,
  type CaseResult,
  type VerificationFixtures,
} from "../src/lib/measure-llm";
import { isOllamaReachable, ollamaConfigFromEnv, OllamaAiVerifier } from "../src/lib/ollama";
import {
  ResilientAiVerifier,
  VoteLedger,
  VotingAiVerifier,
  votingConfigFromEnv,
} from "../src/lib/voting-verifier";

/**
 * Iteration 27 — self-consistency voting의 라벨 안정화 효과를 라이브 qwen3:4b에서 실측한다.
 *
 * 핵심 질문: 투표가 qwen3:4b의 실행 간 비결정성을 byte-identical 분류 라벨로 바꾸는가 — stub이
 * 아니라 REAL 모델 출력에서. Iteration 26의 게이트는 FlakyVerifier stub으로 구성상 보장만 증명했고,
 * 유일했던 라이브 run은 60s 타임아웃으로 23건 mock fallback해 사실상 mock 결정이었다.
 *
 * 이 하네스는 그 빈틈을 메운다:
 *  1) 같은 작은 fixture를 VOTED(samples=N) R회 + CONTROL(samples=1) R회 end-to-end로 돌린다.
 *  2) **mock fallback이 1건이라도 있으면 LOUD하게 실패**한다 — fallback 오염된 run을 실측으로
 *     오인할 수 없게(과제 1의 hard guard). fallback율을 명시 보고한다(실측이 성립하려면 ~0).
 *  3) per-case 라벨 agreement(R회에서 byte-identical인가)를 VOTED vs CONTROL로 정량화한다.
 *  4) per-case 표 분포(깨끗한 다수결 vs 저신뢰로 갈린 split)를 기록한다 → N=5가 적절한지 판단.
 *
 * 불변 원칙: 투표는 라벨만 안정화한다(#1 — 사실 생성 없음). source-review dossier·공개 스냅샷을
 * 건드리지 않는다. 결과 JSON은 gitignore된 data/internal/measurements에만 떨군다(#8).
 *
 * 라이브 전용: Ollama에 닿지 않거나 모델이 없으면 mock으로 떨어지지 않고 즉시 non-zero 종료한다
 * (실측이 목적이므로 mock 측정은 의미가 없다).
 */

const fixturesPath = join(process.cwd(), "fixtures", "verification-cases.json");
const resultsDir = join(process.cwd(), "data", "internal", "measurements");

/** VOTED 반복 횟수(기본 3 — 과제 명시 "≥3 repeats"). 비싸므로(분당 수십 호출) 작게 둔다. */
const REPEATS = Math.max(3, Number(process.env.VOTING_STABILITY_REPEATS) || 3);
/**
 * CONTROL(samples=1) 반복 횟수. VOTED와 독립으로 더 크게 둘 수 있다 — control은 6×(samples) 싸므로
 * baseline이 발산할 기회를 더 주려면 이 값을 키운다(투표 귀속 검정 강화). 기본은 VOTED와 동일.
 */
const CONTROL_REPEATS = Math.max(REPEATS, Number(process.env.VOTING_STABILITY_CONTROL_REPEATS) || REPEATS);

interface RepeatRun {
  repeat: number;
  results: CaseResult[];
  /** 라벨만 본 지문(이 run의 분류 라벨 정규형). */
  labelFingerprint: string;
  /** 이 run에서 mock으로 떨어진 라이브 호출 수. 실측이 성립하려면 0이어야 한다. */
  fallbacks: number;
  /** 이 run의 표 분포(VOTED만 — CONTROL은 samples=1이라 분포가 무의미). */
  ledger?: VoteRecordLite[];
  wallMs: number;
}

interface VoteRecordLite {
  kind: string;
  inputKey: string;
  label: string;
  tally: Record<string, number>;
  winnerVotes: number;
  totalVotes: number;
  confidence: number;
  lowConfidence: boolean;
}

/** 한 케이스가 R회에서 라벨이 몇 가지로 갈렸는지 — 1이면 완전 안정(byte-identical). */
interface CaseAgreement {
  id: string;
  kind: string;
  /** R회 동안 관측된 distinct 라벨 → 등장 횟수. */
  labelCounts: Record<string, number>;
  distinctLabels: number;
  stable: boolean;
}

async function main() {
  const config = ollamaConfigFromEnv();

  // 1) 라이브 도달성 — mock fallback 없이 즉시 실패(실측 전용).
  const reachable = await isOllamaReachable(config);
  if (!reachable.ok) {
    console.error(
      [
        `[voting-stability] Ollama is NOT reachable at ${config.baseUrl} (${reachable.reason}).`,
        "This harness measures the LIVE model and never falls back to mock.",
        "Start Ollama and pull the model first (see docs/LOCAL_LLM_SETUP.md):",
        "  ollama pull qwen3:4b",
      ].join("\n"),
    );
    process.exit(1);
  }

  const fixtures = parseFixtures(JSON.parse(await readFile(fixturesPath, "utf8")));
  const votingConfig = votingConfigFromEnv();
  const caseCount = fixtures.entity_match_cases.length + fixtures.classification_cases.length;

  console.log(
    `[voting-stability] live Ollama OK — model=${config.model} timeoutMs=${config.timeoutMs}\n` +
      `[voting-stability] ${caseCount} cases — VOTED(samples=${votingConfig.samples}) ×${REPEATS}, CONTROL(samples=1) ×${CONTROL_REPEATS}.\n` +
      `[voting-stability] HARD GUARD: any mock fallback aborts the measurement (a fallback-contaminated run does not count).`,
  );

  // VOTED: Voting(Resilient(Ollama)) — 프로덕션 배치와 동일 구성. 매 repeat마다 fresh ledger.
  const votedRuns = await runRepeats("VOTED", REPEATS, () => {
    const resilient = new ResilientAiVerifier(new OllamaAiVerifier(config));
    const ledger = new VoteLedger();
    const verifier = new VotingAiVerifier(resilient, votingConfig, ledger);
    return { verifier, resilient, ledger };
  }, fixtures, true);

  // CONTROL: samples=1 voting = 모델 단독(다수결 무력화). 같은 케이스에서 baseline이 여전히
  // 발산하는지 확인 → 투표가 안정화의 원인임을 입증(과제 2).
  const controlRuns = await runRepeats("CONTROL", CONTROL_REPEATS, () => {
    const resilient = new ResilientAiVerifier(new OllamaAiVerifier(config));
    const ledger = new VoteLedger();
    const verifier = new VotingAiVerifier(resilient, { ...votingConfig, samples: 1 }, ledger);
    return { verifier, resilient, ledger };
  }, fixtures, false);

  // 2) HARD GUARD: fallback이 한 건이라도 있으면 실측 무효 → loud fail.
  const totalFallbacks =
    sum(votedRuns.map((r) => r.fallbacks)) + sum(controlRuns.map((r) => r.fallbacks));
  const fallbackContaminated = totalFallbacks > 0;

  // 3) per-case agreement: R회에서 라벨이 byte-identical인가.
  const votedAgreement = perCaseAgreement(votedRuns);
  const controlAgreement = perCaseAgreement(controlRuns);

  // 라벨 지문이 R회 모두 동일한가(완전 안정).
  const votedFullyStable = allSame(votedRuns.map((r) => r.labelFingerprint));
  const controlFullyStable = allSame(controlRuns.map((r) => r.labelFingerprint));

  const report = {
    generatedAt: new Date().toISOString(),
    model: config.model,
    baseUrl: config.baseUrl,
    timeoutMs: config.timeoutMs,
    repeats: REPEATS,
    controlRepeats: CONTROL_REPEATS,
    voting: votingConfig,
    caseCount,
    fallback: {
      total: totalFallbacks,
      perVotedRun: votedRuns.map((r) => r.fallbacks),
      perControlRun: controlRuns.map((r) => r.fallbacks),
      contaminated: fallbackContaminated,
      note: "Measurement only counts if total === 0. Any fallback means some label was mock-decided.",
    },
    voted: {
      fullyStableAcrossRepeats: votedFullyStable,
      perCaseAgreement: votedAgreement,
      unstableCases: votedAgreement.filter((c) => !c.stable).map((c) => c.id),
      perRepeatLabelFingerprint: votedRuns.map((r) => r.labelFingerprint),
      voteDistributions: votedRuns.map((r) => ({ repeat: r.repeat, ledger: r.ledger })),
      wallMsPerRepeat: votedRuns.map((r) => r.wallMs),
    },
    control: {
      fullyStableAcrossRepeats: controlFullyStable,
      perCaseAgreement: controlAgreement,
      unstableCases: controlAgreement.filter((c) => !c.stable).map((c) => c.id),
      perRepeatLabelFingerprint: controlRuns.map((r) => r.labelFingerprint),
      wallMsPerRepeat: controlRuns.map((r) => r.wallMs),
    },
    verdict: buildVerdict(votedAgreement, controlAgreement, fallbackContaminated),
  };

  await mkdir(resultsDir, { recursive: true });
  const stamp = report.generatedAt.replace(/[:.]/g, "-");
  const json = `${JSON.stringify(report, null, 2)}\n`;
  await writeFile(join(resultsDir, `voting-stability-${stamp}.json`), json, "utf8");
  await writeFile(join(resultsDir, "voting-stability-latest.json"), json, "utf8");

  // 4) 사람이 읽을 요약.
  console.log("");
  console.log("=".repeat(72));
  console.log(`fallback: total=${totalFallbacks} (voted ${report.fallback.perVotedRun.join("/")}, control ${report.fallback.perControlRun.join("/")})`);
  console.log("");
  console.log(`VOTED  fully stable across ${REPEATS} repeats: ${votedFullyStable ? "YES (byte-identical labels)" : `NO — unstable: ${report.voted.unstableCases.join(", ")}`}`);
  console.log(`CONTROL(samples=1) stable:                 ${controlFullyStable ? "YES" : `NO — divergent: ${report.control.unstableCases.join(", ")}`}`);
  console.log("");
  console.log("per-case label agreement across repeats (VOTED | CONTROL):");
  for (const v of votedAgreement) {
    const c = controlAgreement.find((x) => x.id === v.id);
    const vLabels = Object.entries(v.labelCounts).map(([l, n]) => `${l}×${n}`).join(",");
    const cLabels = c ? Object.entries(c.labelCounts).map(([l, n]) => `${l}×${n}`).join(",") : "-";
    console.log(
      `  ${v.id.padEnd(34)} ${v.stable ? "stable " : "UNSTABLE"} [${vLabels}]  |  ${c?.stable ? "stable " : "UNSTABLE"} [${cLabels}]`,
    );
  }
  console.log("");
  console.log(`verdict: ${report.verdict}`);
  console.log("=".repeat(72));

  // HARD GUARD enforcement: 오염되면 non-zero exit로 실측 무효를 명시.
  if (fallbackContaminated) {
    console.error(
      `\n[voting-stability] ABORT: ${totalFallbacks} mock fallback(s) detected — this run does NOT count as a real-LLM measurement.\n` +
        `Raise OLLAMA_TIMEOUT_MS (current ${config.timeoutMs}ms) and re-run. Measured single-call worst case ~52s; use >=300000.`,
    );
    process.exit(3);
  }

  console.log(`\n[voting-stability] JSON report written to ${resultsDir}`);
}

async function runRepeats(
  label: string,
  repeats: number,
  makeVerifier: () => { verifier: VotingAiVerifier; resilient: ResilientAiVerifier; ledger: VoteLedger },
  fixtures: VerificationFixtures,
  recordLedger: boolean,
): Promise<RepeatRun[]> {
  const runs: RepeatRun[] = [];
  for (let r = 1; r <= repeats; r += 1) {
    const { verifier, resilient, ledger } = makeVerifier();
    const start = now();
    const results = await runAllCases(fixtures, verifier);
    const wallMs = now() - start;
    const fallbacks = resilient.stats().total;
    runs.push({
      repeat: r,
      results,
      labelFingerprint: classificationFingerprint(results, true),
      fallbacks,
      ledger: recordLedger ? ledger.all().map(projectRecord) : undefined,
      wallMs: Math.round(wallMs),
    });
    console.log(
      `[voting-stability]   ${label} repeat ${r}/${repeats} done in ${(wallMs / 1000).toFixed(1)}s — fallbacks=${fallbacks}`,
    );
  }
  return runs;
}

function perCaseAgreement(runs: RepeatRun[]): CaseAgreement[] {
  const ids = runs[0]?.results.map((r) => r.id) ?? [];
  return ids.map((id) => {
    const labelCounts: Record<string, number> = {};
    let kind = "";
    for (const run of runs) {
      const c = run.results.find((x) => x.id === id);
      if (!c) continue;
      kind = c.kind;
      const label = String(c.llmResult);
      labelCounts[label] = (labelCounts[label] ?? 0) + 1;
    }
    const distinctLabels = Object.keys(labelCounts).length;
    return { id, kind, labelCounts: sortedCounts(labelCounts), distinctLabels, stable: distinctLabels === 1 };
  });
}

function buildVerdict(
  voted: CaseAgreement[],
  control: CaseAgreement[],
  contaminated: boolean,
): string {
  if (contaminated) return "INVALID — mock fallback contamination; re-run with a larger timeout.";
  const votedUnstable = voted.filter((c) => !c.stable).length;
  const controlUnstable = control.filter((c) => !c.stable).length;
  if (votedUnstable === 0 && controlUnstable > 0) {
    return `YES — voting stabilized all ${voted.length} cases (byte-identical labels) while the samples=1 control diverged on ${controlUnstable}. The delta is attributable to voting on real output.`;
  }
  if (votedUnstable === 0 && controlUnstable === 0) {
    return `INCONCLUSIVE-on-this-sample — voting fully stable, but the control did NOT diverge either, so this sample did not exercise the nondeterminism voting targets. Re-run or widen the sample.`;
  }
  if (votedUnstable > 0 && votedUnstable < controlUnstable) {
    return `PARTIAL — voting reduced unstable cases from ${controlUnstable} (control) to ${votedUnstable} (voted) but did not fully stabilize. Remaining wobble is inherently low-confidence; raise AI_VOTE_SAMPLES.`;
  }
  return `NO — voting did not stabilize labels more than the control (voted unstable ${votedUnstable}, control ${controlUnstable}).`;
}

function projectRecord(entry: {
  kind: string;
  inputKey: string;
  label: string;
  tally: Record<string, number>;
  winnerVotes: number;
  totalVotes: number;
  confidence: number;
  lowConfidence: boolean;
}): VoteRecordLite {
  return {
    kind: entry.kind,
    inputKey: entry.inputKey,
    label: entry.label,
    tally: entry.tally,
    winnerVotes: entry.winnerVotes,
    totalVotes: entry.totalVotes,
    confidence: entry.confidence,
    lowConfidence: entry.lowConfidence,
  };
}

function now(): number {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

function sum(values: number[]): number {
  return values.reduce((a, b) => a + b, 0);
}

function allSame(values: string[]): boolean {
  return values.every((v) => v === values[0]);
}

function sortedCounts(counts: Record<string, number>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const key of Object.keys(counts).sort()) out[key] = counts[key];
  return out;
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
