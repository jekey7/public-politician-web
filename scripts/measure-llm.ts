import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  buildReport,
  classificationFingerprint,
  compareForDeterminism,
  formatSummaryTable,
  parseFixtures,
  runAllCases,
  type DeterminismResult,
} from "../src/lib/measure-llm";
import { isOllamaReachable, ollamaConfigFromEnv, OllamaAiVerifier } from "../src/lib/ollama";
import { ResilientAiVerifier, VotingAiVerifier, votingConfigFromEnv } from "../src/lib/voting-verifier";

/**
 * 로컬 LLM 측정 하네스 (라이브 전용).
 *
 * 이 스크립트는 **반드시 떠 있는 Ollama에 대해서만** 돈다. /api/tags로 도달성을 먼저 확인하고,
 * 닿지 않으면 명확한 메시지와 함께 non-zero로 종료한다 — mock으로 조용히 fallback 하지 않는다
 * (이 스크립트의 목적은 실측이므로 mock 측정은 의미가 없다).
 *
 * fixture의 expected 라벨은 사람이 작성한 ground truth이고, 하네스는 그것에 대조해
 * 분류·정합 품질을 측정만 한다. 사실을 생성하거나 source-review dossier를 바꾸지 않는다(불변 원칙 #1).
 */

const fixturesPath = join(process.cwd(), "fixtures", "verification-cases.json");
const resultsDir = join(process.cwd(), "data", "internal", "measurements");

async function main() {
  const config = ollamaConfigFromEnv();

  // 1) 라이브 도달성 — 닿지 않으면 mock fallback 없이 즉시 실패.
  const reachable = await isOllamaReachable(config);
  if (!reachable.ok) {
    console.error(
      [
        `[measure:llm] Ollama is NOT reachable at ${config.baseUrl} (${reachable.reason}).`,
        "This script measures a LIVE model and does not fall back to mock.",
        "Start Ollama and pull the model first, e.g.:",
        "  ollama pull qwen3:4b",
        "  curl http://localhost:11434/api/tags",
        "See docs/LOCAL_LLM_SETUP.md.",
      ].join("\n"),
    );
    process.exit(1);
  }

  console.log(`[measure:llm] live Ollama OK — model=${config.model} baseUrl=${config.baseUrl}`);

  const fixtures = parseFixtures(JSON.parse(await readFile(fixturesPath, "utf8")));
  const votingConfig = votingConfigFromEnv();

  // RAW: 모델 단독(투표 없음) — Iteration 25와 동일한 진단. raw 모델이 얼마나 흔들리는지 특성화.
  const rawVerifier = new OllamaAiVerifier(config);
  // VOTED: Resilient(Ollama)을 self-consistency voting으로 감쌈 — Iteration 26 재현성 메커니즘.
  const votedVerifier = new VotingAiVerifier(new ResilientAiVerifier(new OllamaAiVerifier(config)), votingConfig);

  console.log(
    `[measure:llm] ${fixtures.entity_match_cases.length} match + ${fixtures.classification_cases.length} classify cases.` +
      ` RAW x2 (diagnosis) then VOTED x2 (samples=${votingConfig.samples}, reproducibility gate)...`,
  );

  // 2a) RAW 결정성 진단: 같은 fixture 2회. temp0/seed0에도 흔들릴 수 있음(Iteration 25 발견).
  const rawA = await runAllCases(fixtures, rawVerifier);
  const rawB = await runAllCases(fixtures, rawVerifier);
  const rawDeterminism: DeterminismResult = compareForDeterminism(rawA, rawB);

  // 2b) VOTED 결정성 게이트: 다수결 라벨이 2회 실행에서 일치해야 한다(메커니즘의 보장).
  //     라벨만 본다(label-only) — 정합 confidence float은 모델이 흔들 수 있으나 우리가 신경 쓰는
  //     것은 검증된 분류 라벨이다(과제 명시).
  const votedA = await runAllCases(fixtures, votedVerifier);
  const votedB = await runAllCases(fixtures, votedVerifier);
  const votedDeterminism: DeterminismResult = compareForDeterminism(votedA, votedB, true);

  if (
    classificationFingerprint(votedA, true) !== classificationFingerprint(votedB, true) &&
    votedDeterminism.deterministic
  ) {
    throw new Error("internal inconsistency: fingerprint mismatch but per-case determinism passed");
  }

  // 보고: 정확도/지연은 VOTED 결과 기준(실제 파이프라인이 쓰는 라벨), 결정성은 VOTED 게이트.
  const report = buildReport({
    generatedAt: new Date().toISOString(),
    model: config.model,
    baseUrl: config.baseUrl,
    fixtures,
    results: votedA,
    determinism: votedDeterminism,
  });

  // 3) 머신 판독용 JSON은 gitignore 된 results dir에 기록. raw 진단도 함께 남긴다(정직성).
  await mkdir(resultsDir, { recursive: true });
  const stamp = report.generatedAt.replace(/[:.]/g, "-");
  const reportPath = join(resultsDir, `fixtures-${stamp}.json`);
  const latestPath = join(resultsDir, "latest.json");
  const enriched = {
    ...report,
    voting: votingConfig,
    rawDeterminism,
    note:
      "results/determinism are the VOTED labels (what the pipeline uses). rawDeterminism is the single-sample model wobble for comparison (Iteration 25 finding).",
  };
  const json = `${JSON.stringify(enriched, null, 2)}\n`;
  await writeFile(reportPath, json, "utf8");
  await writeFile(latestPath, json, "utf8");

  // 4) 사람이 읽을 표는 stdout으로.
  console.log("");
  console.log(formatSummaryTable(report));
  console.log("");
  console.log(
    `[measure:llm] RAW determinism (single-sample, x2): ${rawDeterminism.deterministic ? "PASS" : `FAIL — divergent: ${rawDeterminism.divergentIds.join(", ")}`}`,
  );
  console.log(
    `[measure:llm] VOTED determinism (samples=${votingConfig.samples}, x2): ${votedDeterminism.deterministic ? "PASS" : `FAIL — divergent: ${votedDeterminism.divergentIds.join(", ")}`}`,
  );
  console.log(`[measure:llm] JSON report written: ${reportPath}`);

  // 게이트는 VOTED 결정성으로 판정한다. raw 흔들림은 정직하게 보고하되 실패로 보지 않는다
  // (메커니즘이 흡수하는 것이 목표). VOTED가 깨지면 재현성이 깨진 것이므로 실패.
  if (!votedDeterminism.deterministic) {
    console.error(`[measure:llm] VOTED DETERMINISM FAILED — divergent: ${votedDeterminism.divergentIds.join(", ")}`);
    process.exit(2);
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
