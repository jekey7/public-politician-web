import assert from "node:assert/strict";
import test from "node:test";
import { publicArtifactLinks } from "../src/lib/public-artifacts";

test("public artifact links expose all release files", () => {
  assert.deepEqual(
    publicArtifactLinks.map((link) => link.href),
    [
      "/snapshots/latest.json",
      "/snapshots/facts.csv",
      "/snapshots/latest-coverage.json",
      "/snapshots/schema.json",
      "/snapshots/manifest.json",
    ],
  );
  assert.deepEqual(
    publicArtifactLinks.map((link) => link.label),
    ["LATEST JSON", "FACTS CSV", "COVERAGE", "SCHEMA", "MANIFEST"],
  );
});

test("public artifact links are snapshot-local", () => {
  for (const link of publicArtifactLinks) {
    assert.match(link.href, /^\/snapshots\//);
    assert.equal(link.href.includes("data/internal"), false);
  }
});
