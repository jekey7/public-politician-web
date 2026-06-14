import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { verifySnapshotArtifactContents, type SnapshotReleaseManifest } from "../src/lib/release-manifest";
import { validatePublicSnapshot } from "../src/lib/snapshot-validator";
import type { PublicSnapshot } from "../src/lib/types";

const snapshotDir = join(process.cwd(), "public", "snapshots");

async function main() {
  const latestJson = await readText("latest.json");
  const factsCsv = await readText("facts.csv");
  const schemaJson = await readText("schema.json");
  const manifestJson = await readText("manifest.json");
  const snapshot = JSON.parse(latestJson) as PublicSnapshot;
  const manifest = JSON.parse(manifestJson) as SnapshotReleaseManifest;
  const files = [
    { path: "latest.json", content: latestJson },
    { path: "facts.csv", content: factsCsv },
    { path: "schema.json", content: schemaJson },
  ];

  if (manifest.files.some((file) => file.path === "latest-coverage.json")) {
    files.push({ path: "latest-coverage.json", content: await readText("latest-coverage.json") });
  }

  const snapshotValidation = validatePublicSnapshot(snapshot);
  if (!snapshotValidation.valid) {
    throw new Error(`public snapshot validation failed: ${snapshotValidation.errors.join("; ")}`);
  }

  const artifactValidation = verifySnapshotArtifactContents(manifest, snapshot, files);

  if (!artifactValidation.valid) {
    throw new Error(`snapshot artifact validation failed: ${artifactValidation.errors.join("; ")}`);
  }

  console.log(`snapshot verified: ${manifest.files.length} public artifacts`);
  console.log(`snapshot verified: ${snapshot.verified_facts.length} facts`);
}

async function readText(fileName: string) {
  return readFile(join(snapshotDir, fileName), "utf8");
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
