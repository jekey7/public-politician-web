import type { PublicSnapshot, RagAnswer, RagCitation, SnapshotFactRow } from "./types";

export interface RagCorpusEntry {
  evidenceId: string;
  politicianId: string;
  displayName: string;
  field: string;
  text: string;
  sourceOrg: string;
  sourceUrl: string;
}

export function buildRagCorpus(snapshot: PublicSnapshot): RagCorpusEntry[] {
  return snapshot.verified_facts.map(toCorpusEntry);
}

export function answerQuestionFromSnapshot(question: string, snapshot: PublicSnapshot): RagAnswer {
  const tokens = tokenize(question);
  if (tokens.length === 0) return noMaterial();

  const citations: RagCitation[] = buildRagCorpus(snapshot)
    .filter((entry) => tokens.some((token) => tokenize(entry.text).includes(token)))
    .slice(0, 4)
    .map((entry) => ({
      evidenceId: entry.evidenceId,
      sourceOrg: entry.sourceOrg,
      sourceUrl: entry.sourceUrl,
      snippet: entry.text,
    }));

  if (citations.length === 0) return noMaterial();

  return {
    answer: "아래 출처에서 질문과 관련된 공개 자료가 확인되었습니다. 출처 원문을 기준으로 판단하세요.",
    citations,
    status: "answered_with_citations",
  };
}

function toCorpusEntry(row: SnapshotFactRow): RagCorpusEntry {
  return {
    evidenceId: row.evidence_id,
    politicianId: row.politician_id,
    displayName: row.display_name,
    field: row.field,
    text: `${row.display_name} ${row.field} ${String(row.value)} ${row.raw_text}`,
    sourceOrg: row.source_org,
    sourceUrl: row.source_url,
  };
}

function noMaterial(): RagAnswer {
  return {
    answer: "관련 자료 없음",
    citations: [],
    status: "no_material",
  };
}

function tokenize(value: string) {
  return value
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
}
