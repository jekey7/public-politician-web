import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  assertRawArchivePublishableForInternalUse,
  buildInternalRawArchive,
  mockOpenAssemblyRawRecords,
} from "../src/lib/raw-records";
import { parsePinCacheArtifact } from "../src/lib/pin-cache";
import { buildSnapshotReleaseManifest } from "../src/lib/release-manifest";
import { buildPublicSnapshot, factsToCsv } from "../src/lib/snapshot";
import { selectPublicPipelineCollector } from "../src/lib/public-pipeline";
import { runBatchVerificationPipeline } from "../src/lib/verification";

const outputDir = join(process.cwd(), "public", "snapshots");
const rawOutputDir = join(process.cwd(), "data", "internal", "raw");
const voteLedgerDir = join(process.cwd(), "data", "internal", "vote-ledger");
const pinCacheDir = join(process.cwd(), "data", "internal", "pin-cache");
const pinCachePath = join(pinCacheDir, "latest.json");
const schemaPath = join(process.cwd(), "schemas", "public-snapshot.schema.json");

/** 이전 배치의 핀 캐시를 읽는다. 없거나 깨졌으면 빈 캐시로 시작한다(크래시 금지). */
async function loadPinCache() {
  try {
    return parsePinCacheArtifact(await readFile(pinCachePath, "utf8"));
  } catch {
    return undefined;
  }
}

async function main() {
  const generatedAt = new Date().toISOString();
  const selection = selectPublicPipelineCollector();
  const { collector } = selection;
  const initialPinCache = await loadPinCache();
  const result = await runBatchVerificationPipeline(collector, initialPinCache);
  const snapshot = buildPublicSnapshot(result.profiles, generatedAt);
  const necRunSummary = selection.getNecRunSummary();
  const coverageSidecar = necRunSummary
    ? { ...necRunSummary.coverageSidecar, generated_at: generatedAt }
    : { generated_at: generatedAt, coverage: {} };
  const rawArchive = buildInternalRawArchive(mockOpenAssemblyRawRecords(), generatedAt);
  assertRawArchivePublishableForInternalUse(rawArchive);
  const latestJson = `${JSON.stringify(snapshot, null, 2)}\n`;
  const factsCsv = `${factsToCsv(snapshot.verified_facts)}\n`;
  const coverageJson = `${JSON.stringify(coverageSidecar, null, 2)}\n`;
  const schemaJson = await readFile(schemaPath, "utf8");
  const manifest = buildSnapshotReleaseManifest(snapshot, [
    { path: "latest.json", content: latestJson },
    { path: "facts.csv", content: factsCsv },
    { path: "latest-coverage.json", content: coverageJson },
    { path: "schema.json", content: schemaJson },
  ]);

  await mkdir(outputDir, { recursive: true });
  await mkdir(rawOutputDir, { recursive: true });
  await writeFile(join(outputDir, "latest.json"), latestJson, "utf8");
  await writeFile(join(outputDir, "facts.csv"), factsCsv, "utf8");
  await writeFile(join(outputDir, "latest-coverage.json"), coverageJson, "utf8");
  await writeFile(join(outputDir, "schema.json"), schemaJson, "utf8");
  await writeFile(join(outputDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  await writeFile(join(rawOutputDir, "open-assembly.mock.json"), `${JSON.stringify(rawArchive, null, 2)}\n`, "utf8");

  // self-consistency voting의 표 분포를 내부(gitignore) 아티팩트로 기록한다. 공개 스냅샷과는
  // 분리하지만(불변 #5), 표가 검사 가능해야 한다(불변 #8). mock backend는 투표하지 않으므로 생략.
  if (result.voteLedger) {
    await mkdir(voteLedgerDir, { recursive: true });
    const ledgerArtifact = {
      generatedAt,
      backend: result.aiBackend,
      summary: result.voteLedger.summary(),
      lowConfidenceCount: result.lowConfidenceCount,
      llmCallFallbacks: result.llmCallFallbacks,
      records: result.voteLedger.all(),
    };
    await writeFile(join(voteLedgerDir, "latest.json"), `${JSON.stringify(ledgerArtifact, null, 2)}\n`, "utf8");
  }

  // 입력 해시 캐시(핀)를 내부(gitignore) 아티팩트로 저장한다. 다음 배치가 동일 입력을 재호출 없이
  // 동결 결과로 재현한다(불변 #8: 재현 가능). 공개 스냅샷과는 분리(불변 #5). mock backend는 핀 없음.
  if (result.pinCache) {
    await mkdir(pinCacheDir, { recursive: true });
    await writeFile(pinCachePath, `${JSON.stringify(result.pinCache, null, 2)}\n`, "utf8");
  }

  console.log(`snapshot generated: ${snapshot.verified_facts.length} facts`);
  console.log(`snapshot generated: ${snapshot.discrepancies.length} discrepancies`);
  console.log(`snapshot generated: ${snapshot.news_feed.length} news items`);
  if (necRunSummary) {
    console.log(
      `NEC public pipeline coverage: matched=${necRunSummary.matched} genuine-unmatched=${necRunSummary.genuineUnmatched} ambiguous-withheld=${necRunSummary.ambiguousWithheld} out-of-scope=${necRunSummary.outOfScope} / total=${necRunSummary.totalOaMembers}`,
    );
    console.log(`NEC public pipeline calls: ${necRunSummary.necCallsUsed}/${necRunSummary.necCallBudget}`);
  }
  console.log(`snapshot manifest generated: ${manifest.files.length} files`);
  console.log(`internal raw archive generated: ${rawArchive.records.length} records`);
  console.log(`cross-verification AI backend: ${result.aiBackend}${result.aiBackendReason ? ` (${result.aiBackendReason})` : ""}`);
  if (result.aiBackend === "ollama") {
    console.log(`cross-verification low-confidence (split-vote, 검수중) discrepancies: ${result.lowConfidenceCount}`);
    console.log(`cross-verification live-LLM call fallbacks to mock (resilience): ${result.llmCallFallbacks}`);
    if (result.pinCacheStats) {
      const { hits, misses, size } = result.pinCacheStats;
      console.log(`cross-verification pin cache: ${hits} hits / ${misses} misses (${size} entries pinned)`);
    }
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
