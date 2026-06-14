import { createHash } from "node:crypto";
import type { PublicSnapshot } from "./types";

export interface SnapshotManifestFile {
  path: string;
  bytes: number;
  sha256: string;
}

export interface SnapshotReleaseManifest {
  schema_version: "0.1.0";
  generated_at: string;
  snapshot_schema: string;
  files: SnapshotManifestFile[];
  counts: {
    facts: number;
    discrepancies: number;
    news_items: number;
  };
  notes: string[];
}

export function buildSnapshotReleaseManifest(
  snapshot: PublicSnapshot,
  files: Array<{ path: string; content: string }>,
): SnapshotReleaseManifest {
  return {
    schema_version: "0.1.0",
    generated_at: snapshot.generated_at,
    snapshot_schema: "schema.json",
    files: files.map((file) => ({
      path: file.path,
      bytes: Buffer.byteLength(file.content, "utf8"),
      sha256: sha256(file.content),
    })),
    counts: {
      facts: snapshot.verified_facts.length,
      discrepancies: snapshot.discrepancies.length,
      news_items: snapshot.news_feed.length,
    },
    notes: [
      "Manifest checksums cover public snapshot artifacts only.",
      "Internal raw archives are intentionally excluded from public release artifacts.",
    ],
  };
}

export function validateSnapshotReleaseManifest(manifest: SnapshotReleaseManifest, snapshot: PublicSnapshot) {
  const errors: string[] = [];

  if (manifest.schema_version !== "0.1.0") errors.push("manifest schema_version must be 0.1.0");
  if (manifest.generated_at !== snapshot.generated_at) errors.push("manifest generated_at must match snapshot");
  if (manifest.snapshot_schema !== "schema.json") errors.push("manifest snapshot_schema must point to schema.json");
  if (manifest.counts.facts !== snapshot.verified_facts.length) errors.push("manifest fact count mismatch");
  if (manifest.counts.discrepancies !== snapshot.discrepancies.length) errors.push("manifest discrepancy count mismatch");
  if (manifest.counts.news_items !== snapshot.news_feed.length) errors.push("manifest news count mismatch");

  const paths = new Set(manifest.files.map((file) => file.path));
  for (const requiredPath of ["latest.json", "facts.csv", "schema.json"]) {
    if (!paths.has(requiredPath)) errors.push(`manifest is missing ${requiredPath}`);
  }
  for (const file of manifest.files) {
    if (!file.path || file.bytes <= 0 || !/^[a-f0-9]{64}$/.test(file.sha256)) {
      errors.push(`manifest file entry is invalid: ${file.path}`);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

export function verifySnapshotArtifactContents(
  manifest: SnapshotReleaseManifest,
  snapshot: PublicSnapshot,
  files: Array<{ path: string; content: string }>,
) {
  const errors = [...validateSnapshotReleaseManifest(manifest, snapshot).errors];
  const fileMap = new Map(files.map((file) => [file.path, file.content]));

  for (const manifestFile of manifest.files) {
    const content = fileMap.get(manifestFile.path);
    if (content === undefined) {
      errors.push(`artifact content is missing: ${manifestFile.path}`);
      continue;
    }

    const bytes = Buffer.byteLength(content, "utf8");
    const digest = sha256(content);
    if (bytes !== manifestFile.bytes) errors.push(`artifact byte size mismatch: ${manifestFile.path}`);
    if (digest !== manifestFile.sha256) errors.push(`artifact sha256 mismatch: ${manifestFile.path}`);
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

function sha256(content: string) {
  return createHash("sha256").update(content, "utf8").digest("hex");
}
