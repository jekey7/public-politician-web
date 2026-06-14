import assert from "node:assert/strict";
import test from "node:test";
import { politicians } from "../src/lib/mock-data";
import {
  buildSnapshotReleaseManifest,
  validateSnapshotReleaseManifest,
  verifySnapshotArtifactContents,
} from "../src/lib/release-manifest";
import { buildPublicSnapshot, factsToCsv } from "../src/lib/snapshot";

const snapshot = buildPublicSnapshot(politicians, "2026-06-11T00:00:00.000Z");

test("snapshot release manifest lists public artifacts with checksums", () => {
  const manifest = buildSnapshotReleaseManifest(snapshot, [
    { path: "latest.json", content: `${JSON.stringify(snapshot)}\n` },
    { path: "facts.csv", content: `${factsToCsv(snapshot.verified_facts)}\n` },
    { path: "schema.json", content: "{}\n" },
  ]);

  assert.equal(manifest.counts.facts, snapshot.verified_facts.length);
  assert.equal(manifest.counts.discrepancies, snapshot.discrepancies.length);
  assert.equal(manifest.counts.news_items, snapshot.news_feed.length);
  assert.deepEqual(
    manifest.files.map((file) => file.path),
    ["latest.json", "facts.csv", "schema.json"],
  );
  assert.ok(manifest.files.every((file) => /^[a-f0-9]{64}$/.test(file.sha256)));
  assert.deepEqual(validateSnapshotReleaseManifest(manifest, snapshot), { valid: true, errors: [] });
});

test("snapshot release manifest validator rejects missing artifacts", () => {
  const manifest = buildSnapshotReleaseManifest(snapshot, [{ path: "latest.json", content: "{}" }]);
  const result = validateSnapshotReleaseManifest(manifest, snapshot);

  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => error.includes("facts.csv")));
  assert.ok(result.errors.some((error) => error.includes("schema.json")));
});

test("snapshot artifact verifier rejects checksum mismatch", () => {
  const latest = `${JSON.stringify(snapshot)}\n`;
  const facts = `${factsToCsv(snapshot.verified_facts)}\n`;
  const schema = "{}\n";
  const manifest = buildSnapshotReleaseManifest(snapshot, [
    { path: "latest.json", content: latest },
    { path: "facts.csv", content: facts },
    { path: "schema.json", content: schema },
  ]);

  const result = verifySnapshotArtifactContents(manifest, snapshot, [
    { path: "latest.json", content: latest.replace("mock-001", "tampered") },
    { path: "facts.csv", content: facts },
    { path: "schema.json", content: schema },
  ]);

  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => error.includes("sha256 mismatch")));
});
