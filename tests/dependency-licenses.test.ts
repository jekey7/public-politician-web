import assert from "node:assert/strict";
import test from "node:test";
import { licenseIds, validatePackageLockLicenses, type PackageLock } from "../src/lib/dependency-licenses";

test("licenseIds parses compound license expressions", () => {
  assert.deepEqual(licenseIds("Apache-2.0 AND LGPL-3.0-or-later AND MIT"), ["Apache-2.0", "LGPL-3.0-or-later", "MIT"]);
});

test("dependency license validator accepts permissive licenses", () => {
  const lockfile: PackageLock = {
    packages: {
      "": {},
      "node_modules/example": { version: "1.0.0", license: "MIT" },
      "node_modules/example-bsd": { version: "1.0.0", license: "BSD-3-Clause" },
    },
  };

  const result = validatePackageLockLicenses(lockfile);

  assert.equal(result.valid, true);
  assert.equal(result.checkedPackages, 2);
});

test("dependency license validator rejects missing licenses", () => {
  const lockfile: PackageLock = {
    packages: {
      "node_modules/no-license": { version: "1.0.0" },
    },
  };

  const result = validatePackageLockLicenses(lockfile);

  assert.equal(result.valid, false);
  assert.deepEqual(result.findings, [{ packagePath: "node_modules/no-license", license: "", reason: "missing_license" }]);
});

test("dependency license validator requires documented exception package paths", () => {
  const lockfile: PackageLock = {
    packages: {
      "node_modules/random-lgpl": { version: "1.0.0", license: "LGPL-3.0-or-later" },
      "node_modules/@img/sharp-libvips-linux-x64": { version: "1.0.0", license: "LGPL-3.0-or-later" },
    },
  };

  const result = validatePackageLockLicenses(lockfile);

  assert.equal(result.valid, false);
  assert.deepEqual(result.findings, [
    {
      packagePath: "node_modules/random-lgpl",
      license: "LGPL-3.0-or-later",
      reason: "undocumented_exception",
    },
  ]);
});

test("dependency license validator rejects unsupported licenses", () => {
  const lockfile: PackageLock = {
    packages: {
      "node_modules/gpl": { version: "1.0.0", license: "GPL-3.0-only" },
    },
  };

  const result = validatePackageLockLicenses(lockfile);

  assert.equal(result.valid, false);
  assert.deepEqual(result.findings, [
    {
      packagePath: "node_modules/gpl",
      license: "GPL-3.0-only",
      reason: "unsupported_license",
    },
  ]);
});
