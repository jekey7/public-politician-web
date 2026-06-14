/**
 * Iteration: INTERNAL LIVE DRY-RUN against the real nwvrqwxyaytdsfvhu endpoint.
 *
 * Fetches the 300 current 22nd-Assembly members into the INTERNAL raw archive only, runs them
 * through runOpenAssemblyFixtureDryRun + the raw-archive privacy scan, and reports validation
 * facts. This NEVER writes to public output and NEVER flips the license. The source-license gate
 * must still reject (open_assembly is pending_review).
 *
 * Key is read from env (OPEN_ASSEMBLY_API_KEY) only. The key value is never printed or persisted.
 * Run: npm run dry-run:open-assembly-live   (or: tsx scripts/dry-run-open-assembly-live.ts)
 */
import {
  APPROVED_PUBLIC_CONTACT_FIELDS,
  DEFAULT_OPEN_ASSEMBLY_MEMBER_PATH,
  mapOpenAssemblyMemberRecord,
  OpenAssemblyCollector,
  openAssemblyConfigFromEnv,
  PUBLIC_MAPPER_DROPPED_FIELDS,
} from "../src/lib/collectors/open-assembly";
import { runOpenAssemblyFixtureDryRun } from "../src/lib/public-pipeline";
import { scanRawRecordsForPrivateData } from "../src/lib/raw-records";

const EXPECTED = 300;

function classifyHomepage(url: string | null): string {
  if (!url) return "empty";
  const u = url.toLowerCase();
  if (u.includes("assembly.go.kr")) return "assembly.go.kr profile";
  if (u.includes("blog.naver") || u.includes("tistory") || u.includes("blog.")) return "blog";
  if (
    u.includes("instagram") || u.includes("facebook") || u.includes("youtube") ||
    u.includes("twitter") || u.includes("x.com") || u.includes("threads")
  ) {
    return "SNS";
  }
  return "official site / other";
}

function tallySorted(values: (string | null)[]): [string, number][] {
  const map = new Map<string, number>();
  for (const v of values) {
    const k = v ?? "(null)";
    map.set(k, (map.get(k) ?? 0) + 1);
  }
  return [...map.entries()].sort((a, b) => b[1] - a[1]);
}

async function main() {
  // Force the live current-member endpoint for this dry-run regardless of ambient env.
  const config = openAssemblyConfigFromEnv({
    ...process.env,
    OPEN_ASSEMBLY_MEMBER_PATH: process.env.OPEN_ASSEMBLY_MEMBER_PATH ?? DEFAULT_OPEN_ASSEMBLY_MEMBER_PATH,
    // license note required only for the PUBLIC pipeline; dry-run keeps a provisional internal note.
    OPEN_ASSEMBLY_LICENSE_NOTE:
      process.env.OPEN_ASSEMBLY_LICENSE_NOTE ?? "INTERNAL DRY-RUN ONLY — pending_review, not for public release",
  });

  if (!config) {
    console.error(
      "STOP: OPEN_ASSEMBLY_API_KEY not set. In PowerShell, load it from .env then re-run:\n" +
        "  $env:OPEN_ASSEMBLY_API_KEY = (Get-Content .env | Where-Object { $_ -match '^OPEN_ASSEMBLY_API_KEY=' }) -replace '^OPEN_ASSEMBLY_API_KEY=',''\n" +
        "  npm run dry-run:open-assembly-live",
    );
    process.exitCode = 2;
    return;
  }

  console.log(`endpoint: ${config.memberListPath ?? DEFAULT_OPEN_ASSEMBLY_MEMBER_PATH}`);

  const collector = new OpenAssemblyCollector(config);
  const records = await collector.collect();
  const rowCount = records.length;

  console.log(`\n=== 1. LIVE FETCH ===`);
  console.log(`rowCount fetched: ${rowCount}`);

  if (rowCount !== EXPECTED) {
    console.error(
      `STOP: expected ${EXPECTED} rows, got ${rowCount}. (If 5, the key fell back to sample mode — check Key param / env.)`,
    );
    process.exitCode = 3;
    return;
  }

  // --- 3(a) identity profiles + MONA_CD ids ---
  const mapped = records.map(mapOpenAssemblyMemberRecord);
  const validProfiles = mapped.filter((m): m is NonNullable<typeof m> => m !== null);
  const missCount = mapped.length - validProfiles.length;
  const monaIds = new Set(records.map((r) => String(r.raw.MONA_CD ?? "")).filter(Boolean));

  console.log(`\n=== 3(a) IDENTITY PROFILES ===`);
  console.log(`valid profiles: ${validProfiles.length} / ${EXPECTED} (misses: ${missCount})`);
  console.log(`distinct MONA_CD ids in raw: ${monaIds.size}`);
  console.log(`all profile ids prefixed open-assembly-: ${validProfiles.every((p) => p.politicianId.startsWith("open-assembly-"))}`);

  // --- 3(b) approved contact field population (present vs null) ---
  console.log(`\n=== 3(b) APPROVED CONTACT FIELD POPULATION (present / ${EXPECTED}) ===`);
  for (const [rawKey, fieldName] of Object.entries(APPROVED_PUBLIC_CONTACT_FIELDS)) {
    const present = records.filter((r) => {
      const v = r.raw[rawKey];
      return typeof v === "string" && v.trim().length > 0;
    }).length;
    console.log(`  ${rawKey} -> ${fieldName}: ${present} present, ${EXPECTED - present} empty/null`);
  }
  // confirm contact evidence carries source metadata
  const withContact = validProfiles.filter((p) => p.contact.length > 0);
  const allContactSourced = withContact.every((p) =>
    p.contact.every((e) => e.source.sourceKind === "open_assembly" && e.source.sourceUrl.length > 0),
  );
  console.log(`  profiles with >=1 contact field: ${withContact.length}; all contact evidence source-attached: ${allContactSourced}`);

  // --- 3(c) privacy scan on real raw ---
  const scan = scanRawRecordsForPrivateData(records);
  const flaggedKeys = new Set(scan.findings.map((f) => f.path.split(".").pop() ?? ""));
  const aideFlagged = PUBLIC_MAPPER_DROPPED_FIELDS.aideNames.filter((k) => flaggedKeys.has(k));
  const contactFalseBlocks = Object.keys(APPROVED_PUBLIC_CONTACT_FIELDS).filter((k) => flaggedKeys.has(k));

  console.log(`\n=== 3(c) PRIVACY SCAN (internal raw) ===`);
  console.log(`scan status: ${scan.status} (findings: ${scan.findings.length})`);
  console.log(`aide-name fields flagged: [${aideFlagged.join(", ")}] of [${PUBLIC_MAPPER_DROPPED_FIELDS.aideNames.join(", ")}]`);
  console.log(`approved contact fields FALSE-blocked: [${contactFalseBlocks.join(", ")}] (must be empty)`);

  // --- 3(d) source-license gate must still reject ---
  const dryRun = runOpenAssemblyFixtureDryRun(records);
  const licenseGate = dryRun.checks.find((c) => c.name === "source_license_gate_still_rejects");
  const identityOnly = dryRun.checks.find((c) => c.name === "only_identity_fields_exposed");
  const noGuessed = dryRun.checks.find((c) => c.name === "no_guessed_fields");

  console.log(`\n=== 3(d) SOURCE-LICENSE GATE (must REJECT) ===`);
  console.log(`dry-run profileCount: ${dryRun.profileCount}, factCount: ${dryRun.factCount}`);
  console.log(`source_license_gate_still_rejects: ${licenseGate?.passed} (true = still rejected → nothing public)`);
  console.log(`only_identity_fields_exposed: ${identityOnly?.passed}`);
  console.log(`no_guessed_fields: ${noGuessed?.passed}`);

  // --- HOMEPAGE distribution ---
  const homepages = records.map((r) => (typeof r.raw.HOMEPAGE === "string" ? r.raw.HOMEPAGE : null));
  const hpDist = tallySorted(homepages.map(classifyHomepage));
  console.log(`\n=== HOMEPAGE DISTRIBUTION ===`);
  for (const [cat, n] of hpDist) console.log(`  ${cat}: ${n}`);

  // --- JOB_RES_NM observed values ---
  const jobs = records.map((r) => (typeof r.raw.JOB_RES_NM === "string" && r.raw.JOB_RES_NM.trim() ? r.raw.JOB_RES_NM : null));
  const jobDist = tallySorted(jobs);
  console.log(`\n=== 4. JOB_RES_NM OBSERVED VALUES (distinct + counts) ===`);
  for (const [val, n] of jobDist.slice(0, 20)) console.log(`  ${val}: ${n}`);
  console.log(`  distinct JOB_RES_NM values: ${jobDist.length}`);

  console.log(`\n=== SUMMARY ===`);
  console.log(`nothing written to public/ (this script only reads + reports).`);
  console.log(`license gate rejected: ${licenseGate?.passed} → no public exposure path.`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
