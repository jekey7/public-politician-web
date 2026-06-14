import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { attachDetectedDiscrepancies } from "../src/lib/cross-verification";
import { politicians as mockPoliticians } from "../src/lib/mock-data";
import { isOllamaReachable, ollamaConfigFromEnv, OllamaAiVerifier } from "../src/lib/ollama";
import { ResilientAiVerifier, VotingAiVerifier, votingConfigFromEnv } from "../src/lib/voting-verifier";
import type { EvidenceValue, PoliticianProfile } from "../src/lib/types";

/**
 * 배치 타이밍 측정 (라이브 전용).
 *
 * 약 300명 규모의 cross-verification을 라이브 Ollama로 돌려 총 wall time, 인당 평균,
 * 스냅샷 갱신 예상 소요를 측정한다. mock fallback 없이 라이브에서만 돈다.
 *
 * 부하 데이터: 현재 공개 파이프라인에 승인된 실데이터가 없으므로(open_assembly는 pending_review),
 * mock 프로필 2건을 fresh id로 복제해 ~300명 부하를 만든다. 이 데이터는 어디에도 공개되지 않으며
 * (타이밍 측정 전용), 사실을 생성하지도 source-review dossier를 바꾸지도 않는다(불변 원칙 #1).
 * 인당 필드/출처 수가 실제 분포와 다를 수 있으므로 결과는 "이 부하 기준 추정"으로만 해석한다.
 *
 * 재개(resume): pairwise match는 매 갱신마다 새로 계산되며 안전한 부분-저장 지점이 없다.
 * 그래서 이 스크립트는 중단 시 resume를 지원하지 않고 처음부터 다시 돌린다(아래 NOTE 참조).
 * 대신 진행 로그를 50명마다 찍어 어디까지 갔는지 보이게 한다. 인당 처리가 짧아(배치 1회=수분)
 * 재시작 비용이 작다는 판단.
 */

const COUNT = Number(process.env.MEASURE_BATCH_COUNT) || 300;
const resultsDir = join(process.cwd(), "data", "internal", "measurements");

/**
 * mock 프로필을 fresh id로 복제해 부하용 ~N명을 만든다(공개되지 않는 타이밍 전용 데이터).
 *
 * 복수 출처 필드(=pairwise LLM 호출이 실제로 도는 필드)를 가진 프로필만 부하로 쓴다.
 * 단일 출처 stub(예: mock-002)은 cross-verification에서 제외되어 LLM 호출이 거의 없어
 * per-member 분포를 왜곡(p50=0)하므로 제외한다. 그래야 인당 시간이 "실제로 검증되는 의원"을
 * 대표한다. 실제 분포는 다를 수 있으므로 결과는 "이 부하 기준 추정"으로만 해석한다.
 */
function buildLoad(count: number): PoliticianProfile[] {
  const multiSource = mockPoliticians.filter(hasMultiSourceField);
  const base = multiSource.length > 0 ? multiSource : mockPoliticians;
  const load: PoliticianProfile[] = [];
  for (let i = 0; i < count; i += 1) {
    load.push(reId(base[i % base.length], i));
  }
  return load;
}

/** 어떤 필드든 출처가 2개 이상이면(=pairwise 비교 대상) true. */
function hasMultiSourceField(profile: PoliticianProfile): boolean {
  const fields = [
    profile.party,
    profile.district,
    profile.position,
    profile.education,
    profile.careers,
    profile.partyHistory,
    profile.elections,
    profile.activities.bills,
    profile.activities.votes,
    profile.activities.committees,
  ];
  return fields.some((evidences) => new Set(evidences.map((e) => e.source.sourceId)).size >= 2);
}

/** evidenceId만 접두어를 붙여 충돌 없는 사본을 만든다(값·출처·rawText는 그대로). */
function reEvidence<T>(tag: string, values: EvidenceValue<T>[]): EvidenceValue<T>[] {
  return values.map((evidence) => ({ ...evidence, evidenceId: `${tag}-${evidence.evidenceId}` }));
}

/** 프로필과 그 안의 evidenceId에 인덱스 접두어를 붙여 충돌 없는 사본을 만든다. */
function reId(profile: PoliticianProfile, index: number): PoliticianProfile {
  const tag = `load${index}`;

  return {
    ...profile,
    politicianId: `${tag}-${profile.politicianId}`,
    party: reEvidence(tag, profile.party),
    district: reEvidence(tag, profile.district),
    position: reEvidence(tag, profile.position),
    birthYear: reEvidence(tag, profile.birthYear),
    gender: reEvidence(tag, profile.gender),
    education: reEvidence(tag, profile.education),
    careers: reEvidence(tag, profile.careers),
    partyHistory: reEvidence(tag, profile.partyHistory),
    elections: reEvidence(tag, profile.elections),
    activities: {
      bills: reEvidence(tag, profile.activities.bills),
      votes: reEvidence(tag, profile.activities.votes),
      committees: reEvidence(tag, profile.activities.committees),
    },
    discrepancies: [],
    news: profile.news,
  };
}

async function main() {
  const config = ollamaConfigFromEnv();

  const reachable = await isOllamaReachable(config);
  if (!reachable.ok) {
    console.error(
      [
        `[measure:llm:batch] Ollama is NOT reachable at ${config.baseUrl} (${reachable.reason}).`,
        "This script measures LIVE batch timing and does not fall back to mock.",
        "See docs/LOCAL_LLM_SETUP.md.",
      ].join("\n"),
    );
    process.exit(1);
  }

  // 프로덕션 배치와 동일한 구성으로 측정한다: Voting(Resilient(Ollama)).
  // 회복력 래퍼가 없으면 라이브 모델의 간헐적 잘못된 출력 1건이 전체 배치를 멈춘다(실측됨).
  const votingConfig = votingConfigFromEnv();
  const resilient = new ResilientAiVerifier(new OllamaAiVerifier(config));
  const verifier = new VotingAiVerifier(resilient, votingConfig);
  const load = buildLoad(COUNT);
  console.log(
    `[measure:llm:batch] live Ollama OK — model=${config.model}, voting samples=${votingConfig.samples}, processing ${load.length} members...`,
  );
  console.log("[measure:llm:batch] NOTE: not resumable — pairwise match is recomputed per run (see script header).");

  const start = now();
  const perMemberMs: number[] = [];
  let discrepancyCount = 0;

  for (let i = 0; i < load.length; i += 1) {
    const memberStart = now();
    const enriched = await attachDetectedDiscrepancies(load[i], verifier);
    discrepancyCount += enriched.discrepancies.length;
    perMemberMs.push(now() - memberStart);

    if ((i + 1) % 50 === 0 || i + 1 === load.length) {
      console.log(`[measure:llm:batch]   ${i + 1}/${load.length} done`);
    }
  }

  const totalMs = now() - start;
  const avgMs = totalMs / load.length;

  const report = {
    generatedAt: new Date().toISOString(),
    model: config.model,
    baseUrl: config.baseUrl,
    memberCount: load.length,
    loadSource: "multi-source mock profiles cloned with fresh ids (timing-only, never published)",
    totalWallMs: round(totalMs),
    perMemberAvgMs: round(avgMs),
    perMemberP50Ms: round(percentile(perMemberMs, 50)),
    perMemberP95Ms: round(percentile(perMemberMs, 95)),
    discrepanciesDetected: discrepancyCount,
    votingSamples: votingConfig.samples,
    llmCallFallbacks: resilient.stats().total,
    projectedSnapshotRefresh: {
      for300Members: humanizeMs(avgMs * 300),
      for300MembersMs: round(avgMs * 300),
    },
  };

  await mkdir(resultsDir, { recursive: true });
  const stamp = report.generatedAt.replace(/[:.]/g, "-");
  await writeFile(join(resultsDir, `batch-${stamp}.json`), `${JSON.stringify(report, null, 2)}\n`, "utf8");
  await writeFile(join(resultsDir, "batch-latest.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");

  console.log("");
  console.log(`members:              ${report.memberCount}`);
  console.log(`total wall time:      ${humanizeMs(totalMs)} (${report.totalWallMs} ms)`);
  console.log(`per-member avg:       ${report.perMemberAvgMs} ms`);
  console.log(`per-member p50 / p95: ${report.perMemberP50Ms} / ${report.perMemberP95Ms} ms`);
  console.log(`discrepancies found:  ${report.discrepanciesDetected}`);
  console.log(`voting samples:       ${report.votingSamples}`);
  console.log(`live-LLM call fallbacks to mock (resilience): ${report.llmCallFallbacks}`);
  console.log(`projected 300-member refresh: ${report.projectedSnapshotRefresh.for300Members}`);
  console.log("");
  console.log(`[measure:llm:batch] JSON report written to ${resultsDir}`);
}

function now(): number {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

function round(ms: number): number {
  return Math.round(ms);
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(Math.max(Math.ceil((p / 100) * sorted.length), 1), sorted.length) - 1;
  return sorted[index];
}

function humanizeMs(ms: number): string {
  const totalSeconds = ms / 1000;
  if (totalSeconds < 60) return `${totalSeconds.toFixed(1)}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = Math.round(totalSeconds % 60);
  return `${minutes}m ${seconds}s`;
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
