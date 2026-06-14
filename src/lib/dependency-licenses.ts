export interface PackageLock {
  packages?: Record<string, PackageLockPackage>;
}

export interface PackageLockPackage {
  version?: string;
  license?: string;
  licenses?: unknown;
  dev?: boolean;
  optional?: boolean;
}

export interface DependencyLicensePolicy {
  allowedLicenseIds: Set<string>;
  documentedExceptionLicenseIds: Set<string>;
  documentedExceptionPackagePatterns: RegExp[];
}

export interface DependencyLicenseFinding {
  packagePath: string;
  license: string;
  reason: "missing_license" | "unsupported_license" | "undocumented_exception";
}

export interface DependencyLicenseValidationResult {
  valid: boolean;
  checkedPackages: number;
  findings: DependencyLicenseFinding[];
}

export const dependencyLicensePolicy: DependencyLicensePolicy = {
  allowedLicenseIds: new Set([
    "0BSD",
    "Apache-2.0",
    "BSD-2-Clause",
    "BSD-3-Clause",
    "BlueOak-1.0.0",
    "CC-BY-4.0",
    "CC0-1.0",
    "ISC",
    "MIT",
    "MIT-0",
    "Python-2.0",
  ]),
  documentedExceptionLicenseIds: new Set(["LGPL-3.0-or-later", "MPL-2.0"]),
  documentedExceptionPackagePatterns: [
    /^node_modules\/@img\/sharp-/,
    /^node_modules\/axe-core$/,
  ],
};

export function validatePackageLockLicenses(
  packageLock: PackageLock,
  policy: DependencyLicensePolicy = dependencyLicensePolicy,
): DependencyLicenseValidationResult {
  const packages = packageLock.packages ?? {};
  const findings: DependencyLicenseFinding[] = [];
  let checkedPackages = 0;

  for (const [packagePath, packageInfo] of Object.entries(packages)) {
    if (packagePath === "") continue;
    checkedPackages += 1;

    const license = licenseText(packageInfo);
    if (!license) {
      findings.push({ packagePath, license: "", reason: "missing_license" });
      continue;
    }

    for (const licenseId of licenseIds(license)) {
      if (policy.allowedLicenseIds.has(licenseId)) continue;
      if (policy.documentedExceptionLicenseIds.has(licenseId)) {
        if (!isDocumentedExceptionPackage(packagePath, policy)) {
          findings.push({ packagePath, license, reason: "undocumented_exception" });
        }
        continue;
      }

      findings.push({ packagePath, license, reason: "unsupported_license" });
    }
  }

  return {
    valid: findings.length === 0,
    checkedPackages,
    findings,
  };
}

export function licenseIds(licenseExpression: string) {
  return Array.from(new Set(licenseExpression.match(/[A-Za-z0-9.-]+/g) ?? [])).filter(
    (token) => token !== "AND" && token !== "OR" && token !== "WITH",
  );
}

function licenseText(packageInfo: PackageLockPackage) {
  if (typeof packageInfo.license === "string") return packageInfo.license.trim();
  if (Array.isArray(packageInfo.licenses)) {
    return packageInfo.licenses
      .map((license) => (typeof license === "string" ? license : null))
      .filter((license): license is string => Boolean(license))
      .join(" OR ");
  }

  return "";
}

function isDocumentedExceptionPackage(packagePath: string, policy: DependencyLicensePolicy) {
  return policy.documentedExceptionPackagePatterns.some((pattern) => pattern.test(packagePath));
}
