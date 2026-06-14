import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { validatePackageLockLicenses, type PackageLock } from "../src/lib/dependency-licenses";

async function main() {
  const lockfile = JSON.parse(await readFile(join(process.cwd(), "package-lock.json"), "utf8")) as PackageLock;
  const result = validatePackageLockLicenses(lockfile);

  if (!result.valid) {
    const details = result.findings
      .map((finding) => `${finding.packagePath} ${finding.license || "(missing license)"} ${finding.reason}`)
      .join("; ");
    throw new Error(`dependency license verification failed: ${details}`);
  }

  console.log(`dependency licenses verified: ${result.checkedPackages} packages`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
