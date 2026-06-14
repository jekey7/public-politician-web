import type {
  Discrepancy,
  EvidenceValue,
  FactCategory,
  NecCoverage,
  NewsItem,
  PoliticianProfile,
  PublicSnapshot,
  SnapshotDiscrepancyRow,
  SnapshotFactRow,
  SnapshotNewsRow,
  SourceMeta,
} from "./types";

/**
 * 공개 스냅샷(PublicSnapshot, 평면 행 형식)을 상세 페이지가 소비하는 `PoliticianProfile[]`로 **재구성**한다.
 *
 * 이것은 `buildPublicSnapshot`(snapshot.ts)의 역(inverse)이다. 같은 라이브러리 경로를 공유하므로, 스냅샷에
 * NEC 사실이 실리면(go-live 후) 추가 매핑 없이 그대로 화면에 나타난다(불변 #2/#4: 출처·불일치가 행에 보존됨).
 *
 * 사실을 **생성하지 않는다**(불변 #1): 행에 있는 값/출처/불일치만 그대로 옮긴다. 행에 없는 사실은 만들지 않는다.
 *
 * 커버리지 사이드카(coverage)는 선택이다. 공개 스냅샷 본문 스키마(verified_facts/discrepancies/news_feed)는
 * 건드리지 않고(공개 출력 바이트 동일 보존), 보류/범위밖 상태만 별도 사이드카로 받아 프로필에 동반시킨다(불변 #3).
 */

/** 커버리지 사이드카 아티팩트(내부 전용 — 공개 스냅샷 본문과 분리). politician_id별 NEC 커버리지 상태. */
export interface SnapshotCoverageSidecar {
  generated_at: string;
  /** politician_id → 커버리지 상태(ambiguous_withheld | out_of_scope). matched/genuine-unmatched는 미수록. */
  coverage: Record<string, NecCoverage>;
}

function toSourceMeta(row: SnapshotFactRow | SnapshotNewsRow): SourceMeta {
  return {
    sourceId: row.source_id,
    sourceKind: row.source_kind,
    sourceOrg: row.source_org,
    sourceUrl: row.source_url,
    fetchedAt: row.fetched_at,
    licenseNote: row.license_note,
  };
}

function toEvidence(row: SnapshotFactRow): EvidenceValue<string | number | boolean> {
  return {
    evidenceId: row.evidence_id,
    category: row.category,
    field: row.field,
    value: row.value,
    rawText: row.raw_text,
    source: toSourceMeta(row),
    reviewStatus: row.review_status,
  };
}

function toDiscrepancy(row: SnapshotDiscrepancyRow): Discrepancy {
  return {
    discrepancyId: row.discrepancy_id,
    category: row.category,
    field: row.field,
    kind: row.kind,
    label: row.label,
    evidenceIds: row.evidence_ids,
    detectedAt: row.detected_at,
    detector: row.detector,
  };
}

function toNewsItem(row: SnapshotNewsRow): NewsItem {
  return {
    newsId: row.news_id,
    politicianId: row.politician_id,
    title: row.title,
    publisher: row.publisher,
    publishedAt: row.published_at,
    source: toSourceMeta(row),
    mediaKind: row.media_kind,
  };
}

function emptyProfile(politicianId: string, displayName: string): PoliticianProfile {
  return {
    politicianId,
    displayName,
    party: [],
    district: [],
    position: [],
    committeeRole: [],
    contact: [],
    birthYear: [],
    gender: [],
    education: [],
    careers: [],
    partyHistory: [],
    elections: [],
    activities: { bills: [], votes: [], committees: [] },
    discrepancies: [],
    news: [],
  };
}

// identity 카테고리 안에서 field → 어느 프로필 배열로 갈지. 나머지 카테고리는 카테고리만으로 라우팅된다.
const CONTACT_FIELDS = new Set(["office_phone", "office_email", "office_room", "registered_channel_url"]);

/** 한 fact 행을 카테고리/필드에 따라 올바른 프로필 배열에 넣는다. 값/출처는 그대로 보존(불변 #1·#2). */
function routeFact(profile: PoliticianProfile, evidence: EvidenceValue<string | number | boolean>) {
  const category: FactCategory = evidence.category;
  switch (category) {
    case "identity":
      routeIdentity(profile, evidence);
      return;
    case "education":
      profile.education.push(evidence as EvidenceValue<string>);
      return;
    case "career":
      profile.careers.push(evidence as EvidenceValue<string>);
      return;
    case "party_history":
      profile.partyHistory.push(evidence as EvidenceValue<string>);
      return;
    case "election":
      profile.elections.push(evidence as EvidenceValue<string>);
      return;
    case "bill":
      profile.activities.bills.push(evidence as EvidenceValue<string>);
      return;
    case "vote":
      profile.activities.votes.push(evidence as EvidenceValue<string>);
      return;
    case "committee":
      profile.activities.committees.push(evidence as EvidenceValue<string>);
      return;
  }
}

function routeIdentity(profile: PoliticianProfile, evidence: EvidenceValue<string | number | boolean>) {
  const field = evidence.field;
  if (field === "party") profile.party.push(evidence as EvidenceValue<string>);
  else if (field === "district") profile.district.push(evidence as EvidenceValue<string>);
  else if (field === "position") profile.position.push(evidence as EvidenceValue<string>);
  else if (field === "committee_role") profile.committeeRole.push(evidence as EvidenceValue<string>);
  else if (field === "birthYear") profile.birthYear.push(evidence as EvidenceValue<number>);
  else if (field === "gender") profile.gender.push(evidence as EvidenceValue<string>);
  else if (CONTACT_FIELDS.has(field)) profile.contact.push(evidence as EvidenceValue<string>);
  // 알 수 없는 identity 필드는 조용히 버리지 않고 contact로도 강제 분류하지 않는다 — party 기준 라우팅만 확정.
  // (현재 매퍼가 내보내는 identity 필드는 위 집합으로 닫혀 있다. 새 필드가 생기면 여기에 명시 추가한다.)
}

/**
 * 스냅샷 + (선택) 커버리지 사이드카로부터 프로필 배열을 재구성한다. 스냅샷의 등장 순서를 보존한다
 * (politician_id가 처음 등장한 순서). 빈 스냅샷이면 빈 배열을 돌려준다(크래시 금지).
 */
export function reconstructProfilesFromSnapshot(
  snapshot: PublicSnapshot,
  coverage?: SnapshotCoverageSidecar,
): PoliticianProfile[] {
  const byId = new Map<string, PoliticianProfile>();
  const order: string[] = [];

  const ensure = (politicianId: string, displayName: string): PoliticianProfile => {
    let profile = byId.get(politicianId);
    if (!profile) {
      profile = emptyProfile(politicianId, displayName);
      byId.set(politicianId, profile);
      order.push(politicianId);
    }
    return profile;
  };

  for (const row of snapshot.verified_facts) {
    const profile = ensure(row.politician_id, row.display_name);
    routeFact(profile, toEvidence(row));
  }
  for (const row of snapshot.discrepancies) {
    const profile = ensure(row.politician_id, row.display_name);
    profile.discrepancies.push(toDiscrepancy(row));
  }
  for (const row of snapshot.news_feed) {
    // 뉴스 행은 politician_id를 가지지만 display_name 컬럼이 없다 — 기존 프로필에만 붙인다(없으면 생성 안 함).
    const profile = byId.get(row.politician_id);
    if (profile) profile.news.push(toNewsItem(row));
  }

  if (coverage) {
    for (const [politicianId, status] of Object.entries(coverage.coverage)) {
      const profile = byId.get(politicianId);
      if (profile) profile.necCoverage = status;
    }
  }

  return order.map((id) => byId.get(id)!);
}
