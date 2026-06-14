import type { AiVerifier } from "./ai";
import type {
  Discrepancy,
  DiscrepancyKind,
  EntityMatchRequest,
  EntityMatchResult,
  EvidenceValue,
  FactCategory,
  PoliticianProfile,
} from "./types";

/**
 * Rule-based cross-verification (정합 + 탐지).
 *
 * 이 모듈은 사실을 생성하지 않는다(불변 원칙 #1). 출처별 EvidenceValue를 입력으로 받아
 *   - 정합(match): 서로 다른 표기가 같은 항목을 가리키는지 판단해 cluster로 묶고,
 *   - 탐지(detect): 표기 차이 / 내용 충돌 / 정보 누락을 Discrepancy로 드러낸다.
 * 어떤 값도 병합·선택하지 않으며(불변 원칙 #4), 모든 evidence를 그대로 보존한다.
 * 같은 항목 여부(정합)와 불일치 종류(분류) 판단은 주입된 verifier에 위임한다
 * (현재 구현은 MockAiVerifier / mockSyncVerifier — 규칙 기반, LLM 미연결).
 *
 * 핵심 로직은 동기(SyncCrossVerifier)로 구현하고, 비동기 AiVerifier는 그 위의 얇은 wrapper다.
 * 덕분에 정적 mock 데이터(모듈 로드 시점)와 async 파이프라인이 동일한 탐지 로직을 공유한다.
 */

/** 동기 cross-verification에 필요한 최소 verifier interface. */
export interface SyncCrossVerifier {
  matchEntity(request: EntityMatchRequest): EntityMatchResult;
  classifyDiscrepancy(field: string, evidences: EvidenceValue<unknown>[]): DiscrepancyKind;
}

interface FieldGroup {
  field: string;
  category: FactCategory;
  evidences: EvidenceValue<string | number>[];
}

export interface DetectDiscrepanciesOptions {
  detectedAt?: string;
}

/** 동기 cross-verification 핵심 — 정적 mock 데이터와 async 파이프라인이 공유한다. */
export function detectProfileDiscrepanciesSync(
  profile: PoliticianProfile,
  verifier: SyncCrossVerifier,
  options: DetectDiscrepanciesOptions = {},
): Discrepancy[] {
  const detectedAt = options.detectedAt ?? "1970-01-01T00:00:00.000Z";
  const discrepancies: Discrepancy[] = [];

  for (const group of collectFieldGroups(profile)) {
    const discrepancy = detectGroupDiscrepancy(profile.politicianId, group, verifier, detectedAt);
    if (discrepancy) discrepancies.push(discrepancy);
  }

  return discrepancies;
}

/** 비동기 AiVerifier를 동기 interface로 감싸 핵심 로직에 위임한다. */
export async function detectProfileDiscrepancies(
  profile: PoliticianProfile,
  ai: AiVerifier,
  options: DetectDiscrepanciesOptions = {},
): Promise<Discrepancy[]> {
  // 모든 pairwise match와 classify를 먼저 동기 lookup으로 미리 계산한다.
  const verifier = await materializeSyncVerifier(profile, ai);
  return detectProfileDiscrepanciesSync(profile, verifier, options);
}

/** Returns a copy of the profile with freshly detected discrepancies attached (originals discarded). */
export async function attachDetectedDiscrepancies(
  profile: PoliticianProfile,
  ai: AiVerifier,
  options: DetectDiscrepanciesOptions = {},
): Promise<PoliticianProfile> {
  const discrepancies = await detectProfileDiscrepancies(profile, ai, options);
  return { ...profile, discrepancies };
}

function collectFieldGroups(profile: PoliticianProfile): FieldGroup[] {
  const candidates: FieldGroup[] = [
    { field: "party", category: "identity", evidences: profile.party },
    { field: "district", category: "identity", evidences: profile.district },
    { field: "position", category: "identity", evidences: profile.position },
    { field: "education", category: "education", evidences: profile.education },
    { field: "career", category: "career", evidences: profile.careers },
    { field: "partyHistory", category: "party_history", evidences: profile.partyHistory },
    { field: "elections", category: "election", evidences: profile.elections },
    { field: "bills", category: "bill", evidences: profile.activities.bills },
    { field: "votes", category: "vote", evidences: profile.activities.votes },
    { field: "committees", category: "committee", evidences: profile.activities.committees },
  ];

  // 단일 출처 필드는 비교 대상이 없으므로 cross-verification에서 제외한다.
  return candidates.filter((group) => uniqueSources(group.evidences).size >= 2);
}

function detectGroupDiscrepancy(
  politicianId: string,
  group: FieldGroup,
  verifier: SyncCrossVerifier,
  detectedAt: string,
): Discrepancy | null {
  const { evidences } = group;

  // 정합(match): 출처별 값을 "같은 항목" cluster로 묶는다. 같은 항목 판단은 verifier에 위임.
  const clusters = clusterEvidences(evidences, verifier);

  if (clusters.length === 1) {
    const distinctRawTexts = new Set(evidences.map((evidence) => normalizeText(evidence.rawText)));
    if (distinctRawTexts.size <= 1) {
      // 모든 출처가 같은 항목 + 같은 표기 → 불일치 없음.
      return null;
    }
    // 같은 항목인데 표기만 다름.
    return buildDiscrepancy(politicianId, group, verifier, detectedAt, "다른 표기로 같은 항목을 가리킴");
  }

  // 둘 이상의 cluster → 출처 간 내용이 갈린다. 분류는 verifier가 결정.
  return buildDiscrepancy(politicianId, group, verifier, detectedAt, "출처별 값이 같은 항목으로 정합되지 않음");
}

function buildDiscrepancy(
  politicianId: string,
  group: FieldGroup,
  verifier: SyncCrossVerifier,
  detectedAt: string,
  rationale: string,
): Discrepancy {
  // 분류(notation_variance / content_conflict / missing_from_source)는 classifier가 결정한다.
  const kind = verifier.classifyDiscrepancy(group.field, group.evidences);

  return {
    discrepancyId: `disc-${politicianId}-${group.field}`,
    category: group.category,
    field: group.field,
    kind,
    label: discrepancyLabel(group.field, kind, rationale),
    // 모든 evidence를 보존(병합 금지) — 판단은 이용자 몫.
    evidenceIds: group.evidences.map((evidence) => evidence.evidenceId),
    detectedAt,
    detector: "rule",
  };
}

/**
 * 정합: pairwise entity match를 connected-component(union-find)로 묶어 cluster를 만든다.
 */
function clusterEvidences(
  evidences: EvidenceValue<string | number>[],
  verifier: SyncCrossVerifier,
): EvidenceValue<string | number>[][] {
  const parent = evidences.map((_, index) => index);
  const find = (index: number): number => {
    let root = index;
    while (parent[root] !== root) root = parent[root];
    return root;
  };
  const union = (a: number, b: number) => {
    parent[find(a)] = find(b);
  };

  for (let i = 0; i < evidences.length; i += 1) {
    for (let j = i + 1; j < evidences.length; j += 1) {
      const match = verifier.matchEntity({ candidateA: evidences[i], candidateB: evidences[j] });
      if (match.isSameEntity) union(i, j);
    }
  }

  const groups = new Map<number, EvidenceValue<string | number>[]>();
  evidences.forEach((evidence, index) => {
    const root = find(index);
    const bucket = groups.get(root) ?? [];
    bucket.push(evidence);
    groups.set(root, bucket);
  });

  return [...groups.values()];
}

/**
 * 비동기 AiVerifier의 모든 pairwise match와 field classify를 미리 호출해 동기 lookup table로 만든다.
 * 이렇게 하면 핵심 탐지 로직은 동기로 유지되고, async 경계는 이 함수 하나로 한정된다.
 */
async function materializeSyncVerifier(profile: PoliticianProfile, ai: AiVerifier): Promise<SyncCrossVerifier> {
  const matchCache = new Map<string, EntityMatchResult>();
  const classifyCache = new Map<string, DiscrepancyKind>();

  for (const group of collectFieldGroups(profile)) {
    const { evidences } = group;
    for (let i = 0; i < evidences.length; i += 1) {
      for (let j = i + 1; j < evidences.length; j += 1) {
        const key = matchKey(evidences[i], evidences[j]);
        if (!matchCache.has(key)) {
          matchCache.set(key, await ai.matchEntity({ candidateA: evidences[i], candidateB: evidences[j] }));
        }
      }
    }
    classifyCache.set(group.field, await ai.classifyDiscrepancy({ field: group.field, evidences }));
  }

  return {
    matchEntity(request) {
      const result = matchCache.get(matchKey(request.candidateA, request.candidateB));
      if (!result) throw new Error("cross-verification match cache miss");
      return result;
    },
    classifyDiscrepancy(field) {
      const result = classifyCache.get(field);
      if (!result) throw new Error(`cross-verification classify cache miss for ${field}`);
      return result;
    },
  };
}

function matchKey(a: EntityMatchRequest["candidateA"], b: EntityMatchRequest["candidateB"]): string {
  const left = String((a as EvidenceValue<unknown>).evidenceId);
  const right = String((b as EvidenceValue<unknown>).evidenceId);
  return [left, right].sort().join("|");
}

function discrepancyLabel(field: string, kind: DiscrepancyKind, rationale: string): string {
  const kindLabel: Record<DiscrepancyKind, string> = {
    notation_variance: "표기 차이",
    content_conflict: "내용 충돌",
    missing_from_source: "정보 누락",
  };
  return `${field} ${kindLabel[kind]}: ${rationale}`;
}

function uniqueSources(evidences: EvidenceValue<unknown>[]): Set<string> {
  return new Set(evidences.map((evidence) => evidence.source.sourceId));
}

function normalizeText(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}
