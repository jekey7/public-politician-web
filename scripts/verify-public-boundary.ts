import { readdir, readFile } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import { publicArtifactLinks } from "../src/lib/public-artifacts";
import type { SnapshotReleaseManifest } from "../src/lib/release-manifest";

const publicDir = join(process.cwd(), "public");
const snapshotDir = join(publicDir, "snapshots");
const outDir = join(process.cwd(), "out");
const rawArchivePath = join(process.cwd(), "data", "internal", "raw", "open-assembly.mock.json");

const expectedPublicSnapshotFiles = new Set(["facts.csv", "latest-coverage.json", "latest.json", "manifest.json", "schema.json"]);
const expectedManifestFiles = new Set(["facts.csv", "latest-coverage.json", "latest.json", "schema.json"]);
const forbiddenPublicFragments = ["data/internal", "data\\internal", "internal/raw", "internal\\raw", "open-assembly.mock.json"];

async function main() {
  const errors = [
    ...(await verifyPublicDirectory()),
    ...(await verifyManifest()),
    ...(await verifyPublicArtifactLinks()),
    ...(await verifyStaticExportLinks()),
    ...(await verifyNoForbiddenPublicText()),
    ...(await verifyInternalArchiveMarker()),
  ];

  if (errors.length > 0) {
    throw new Error(`public boundary verification failed: ${errors.join("; ")}`);
  }

  console.log("public boundary verified: public snapshots, manifest, HTML links, and internal raw archive separation");
}

async function verifyPublicDirectory() {
  const errors: string[] = [];
  const publicFiles = await listFiles(publicDir);

  for (const filePath of publicFiles) {
    const publicRelativePath = toPosix(relative(publicDir, filePath));
    if (!publicRelativePath.startsWith("snapshots/")) {
      errors.push(`unexpected public file ${publicRelativePath}`);
    }
  }

  const snapshotFiles = new Set((await listFiles(snapshotDir)).map((filePath) => toPosix(relative(snapshotDir, filePath))));
  assertSetEquals(errors, snapshotFiles, expectedPublicSnapshotFiles, "public snapshot files");

  return errors;
}

async function verifyManifest() {
  const errors: string[] = [];
  const manifest = JSON.parse(await readFile(join(snapshotDir, "manifest.json"), "utf8")) as SnapshotReleaseManifest;
  const manifestPaths = new Set(manifest.files.map((file) => file.path));

  assertSetEquals(errors, manifestPaths, expectedManifestFiles, "manifest artifact files");

  for (const file of manifest.files) {
    if (file.path.includes("/") || file.path.includes("\\")) errors.push(`manifest path must be snapshot-local: ${file.path}`);
    if (containsForbiddenFragment(file.path)) errors.push(`manifest exposes internal path ${file.path}`);
  }

  const serializedManifest = JSON.stringify(manifest);
  if (containsForbiddenFragment(serializedManifest)) errors.push("manifest contains an internal raw archive path or filename");

  return errors;
}

async function verifyPublicArtifactLinks() {
  const errors: string[] = [];
  const hrefs = new Set(publicArtifactLinks.map((link) => link.href));
  const expectedHrefs = new Set([
    "/snapshots/facts.csv",
    "/snapshots/latest-coverage.json",
    "/snapshots/latest.json",
    "/snapshots/manifest.json",
    "/snapshots/schema.json",
  ]);

  assertSetEquals(errors, hrefs, expectedHrefs, "public artifact links");

  for (const link of publicArtifactLinks) {
    if (!link.href.startsWith("/snapshots/")) errors.push(`public artifact link is not snapshot-local: ${link.href}`);
    if (containsForbiddenFragment(link.href)) errors.push(`public artifact link exposes internal path: ${link.href}`);
  }

  return errors;
}

async function verifyStaticExportLinks() {
  const errors: string[] = [];
  const htmlFiles = (await listFiles(outDir)).filter((filePath) => filePath.endsWith(".html"));

  for (const filePath of htmlFiles) {
    const html = await readFile(filePath, "utf8");
    for (const href of extractHrefs(html)) {
      if (containsForbiddenFragment(href)) {
        errors.push(`${toPosix(relative(outDir, filePath))} links to internal path ${href}`);
      }
    }
  }

  return errors;
}

async function verifyNoForbiddenPublicText() {
  const errors: string[] = [];
  const publicOutputFiles = [...(await listFiles(publicDir)), ...(await listFiles(outDir))];

  for (const filePath of publicOutputFiles) {
    const content = await readFile(filePath, "utf8").catch(() => "");
    if (containsForbiddenFragment(content)) {
      errors.push(`${toPosix(relative(process.cwd(), filePath))} contains an internal raw archive path or filename`);
    }
  }

  return errors;
}

async function verifyInternalArchiveMarker() {
  const errors: string[] = [];
  const archive = JSON.parse(await readFile(rawArchivePath, "utf8")) as { visibility?: unknown; privacy_scan?: { status?: unknown } };

  if (archive.visibility !== "internal_only") errors.push("internal raw archive must be marked internal_only");
  if (archive.privacy_scan?.status !== "passed") errors.push("internal raw archive privacy scan must pass before internal use");

  return errors;
}

async function listFiles(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map((entry) => {
      const path = join(root, entry.name);
      return entry.isDirectory() ? listFiles(path) : [path];
    }),
  );

  return nested.flat();
}

function extractHrefs(html: string) {
  return Array.from(html.matchAll(/\shref=["']([^"']+)["']/g)).map((match) => match[1] ?? "");
}

function containsForbiddenFragment(value: string) {
  return forbiddenPublicFragments.some((fragment) => value.includes(fragment));
}

function assertSetEquals(errors: string[], actual: Set<string>, expected: Set<string>, label: string) {
  for (const value of expected) {
    if (!actual.has(value)) errors.push(`${label} missing ${value}`);
  }
  for (const value of actual) {
    if (!expected.has(value)) errors.push(`${label} has unexpected ${value}`);
  }
}

function toPosix(value: string) {
  return value.split(sep).join("/");
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
