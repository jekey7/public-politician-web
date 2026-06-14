/**
 * Iteration 29 — INTERNAL pre-go-live snapshot dry-run with the NEC collector ACTIVE.
 *
 * Purpose (verification-only): regenerate a NON-MOCK snapshot (latest.json / facts.csv) that ACTUALLY
 * contains NEC evidence, so we can verify the public-boundary invariants and the rendering path on real
 * surfaced states BEFORE the human go/no-go. This is the artifact the public pipeline WOULD emit once NEC
 * is wired in — produced here only into data/internal/ (gitignored).
 *
 * What this proves vs. dry-run-nec-cross-verification-live.ts: that earlier script reports validation
 * FACTS (counts). This script additionally builds the real SNAPSHOT objects (buildPublicSnapshot /
 * factsToCsv — the SAME library functions generate-snapshot.ts uses for public output) so we can assert
 * invariants on the emitted snapshot, not merely on intermediate profiles or mock fixtures.
 *
 * GUARDRAILS (non-negotiable — identical to the live cross-verification dry-run):
 *   - selectNecCollector / NEC_COLLECTOR stay OFF; PUBLIC_PIPELINE_COLLECTOR untouched. This script builds
 *     NecCollector directly for an internal read-only dry-run. NO NEC row reaches public/. The public
 *     latest.json / facts.csv are NEVER written or read for output by this script.
 *   - NEC_API_KEY is read from env only and is NEVER printed, logged, or persisted (fetch wrapper redacts
 *     serviceKey before logging). The regenerated internal snapshot carries source_url WITHOUT the key
 *     (NecCollector tags sourceUrl with the key-bearing first-page URL — we strip the key before emit;
 *     see assertNoApiKeyInArtifact, which FAILS the run if any key-like token leaks).
 *   - Identity-only mapping: party (jdName) + district (sggName) only. sdName is matching-only, never
 *     emitted as a value.
 *   - Daily traffic budget 10,000/day — caps total NEC calls at MAX_NEC_CALLS, never retries in a loop.
 *
 * Run (PowerShell — load key from .env, do NOT echo it):
 *   $env:NEC_API_KEY = ((Get-Content .env | Where-Object { $_ -match '^NEC_API_KEY=' }) -replace '^NEC_API_KEY=','').Trim()
 *   $env:OPEN_ASSEMBLY_API_KEY = ((Get-Content .env | Where-Object { $_ -match '^OPEN_ASSEMBLY_API_KEY=' }) -replace '^OPEN_ASSEMBLY_API_KEY=','').Trim()
 *   npx tsx scripts/dry-run-nec-snapshot.ts
 */
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  DEFAULT_OPEN_ASSEMBLY_MEMBER_PATH,
  mapOpenAssemblyMemberRecord,
  mergeOpenAssemblyMappedProfile,
  OpenAssemblyCollector,
  openAssemblyConfigFromEnv,
} from "../src/lib/collectors/open-assembly";
import { mapNecRecord, NecCollector, necConfigFromEnv } from "../src/lib/collectors/nec";
import { mergeNecIntoProfiles } from "../src/lib/collectors/nec-merge";
import {
  classifyNecCoverage,
  classifyNecCoveragePerProfile,
  isProportionalDistrict,
  NEC_AMBIGUOUS_WITHHELD_REASON,
} from "../src/lib/collectors/nec-coverage";
import { detectProfileDiscrepanciesSync } from "../src/lib/cross-verification";
import { mockSyncVerifier } from "../src/lib/ai";
import { buildPublicSnapshot, factsToCsv } from "../src/lib/snapshot";
import { validatePublicSnapshot } from "../src/lib/snapshot-validator";
import type { PoliticianProfile, PublicSnapshot, SnapshotFactRow } from "../src/lib/types";

const MAX_NEC_CALLS = 6; // 1 probe page + pagination headroom; never loops/retries.
const outputDir = join(process.cwd(), "data", "internal", "nec-dry-run");

let necCallCount = 0;

/** Redact serviceKey out of any URL before it can be logged. */
function redactKey(input: string): string {
  try {
    const u = new URL(input);
    if (u.searchParams.has("serviceKey")) u.searchParams.set("serviceKey", "***REDACTED***");
    return u.toString();
  } catch {
    return "[unparseable-url-redacted]";
  }
}

/** Counting + budget-guarding + key-redacting fetch wrapper. Only place the live NEC endpoint is hit. */
const countingFetch = async (input: string | URL): Promise<Pick<Response, "ok" | "status" | "json">> => {
  if (necCallCount >= MAX_NEC_CALLS) {
    throw new Error(`STOP: NEC call budget (${MAX_NEC_CALLS}) exhausted — refusing to loop/retry.`);
  }
  necCallCount += 1;
  const urlStr = typeof input === "string" ? input : input.toString();
  console.log(`  NEC call #${necCallCount}: ${redactKey(urlStr)}`);
  const response = await fetch(urlStr);
  return { ok: response.ok, status: response.status, json: () => response.json() };
};

async function buildOpenAssemblyProfiles(): Promise<PoliticianProfile[]> {
  const config = openAssemblyConfigFromEnv({
    ...process.env,
    OPEN_ASSEMBLY_MEMBER_PATH: process.env.OPEN_ASSEMBLY_MEMBER_PATH ?? DEFAULT_OPEN_ASSEMBLY_MEMBER_PATH,
    OPEN_ASSEMBLY_LICENSE_NOTE:
      process.env.OPEN_ASSEMBLY_LICENSE_NOTE ?? "INTERNAL DRY-RUN ONLY — pending_review, not for public release",
  });
  if (!config) {
    console.warn("  WARN: OPEN_ASSEMBLY_API_KEY not set — merge will have 0 OA profiles.");
    return [];
  }
  const records = await new OpenAssemblyCollector(config).collect();
  const profiles: PoliticianProfile[] = [];
  for (const r of records) {
    const mapped = mapOpenAssemblyMemberRecord(r);
    if (mapped) profiles.push(mergeOpenAssemblyMappedProfile(mapped));
  }
  console.log(`  OA live roster: ${records.length} rows → ${profiles.length} identity profiles`);
  return profiles;
}

/**
 * Secret guard: the serviceKey must never appear in the emitted internal snapshot artifacts. We pass the
 * known key and a generic 64-hex pattern; if either matches the serialized snapshot, we FAIL the run.
 */
function assertNoApiKeyInArtifact(serialized: string): { keyLiteralFound: boolean; hexTokenFound: boolean } {
  const key = process.env.NEC_API_KEY?.trim() ?? "";
  const keyLiteralFound = key.length > 0 && serialized.includes(key);
  // data.go.kr decoded keys are long opaque tokens; flag any standalone 40+ char alnum/%-token as suspicious.
  const hexTokenFound = /[A-Za-z0-9%]{40,}/.test(serialized.replace(/"source_url":"[^"]*"/g, '"source_url":""'));
  return { keyLiteralFound, hexTokenFound };
}

/** Every NEC fact row must carry full source metadata (invariant #2). */
function necRowsMissingSource(rows: SnapshotFactRow[]): SnapshotFactRow[] {
  return rows
    .filter((r) => r.source_kind === "nec")
    .filter((r) => !r.source_url || !r.source_org || !r.fetched_at);
}

async function writeArtifacts(
  snapshot: PublicSnapshot,
  report: Record<string, unknown>,
  coverageSidecar: { generated_at: string; coverage: Record<string, { status: string; reason: string }> },
) {
  report.necCallsUsed = necCallCount;
  await mkdir(outputDir, { recursive: true });
  // The regenerated NON-MOCK snapshot (the artifact under test). Internal-only.
  await writeFile(join(outputDir, "snapshot-latest.json"), `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
  await writeFile(join(outputDir, "snapshot-facts.csv"), `${factsToCsv(snapshot.verified_facts)}\n`, "utf8");
  // Coverage sidecar — NOT part of the public snapshot body (schema untouched, public output byte-identical).
  // Carries only ambiguous-withheld / out-of-scope states keyed by politician_id (불변 #3 carrier). Internal-only.
  await writeFile(join(outputDir, "snapshot-coverage.json"), `${JSON.stringify(coverageSidecar, null, 2)}\n`, "utf8");
  await writeFile(join(outputDir, "snapshot-report.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
}

async function main() {
  const apiKey = process.env.NEC_API_KEY?.trim();
  if (!apiKey) {
    console.error(
      "STOP: NEC_API_KEY not set. In PowerShell:\n" +
        "  $env:NEC_API_KEY = ((Get-Content .env | Where-Object { $_ -match '^NEC_API_KEY=' }) -replace '^NEC_API_KEY=','').Trim()",
    );
    process.exitCode = 2;
    return;
  }

  const necConfig = necConfigFromEnv({
    ...process.env,
    NEC_LICENSE_NOTE:
      process.env.NEC_LICENSE_NOTE?.trim() || "INTERNAL DRY-RUN ONLY — nec 15000864, not for public release",
  });
  if (!necConfig) {
    console.error("STOP: necConfigFromEnv returned null (NEC_API_KEY missing).");
    process.exitCode = 2;
    return;
  }

  const report: Record<string, unknown> = {
    note: "INTERNAL-ONLY regenerated NON-MOCK snapshot WITH NEC evidence (Iter-29 pre-go-live dry-run). NOT public output (불변 #5/#8). Public snapshot untouched. NEC_COLLECTOR stays OFF.",
    generatedAt: new Date().toISOString(),
    servicePath: "WinnerInfoInqireService2/getWinnerInfoInqire (via NecCollector / NEC_WINNER_SERVICE_PATH)",
    scope: "regional-district winners only (sgTypecode=2). 비례대표 out-of-scope for this source (human decision 2).",
  };

  // ── STEP 1: live collect via the public code path (NecCollector → buildNecUrl) ──
  console.log("=== STEP 1: LIVE COLLECT (OA roster + NEC winners) ===");
  let necRecords;
  try {
    necRecords = await new NecCollector(necConfig, "winner", countingFetch).collect();
  } catch (err) {
    console.error(`STOP: ${err instanceof Error ? err.message : err}`);
    report.stopped = "nec_collect_failed";
    await mkdir(outputDir, { recursive: true });
    await writeFile(join(outputDir, "snapshot-report.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
    process.exitCode = 3;
    return;
  }
  const oaProfiles = await buildOpenAssemblyProfiles();
  if (necRecords.length === 0 || oaProfiles.length === 0) {
    console.error(`STOP: empty collect (nec=${necRecords.length}, oa=${oaProfiles.length}).`);
    report.stopped = "empty_collect";
    await mkdir(outputDir, { recursive: true });
    await writeFile(join(outputDir, "snapshot-report.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
    process.exitCode = 3;
    return;
  }
  const fetchedAt = necRecords[0]?.fetchedAt ?? new Date().toISOString();
  console.log(`  collected: nec=${necRecords.length} rows, oa=${oaProfiles.length} profiles`);

  // ── STEP 2: map → merge → detect → build the regenerated snapshot ──
  console.log("\n=== STEP 2: MAP → MERGE → DETECT → BUILD SNAPSHOT ===");
  const mapped = necRecords
    .map((rec, i) => mapNecRecord(rec, i))
    .filter((m): m is NonNullable<typeof m> => m !== null);

  const merge = mergeNecIntoProfiles(oaProfiles, mapped);
  const detected = merge.profiles.map((p) => ({
    ...p,
    discrepancies: detectProfileDiscrepanciesSync(p, mockSyncVerifier, { detectedAt: fetchedAt }),
  }));

  // Build the snapshot with the SAME library functions the public pipeline uses. Internal-only output.
  const snapshot = buildPublicSnapshot(detected, fetchedAt);

  // ── STEP 3: coverage classification — DECISION 2 wired (ambiguous-withheld separated) ──
  // NOTE: unlike the older live report, we pass merge.ambiguous so 박지원 twins are classified as
  // ambiguous-withheld, NOT folded into genuine-unmatched (invariant #3).
  const coverage = classifyNecCoverage(detected, oaProfiles, merge.ambiguous);
  // Per-profile carrier (politician_id → status) for the coverage sidecar. SAME rule as the counts above.
  const coveragePerProfile = classifyNecCoveragePerProfile(detected, oaProfiles, merge.ambiguous);
  const coverageSidecar = { generated_at: fetchedAt, coverage: coveragePerProfile };

  // ── INVARIANT #2: every emitted NEC fact carries source_url / source_org / fetched_at ──
  const necFactRows = snapshot.verified_facts.filter((r) => r.source_kind === "nec");
  const necRowsNoSource = necRowsMissingSource(snapshot.verified_facts);

  // ── INVARIANT #4: content_conflict cases present BOTH source values, un-merged, separately citable ──
  const partyConflicts = detected.flatMap((p) =>
    p.discrepancies
      .filter((d) => d.field === "party" && d.kind === "content_conflict")
      .map((d) => {
        const cited = p.party.filter((e) => d.evidenceIds.includes(e.evidenceId));
        const kinds = [...new Set(cited.map((e) => e.source.sourceKind))];
        return {
          member: p.displayName,
          discrepancyId: d.discrepancyId,
          detector: d.detector,
          citedSourceKinds: kinds,
          // Both values present and separately addressable (un-merged) — invariant #4 evidence.
          citedValues: cited.map((e) => ({ value: e.value, sourceKind: e.source.sourceKind, evidenceId: e.evidenceId })),
          presentsBothUnmerged: kinds.includes("open_assembly") && kinds.includes("nec") && cited.length >= 2,
        };
      }),
  );

  // ── sdName never emitted as a value (matching-only) on the REGENERATED snapshot, not just unit tests ──
  // sdName values come from raw NEC rows. Collect the distinct sdName strings we actually saw, then assert
  // none of them appears as an emitted fact `value` or in the serialized snapshot facts.
  const sdNamesSeen = [
    ...new Set(
      necRecords
        .map((r) => (r.raw as Record<string, unknown>).sdName)
        .filter((v): v is string => typeof v === "string" && v.trim().length > 0)
        .map((v) => v.trim()),
    ),
  ];
  const necDistrictValues = new Set(necFactRows.filter((r) => r.field === "district").map((r) => String(r.value)));
  // A bare sido string (e.g. "서울특별시") must never be a district value. (Raw sggName like "강서구갑" is fine.)
  const sdNameEmittedAsValue = sdNamesSeen.filter((sd) => necDistrictValues.has(sd));

  // ── ambiguous-withheld NOT folded into genuine-unmatched; carries the honest reason (invariant #3) ──
  const ambiguousWithheld = {
    count: coverage.ambiguousWithheld,
    members: coverage.ambiguousWithheldMembers,
    reason: NEC_AMBIGUOUS_WITHHELD_REASON,
    // proof it is NOT in genuine-unmatched:
    notInGenuineUnmatched: coverage.ambiguousWithheldMembers.every(
      (m) => !coverage.genuineUnmatchedMembers.includes(m),
    ),
  };

  // ── out-of-scope 비례 not mislabeled as unmatched ──
  const proportionalDistrictSamples = [
    ...new Set(oaProfiles.map((p) => p.district[0]?.value ?? "").filter((d) => isProportionalDistrict(d))),
  ];

  // ── schema validity of the regenerated snapshot ──
  const schema = validatePublicSnapshot(snapshot);

  // ── secret guard ──
  const serializedFacts = JSON.stringify(snapshot.verified_facts);
  const keyScan = assertNoApiKeyInArtifact(JSON.stringify(snapshot));

  report.collect = { necRows: necRecords.length, oaProfiles: oaProfiles.length, necMapped: mapped.length };
  report.snapshot = {
    schemaValid: schema.valid,
    schemaErrors: schema.errors,
    totalFacts: snapshot.verified_facts.length,
    necFacts: necFactRows.length,
    discrepancies: snapshot.discrepancies.length,
  };
  report.invariant2_sourceMetadata = {
    necFactCount: necFactRows.length,
    necFactsMissingSource: necRowsNoSource.length,
    pass: necFactRows.length > 0 && necRowsNoSource.length === 0,
    sampleNecRow: necFactRows[0]
      ? {
          field: necFactRows[0].field,
          value: necFactRows[0].value,
          source_kind: necFactRows[0].source_kind,
          source_org: necFactRows[0].source_org,
          source_url: redactKey(necFactRows[0].source_url),
          fetched_at: necFactRows[0].fetched_at,
        }
      : null,
  };
  report.invariant4_contentConflict = {
    partyConflictCount: partyConflicts.length,
    allPresentBothUnmerged: partyConflicts.every((c) => c.presentsBothUnmerged),
    conflicts: partyConflicts,
  };
  report.invariant_sdNameNeverEmitted = {
    sdNamesSeenCount: sdNamesSeen.length,
    sdNameEmittedAsValue,
    pass: sdNameEmittedAsValue.length === 0,
  };
  report.invariant3_ambiguousWithheld = ambiguousWithheld;
  report.coverage = {
    matched: coverage.matched,
    genuineUnmatched: coverage.genuineUnmatched,
    ambiguousWithheld: coverage.ambiguousWithheld,
    outOfScope: coverage.outOfScope,
    totalOaMembers: coverage.totalOaMembers,
    genuineUnmatchedMembers: coverage.genuineUnmatchedMembers,
    proportionalDistrictValuesSeen: proportionalDistrictSamples,
    necAmbiguousRecords: merge.ambiguous.map((m) => m.displayName),
    necUnmatchedRecords: merge.unmatched.length,
  };
  report.secretGuard = {
    keyLiteralFoundInArtifact: keyScan.keyLiteralFound,
    suspiciousLongToken: keyScan.hexTokenFound,
    pass: !keyScan.keyLiteralFound,
    note: "Collectors strip the auth key from sourceUrl (Iter-29 fix: stripServiceKey/stripAuthKey). The key must be absent from BOTH the snapshot JSON and the facts CSV even though this is an internal artifact.",
    keyInSerializedFacts: apiKey ? serializedFacts.includes(apiKey) : false,
  };

  report.coverageSidecar = {
    note: "Internal-only carrier (NOT in public snapshot body). politician_id → ambiguous_withheld / out_of_scope.",
    ambiguousWithheldIds: Object.entries(coveragePerProfile)
      .filter(([, v]) => v.status === "ambiguous_withheld")
      .map(([id]) => id),
    outOfScopeCount: Object.values(coveragePerProfile).filter((v) => v.status === "out_of_scope").length,
  };

  await writeArtifacts(snapshot, report, coverageSidecar);

  // ── console summary ──
  console.log(`\n=== SUMMARY (internal artifact) ===`);
  console.log(`  schema valid: ${schema.valid}`);
  console.log(`  total facts: ${snapshot.verified_facts.length} (nec: ${necFactRows.length})`);
  console.log(`  [#2 source metadata] nec facts missing source: ${necRowsNoSource.length} (must be 0)`);
  console.log(`  [#4 content_conflict] party conflicts: ${partyConflicts.length}; all present both un-merged: ${partyConflicts.every((c) => c.presentsBothUnmerged)}`);
  console.log(`     members: [${partyConflicts.map((c) => c.member).join(", ")}]`);
  console.log(`  [sdName] emitted as value: ${sdNameEmittedAsValue.length} (must be 0)`);
  console.log(`  [#3 ambiguous-withheld] count=${coverage.ambiguousWithheld} members=[${coverage.ambiguousWithheldMembers.join(", ")}] notInGenuineUnmatched=${ambiguousWithheld.notInGenuineUnmatched}`);
  console.log(`  [coverage] matched=${coverage.matched} genuine-unmatched=${coverage.genuineUnmatched} ambiguous-withheld=${coverage.ambiguousWithheld} out-of-scope(비례)=${coverage.outOfScope} / total=${coverage.totalOaMembers}`);
  console.log(`  [secret] key literal in artifact: ${keyScan.keyLiteralFound}; key in facts CSV: ${apiKey ? serializedFacts.includes(apiKey) : false} (both must be false)`);
  console.log(`  total NEC calls used: ${necCallCount}/${MAX_NEC_CALLS}`);
  console.log(`  internal artifacts → ${outputDir}\\snapshot-latest.json (+ snapshot-facts.csv, snapshot-report.json)`);
  console.log(`  public/ output NOT touched — verify byte-identity separately.`);

  // Fail the run if any hard invariant is violated.
  const hardFail =
    !schema.valid ||
    necFactRows.length === 0 ||
    necRowsNoSource.length > 0 ||
    sdNameEmittedAsValue.length > 0 ||
    !ambiguousWithheld.notInGenuineUnmatched ||
    keyScan.keyLiteralFound ||
    (apiKey ? serializedFacts.includes(apiKey) : false);
  if (hardFail) {
    console.error("HARD INVARIANT VIOLATION — see report.");
    process.exitCode = 1;
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
