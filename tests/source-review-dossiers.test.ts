import assert from "node:assert/strict";
import test from "node:test";
import { parseSourceReviewDossier, validateSourceReviewDossier } from "../src/lib/source-review-dossiers";
import type { SourceLicensePolicy } from "../src/lib/source-license";

const pendingPolicy: SourceLicensePolicy = {
  sourceKind: "open_assembly",
  status: "pending_review",
  reference: "docs/source-reviews/open_assembly.md",
};

const approvedPolicy: SourceLicensePolicy = {
  sourceKind: "open_assembly",
  status: "approved",
  reference: "docs/source-reviews/open_assembly.md",
};

const pendingDossier = `# Open Assembly source review

## Review metadata

- source_kind: open_assembly
- status: pending_review
- publish_snapshot_allowed: false
- source_terms_url: TBD
- license_note_to_use: TBD
- reviewed_at: TBD
- reviewer: TBD
`;

test("source review dossier parser reads metadata fields", () => {
  const dossier = parseSourceReviewDossier(pendingDossier);

  assert.equal(dossier.sourceKind, "open_assembly");
  assert.equal(dossier.status, "pending_review");
  assert.equal(dossier.publishSnapshotAllowed, false);
});

test("pending source review dossier can block public snapshots", () => {
  const result = validateSourceReviewDossier("open_assembly", pendingDossier, pendingPolicy);

  assert.deepEqual(result, { valid: true, errors: [] });
});

test("pending source review dossier cannot allow public snapshots", () => {
  const result = validateSourceReviewDossier(
    "open_assembly",
    pendingDossier.replace("publish_snapshot_allowed: false", "publish_snapshot_allowed: true"),
    pendingPolicy,
  );

  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => error.includes("pending source cannot allow public snapshots")));
});

test("approved source review dossier requires concrete review metadata", () => {
  const result = validateSourceReviewDossier("open_assembly", pendingDossier.replace("status: pending_review", "status: approved"), approvedPolicy);

  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => error.includes("source_terms_url https URL")));
  assert.ok(result.errors.some((error) => error.includes("concrete license_note_to_use")));
});
