import { assertOpenAssemblyFixtureDryRun } from "../src/lib/public-pipeline";
import { mockOpenAssemblyRawRecords } from "../src/lib/raw-records";

function main() {
  const result = assertOpenAssemblyFixtureDryRun(mockOpenAssemblyRawRecords());

  for (const check of result.checks) {
    console.log(`open-assembly fixture check ok: ${check.name} (${check.detail})`);
  }

  console.log(
    `open-assembly fixture dry-run verified: ${result.profileCount} profiles, ${result.factCount} identity facts, internal-only`,
  );
}

try {
  main();
} catch (error: unknown) {
  console.error(error);
  process.exitCode = 1;
}
