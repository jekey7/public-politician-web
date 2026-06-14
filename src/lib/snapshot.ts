import type {
  EvidenceValue,
  PoliticianProfile,
  PublicSnapshot,
  SnapshotDiscrepancyRow,
  SnapshotFactRow,
  SnapshotNewsRow,
} from "./types";

export function buildPublicSnapshot(profiles: PoliticianProfile[], generatedAt: string): PublicSnapshot {
  const allEvidenceRows = profiles.flatMap(allProfileEvidence);
  return {
    schema_version: "0.1.0",
    generated_at: generatedAt,
    assumptions: snapshotAssumptions(allEvidenceRows),
    verified_facts: profiles.flatMap((profile) => allProfileEvidence(profile).map((evidence) => toFactRow(profile, evidence))),
    discrepancies: profiles.flatMap(toDiscrepancyRows),
    news_feed: profiles.flatMap(toNewsRows),
  };
}

function snapshotAssumptions(evidence: EvidenceValue<string | number | boolean>[]) {
  if (evidence.length === 0 || evidence.every((row) => row.source.sourceKind === "mock")) {
    return [
      "ASSUMPTION: current data is mock-only until public source collectors are connected.",
      "ASSUMPTION: snapshot license is provisional and must be replaced with source-compatible data license before public release.",
    ];
  }

  return [
    "Search is temporarily gated pending a snapshot-based rewrite; detail pages and downloadable snapshot artifacts remain available.",
  ];
}

export function factsToCsv(rows: SnapshotFactRow[]) {
  const headers: (keyof SnapshotFactRow)[] = [
    "politician_id",
    "display_name",
    "category",
    "field",
    "value",
    "raw_text",
    "review_status",
    "evidence_id",
    "source_id",
    "source_kind",
    "source_org",
    "source_url",
    "fetched_at",
    "license_note",
  ];

  return [headers.join(","), ...rows.map((row) => headers.map((header) => csvCell(row[header])).join(","))].join("\n");
}

export function allProfileEvidence(profile: PoliticianProfile): EvidenceValue<string | number | boolean>[] {
  return [
    ...profile.party,
    ...profile.district,
    ...profile.position,
    ...profile.committeeRole,
    ...profile.contact,
    ...profile.birthYear,
    ...profile.gender,
    ...profile.education,
    ...profile.careers,
    ...profile.partyHistory,
    ...profile.elections,
    ...profile.activities.bills,
    ...profile.activities.votes,
    ...profile.activities.committees,
  ];
}

function toFactRow(profile: PoliticianProfile, evidence: EvidenceValue<string | number | boolean>): SnapshotFactRow {
  return {
    politician_id: profile.politicianId,
    display_name: profile.displayName,
    category: evidence.category,
    field: evidence.field,
    value: evidence.value,
    raw_text: evidence.rawText,
    review_status: evidence.reviewStatus,
    evidence_id: evidence.evidenceId,
    source_id: evidence.source.sourceId,
    source_kind: evidence.source.sourceKind,
    source_org: evidence.source.sourceOrg,
    source_url: evidence.source.sourceUrl,
    fetched_at: evidence.source.fetchedAt,
    license_note: evidence.source.licenseNote,
  };
}

function toDiscrepancyRows(profile: PoliticianProfile): SnapshotDiscrepancyRow[] {
  return profile.discrepancies.map((discrepancy) => ({
    discrepancy_id: discrepancy.discrepancyId,
    politician_id: profile.politicianId,
    display_name: profile.displayName,
    category: discrepancy.category,
    field: discrepancy.field,
    kind: discrepancy.kind,
    label: discrepancy.label,
    evidence_ids: discrepancy.evidenceIds,
    detected_at: discrepancy.detectedAt,
    detector: discrepancy.detector,
  }));
}

function toNewsRows(profile: PoliticianProfile): SnapshotNewsRow[] {
  return profile.news.map((item) => ({
    news_id: item.newsId,
    politician_id: item.politicianId,
    title: item.title,
    publisher: item.publisher,
    published_at: item.publishedAt,
    media_kind: item.mediaKind,
    source_id: item.source.sourceId,
    source_kind: item.source.sourceKind,
    source_org: item.source.sourceOrg,
    source_url: item.source.sourceUrl,
    fetched_at: item.source.fetchedAt,
    license_note: item.source.licenseNote,
  }));
}

function csvCell(value: string | number | boolean) {
  const text = String(value);
  if (!/[",\n\r]/.test(text)) return text;
  return `"${text.replace(/"/g, '""')}"`;
}
