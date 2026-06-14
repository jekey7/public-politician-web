import type { SourceKind } from "./types";
import type { SourceLicensePolicy } from "./source-license";

export interface SourceReviewDossier {
  sourceKind: SourceKind;
  status: SourceLicensePolicy["status"];
  publishSnapshotAllowed: boolean;
  sourceTermsUrl: string;
  licenseNoteToUse: string;
  reviewedAt: string;
  reviewer: string;
}

export interface SourceReviewDossierValidationResult {
  valid: boolean;
  errors: string[];
}

export const reviewableSourceKinds: SourceKind[] = [
  "open_assembly",
  "public_data_portal",
  "rokps",
  "nec",
  "news_search",
  "rss",
  "manual_review",
];

const requiredKeys = [
  "source_kind",
  "status",
  "publish_snapshot_allowed",
  "source_terms_url",
  "license_note_to_use",
  "reviewed_at",
  "reviewer",
];

const placeholderPatterns = [/\bTBD\b/i, /\bTODO\b/i, /\bASSUMPTION\b/i, /미정/, /검토\s*전/, /확인\s*전/];

export function parseSourceReviewDossier(content: string): SourceReviewDossier {
  const fields = parseDossierFields(content);

  return {
    sourceKind: parseSourceKind(fields.source_kind),
    status: parseStatus(fields.status),
    publishSnapshotAllowed: parseBoolean(fields.publish_snapshot_allowed),
    sourceTermsUrl: fields.source_terms_url ?? "",
    licenseNoteToUse: fields.license_note_to_use ?? "",
    reviewedAt: fields.reviewed_at ?? "",
    reviewer: fields.reviewer ?? "",
  };
}

export function validateSourceReviewDossier(
  expectedSourceKind: SourceKind,
  content: string,
  policy: SourceLicensePolicy,
): SourceReviewDossierValidationResult {
  const errors: string[] = [];
  const fields = parseDossierFields(content);

  for (const key of requiredKeys) {
    if (!(key in fields)) errors.push(`${expectedSourceKind} dossier missing ${key}`);
  }

  const dossier = parseSourceReviewDossier(content);
  if (dossier.sourceKind !== expectedSourceKind) {
    errors.push(`${expectedSourceKind} dossier has source_kind ${dossier.sourceKind}`);
  }
  if (dossier.status !== policy.status) {
    errors.push(`${expectedSourceKind} dossier status ${dossier.status} does not match policy ${policy.status}`);
  }
  if (policy.sourceKind !== expectedSourceKind) {
    errors.push(`${expectedSourceKind} policy has sourceKind ${policy.sourceKind}`);
  }

  if (policy.status === "approved") {
    if (!dossier.publishSnapshotAllowed) errors.push(`${expectedSourceKind} approved policy requires publish_snapshot_allowed: true`);
    if (!isHttpsUrl(dossier.sourceTermsUrl)) errors.push(`${expectedSourceKind} approved policy requires source_terms_url https URL`);
    if (!dossier.reviewedAt || containsPlaceholder(dossier.reviewedAt)) {
      errors.push(`${expectedSourceKind} approved policy requires concrete reviewed_at`);
    }
    if (!dossier.reviewer || containsPlaceholder(dossier.reviewer)) {
      errors.push(`${expectedSourceKind} approved policy requires concrete reviewer`);
    }
    if (!dossier.licenseNoteToUse || containsPlaceholder(dossier.licenseNoteToUse)) {
      errors.push(`${expectedSourceKind} approved policy requires concrete license_note_to_use`);
    }
  } else if (dossier.publishSnapshotAllowed) {
    errors.push(`${expectedSourceKind} pending source cannot allow public snapshots`);
  }

  return { valid: errors.length === 0, errors };
}

function parseDossierFields(content: string) {
  const fields: Record<string, string> = {};

  for (const line of content.split(/\r?\n/)) {
    const match = line.match(/^\s*-\s*([a-z_]+):\s*(.*)\s*$/);
    if (!match) continue;
    const [, key, value] = match;
    if (key) fields[key] = value?.trim() ?? "";
  }

  return fields;
}

function parseSourceKind(value: string | undefined): SourceKind {
  if (isSourceKind(value)) return value;
  return "mock";
}

function isSourceKind(value: unknown): value is SourceKind {
  return (
    value === "open_assembly" ||
    value === "public_data_portal" ||
    value === "rokps" ||
    value === "nec" ||
    value === "news_search" ||
    value === "rss" ||
    value === "manual_review" ||
    value === "mock"
  );
}

function parseStatus(value: string | undefined): SourceLicensePolicy["status"] {
  if (value === "approved" || value === "pending_review" || value === "mock_only") return value;
  return "pending_review";
}

function parseBoolean(value: string | undefined) {
  return value === "true";
}

function containsPlaceholder(value: string) {
  return placeholderPatterns.some((pattern) => pattern.test(value));
}

function isHttpsUrl(value: string) {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}
