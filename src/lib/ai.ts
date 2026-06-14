import type {
  DiscrepancyClassificationRequest,
  DiscrepancyKind,
  EntityMatchRequest,
  EntityMatchResult,
  EvidenceValue,
  RagAnswer,
  RagCitation,
} from "./types";

export interface AiVerifier {
  matchEntity(request: EntityMatchRequest): Promise<EntityMatchResult>;
  classifyDiscrepancy(request: DiscrepancyClassificationRequest): Promise<DiscrepancyKind>;
  answerWithCitations(question: string, corpus: EvidenceValue<unknown>[]): Promise<RagAnswer>;
}

/**
 * 규칙 기반 mock verifier의 동기 핵심. LLM을 연결하지 않고 정규화된 출처 텍스트만 비교한다.
 * 사실을 생성하지 않으며(불변 원칙 #1), 같은 항목 여부와 불일치 종류만 판단한다.
 * MockAiVerifier(async)와 cross-verification의 정적 mock 경로가 이 로직을 공유한다.
 */
export const mockSyncVerifier = {
  matchEntity(request: EntityMatchRequest): EntityMatchResult {
    const a = normalize(request.candidateA.rawText);
    const b = normalize(request.candidateB.rawText);
    return {
      isSameEntity: a === b || a.includes(b) || b.includes(a),
      confidence: a === b ? 0.95 : 0.55,
      rationale: "MOCK: normalized source text comparison only. TODO: replace with constrained LLM entity matching.",
    };
  },

  classifyDiscrepancy(_field: string, evidences: EvidenceValue<unknown>[]): DiscrepancyKind {
    const sources = new Set(evidences.map((evidence) => evidence.source.sourceId));
    const rawTexts = evidences.map((evidence) => normalize(evidence.rawText));
    const distinctRawTexts = new Set(rawTexts);

    // 같은 표기인데 출처 수가 더 많음 → 일부 출처에 값이 없는 정보 누락으로 본다.
    if (distinctRawTexts.size <= 1 && sources.size > distinctRawTexts.size) {
      return "missing_from_source";
    }

    // 표기는 다르지만 한쪽이 다른 쪽의 부분 문자열이면 같은 항목의 표기 차이로 본다.
    if (allMutuallyContained(rawTexts)) return "notation_variance";

    // 그 외에는 출처 간 내용이 갈리는 충돌.
    return "content_conflict";
  },
};

export class MockAiVerifier implements AiVerifier {
  async matchEntity(request: EntityMatchRequest): Promise<EntityMatchResult> {
    return mockSyncVerifier.matchEntity(request);
  }

  async classifyDiscrepancy(request: DiscrepancyClassificationRequest): Promise<DiscrepancyKind> {
    return mockSyncVerifier.classifyDiscrepancy(request.field, request.evidences);
  }

  async answerWithCitations(question: string, corpus: EvidenceValue<unknown>[]): Promise<RagAnswer> {
    const tokens = normalize(question).split(" ").filter(Boolean);
    const citations: RagCitation[] = corpus
      .filter((evidence) => tokens.some((token) => normalize(evidence.rawText).includes(token)))
      .slice(0, 4)
      .map((evidence) => ({
        evidenceId: evidence.evidenceId,
        sourceOrg: evidence.source.sourceOrg,
        sourceUrl: evidence.source.sourceUrl,
        snippet: evidence.rawText,
      }));

    if (citations.length === 0) {
      return {
        answer: "관련 자료 없음",
        citations: [],
        status: "no_material",
      };
    }

    return {
      answer: "아래 출처에서 질문과 관련된 공개 자료가 확인되었습니다. 출처 원문을 기준으로 판단하세요.",
      citations,
      status: "answered_with_citations",
    };
  }
}

const normalize = (value: string) => value.trim().toLowerCase().replace(/\s+/g, " ");

/** 표기들이 서로 부분 문자열 관계(=같은 항목의 표기 차이)로 연결되는지 규칙 기반으로 판단한다. */
const allMutuallyContained = (texts: string[]): boolean => {
  const distinct = [...new Set(texts.filter(Boolean))];
  if (distinct.length < 2) return false;
  return distinct.every((text) =>
    distinct.some((other) => other !== text && (other.includes(text) || text.includes(other))),
  );
};
