import { politicians } from "./mock-data";
import { answerQuestionFromSnapshot } from "./rag";
import { buildPublicSnapshot } from "./snapshot";
import type { EvidenceValue } from "./types";

export interface PoliticianFilters {
  query?: string;
  party?: string;
  region?: string;
  committee?: string;
}

export function searchPoliticians(filters: PoliticianFilters | string) {
  const normalizedFilters = typeof filters === "string" ? { query: filters } : filters;
  const query = normalize(normalizedFilters.query ?? "");
  const party = normalize(normalizedFilters.party ?? "all");
  const region = normalize(normalizedFilters.region ?? "all");
  const committee = normalize(normalizedFilters.committee ?? "all");

  return politicians.filter((politician) =>
    matchesQuery(politician, query) &&
    matchesField(politician.party.map((value) => value.value), party) &&
    matchesField(politician.district.map((value) => value.value), region) &&
    matchesField(politician.activities.committees.map((value) => value.value), committee),
  );
}

export function filterOptions() {
  return {
    parties: uniqueValues(politicians.flatMap((politician) => politician.party.map((value) => value.value))),
    regions: uniqueValues(politicians.flatMap((politician) => politician.district.map((value) => value.value.split(" ")[0] ?? value.value))),
    committees: uniqueValues(politicians.flatMap((politician) => politician.activities.committees.map((value) => value.value))),
  };
}

function matchesQuery(politician: (typeof politicians)[number], query: string) {
  if (!query) return true;

  return [
      politician.displayName,
      ...politician.party.map((value) => value.value),
      ...politician.district.map((value) => value.value),
      ...politician.education.map((value) => value.value),
      ...politician.activities.committees.map((value) => value.value),
    ]
    .join(" ")
    .toLowerCase()
    .includes(query);
}

function matchesField(values: string[], filterValue: string) {
  if (!filterValue || filterValue === "all") return true;
  return values.some((value) => normalize(value).includes(filterValue));
}

function uniqueValues(values: string[]) {
  return Array.from(new Set(values)).sort((a, b) => a.localeCompare(b, "ko"));
}

export function allEvidence(): EvidenceValue<unknown>[] {
  return politicians.flatMap((politician) => [
    ...politician.party,
    ...politician.district,
    ...politician.position,
    ...politician.birthYear,
    ...politician.gender,
    ...politician.education,
    ...politician.careers,
    ...politician.partyHistory,
    ...politician.elections,
    ...politician.activities.bills,
    ...politician.activities.votes,
    ...politician.activities.committees,
  ]);
}

export async function answerQuestion(question: string) {
  const snapshot = buildPublicSnapshot(politicians, new Date().toISOString());
  return answerQuestionFromSnapshot(question, snapshot);
}

const normalize = (value: string) => value.trim().toLowerCase();
