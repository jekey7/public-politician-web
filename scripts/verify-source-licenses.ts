import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { validateSnapshotSourceLicenses } from "../src/lib/source-license";
import type { PublicSnapshot } from "../src/lib/types";

async function main() {
  const snapshotPath = join(process.cwd(), "public", "snapshots", "latest.json");
  const snapshot = JSON.parse(await readFile(snapshotPath, "utf8")) as PublicSnapshot;
  const result = validateSnapshotSourceLicenses(snapshot);

  if (!result.valid) {
    throw new Error(`source license verification failed: ${result.errors.join("; ")}`);
  }

  const sourceKinds = new Set([
    ...snapshot.verified_facts.map((row) => row.source_kind),
    ...snapshot.news_feed.map((row) => row.source_kind),
  ]);

  console.log(`source licenses verified: ${Array.from(sourceKinds).sort().join(", ")}`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
