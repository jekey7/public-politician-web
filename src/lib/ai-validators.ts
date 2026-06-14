import type { DiscrepancyKind, EntityMatchResult, RagAnswer } from "./types";

const discrepancyKinds: DiscrepancyKind[] = ["notation_variance", "content_conflict", "missing_from_source"];

export function validateEntityMatchOutput(value: unknown): EntityMatchResult {
  if (!isRecord(value)) throw new Error("Entity match output must be an object.");
  if (typeof value.isSameEntity !== "boolean") throw new Error("Entity match output requires boolean isSameEntity.");
  if (typeof value.confidence !== "number" || value.confidence < 0 || value.confidence > 1) {
    throw new Error("Entity match confidence must be a number between 0 and 1.");
  }
  if (typeof value.rationale !== "string" || !value.rationale.trim()) {
    throw new Error("Entity match output requires rationale.");
  }

  return {
    isSameEntity: value.isSameEntity,
    confidence: value.confidence,
    rationale: value.rationale,
  };
}

export function validateDiscrepancyKindOutput(value: unknown): DiscrepancyKind {
  if (typeof value !== "string" || !discrepancyKinds.includes(value as DiscrepancyKind)) {
    throw new Error("Discrepancy output must be one of the allowed discrepancy kinds.");
  }

  return value as DiscrepancyKind;
}

export function validateRagAnswerOutput(value: unknown): RagAnswer {
  if (!isRecord(value)) throw new Error("RAG output must be an object.");
  if (value.status !== "answered_with_citations" && value.status !== "no_material") {
    throw new Error("RAG output status is invalid.");
  }
  if (typeof value.answer !== "string" || !value.answer.trim()) throw new Error("RAG output requires answer.");
  if (!Array.isArray(value.citations)) throw new Error("RAG output requires citations array.");

  if (value.status === "no_material") {
    if (value.answer !== "관련 자료 없음") throw new Error("No-material RAG output must use the fixed refusal answer.");
    if (value.citations.length !== 0) throw new Error("No-material RAG output must not include citations.");
  }

  if (value.status === "answered_with_citations" && value.citations.length === 0) {
    throw new Error("Answered RAG output requires at least one citation.");
  }

  return {
    answer: value.answer,
    status: value.status,
    citations: value.citations.map((citation) => {
      if (!isRecord(citation)) throw new Error("Citation must be an object.");
      if (typeof citation.evidenceId !== "string" || !citation.evidenceId.trim()) {
        throw new Error("Citation requires evidenceId.");
      }
      if (typeof citation.sourceOrg !== "string" || !citation.sourceOrg.trim()) {
        throw new Error("Citation requires sourceOrg.");
      }
      if (typeof citation.sourceUrl !== "string" || !citation.sourceUrl.trim()) {
        throw new Error("Citation requires sourceUrl.");
      }
      if (typeof citation.snippet !== "string" || !citation.snippet.trim()) {
        throw new Error("Citation requires snippet.");
      }

      return {
        evidenceId: citation.evidenceId,
        sourceOrg: citation.sourceOrg,
        sourceUrl: citation.sourceUrl,
        snippet: citation.snippet,
      };
    }),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
