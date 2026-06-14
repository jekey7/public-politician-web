import type { PublicSnapshot } from "./types";

export interface SnapshotValidationResult {
  valid: boolean;
  errors: string[];
}

const snapshotKeys = ["schema_version", "generated_at", "assumptions", "verified_facts", "discrepancies", "news_feed"];
const factKeys = [
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
const discrepancyKeys = [
  "discrepancy_id",
  "politician_id",
  "display_name",
  "category",
  "field",
  "kind",
  "label",
  "evidence_ids",
  "detected_at",
  "detector",
];
const newsKeys = [
  "news_id",
  "politician_id",
  "title",
  "publisher",
  "published_at",
  "media_kind",
  "source_id",
  "source_kind",
  "source_org",
  "source_url",
  "fetched_at",
  "license_note",
];

export function validatePublicSnapshot(snapshot: unknown): SnapshotValidationResult {
  const errors: string[] = [];

  if (!isRecord(snapshot)) {
    return { valid: false, errors: ["snapshot must be an object"] };
  }

  validateExactKeys(snapshot, snapshotKeys, "snapshot", errors);
  if (snapshot.schema_version !== "0.1.0") errors.push("snapshot.schema_version must be 0.1.0");
  if (!isNonEmptyString(snapshot.generated_at)) errors.push("snapshot.generated_at is required");
  if (!Array.isArray(snapshot.assumptions)) errors.push("snapshot.assumptions must be an array");
  if (!Array.isArray(snapshot.verified_facts)) errors.push("snapshot.verified_facts must be an array");
  if (!Array.isArray(snapshot.discrepancies)) errors.push("snapshot.discrepancies must be an array");
  if (!Array.isArray(snapshot.news_feed)) errors.push("snapshot.news_feed must be an array");

  if (errors.length > 0) return { valid: false, errors };

  const typed = snapshot as unknown as PublicSnapshot;
  const evidenceIds = new Set<string>();

  typed.verified_facts.forEach((fact, index) => {
    validateExactKeys(fact as unknown as Record<string, unknown>, factKeys, `verified_facts[${index}]`, errors);
    for (const key of factKeys) {
      if (key === "value") continue;
      const value = (fact as unknown as Record<string, unknown>)[key];
      if (!isNonEmptyString(value)) errors.push(`verified_facts[${index}].${key} is required`);
    }
    if (!["verified", "reviewing"].includes(fact.review_status)) {
      errors.push(`verified_facts[${index}].review_status is invalid`);
    }
    evidenceIds.add(fact.evidence_id);
  });

  typed.discrepancies.forEach((discrepancy, index) => {
    validateExactKeys(discrepancy as unknown as Record<string, unknown>, discrepancyKeys, `discrepancies[${index}]`, errors);
    if (!["rule", "llm_interface", "llm_interface_low_confidence"].includes(discrepancy.detector)) {
      errors.push(`discrepancies[${index}].detector is invalid`);
    }
    if (discrepancy.evidence_ids.length === 0) errors.push(`discrepancies[${index}].evidence_ids is empty`);
    for (const evidenceId of discrepancy.evidence_ids) {
      if (!evidenceIds.has(evidenceId)) {
        errors.push(`discrepancies[${index}] references missing evidence ${evidenceId}`);
      }
    }
  });

  typed.news_feed.forEach((item, index) => {
    validateExactKeys(item as unknown as Record<string, unknown>, newsKeys, `news_feed[${index}]`, errors);
    if (item.media_kind !== "article" && item.media_kind !== "video") {
      errors.push(`news_feed[${index}].media_kind is invalid`);
    }
  });

  return { valid: errors.length === 0, errors };
}

function validateExactKeys(value: Record<string, unknown>, allowedKeys: string[], path: string, errors: string[]) {
  for (const key of allowedKeys) {
    if (!(key in value)) errors.push(`${path}.${key} is missing`);
  }
  for (const key of Object.keys(value)) {
    if (!allowedKeys.includes(key)) errors.push(`${path}.${key} is not allowed`);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}
