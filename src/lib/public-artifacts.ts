export interface PublicArtifactLink {
  href: string;
  label: string;
}

export const publicArtifactLinks: PublicArtifactLink[] = [
  { href: "/snapshots/latest.json", label: "LATEST JSON" },
  { href: "/snapshots/facts.csv", label: "FACTS CSV" },
  { href: "/snapshots/latest-coverage.json", label: "COVERAGE" },
  { href: "/snapshots/schema.json", label: "SCHEMA" },
  { href: "/snapshots/manifest.json", label: "MANIFEST" },
];
