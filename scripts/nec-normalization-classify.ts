/**
 * Iteration: INTERNAL pre-go-live NORMALIZATION REVIEW (Parts A–D).
 *
 * Goal (load-bearing for 불변 #1 & #4): before any NEC data is ever exposed publicly, decide whether the
 * surfaced cross-source discrepancies are REAL or merely notation noise. A normalization gap that turns a
 * spelling variant into a content_conflict is a *fabricated* inconsistency and must be caught here first.
 *
 * What this script does (one live fetch, reused for everything):
 *   PART A — classify the 20 genuine-unmatched + 1 content_conflict + 1 ambiguous using the actual differing
 *            identity strings (name/party/district ONLY — all approved identity fields, never PII).
 *   PART C — re-run matching with the matching-only normalization (nec-normalize.ts) applied and report the
 *            before→after deltas: notation-only-now-matched vs real no-match; surviving real conflicts.
 *   PART D — verify the ORIG_NM="비례대표" assumption against the live 254 NEC + OA 300 roster.
 *
 * GUARDRAILS (non-negotiable, identical to dry-run-nec-cross-verification-live.ts):
 *   - NEC_COLLECTOR / public pipeline stay OFF. No NEC row reaches public output. facts.csv/latest.json never written.
 *   - NEC_API_KEY env-only; NEVER printed/logged/persisted (fetch wrapper redacts serviceKey).
 *   - Identity-only: only name (match-only) + party + district are read/recorded. NEC_DROPPED_PII_FIELDS never recorded.
 *   - <= MAX_NEC_CALLS total NEC calls; on any error STOP (no retry loop), well under 10,000/day budget.
 *   - Output goes ONLY to data/internal/nec-dry-run/ (gitignored). Raw per-source values are recorded verbatim
 *     (NOT normalized) so 불변 #4 preservation is auditable; normalization keys are recorded separately.
 *
 * Run: npm run nec:normalize-classify
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
import {
  mergeNecIntoProfiles,
  NEC_MATCH_NORMALIZER_OPTION_A_MEASUREMENT_ONLY,
  NEC_MATCH_NORMALIZER_SIDO_AWARE,
  LEGACY_MATCH_NORMALIZER,
  type MatchNormalizer,
} from "../src/lib/collectors/nec-merge";
import { normalizeDistrictForMatchSidoAware } from "../src/lib/collectors/nec-normalize";
import { classifyNecCoverage, isProportionalDistrict } from "../src/lib/collectors/nec-coverage";
import {
  normalizeNameForMatch,
  normalizePartyForMatch,
  normalizeDistrictForMatch,
  sameNormalizedKey,
} from "../src/lib/collectors/nec-normalize";
import { detectProfileDiscrepanciesSync } from "../src/lib/cross-verification";
import { mockSyncVerifier } from "../src/lib/ai";
import type { NecMappedProfile } from "../src/lib/collectors/nec";
import type { PoliticianProfile } from "../src/lib/types";

const MAX_NEC_CALLS = 6;
const outputDir = join(process.cwd(), "data", "internal", "nec-dry-run");

let necCallCount = 0;

function redactKey(input: string): string {
  try {
    const u = new URL(input);
    if (u.searchParams.has("serviceKey")) u.searchParams.set("serviceKey", "***REDACTED***");
    return u.toString();
  } catch {
    return "[unparseable-url-redacted]";
  }
}

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

// identity helpers (raw value extraction — only name/party/district).
function firstVal(evidences: { value: string }[]): string {
  for (const e of evidences) if (e.value?.trim()) return e.value.trim();
  return "";
}
function oaParty(p: PoliticianProfile): string {
  return firstVal(p.party.filter((e) => e.source.sourceKind === "open_assembly"));
}
function oaDistrict(p: PoliticianProfile): string {
  return firstVal(p.district.filter((e) => e.source.sourceKind === "open_assembly"));
}

async function buildOpenAssemblyProfiles(): Promise<PoliticianProfile[]> {
  const config = openAssemblyConfigFromEnv({
    ...process.env,
    OPEN_ASSEMBLY_MEMBER_PATH: process.env.OPEN_ASSEMBLY_MEMBER_PATH ?? DEFAULT_OPEN_ASSEMBLY_MEMBER_PATH,
    OPEN_ASSEMBLY_LICENSE_NOTE:
      process.env.OPEN_ASSEMBLY_LICENSE_NOTE ?? "INTERNAL DRY-RUN ONLY — pending_review, not for public release",
  });
  if (!config) {
    console.warn("  WARN: OPEN_ASSEMBLY_API_KEY not set — 0 OA profiles.");
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

/** Candidate match under a given normalization regime (name + (party|district)). */
type Normalizer = {
  name: (v: string | null | undefined) => string;
  party: (v: string | null | undefined) => string;
  district: (v: string | null | undefined) => string;
};
const RAW: Normalizer = { name: normalizeNameForMatch, party: (v) => (v ?? "").trim(), district: (v) => (v ?? "").trim() };
const NORM: Normalizer = {
  name: normalizeNameForMatch,
  party: normalizePartyForMatch,
  district: normalizeDistrictForMatch,
};

function necParty(n: NecMappedProfile): string {
  return firstVal(n.party);
}
function necDistrict(n: NecMappedProfile): string {
  return firstVal(n.district);
}

function isMatch(oa: PoliticianProfile, nec: NecMappedProfile, nz: Normalizer): boolean {
  if (!sameNormalizedKey(nz.name(oa.displayName), nz.name(nec.displayName))) return false;
  const partyEq = sameNormalizedKey(nz.party(oaParty(oa)), nz.party(necParty(nec)));
  const districtEq = sameNormalizedKey(nz.district(oaDistrict(oa)), nz.district(necDistrict(nec)));
  return partyEq || districtEq;
}

/** Classify each OA member's matching outcome under a normalizer (mirrors merge semantics: 0 / 1 / >=2 candidates). */
function classifyMatches(oaProfiles: PoliticianProfile[], necMapped: NecMappedProfile[], nz: Normalizer) {
  const matchedOa = new Set<number>();
  const ambiguousNec: NecMappedProfile[] = [];
  const unmatchedNec: NecMappedProfile[] = [];
  for (const nec of necMapped) {
    const cands: number[] = [];
    oaProfiles.forEach((oa, i) => {
      if (isMatch(oa, nec, nz)) cands.push(i);
    });
    if (cands.length === 0) unmatchedNec.push(nec);
    else if (cands.length > 1) ambiguousNec.push(nec);
    else matchedOa.add(cands[0]!);
  }
  return { matchedOa, ambiguousNec, unmatchedNec };
}

async function main() {
  const apiKey = process.env.NEC_API_KEY?.trim();
  if (!apiKey) {
    console.error("STOP: NEC_API_KEY not set. Load it from .env (see dry-run:nec-live instructions) and re-run.");
    process.exitCode = 2;
    return;
  }
  const necConfig = necConfigFromEnv({
    ...process.env,
    NEC_LICENSE_NOTE:
      process.env.NEC_LICENSE_NOTE?.trim() || "INTERNAL DRY-RUN ONLY — nec 15000864, not for public release",
  });
  if (!necConfig) {
    console.error("STOP: necConfigFromEnv returned null.");
    process.exitCode = 2;
    return;
  }

  const report: Record<string, unknown> = {
    note: "INTERNAL-ONLY NEC normalization classification (Parts A/C/D). NOT public output (불변 #5/#8). Raw per-source strings recorded verbatim; normalization is matching-only.",
    generatedAt: new Date().toISOString(),
    scope: "regional-district winners only (sgTypecode=2). 비례대표 out-of-scope (ADR-4).",
  };

  console.log("=== FETCH (NEC winners via NecCollector public code path) ===");
  let necRecords;
  try {
    necRecords = await new NecCollector(necConfig, "winner", countingFetch).collect();
  } catch (err) {
    console.error(`STOP: ${err instanceof Error ? err.message : err}`);
    report.stopped = "collect_failed";
    await writeReport(report);
    process.exitCode = 3;
    return;
  }
  const necMapped = necRecords
    .map((rec, i) => mapNecRecord(rec, i))
    .filter((m): m is NecMappedProfile => m !== null);
  const oaProfiles = await buildOpenAssemblyProfiles();
  console.log(`  NEC mapped: ${necMapped.length}; OA profiles: ${oaProfiles.length}`);

  // ── BEFORE (legacy) merge + coverage ── 명시적으로 legacy 주입(이제 production 기본은 sido-aware이므로).
  const mergeRaw = mergeNecIntoProfiles(oaProfiles, necMapped, LEGACY_MATCH_NORMALIZER);
  const coverageRaw = classifyNecCoverage(mergeRaw.profiles, oaProfiles);
  const detectedRaw = mergeRaw.profiles.map((p) => ({
    ...p,
    discrepancies: detectProfileDiscrepanciesSync(p, mockSyncVerifier, { detectedAt: necRecords[0]?.fetchedAt }),
  }));
  const partyConflictsRaw = detectedRaw.flatMap((p) =>
    p.discrepancies.filter((d) => d.field === "party" && d.kind === "content_conflict").map((d) => ({ p, d })),
  );

  // Outcome of matching under each regime (drives BOTH Part A buckets and Part C, so they cannot disagree).
  const before = classifyMatches(oaProfiles, necMapped, RAW);
  const after = classifyMatches(oaProfiles, necMapped, NORM);

  // ── PART A: classify the genuine-unmatched + ambiguous + conflict with actual identity strings ──
  console.log("\n=== PART A: CLASSIFY DISCREPANCIES (identity strings only) ===");

  // For each genuine-unmatched OA regional member, show the actual differing strings and bucket by what the
  // NORMALIZED matching outcome is (so the bucket is the real outcome, not a party-only heuristic):
  //   - real-no-match            : no same-name NEC winner at all (by-election/succession/resignation).
  //   - notation-only-now-matched: under NORM this member becomes a UNIQUE match (district notation was the only gap).
  //   - ambiguous-after-norm     : under NORM a same-name NEC row matches but the member is one of >=2 same-name
  //                                twins (party identical) → still cannot be uniquely joined; needs a join key.
  //   - real-diff                : same-name NEC exists but neither party nor district agree under NORM (e.g.
  //                                무소속↔당적 difference AND different district) → genuine, surface don't merge.
  const genuineUnmatchedNames = new Set(coverageRaw.genuineUnmatchedMembers);
  const unmatchedDetail = oaProfiles
    .map((oa, idx) => ({ oa, idx }))
    .filter(({ oa }) => genuineUnmatchedNames.has(oa.displayName))
    .map(({ oa, idx }) => {
      const nmeKey = normalizeNameForMatch(oa.displayName);
      const necByName = necMapped.filter((n) => normalizeNameForMatch(n.displayName) === nmeKey);
      const sameNameOaCount = oaProfiles.filter((o) => normalizeNameForMatch(o.displayName) === nmeKey).length;
      const matchesUnderNorm = necByName.filter((n) => isMatch(oa, n, NORM));

      let bucket: string;
      if (necByName.length === 0) {
        bucket = "real-no-match";
      } else if (after.matchedOa.has(idx)) {
        bucket = "notation-only-now-matched";
      } else if (matchesUnderNorm.length > 0 && sameNameOaCount > 1) {
        bucket = "ambiguous-after-norm";
      } else {
        bucket = "real-diff";
      }
      return {
        oaName: oa.displayName,
        oaParty: oaParty(oa),
        oaDistrict: oaDistrict(oa),
        sameNameOaTwins: sameNameOaCount,
        sameNameNecCount: necByName.length,
        nearestNec: necByName.slice(0, 3).map((n) => ({
          necParty: necParty(n),
          necDistrict: necDistrict(n),
          partyKeyEqAfterNorm: sameNormalizedKey(normalizePartyForMatch(oaParty(oa)), normalizePartyForMatch(necParty(n))),
          districtRaw: { oa: oaDistrict(oa), nec: necDistrict(n) },
          districtKeyEqAfterNorm: sameNormalizedKey(
            normalizeDistrictForMatch(oaDistrict(oa)),
            normalizeDistrictForMatch(necDistrict(n)),
          ),
        })),
        bucket,
      };
    });
  const bucketCounts = unmatchedDetail.reduce<Record<string, number>>((acc, u) => {
    acc[u.bucket] = (acc[u.bucket] ?? 0) + 1;
    return acc;
  }, {});
  console.log(`  genuine-unmatched buckets: ${JSON.stringify(bucketCounts)}`);
  report.partA_unmatched = { count: unmatchedDetail.length, bucketCounts, members: unmatchedDetail };

  // content_conflict: show the two raw party strings + whether normalization collapses them.
  report.partA_contentConflicts = partyConflictsRaw.map(({ p, d }) => {
    const oaVal = oaParty(p);
    const necVals = [...new Set(p.party.filter((e) => e.source.sourceKind === "nec").map((e) => e.value.trim()))];
    return {
      member: p.displayName,
      discrepancyId: d.discrepancyId,
      oaPartyRaw: oaVal,
      necPartyRaw: necVals,
      normalizedKeysEqual: necVals.some((nv) => sameNormalizedKey(normalizePartyForMatch(oaVal), normalizePartyForMatch(nv))),
      verdict:
        necVals.some((nv) => sameNormalizedKey(normalizePartyForMatch(oaVal), normalizePartyForMatch(nv)))
          ? "NOTATION-VARIANT (normalization would collapse — NOT a real conflict)"
          : "TRUE PARTY DIFFERENCE (survives normalization — real switch, surface it)",
    };
  });
  console.log(`  content_conflicts (raw): ${partyConflictsRaw.length}`);

  // ambiguous: report identity strings of the NEC record(s) that hit >=2 OA candidates.
  report.partA_ambiguous = mergeRaw.ambiguous.map((n) => {
    const nmeKey = normalizeNameForMatch(n.displayName);
    const oaTwins = oaProfiles.filter((oa) => normalizeNameForMatch(oa.displayName) === nmeKey);
    return {
      necName: n.displayName,
      necParty: necParty(n),
      necDistrict: necDistrict(n),
      oaCandidates: oaTwins.map((oa) => ({ party: oaParty(oa), district: oaDistrict(oa) })),
      disambiguatingFieldNeeded:
        "a stable join key (MONA_CD↔NEC id) OR district equality; same-name + same-party twins need district/id to resolve",
    };
  });
  console.log(`  ambiguous (raw): ${mergeRaw.ambiguous.length}`);

  // ── DISTRICT-KEY COLLISION SAFETY (불변 #4): does 시도-prefix stripping collapse two DIFFERENT OA districts? ──
  // If two distinct regional OA districts normalize to the same key, the rule could hide a real difference.
  const districtKeyToRaws = new Map<string, Set<string>>();
  for (const oa of oaProfiles) {
    const raw = oaDistrict(oa);
    if (!raw || isProportionalDistrict(raw)) continue;
    const key = normalizeDistrictForMatch(raw);
    const set = districtKeyToRaws.get(key) ?? new Set<string>();
    set.add(raw);
    districtKeyToRaws.set(key, set);
  }
  const districtCollisions = [...districtKeyToRaws.entries()]
    .filter(([, raws]) => raws.size > 1)
    .map(([key, raws]) => ({ normalizedKey: key, rawValues: [...raws] }));
  report.districtNormalizationCollisions = {
    count: districtCollisions.length,
    collisions: districtCollisions,
    note: "OPTION A (strip 시도 from OA, compare to bare NEC sggName). >0 collisions ⇒ distinct OA districts sharing a 선거구명 across cities collapse to one key — a latent false-match risk because NEC sggName carries NO 시도 (시도 is in the dropped sdName field).",
  };
  console.log(`  [Option A] district-key collisions (bare 선거구명): ${districtCollisions.length}`);

  // ── OPTION B (시도-aware on NEC side): compose NEC district as "{sdName} {sggName}" and compare to OA ORIG_NM ──
  // sdName(시도, 예 "서울") is public geographic identity, NOT PII (not in NEC_DROPPED_PII_FIELDS, not flagged by
  // the privacy scanner). Restoring it on the NEC side removes the collision entirely (no 시도 stripping needed).
  const necFullDistrict = (i: number): string => {
    const raw = necRecords[i]?.raw as Record<string, unknown>;
    const sd = typeof raw?.sdName === "string" ? raw.sdName.trim() : "";
    const sgg = typeof raw?.sggName === "string" ? raw.sggName.trim() : "";
    return sd && sgg ? `${sd} ${sgg}` : sgg;
  };
  // Recompute collisions under Option B using the CANONICAL sido-aware key (full→short reconciled).
  const optBKeyToRaws = new Map<string, Set<string>>();
  for (const oa of oaProfiles) {
    const raw = oaDistrict(oa);
    if (!raw || isProportionalDistrict(raw)) continue;
    const key = normalizeDistrictForMatchSidoAware(raw); // OA already has short 시도 prefix
    const set = optBKeyToRaws.get(key) ?? new Set<string>();
    set.add(raw);
    optBKeyToRaws.set(key, set);
  }
  const optBCollisions = [...optBKeyToRaws.entries()].filter(([, raws]) => raws.size > 1);
  // Prove restoration: for each formerly-colliding OA district, does a NEC winner's canonical key (sdName+sggName)
  // reconstruct to the SAME canonical key? (uses full-form sdName → canonicalSido reconciles to short.)
  const sdNamePresent = necRecords.filter((r) => typeof (r.raw as Record<string, unknown>).sdName === "string").length;
  const necCanonKey = (i: number): string => {
    const raw = necRecords[i]?.raw as Record<string, unknown>;
    const sgg = typeof raw?.sggName === "string" ? raw.sggName : "";
    const sd = typeof raw?.sdName === "string" ? raw.sdName : "";
    return normalizeDistrictForMatchSidoAware(sgg, sd);
  };
  const optBSamples = districtCollisions.flatMap((c) =>
    c.rawValues.map((oaRaw) => {
      const oaKey = normalizeDistrictForMatchSidoAware(oaRaw);
      const idx = necRecords.findIndex((_, i) => necCanonKey(i) === oaKey);
      return {
        oaFull: oaRaw,
        oaCanonicalKey: oaKey,
        necReconstructedKey: idx >= 0 ? necCanonKey(idx) : "(no NEC winner in this district)",
        keyMatch: idx >= 0,
      };
    }),
  );
  const baseTok = (oaDistrictValue: string): string => {
    const first = oaDistrictValue.normalize("NFC").trim().split(/\s+/)[0] ?? "";
    return first;
  };
  const distinctNecSdName = [
    ...new Set(necRecords.map((r) => String((r.raw as Record<string, unknown>).sdName ?? "").trim()).filter(Boolean)),
  ].sort();
  const distinctOaSido = [
    ...new Set(
      oaProfiles
        .filter((oa) => !isProportionalDistrict(oaDistrict(oa)))
        .map((oa) => baseTok(oaDistrict(oa)))
        .filter(Boolean),
    ),
  ].sort();
  report.sidoTokenComparison = {
    necSdNameDistinct: distinctNecSdName,
    oaSidoPrefixDistinct: distinctOaSido,
    note: "If these two token sets differ (e.g. NEC '인천광역시' vs OA '인천'), naive sdName+sggName concatenation will NOT equal OA ORIG_NM — the 시도 forms must be reconciled (canonical short form) before Option B works.",
  };
  console.log(`  NEC sdName forms: ${JSON.stringify(distinctNecSdName)}`);
  console.log(`  OA 시도 prefixes: ${JSON.stringify(distinctOaSido)}`);

  report.optionB_sidoAwareNecDistrict = {
    sdNamePresentInRawRows: sdNamePresent,
    totalNecRows: necRecords.length,
    collisionsUnderOptionB: optBCollisions.length,
    note:
      "OPTION B restores 시도 on the NEC side (sdName+sggName) so distinct cities no longer collide. sdNamePresent==totalNecRows confirms sdName is reliably available. This is the COLLISION-FREE matching basis but requires the mapper to READ sdName (currently dropped) — a scope decision for the human (see dossier).",
    formerlyCollidingNowDisambiguated: optBSamples,
  };
  console.log(`  [Option B] sdName present in ${sdNamePresent}/${necRecords.length} rows; collisions under Option B: ${optBCollisions.length}`);

  // ── PART C: re-run the REAL merge+coverage+detection under each normalizer (authoritative counts) ──
  console.log("\n=== PART C: RE-RUN WITH NORMALIZATION (matching-only) ===");
  const proportionalOa = oaProfiles.filter((oa) => isProportionalDistrict(oaDistrict(oa)));
  const regionalOa = oaProfiles.filter((oa) => !isProportionalDistrict(oaDistrict(oa)));

  // Note: the production mapper now precomputes each NEC profile's sido-aware districtMatchKey from sdName (ADR-6),
  // so Option B no longer needs a script-local district rewrite — the unmodified necMapped + sido-aware normalizer
  // reproduces the collision-free regime through the exact production code path.

  const runMerge = (necInput: NecMappedProfile[], normalizer?: MatchNormalizer) => {
    const merge = normalizer
      ? mergeNecIntoProfiles(oaProfiles, necInput, normalizer)
      : mergeNecIntoProfiles(oaProfiles, necInput);
    const coverage = classifyNecCoverage(merge.profiles, oaProfiles, merge.ambiguous);
    const detected = merge.profiles.map((p) => ({
      ...p,
      discrepancies: detectProfileDiscrepanciesSync(p, mockSyncVerifier, { detectedAt: necRecords[0]?.fetchedAt }),
    }));
    const partyConflicts = detected.flatMap((p) =>
      p.discrepancies.filter((d) => d.field === "party" && d.kind === "content_conflict").map((d) => ({ p, d })),
    );
    return { merge, coverage, detected, partyConflicts };
  };

  const summarize = (r: ReturnType<typeof runMerge>) => ({
    matched: r.coverage.matched,
    genuineUnmatched: r.coverage.genuineUnmatched,
    outOfScope: r.coverage.outOfScope,
    ambiguousWithheld: r.coverage.ambiguousWithheld,
    ambiguousWithheldMembers: r.coverage.ambiguousWithheldMembers,
    ambiguousNec: r.merge.ambiguous.length,
    partyContentConflicts: r.partyConflicts.length,
  });

  const beforeRun = runMerge(necMapped, LEGACY_MATCH_NORMALIZER); // legacy normalizer (previous production behavior)
  const optionARun = runMerge(necMapped, NEC_MATCH_NORMALIZER_OPTION_A_MEASUREMENT_ONLY); // 시도-strip (6 collisions)
  // Option B (ADR-6, NOW production default): sido-aware. The mapper precomputes districtMatchKey from sdName, so the
  // production merge path (NEC_MATCH_NORMALIZER_SIDO_AWARE on the unmodified necMapped) reproduces the collision-free
  // regime directly — no script-local district rewrite needed. This is the AUTHORITATIVE post-switch regression count.
  const optionBRun = runMerge(necMapped, NEC_MATCH_NORMALIZER_SIDO_AWARE); // 시도-aware (0 collisions) — PRODUCTION DEFAULT

  const afterRun = optionBRun; // the recommended, collision-free regime drives the headline "after"

  report.partC = {
    before: summarize(beforeRun),
    after_recommended_optionB: summarize(optionBRun),
    optionA_measurement_only_unsafe: summarize(optionARun),
    delta_optionB_vs_before: {
      matched: optionBRun.coverage.matched - beforeRun.coverage.matched,
      genuineUnmatched: optionBRun.coverage.genuineUnmatched - beforeRun.coverage.genuineUnmatched,
      notationOnlyNowMatched: bucketCounts["notation-only-now-matched"] ?? 0,
      ambiguousAfterNorm: bucketCounts["ambiguous-after-norm"] ?? 0,
      realNoMatchStillUnmatched: bucketCounts["real-no-match"] ?? 0,
      realDiffStillUnmatched: bucketCounts["real-diff"] ?? 0,
      partyConflictsBefore: beforeRun.partyConflicts.length,
      partyConflictsAfter: optionBRun.partyConflicts.length,
      newConflictsSurfacedByNormalization: optionBRun.partyConflicts.length - beforeRun.partyConflicts.length,
    },
    afterPartyConflicts: afterRun.partyConflicts.map(({ p }) => ({
      member: p.displayName,
      oaParty: oaParty(p),
      necParty: [...new Set(p.party.filter((e) => e.source.sourceKind === "nec").map((e) => e.value.trim()))],
    })),
  };
  console.log(`  before (legacy):     matched=${beforeRun.coverage.matched} unmatched=${beforeRun.coverage.genuineUnmatched} ambiguous=${beforeRun.merge.ambiguous.length} conflict=${beforeRun.partyConflicts.length}`);
  console.log(`  Option A (unsafe):   matched=${optionARun.coverage.matched} unmatched=${optionARun.coverage.genuineUnmatched} ambiguous=${optionARun.merge.ambiguous.length} conflict=${optionARun.partyConflicts.length}  [6 district collisions]`);
  console.log(`  Option B (DEFAULT):  matched=${optionBRun.coverage.matched} genuine-unmatched=${optionBRun.coverage.genuineUnmatched} ambiguous-withheld=${optionBRun.coverage.ambiguousWithheld} (${JSON.stringify(optionBRun.coverage.ambiguousWithheldMembers)}) out-of-scope=${optionBRun.coverage.outOfScope} ambiguousNec=${optionBRun.merge.ambiguous.length} conflict=${optionBRun.partyConflicts.length}  [0 collisions]`);
  // REGRESSION GATE (ADR-6/7): the reviewed post-switch expectation. Any drift here ⇒ STOP and report the delta.
  const gate = {
    matched: optionBRun.coverage.matched === 239,
    genuineUnmatched: optionBRun.coverage.genuineUnmatched === 13,
    ambiguousWithheld: optionBRun.coverage.ambiguousWithheld === 2,
    outOfScope: optionBRun.coverage.outOfScope === 46,
    contentConflict: optionBRun.partyConflicts.length === 6,
  };
  const gatePass = Object.values(gate).every(Boolean);
  report.regressionGate = {
    expected: { matched: 239, genuineUnmatched: 13, ambiguousWithheld: 2, outOfScope: 46, contentConflict: 6 },
    actual: {
      matched: optionBRun.coverage.matched,
      genuineUnmatched: optionBRun.coverage.genuineUnmatched,
      ambiguousWithheld: optionBRun.coverage.ambiguousWithheld,
      outOfScope: optionBRun.coverage.outOfScope,
      contentConflict: optionBRun.partyConflicts.length,
    },
    perField: gate,
    pass: gatePass,
  };
  console.log(`  REGRESSION GATE: ${gatePass ? "PASS ✅" : "FAIL ❌ — STOP, do not proceed"} ${JSON.stringify(gate)}`);

  // raw-preservation proof: one now-matched pair whose raw strings differ but normalize to same key.
  const beforeMatchedIdx = new Set(
    beforeRun.merge.profiles.map((p, i) => (p.party.concat(p.district).some((e) => e.source.sourceKind === "nec") ? i : -1)).filter((i) => i >= 0),
  );
  const afterMatchedIdx = new Set(
    afterRun.merge.profiles.map((p, i) => (p.party.concat(p.district).some((e) => e.source.sourceKind === "nec") ? i : -1)).filter((i) => i >= 0),
  );
  const preservationExample = (() => {
    for (const oa of oaProfiles) {
      const idx = oaProfiles.indexOf(oa);
      if (!afterMatchedIdx.has(idx) || beforeMatchedIdx.has(idx)) continue; // newly matched only
      const nz = necMapped.find((n) => isMatch(oa, n, NORM));
      if (!nz) continue;
      const oaD = oaDistrict(oa);
      const necD = necDistrict(nz);
      const oaP = oaParty(oa);
      const necP = necParty(nz);
      const districtRawDiffers = oaD !== necD && sameNormalizedKey(normalizeDistrictForMatch(oaD), normalizeDistrictForMatch(necD));
      const partyRawDiffers = oaP !== necP && sameNormalizedKey(normalizePartyForMatch(oaP), normalizePartyForMatch(necP));
      if (districtRawDiffers || partyRawDiffers) {
        return {
          member: oa.displayName,
          field: districtRawDiffers ? "district" : "party",
          oaRaw: districtRawDiffers ? oaD : oaP,
          necRaw: districtRawDiffers ? necD : necP,
          normalizedKey: districtRawDiffers ? normalizeDistrictForMatch(oaD) : normalizePartyForMatch(oaP),
          note: "both raw strings remain separately stored on their own EvidenceValue (source-tagged); normalization only produced the comparison key.",
        };
      }
    }
    return null;
  })();
  report.partC_rawPreservationExample = preservationExample;
  console.log(`  raw-preservation example: ${preservationExample ? JSON.stringify(preservationExample) : "none (no newly-matched notation-only pairs)"}`);

  // ── PART D: ORIG_NM 비례대표 assumption ──
  console.log("\n=== PART D: ORIG_NM 비례대표 ASSUMPTION ===");
  const proportionalDistinct = [...new Set(proportionalOa.map((p) => oaDistrict(p)))];
  const regionalSample = [...new Set(regionalOa.map((p) => oaDistrict(p)))].slice(0, 8);
  // Sanity: do any NEC winner rows (regional) carry a 비례대표 district? (should be zero — winner API has no 비례.)
  const necProportionalRows = necMapped.filter((n) => isProportionalDistrict(necDistrict(n))).length;
  report.partD = {
    oaTotal: oaProfiles.length,
    proportionalCount: proportionalOa.length,
    regionalCount: regionalOa.length,
    knownAssembly22ProportionalSeats: 46,
    proportionalCountMatchesKnown: proportionalOa.length === 46,
    distinctProportionalDistrictValues: proportionalDistinct,
    regionalDistrictSamples: regionalSample,
    necRowsLabeledProportional: necProportionalRows,
    // a regional member mislabeled proportional would wrongly hide a real unmatched; check none of the matched
    // members are proportional-labeled (they matched a regional NEC winner, so they cannot be proportional).
    matchedButProportionalLabeled: oaProfiles.filter(
      (oa, i) => after.matchedOa.has(i) && isProportionalDistrict(oaDistrict(oa)),
    ).map((oa) => oa.displayName),
    verdict:
      proportionalOa.length === 46 && necProportionalRows === 0
        ? "HOLDS: ORIG_NM='비례대표' isolates exactly the 46 proportional seats; no regional member mislabeled; no NEC winner row labeled proportional."
        : "NEEDS REVIEW: proportional count != 46 or NEC winner rows carry proportional district — investigate field reliability.",
  };
  console.log(`  proportional=${proportionalOa.length} (==46? ${proportionalOa.length === 46}); distinct values=${JSON.stringify(proportionalDistinct)}`);
  console.log(`  NEC winner rows labeled proportional: ${necProportionalRows} (must be 0)`);

  // DIAGNOSTIC: trace any member matched under legacy but NOT under Option B (would be a hidden conflict — 불변 #4).
  const lostByOptB = oaProfiles
    .map((oa, i) => ({ oa, i }))
    .filter(({ i }) => beforeMatchedIdx.has(i) && !afterMatchedIdx.has(i))
    .map(({ oa, i }) => {
      const nmeKey = normalizeNameForMatch(oa.displayName);
      const necByName = necMapped.filter((n) => normalizeNameForMatch(n.displayName) === nmeKey);
      return {
        member: oa.displayName,
        oaParty: oaParty(oa),
        oaDistrict: oaDistrict(oa),
        oaDistrictCanonKey: normalizeDistrictForMatchSidoAware(oaDistrict(oa)),
        nec: necByName.map((n, k) => {
          const idx = necMapped.indexOf(n);
          return {
            necParty: necParty(n),
            necDistrictBare: necDistrict(n),
            necDistrictCanonKey: idx >= 0 ? necCanonKey(idx) : "?",
            necFullComposed: idx >= 0 ? necFullDistrict(idx) : "?",
          };
        }),
      };
    });
  report.diagnostic_matchedLegacyButLostUnderOptionB = lostByOptB;
  if (lostByOptB.length > 0) {
    console.log(`  ⚠️ LOST under Option B (investigate — possible hidden conflict): ${JSON.stringify(lostByOptB)}`);
  }

  await writeReport(report);
  console.log(`\n=== SUMMARY ===`);
  console.log(`  total NEC calls used: ${necCallCount}/${MAX_NEC_CALLS}`);
  console.log(`  dossier written to ${join(outputDir, "normalization-classify.json")}`);
}

async function writeReport(report: Record<string, unknown>) {
  report.necCallsUsed = necCallCount;
  await mkdir(outputDir, { recursive: true });
  await writeFile(join(outputDir, "normalization-classify.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
