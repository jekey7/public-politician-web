import type { PublicSnapshot, SnapshotFactRow, SnapshotNewsRow, SourceKind } from "./types";

export type SourceLicenseStatus = "approved" | "pending_review" | "mock_only";

export interface SourceLicensePolicy {
  sourceKind: SourceKind;
  status: SourceLicenseStatus;
  requiredNoteFragment?: string;
  reference: string;
}

export interface SourceLicenseValidationResult {
  valid: boolean;
  errors: string[];
}

type SourceRow = Pick<
  SnapshotFactRow | SnapshotNewsRow,
  "source_kind" | "source_id" | "source_org" | "source_url" | "license_note"
>;

export const sourceLicensePolicies: Record<SourceKind, SourceLicensePolicy> = {
  mock: {
    sourceKind: "mock",
    status: "mock_only",
    requiredNoteFragment: "MOCK DATA ONLY",
    reference: "docs/PUBLIC_DATA_POLICY.md#assumption",
  },
  open_assembly: {
    // APPROVED 2026-06-13 by the human owner (§0.7 publishability judgment) for endpoint
    // nwvrqwxyaytdsfvhu only — see docs/source-reviews/open_assembly.md. KOGL Type 1 (출처표시).
    // Agents MUST NOT self-approve license status; this records a human decision.
    sourceKind: "open_assembly",
    status: "approved",
    reference: "docs/source-reviews/open_assembly.md",
  },
  public_data_portal: {
    sourceKind: "public_data_portal",
    status: "pending_review",
    reference: "docs/source-reviews/public_data_portal.md",
  },
  rokps: {
    sourceKind: "rokps",
    status: "pending_review",
    reference: "docs/source-reviews/rokps.md",
  },
  nec: {
    // APPROVED 2026-06-13 by the human owner (§0.7 publishability judgment) for dataset 15000864 only
    // (당선인 정보 조회 서비스) — see docs/source-reviews/nec.md. data.go.kr 이용허락범위 "제한 없음".
    // Agents MUST NOT self-approve license status; this records a human decision. Approval unlocks the
    // license gate ONLY — real NEC fetch stays gated by NEC_COLLECTOR / PUBLIC_PIPELINE_COLLECTOR.
    sourceKind: "nec",
    status: "approved",
    reference: "docs/source-reviews/nec.md",
  },
  news_search: {
    sourceKind: "news_search",
    status: "pending_review",
    reference: "docs/source-reviews/news_search.md",
  },
  rss: {
    sourceKind: "rss",
    status: "pending_review",
    reference: "docs/source-reviews/rss.md",
  },
  manual_review: {
    sourceKind: "manual_review",
    status: "pending_review",
    reference: "docs/source-reviews/manual_review.md",
  },
};

const provisionalLicensePatterns = [
  /\bTODO\b/i,
  /\bASSUMPTION\b/i,
  /\bprovisional\b/i,
  /\breplace\b/i,
  /\bconfirm\b/i,
  /검토\s*전/,
  /확인\s*전/,
  /미확인/,
];

export function validateSnapshotSourceLicenses(
  snapshot: PublicSnapshot,
  policies: Record<SourceKind, SourceLicensePolicy> = sourceLicensePolicies,
): SourceLicenseValidationResult {
  const errors: string[] = [];
  const rows = collectSourceRows(snapshot);

  for (const row of rows) {
    const label = `${row.source_kind}:${row.source_id}`;
    const policy = policies[row.source_kind];

    if (!policy) {
      errors.push(`${label} has no source license policy`);
      continue;
    }

    if (!row.license_note.trim()) {
      errors.push(`${label} is missing license_note`);
      continue;
    }

    if (row.source_kind === "mock") {
      if (policy.status !== "mock_only") errors.push(`${label} mock source policy must be mock_only`);
      if (!policy.requiredNoteFragment || !row.license_note.includes(policy.requiredNoteFragment)) {
        errors.push(`${label} mock data must carry ${policy.requiredNoteFragment ?? "an explicit mock-only license note"}`);
      }
      continue;
    }

    if (policy.status !== "approved") {
      errors.push(`${label} source license is not approved (${policy.status}); see ${policy.reference}`);
      continue;
    }

    if (containsProvisionalLanguage(row.license_note)) {
      errors.push(`${label} license_note contains provisional language: ${row.license_note}`);
    }
  }

  if (rows.length > 0 && rows.every((row) => row.source_kind === "mock") && !hasMockOnlyAssumption(snapshot)) {
    errors.push("mock-only snapshot must include a mock-only assumption");
  }

  return { valid: errors.length === 0, errors };
}

function collectSourceRows(snapshot: PublicSnapshot): SourceRow[] {
  return [
    ...snapshot.verified_facts.map((row) => ({
      source_kind: row.source_kind,
      source_id: row.source_id,
      source_org: row.source_org,
      source_url: row.source_url,
      license_note: row.license_note,
    })),
    ...snapshot.news_feed.map((row) => ({
      source_kind: row.source_kind,
      source_id: row.source_id,
      source_org: row.source_org,
      source_url: row.source_url,
      license_note: row.license_note,
    })),
  ];
}

function containsProvisionalLanguage(value: string) {
  return provisionalLicensePatterns.some((pattern) => pattern.test(value));
}

function hasMockOnlyAssumption(snapshot: PublicSnapshot) {
  return snapshot.assumptions.some((assumption) => /mock-only|목 데이터/i.test(assumption));
}
