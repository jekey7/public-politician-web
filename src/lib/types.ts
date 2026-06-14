export type SourceKind =
  | "open_assembly"
  | "public_data_portal"
  | "rokps"
  | "nec"
  | "news_search"
  | "rss"
  | "manual_review"
  | "mock";

export type ReviewStatus = "verified" | "reviewing";

export type DiscrepancyKind = "notation_variance" | "content_conflict" | "missing_from_source";

/**
 * 불일치를 누가/어떤 신뢰도로 탐지했는지.
 * - rule: 규칙 기반 detector(LLM 미연결 또는 mock fallback).
 * - llm_interface: LLM이 안정적 다수결로 분류(self-consistency voting 통과).
 * - llm_interface_low_confidence: LLM 투표가 갈려(동률/임계치 미만) 저신뢰 — 검수중으로 surface
 *   (불변 #3: 모르면 모른다 — 한쪽을 조용히 채택하지 않는다).
 */
export type Detector = "rule" | "llm_interface" | "llm_interface_low_confidence";

export type FactCategory =
  | "identity"
  | "education"
  | "career"
  | "party_history"
  | "election"
  | "bill"
  | "vote"
  | "committee";

export interface SourceMeta {
  sourceId: string;
  sourceKind: SourceKind;
  sourceOrg: string;
  sourceUrl: string;
  fetchedAt: string;
  licenseNote: string;
}

export interface EvidenceValue<T> {
  evidenceId: string;
  category: FactCategory;
  field: string;
  value: T;
  rawText: string;
  source: SourceMeta;
  reviewStatus: ReviewStatus;
}

export interface Discrepancy {
  discrepancyId: string;
  category: FactCategory;
  field: string;
  kind: DiscrepancyKind;
  label: string;
  evidenceIds: string[];
  detectedAt: string;
  detector: Detector;
}

export interface LegislativeActivity {
  bills: EvidenceValue<string>[];
  votes: EvidenceValue<string>[];
  committees: EvidenceValue<string>[];
}

export interface NewsItem {
  newsId: string;
  politicianId: string;
  title: string;
  publisher: string;
  publishedAt: string;
  source: SourceMeta;
  mediaKind: "article" | "video";
}

export interface SnapshotFactRow {
  politician_id: string;
  display_name: string;
  category: FactCategory;
  field: string;
  value: string | number | boolean;
  raw_text: string;
  review_status: ReviewStatus;
  evidence_id: string;
  source_id: string;
  source_kind: SourceKind;
  source_org: string;
  source_url: string;
  fetched_at: string;
  license_note: string;
}

export interface SnapshotDiscrepancyRow {
  discrepancy_id: string;
  politician_id: string;
  display_name: string;
  category: FactCategory;
  field: string;
  kind: DiscrepancyKind;
  label: string;
  evidence_ids: string[];
  detected_at: string;
  detector: Detector;
}

export interface SnapshotNewsRow {
  news_id: string;
  politician_id: string;
  title: string;
  publisher: string;
  published_at: string;
  media_kind: "article" | "video";
  source_id: string;
  source_kind: SourceKind;
  source_org: string;
  source_url: string;
  fetched_at: string;
  license_note: string;
}

export interface PublicSnapshot {
  schema_version: "0.1.0";
  generated_at: string;
  assumptions: string[];
  verified_facts: SnapshotFactRow[];
  discrepancies: SnapshotDiscrepancyRow[];
  news_feed: SnapshotNewsRow[];
}

/**
 * NEC 교차검증 커버리지 상태 carrier(불변 #3 — 모르면 모른다를 타입으로 표현).
 *
 * `classifyNecCoverage`의 분류 결과를 **프로필에 동반**시키기 위한 사이드카다. 사실(EvidenceValue)도
 * 불일치(Discrepancy)도 아니며 — 출처 간 *값*이 아니라 *교차검증 가능 여부*를 말한다. 따라서 공개
 * 스냅샷 본문(verified_facts/discrepancies/news_feed) 스키마는 건드리지 않고, 선택적 사이드카
 * 아티팩트(coverage)로만 흐른다(공개 스냅샷 바이트 동일 보존).
 *
 * - `ambiguous_withheld`: 동명이인+동일정당 쌍둥이라 안정 join key 없이 식별 불가 → NEC 교차검증을
 *   정직하게 보류. 강제 해소·새 PII 도입 금지(불변 #7). reason은 표준 사유 문구.
 * - `out_of_scope`: 비례대표 — NEC 지역구 당선인 API 범위 밖. 미매칭(버그)이 아니라 출처 범위 밖.
 *
 * matched / genuine-unmatched는 carrier가 필요 없다(matched는 NEC 출처가 배열에 이미 합류되어
 * 보이고, genuine-unmatched는 단순히 NEC 사실 부재 = 별도 라벨 없이 "자료 없음"으로 표현됨).
 */
export interface NecCoverage {
  status: "ambiguous_withheld" | "out_of_scope";
  reason: string;
}

export interface PoliticianProfile {
  politicianId: string;
  displayName: string;
  party: EvidenceValue<string>[];
  district: EvidenceValue<string>[];
  position: EvidenceValue<string>[];
  /**
   * 위원회 내 직책(JOB_RES_NM: 위원/간사/위원장). roster가 그 사람의 속성으로 직접 명시한 값이라
   * identity 카테고리로 출처와 함께 노출한다(불변 #2). 값이 없으면(JOB_RES_NM null) 빈 배열 — 지어내지 않는다.
   * 주의: 위원회 *이름*(CMIT_NM)이나 위원회 *활동*(committee 카테고리)과는 다른 성질이다(불변 #5).
   */
  committeeRole: EvidenceValue<string>[];
  /** 사람 승인된 공직 연락 채널(사무실 전화·이메일·호실·등록 채널 URL). 출처 메타데이터 동반(불변 #2). */
  contact: EvidenceValue<string>[];
  birthYear: EvidenceValue<number>[];
  gender: EvidenceValue<string>[];
  education: EvidenceValue<string>[];
  careers: EvidenceValue<string>[];
  partyHistory: EvidenceValue<string>[];
  elections: EvidenceValue<string>[];
  activities: LegislativeActivity;
  discrepancies: Discrepancy[];
  news: NewsItem[];
  /**
   * NEC 교차검증 커버리지 상태(선택). 없으면 carrier 없음 = 보류/범위밖 라벨을 붙이지 않는다
   * (matched 또는 carrier 미산출). 사이드카 coverage 아티팩트에서만 채워진다(공개 스냅샷 본문 불변).
   */
  necCoverage?: NecCoverage;
}

export interface EntityMatchRequest {
  candidateA: EvidenceValue<unknown>;
  candidateB: EvidenceValue<unknown>;
}

export interface EntityMatchResult {
  isSameEntity: boolean;
  confidence: number;
  rationale: string;
}

export interface DiscrepancyClassificationRequest {
  field: string;
  evidences: EvidenceValue<unknown>[];
}

export interface RagCitation {
  evidenceId: string;
  sourceOrg: string;
  sourceUrl: string;
  snippet: string;
}

export interface RagAnswer {
  answer: string;
  citations: RagCitation[];
  status: "answered_with_citations" | "no_material";
}
