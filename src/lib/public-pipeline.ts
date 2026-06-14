import { MockCollector } from "./collectors/mock";
import { classifyNecCoverage, classifyNecCoveragePerProfile } from "./collectors/nec-coverage";
import { mapNecRecord, NecCollector, necConfigFromEnv } from "./collectors/nec";
import { mergeNecIntoProfiles } from "./collectors/nec-merge";
import {
  mapOpenAssemblyMemberRecord,
  mergeOpenAssemblyMappedProfile,
  OpenAssemblyCollector,
  openAssemblyConfigFromEnv,
  type OpenAssemblyConfig,
  type OpenAssemblyMemberRecord,
} from "./collectors/open-assembly";
import type { Collector } from "./collectors/types";
import {
  assertRawArchivePublishableForInternalUse,
  buildInternalRawArchive,
  type InternalRawArchive,
} from "./raw-records";
import { buildPublicSnapshot } from "./snapshot";
import { validatePublicSnapshot } from "./snapshot-validator";
import { sourceLicensePolicies, validateSnapshotSourceLicenses } from "./source-license";
import { assertNecApprovedForRealCollection, parseNecCollectorMode, type NecCollectorMode } from "./collectors/nec-pipeline";
import type { FactCategory, PoliticianProfile, PublicSnapshot } from "./types";

export type PublicPipelineCollectorMode = "mock" | "open_assembly";
const MAX_PUBLIC_NEC_CALLS = 6;

export interface PublicPipelineEnv extends Record<string, string | undefined> {
  PUBLIC_PIPELINE_COLLECTOR?: string;
  OPEN_ASSEMBLY_API_KEY?: string;
  OPEN_ASSEMBLY_BASE_URL?: string;
  OPEN_ASSEMBLY_LICENSE_NOTE?: string;
  NEC_COLLECTOR?: string;
  NEC_API_KEY?: string;
  NEC_BASE_URL?: string;
  NEC_LICENSE_NOTE?: string;
  NEC_SG_ID?: string;
  NEC_SG_TYPECODE?: string;
}

export interface PublicPipelineCollectorSelection {
  mode: PublicPipelineCollectorMode;
  collector: Collector<PoliticianProfile>;
  necMode: NecCollectorMode;
  getNecRunSummary: () => PublicNecRunSummary | undefined;
}

export interface PublicNecRunSummary {
  mode: "nec";
  necRows: number;
  necMapped: number;
  necCallsUsed: number;
  necCallBudget: number;
  matched: number;
  genuineUnmatched: number;
  ambiguousWithheld: number;
  outOfScope: number;
  totalOaMembers: number;
  ambiguousWithheldMembers: string[];
  genuineUnmatchedMembers: string[];
  outOfScopeMembers: string[];
  ambiguousNecRecords: string[];
  unmatchedNecRecords: number;
  coverageSidecar: {
    generated_at: string;
    coverage: Record<string, { status: "ambiguous_withheld" | "out_of_scope"; reason: string }>;
  };
}

export class OpenAssemblyProfileCollector implements Collector<PoliticianProfile> {
  sourceName = "open-assembly-public-profile";

  constructor(private readonly collector: OpenAssemblyCollector) {}

  async collect(): Promise<PoliticianProfile[]> {
    const records = await this.collector.collect();

    return records
      .map(mapOpenAssemblyMemberRecord)
      .filter((profile): profile is NonNullable<typeof profile> => profile !== null)
      .map(mergeOpenAssemblyMappedProfile);
  }
}

export class OpenAssemblyNecCrossVerifiedCollector implements Collector<PoliticianProfile> {
  sourceName = "open-assembly-public-profile+nec-cross-verification";
  private necRunSummary: PublicNecRunSummary | undefined;

  constructor(
    private readonly openAssemblyCollector: OpenAssemblyProfileCollector,
    private readonly necCollector: NecCollector,
    private readonly necStats: { callsUsed: number; budget: number },
  ) {}

  async collect(): Promise<PoliticianProfile[]> {
    const oaProfiles = await this.openAssemblyCollector.collect();
    const necRecords = await this.necCollector.collect();
    const necMapped = necRecords
      .map((record, index) => mapNecRecord(record, index))
      .filter((profile): profile is NonNullable<typeof profile> => profile !== null);

    const merge = mergeNecIntoProfiles(oaProfiles, necMapped);
    const coverage = classifyNecCoverage(merge.profiles, oaProfiles, merge.ambiguous);
    const coverageSidecar = {
      generated_at: necRecords[0]?.fetchedAt ?? new Date().toISOString(),
      coverage: classifyNecCoveragePerProfile(merge.profiles, oaProfiles, merge.ambiguous),
    };

    this.necRunSummary = {
      mode: "nec",
      necRows: necRecords.length,
      necMapped: necMapped.length,
      necCallsUsed: this.necStats.callsUsed,
      necCallBudget: this.necStats.budget,
      matched: coverage.matched,
      genuineUnmatched: coverage.genuineUnmatched,
      ambiguousWithheld: coverage.ambiguousWithheld,
      outOfScope: coverage.outOfScope,
      totalOaMembers: coverage.totalOaMembers,
      ambiguousWithheldMembers: coverage.ambiguousWithheldMembers,
      genuineUnmatchedMembers: coverage.genuineUnmatchedMembers,
      outOfScopeMembers: coverage.outOfScopeMembers,
      ambiguousNecRecords: merge.ambiguous.map((profile) => profile.displayName),
      unmatchedNecRecords: merge.unmatched.length,
      coverageSidecar,
    };

    return merge.profiles;
  }

  getNecRunSummary(): PublicNecRunSummary | undefined {
    return this.necRunSummary;
  }
}

export function selectPublicPipelineCollector(env: PublicPipelineEnv = process.env): PublicPipelineCollectorSelection {
  const mode = parsePublicPipelineCollectorMode(env.PUBLIC_PIPELINE_COLLECTOR);
  const necMode = parseNecCollectorMode(env.NEC_COLLECTOR);

  if (mode === "mock") {
    return { mode, necMode, collector: new MockCollector(), getNecRunSummary: () => undefined };
  }

  assertSourceApprovedForPublicPipeline("open_assembly");
  const config = openAssemblyConfigFromEnv(env);
  if (!config) {
    throw new Error("OPEN_ASSEMBLY_API_KEY is required when PUBLIC_PIPELINE_COLLECTOR=open_assembly");
  }
  if (!config.licenseNote) {
    throw new Error("OPEN_ASSEMBLY_LICENSE_NOTE is required when PUBLIC_PIPELINE_COLLECTOR=open_assembly");
  }

  const openAssemblyCollector = new OpenAssemblyProfileCollector(new OpenAssemblyCollector(config));

  if (necMode === "off") {
    return { mode, necMode, collector: openAssemblyCollector, getNecRunSummary: () => undefined };
  }

  assertNecApprovedForRealCollection();
  const necStats = { callsUsed: 0, budget: MAX_PUBLIC_NEC_CALLS };
  const necConfig = necConfigFromEnv(env);
  if (!necConfig) throw new Error("NEC_API_KEY is required when NEC_COLLECTOR=nec");
  const necCollector = new NecCollector(necConfig, "winner", buildCountingNecFetch(necStats));
  const collector = new OpenAssemblyNecCrossVerifiedCollector(openAssemblyCollector, necCollector, necStats);

  return {
    mode,
    necMode,
    collector,
    getNecRunSummary: () => collector.getNecRunSummary(),
  };
}

export function parsePublicPipelineCollectorMode(value: string | undefined): PublicPipelineCollectorMode {
  const normalized = value?.trim();
  if (!normalized || normalized === "mock") return "mock";
  if (normalized === "open_assembly") return "open_assembly";
  throw new Error(`Unsupported PUBLIC_PIPELINE_COLLECTOR: ${value}`);
}

export function assertSourceApprovedForPublicPipeline(sourceKind: "open_assembly") {
  const policy = sourceLicensePolicies[sourceKind];
  if (policy.status !== "approved") {
    throw new Error(`${sourceKind} is ${policy.status}; approve ${policy.reference} before using it in the public pipeline`);
  }
}

export function publicPipelineStatus(env: PublicPipelineEnv = process.env) {
  const mode = parsePublicPipelineCollectorMode(env.PUBLIC_PIPELINE_COLLECTOR);
  const necMode = parseNecCollectorMode(env.NEC_COLLECTOR);
  const sourceStatus = mode === "mock" ? "mock_only" : sourceLicensePolicies.open_assembly.status;

  return {
    mode,
    necMode,
    sourceStatus,
    publicDataAllowed: mode === "mock" || sourceStatus === "approved",
  };
}

function buildCountingNecFetch(stats: { callsUsed: number; budget: number }) {
  return async (input: string | URL): Promise<Pick<Response, "ok" | "status" | "json">> => {
    if (stats.callsUsed >= stats.budget) {
      throw new Error(`STOP: NEC call budget (${stats.budget}) exhausted — refusing to loop/retry.`);
    }
    stats.callsUsed += 1;
    const url = typeof input === "string" ? input : input.toString();
    console.log(`NEC public pipeline call #${stats.callsUsed}/${stats.budget}: ${redactNecUrl(url)}`);
    const response = await fetch(url);
    return { ok: response.ok, status: response.status, json: () => response.json() };
  };
}

function redactNecUrl(input: string) {
  try {
    const u = new URL(input);
    if (u.searchParams.has("serviceKey")) u.searchParams.set("serviceKey", "***REDACTED***");
    return u.toString();
  } catch {
    return "[unparseable-url-redacted]";
  }
}

/**
 * Internal-only Open Assembly fixture dry-run.
 *
 * This proves the real-source pipeline shape (raw record -> mapper -> profile -> snapshot)
 * works WITHOUT letting unapproved Open Assembly data into public artifacts. It runs entirely
 * on the provided fixture records and never touches the network or the public snapshot output.
 *
 * The dry-run asserts five things and returns the evidence for each:
 * 1. the snapshot schema validates,
 * 2. the internal raw archive privacy scan passes,
 * 3. only mapped identity fields are exposed,
 * 4. no guessed education/career/election/bill/vote/committee fields appear,
 * 5. the source-license gate STILL rejects the snapshot while open_assembly is pending_review.
 */

// Categories that the verified Open Assembly identity mapper is allowed to expose.
const ALLOWED_FIXTURE_CATEGORIES: ReadonlySet<FactCategory> = new Set<FactCategory>(["identity"]);

// Categories that must never appear from the fixture until their mappers are verified.
const GUESSED_FIXTURE_CATEGORIES: readonly FactCategory[] = [
  "education",
  "career",
  "party_history",
  "election",
  "bill",
  "vote",
  "committee",
];

export interface OpenAssemblyFixtureDryRunCheck {
  name: string;
  passed: boolean;
  detail: string;
}

export interface OpenAssemblyFixtureDryRunResult {
  ok: boolean;
  profileCount: number;
  factCount: number;
  rawArchive: InternalRawArchive<OpenAssemblyMemberRecord>;
  snapshot: PublicSnapshot;
  checks: OpenAssemblyFixtureDryRunCheck[];
}

export function runOpenAssemblyFixtureDryRun(
  records: OpenAssemblyMemberRecord[],
  generatedAt = "2026-06-12T00:00:00.000Z",
): OpenAssemblyFixtureDryRunResult {
  // Step 1: preserve the raw records in an internal-only archive and scan for private data.
  const rawArchive = buildInternalRawArchive(records, generatedAt);

  // Step 2: convert raw records through the verified identity mapper into profiles.
  const profiles = records
    .map(mapOpenAssemblyMemberRecord)
    .filter((profile): profile is NonNullable<typeof profile> => profile !== null)
    .map(mergeOpenAssemblyMappedProfile);

  // Step 3: build a snapshot-shaped object for internal validation only (never written to public/).
  const snapshot = buildPublicSnapshot(profiles, generatedAt);

  const checks: OpenAssemblyFixtureDryRunCheck[] = [];

  // Check 1: snapshot schema validates.
  const schemaResult = validatePublicSnapshot(snapshot);
  checks.push({
    name: "snapshot_schema_valid",
    passed: schemaResult.valid,
    detail: schemaResult.valid ? "snapshot matches public schema" : schemaResult.errors.join("; "),
  });

  // Check 2: raw archive privacy scan passes.
  checks.push({
    name: "raw_privacy_scan_passed",
    passed: rawArchive.privacy_scan.status === "passed",
    detail:
      rawArchive.privacy_scan.status === "passed"
        ? "no private-data findings in raw archive"
        : rawArchive.privacy_scan.findings.map((finding) => finding.path).join(", "),
  });

  // Check 3: only mapped identity fields are exposed.
  const nonIdentityFacts = snapshot.verified_facts.filter((row) => !ALLOWED_FIXTURE_CATEGORIES.has(row.category));
  checks.push({
    name: "only_identity_fields_exposed",
    passed: nonIdentityFacts.length === 0,
    detail:
      nonIdentityFacts.length === 0
        ? `all ${snapshot.verified_facts.length} facts are identity facts`
        : `non-identity facts present: ${nonIdentityFacts.map((row) => `${row.category}:${row.field}`).join(", ")}`,
  });

  // Check 4: no guessed education/career/election/bill/vote/committee fields appear.
  const guessedFacts = snapshot.verified_facts.filter((row) =>
    GUESSED_FIXTURE_CATEGORIES.includes(row.category),
  );
  checks.push({
    name: "no_guessed_fields",
    passed: guessedFacts.length === 0,
    detail:
      guessedFacts.length === 0
        ? "no education/career/election/bill/vote/committee facts present"
        : `guessed facts present: ${guessedFacts.map((row) => `${row.category}:${row.field}`).join(", ")}`,
  });

  // Check 5: the source-license gate STILL rejects this fixture's snapshot.
  // NOTE (2026-06-13): open_assembly is now human-approved, so the policy-status branch no longer blocks it.
  // This fixture still carries a deliberately-provisional MOCK raw note ("...replace after source license
  // review"), so the gate's provisional-language guard rejects it — a mock/fixture note must never publish.
  // The dry-run therefore stays internal-only regardless of the approval flip.
  const licenseResult = validateSnapshotSourceLicenses(snapshot);
  const stillBlocked =
    !licenseResult.valid && licenseResult.errors.some((error) => error.includes("open_assembly"));
  checks.push({
    name: "source_license_gate_still_rejects",
    passed: stillBlocked,
    detail: stillBlocked
      ? `license gate rejects open_assembly: ${licenseResult.errors.join("; ")}`
      : "license gate unexpectedly accepted pending open_assembly snapshot",
  });

  return {
    ok: checks.every((check) => check.passed),
    profileCount: profiles.length,
    factCount: snapshot.verified_facts.length,
    rawArchive,
    snapshot,
    checks,
  };
}

/**
 * Runs the fixture dry-run and throws if any check fails. The internal raw archive privacy assertion
 * is enforced first so a privacy regression surfaces with the shared raw-archive error message.
 */
export function assertOpenAssemblyFixtureDryRun(
  records: OpenAssemblyMemberRecord[],
  generatedAt?: string,
): OpenAssemblyFixtureDryRunResult {
  const result = runOpenAssemblyFixtureDryRun(records, generatedAt);
  assertRawArchivePublishableForInternalUse(result.rawArchive);

  const failures = result.checks.filter((check) => !check.passed);
  if (failures.length > 0) {
    throw new Error(
      `Open Assembly fixture dry-run failed: ${failures.map((check) => `${check.name} (${check.detail})`).join("; ")}`,
    );
  }

  return result;
}
