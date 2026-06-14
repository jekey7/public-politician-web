import manifest from "../../public/snapshots/manifest.json";

export const publicReleaseSummary = {
  generatedAt: manifest.generated_at,
  facts: manifest.counts.facts,
  discrepancies: manifest.counts.discrepancies,
  newsItems: manifest.counts.news_items,
};
