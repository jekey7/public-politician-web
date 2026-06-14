import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { reviewableSourceKinds, validateSourceReviewDossier } from "../src/lib/source-review-dossiers";
import { sourceLicensePolicies } from "../src/lib/source-license";

async function main() {
  const errors: string[] = [];

  for (const sourceKind of reviewableSourceKinds) {
    const dossierPath = join(process.cwd(), "docs", "source-reviews", `${sourceKind}.md`);
    const content = await readFile(dossierPath, "utf8").catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return null;
      throw error;
    });

    if (content === null) {
      errors.push(`${sourceKind} missing docs/source-reviews/${sourceKind}.md`);
      continue;
    }

    const result = validateSourceReviewDossier(sourceKind, content, sourceLicensePolicies[sourceKind]);
    errors.push(...result.errors);
  }

  if (errors.length > 0) {
    throw new Error(`source review dossier verification failed: ${errors.join("; ")}`);
  }

  console.log(`source review dossiers verified: ${reviewableSourceKinds.length} real source dossiers`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
