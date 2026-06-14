/**
 * Iteration: INTERNAL LIVE DRY-RUN against the real NEC 당선인 endpoint
 * (data.go.kr 15000864 — WinnerInfoInqireService2/getWinnerInfoInqire, sgId=20240410, sgTypecode=2).
 *
 * This fetches the 22nd-Assembly 지역구 winners into the INTERNAL dossier only (data/internal/, gitignored),
 * runs them through the library functions (NecCollector → mapNecRecord / scanRawRecordsForPrivateData /
 * mergeNecIntoProfiles / classifyNecCoverage / detectProfileDiscrepanciesSync), and reports validation facts.
 *
 * The NEC fetch now goes through the SAME NecCollector / NEC_WINNER_SERVICE_PATH the public collector would
 * use (with an injected counting+redacting fetch), so this dry-run verifies the corrected service-path
 * constant on the real public code path — NOT a script-private URL.
 *
 * GUARDRAILS (non-negotiable):
 *   - selectNecCollector / NEC_COLLECTOR stay OFF; public pipeline (PUBLIC_PIPELINE_COLLECTOR) stays off.
 *     This script constructs NecCollector directly for an internal read-only dry-run; no NEC row reaches
 *     public output. facts.csv / latest.json are never written.
 *   - The NEC_API_KEY value is read from env only and is NEVER printed, logged, or persisted (fetch wrapper
 *     redacts the serviceKey before logging).
 *   - Identity-only mapping: mapNecRecord emits ONLY party (jdName) + district (sggName). name is
 *     match-only (never emitted). All NEC_DROPPED_PII_FIELDS must be absent from mapped output.
 *   - Daily traffic budget 10,000/day — this run caps total NEC calls at MAX_NEC_CALLS and never retries
 *     in a loop. On any auth/result error it STOPS and reports (does not burn budget).
 *
 * Run: npm run dry-run:nec-live   (or: tsx scripts/dry-run-nec-cross-verification-live.ts)
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
import {
  mapNecRecord,
  NecCollector,
  necConfigFromEnv,
  NEC_DROPPED_PII_FIELDS,
} from "../src/lib/collectors/nec";
import { mergeNecIntoProfiles } from "../src/lib/collectors/nec-merge";
import { classifyNecCoverage, isProportionalDistrict } from "../src/lib/collectors/nec-coverage";
import { scanRawRecordsForPrivateData } from "../src/lib/raw-records";
import { detectProfileDiscrepanciesSync } from "../src/lib/cross-verification";
import { mockSyncVerifier } from "../src/lib/ai";
import type { PoliticianProfile } from "../src/lib/types";

const MAX_NEC_CALLS = 6; // budget guard: 1 precondition probe + 1 full collect + headroom
const outputDir = join(process.cwd(), "data", "internal", "nec-dry-run");

let necCallCount = 0;

/** Redact the serviceKey out of any URL before it can be logged. */
function redactKey(input: string): string {
  try {
    const u = new URL(input);
    if (u.searchParams.has("serviceKey")) u.searchParams.set("serviceKey", "***REDACTED***");
    return u.toString();
  } catch {
    return "[unparseable-url-redacted]";
  }
}

/**
 * Counting + budget-guarding + key-redacting fetch wrapper injected into NecCollector. This is the only
 * place the live NEC endpoint is hit; the key is never logged (redactKey strips it).
 */
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

function strOf(v: unknown): string {
  return typeof v === "string" ? v.trim() : typeof v === "number" ? String(v) : "";
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** data.go.kr success codes vary by service: "INFO-00" / "INFO-000" / "00" / "0" all mean NORMAL SERVICE. */
function isSuccessCode(code: string): boolean {
  return code === "" || /^INFO-0+$/.test(code) || /^0+$/.test(code);
}

/** Defensively dig out {resultCode,resultMsg,totalCount} from the nested data.go.kr envelope (probe only). */
function readEnvelope(payload: unknown): { resultCode: string; resultMsg: string; totalCount: number } {
  let resultCode = "";
  let resultMsg = "";
  let totalCount = 0;
  const visit = (v: unknown) => {
    if (isRecord(v)) {
      if (typeof v.resultCode === "string") resultCode = v.resultCode.trim();
      if (typeof v.resultMsg === "string") resultMsg = v.resultMsg.trim();
      if (v.totalCount !== undefined && totalCount === 0) {
        const n = typeof v.totalCount === "number" ? v.totalCount : Number(v.totalCount);
        if (!Number.isNaN(n)) totalCount = n;
      }
      Object.values(v).forEach(visit);
    } else if (Array.isArray(v)) {
      v.forEach(visit);
    }
  };
  visit(payload);
  return { resultCode, resultMsg, totalCount };
}

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

async function writeReport(report: Record<string, unknown>) {
  report.necCallsUsed = necCallCount;
  await mkdir(outputDir, { recursive: true });
  await writeFile(join(outputDir, "live-latest.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
}

async function main() {
  const apiKey = process.env.NEC_API_KEY?.trim();
  if (!apiKey) {
    console.error(
      "STOP: NEC_API_KEY not set. In PowerShell, load it from .env then re-run:\n" +
        "  $env:NEC_API_KEY = ((Get-Content .env | Where-Object { $_ -match '^NEC_API_KEY=' }) -replace '^NEC_API_KEY=','')\n" +
        "  npm run dry-run:nec-live",
    );
    process.exitCode = 2;
    return;
  }

  // Build NEC config from env (key env-only). licenseNote is an internal dry-run note, not the public note.
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
    note: "INTERNAL-ONLY NEC LIVE cross-verification dry-run. NOT public output (불변 #5/#8). Public snapshot untouched.",
    generatedAt: new Date().toISOString(),
    servicePath: "WinnerInfoInqireService2/getWinnerInfoInqire (via NecCollector / NEC_WINNER_SERVICE_PATH)",
    scope: "regional-district winners only (sgTypecode=2). 비례대표 out-of-scope for this source (human decision 2).",
  };

  // ── STEP 1: precondition probe via the public collector code path (NecCollector → buildNecUrl) ──
  // numOfRows is fixed at 300 inside buildNecUrl; for 254 winners that's a single live page = the real sweep.
  console.log("=== STEP 1: PRECONDITION PROBE + COLLECT (via NecCollector, public code path) ===");
  let probeOk = false;
  let envelope = { resultCode: "", resultMsg: "", totalCount: 0 };
  // We tap the raw payload for the envelope by wrapping fetch once for the probe-level read.
  const probingFetch = async (input: string | URL) => {
    const res = await countingFetch(input);
    if (!res.ok) return res;
    const payload = await res.json();
    envelope = readEnvelope(payload);
    probeOk = isSuccessCode(envelope.resultCode);
    // hand the already-parsed payload back so NecCollector doesn't re-fetch.
    return { ok: res.ok, status: res.status, json: async () => payload };
  };

  let necRecords;
  try {
    const collector = new NecCollector(necConfig, "winner", probingFetch);
    necRecords = await collector.collect();
  } catch (err) {
    console.error(`STOP: ${err instanceof Error ? err.message : err}`);
    console.error(
      "  Likely cause: decoded-vs-encoded serviceKey, or PowerShell .env not reloaded. NOT retrying (budget).",
    );
    report.stopped = "collect_failed";
    report.precondition = envelope;
    await writeReport(report);
    process.exitCode = 3;
    return;
  }

  const sampleNamePresence = necRecords
    .slice(0, 3)
    .map((r) => strOf((r.raw as Record<string, unknown>).name))
    .filter(Boolean).length;
  console.log(`  resultCode=${JSON.stringify(envelope.resultCode)} resultMsg=${JSON.stringify(envelope.resultMsg)}`);
  console.log(`  totalCount=${envelope.totalCount} rowsFetched=${necRecords.length} sampleNamePresence=${sampleNamePresence}`);
  report.precondition = {
    resultCode: envelope.resultCode,
    resultMsg: envelope.resultMsg,
    totalCount: envelope.totalCount,
    rowsFetched: necRecords.length,
    sampleNamePresence,
    looksLive: probeOk && necRecords.length > 0,
  };

  if (!probeOk || necRecords.length === 0) {
    console.error(
      `STOP: response not a clean keyed result (code=${JSON.stringify(envelope.resultCode)}, rows=${necRecords.length}).`,
    );
    report.stopped = "precondition_failed";
    await writeReport(report);
    process.exitCode = 3;
    return;
  }

  // coverage check: single-page collect must cover totalCount (254 < 300 page size).
  const coverageComplete = envelope.totalCount === 0 || necRecords.length >= envelope.totalCount;
  console.log(`  coverage: ${necRecords.length}/${envelope.totalCount} (complete=${coverageComplete})`);
  report.sweep = {
    totalCount: envelope.totalCount,
    rowCount: necRecords.length,
    coverageComplete,
    note: "Single 300-row page via NecCollector covers the 254 지역구 winners (winner API has no 비례대표).",
  };

  const fetchedAt = necRecords[0]?.fetchedAt ?? new Date().toISOString();

  // ── STEP 3: mapped-field presence on real rows ──
  console.log("\n=== STEP 3: MAPPED-FIELD PRESENCE (party, district only) ===");
  const mapped = necRecords
    .map((rec, i) => mapNecRecord(rec, i))
    .filter((m): m is NonNullable<typeof m> => m !== null);
  const partyPresent = mapped.filter((m) => m.party.length > 0).length;
  const districtPresent = mapped.filter((m) => m.district.length > 0).length;
  const emittedKeys = new Set(mapped.flatMap((m) => Object.keys(m)));
  const piiInMapped = NEC_DROPPED_PII_FIELDS.filter((f) => JSON.stringify(mapped).includes(`"${f}"`));
  const nameAsEvidence = JSON.stringify(mapped.map((m) => [m.party, m.district])).includes('"field":"name"');
  console.log(`  mapped profiles: ${mapped.length}/${necRecords.length}`);
  console.log(`  party present: ${partyPresent}/${mapped.length}; district present: ${districtPresent}/${mapped.length}`);
  console.log(`  emitted object keys: [${[...emittedKeys].join(", ")}]`);
  console.log(`  PII field names in mapped JSON: [${piiInMapped.join(", ")}] (must be empty)`);
  console.log(`  name emitted as evidence field: ${nameAsEvidence} (must be false)`);
  report.mappedFieldPresence = {
    mappedCount: mapped.length,
    totalRecords: necRecords.length,
    partyPresent,
    districtPresent,
    emittedObjectKeys: [...emittedKeys],
    piiFieldsInMapped: piiInMapped,
    nameEmittedAsEvidence: nameAsEvidence,
  };

  // ── STEP 4: privacy scan on raw + mapped ──
  console.log("\n=== STEP 4: PRIVACY SCAN ===");
  const rawScan = scanRawRecordsForPrivateData(necRecords);
  const mappedScan = scanRawRecordsForPrivateData(mapped.map((m) => ({ raw: m })));
  const rawFlaggedKeys = [...new Set(rawScan.findings.map((f) => f.path.split(".").pop() ?? ""))];
  const approvedFalseBlocks = mappedScan.findings.filter((f) => /party|district/.test(f.path));
  const droppedPiiKeysPresentInRaw = NEC_DROPPED_PII_FIELDS.filter((f) =>
    necRecords.some((r) => f in (r.raw as Record<string, unknown>)),
  );
  console.log(`  raw scan: ${rawScan.status} (${rawScan.findings.length} findings); flagged raw keys: [${rawFlaggedKeys.join(", ")}]`);
  console.log(`  mapped scan: ${mappedScan.status} (${mappedScan.findings.length} findings)`);
  console.log(`  approved identity fields false-blocked: ${approvedFalseBlocks.length} (must be 0)`);
  console.log(`  dropped-PII keys present in raw: [${droppedPiiKeysPresentInRaw.join(", ")}]; absent from mapped: ${piiInMapped.length === 0}`);
  report.privacyScan = {
    rawStatus: rawScan.status,
    rawFindingCount: rawScan.findings.length,
    rawFlaggedKeys,
    mappedStatus: mappedScan.status,
    mappedFindingCount: mappedScan.findings.length,
    approvedIdentityFalseBlocks: approvedFalseBlocks.length,
    droppedPiiKeysPresentInRaw,
    droppedPiiAbsentFromMapped: piiInMapped.length === 0,
  };

  // ── STEP 5: real cross-verification + coverage classification (decision 2) ──
  console.log("\n=== STEP 5: CROSS-VERIFICATION + COVERAGE CLASSIFICATION ===");
  const oaProfiles = await buildOpenAssemblyProfiles();
  const merge = mergeNecIntoProfiles(oaProfiles, mapped);
  const detected = merge.profiles.map((p) => ({
    ...p,
    discrepancies: detectProfileDiscrepanciesSync(p, mockSyncVerifier, { detectedAt: fetchedAt }),
  }));
  const partyConflicts = detected.flatMap((p) =>
    p.discrepancies.filter((d) => d.field === "party" && d.kind === "content_conflict"),
  );

  // Decision 2: classify OA roster coverage — 비례대표 = out-of-scope, NOT unmatched.
  const coverage = classifyNecCoverage(detected, oaProfiles);

  // diagnostic: which distinct OA district values were treated as proportional (ASSUMPTION verification).
  const proportionalDistrictSamples = [
    ...new Set(
      oaProfiles
        .map((p) => p.district[0]?.value ?? "")
        .filter((d) => isProportionalDistrict(d)),
    ),
  ];

  console.log(`  OA profiles: ${oaProfiles.length}; NEC mapped: ${mapped.length}`);
  console.log(`  [OA coverage] matched=${coverage.matched} genuine-unmatched=${coverage.genuineUnmatched} out-of-scope(비례대표)=${coverage.outOfScope}`);
  console.log(`  [NEC-side] ambiguous=${merge.ambiguous.length}; party content_conflict=${partyConflicts.length}`);
  console.log(`  proportional district values seen: [${proportionalDistrictSamples.join(", ")}] (count=${coverage.outOfScope})`);
  report.crossVerification = {
    oaProfiles: oaProfiles.length,
    necMapped: mapped.length,
    // Decision-2 breakdown (OA roster coverage):
    match: coverage.matched,
    genuineUnmatched: coverage.genuineUnmatched,
    outOfScopeProportionalRep: coverage.outOfScope,
    // NEC-side outcomes from the merge:
    necAmbiguous: merge.ambiguous.length,
    necUnmatchedRecords: merge.unmatched.length,
    partyContentConflicts: partyConflicts.length,
    proportionalDistrictValuesSeen: proportionalDistrictSamples,
    proportionalFlagAssumption:
      "ASSUMPTION: 비례대표 detected via OA district(ORIG_NM) text containing '비례대표'/'비례'. No dedicated proportional-rep flag field in nwvrqwxyaytdsfvhu roster; if OA adds one, switch to it.",
    scopeNote:
      "지역구 winners only (sgTypecode=2). 비례대표 46석 = intentionally out-of-scope for the NEC winner source (not unmatched, not a gap). 비례대표 cross-verification source = backlog (separate future iteration, Chapter 1 gate).",
    conflictProof: partyConflicts.map((c) => {
      const profile = detected.find((p) => p.discrepancies.includes(c));
      const cited = (profile?.party ?? []).filter((e) => c.evidenceIds.includes(e.evidenceId));
      return {
        discrepancyId: c.discrepancyId,
        citedSourceKinds: [...new Set(cited.map((e) => e.source.sourceKind))],
      };
    }),
  };

  await writeReport(report);
  console.log(`\n=== SUMMARY ===`);
  console.log(`  total NEC calls used: ${necCallCount}/${MAX_NEC_CALLS}`);
  console.log(`  dossier written to ${join(outputDir, "live-latest.json")}`);
  console.log(`  public output untouched; verify byte-identity separately.`);
}

main().catch((error: unknown) => {
  // never echo the key; error messages here are constructed not to include it.
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
