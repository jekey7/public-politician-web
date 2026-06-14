import type { EvidenceValue, PoliticianProfile, SourceMeta } from "../types";
import type { CollectorConfigStatus } from "./types";

/**
 * 기본 멤버 목록 endpoint. `nwvrqwxyaytdsfvhu` = "국회의원 인적사항"(현직 제22대, list_total_count=300).
 * 과거 기본값 `ALLNAMEMBER`(역대 전체 3295건, 필드명도 NAAS_* 계열로 다름)는 현직 용도에 맞지 않아 교체.
 * 명시적 상수로 두고 config/env로 override 가능하게 한다(silently hardcode 금지).
 */
export const DEFAULT_OPEN_ASSEMBLY_MEMBER_PATH = "nwvrqwxyaytdsfvhu";

export interface OpenAssemblyConfig {
  apiKey: string;
  baseUrl: string;
  /** 멤버 목록 service path. 미지정 시 DEFAULT_OPEN_ASSEMBLY_MEMBER_PATH. env: OPEN_ASSEMBLY_MEMBER_PATH. */
  memberListPath?: string;
  licenseNote?: string;
}

export interface OpenAssemblyMemberRecord {
  source: "open_assembly";
  raw: Record<string, unknown>;
  fetchedAt: string;
  sourceUrl: string;
  licenseNote: string;
}

type EnvLike = Partial<
  Record<
    "OPEN_ASSEMBLY_API_KEY" | "OPEN_ASSEMBLY_BASE_URL" | "OPEN_ASSEMBLY_LICENSE_NOTE" | "OPEN_ASSEMBLY_MEMBER_PATH",
    string
  >
>;
type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Pick<Response, "ok" | "status" | "json">>;

export function openAssemblyConfigFromEnv(env: EnvLike = readOpenAssemblyEnv()): OpenAssemblyConfig | null {
  const apiKey = env.OPEN_ASSEMBLY_API_KEY?.trim();
  const baseUrl = env.OPEN_ASSEMBLY_BASE_URL?.trim() || "https://open.assembly.go.kr/portal/openapi";

  const licenseNote = env.OPEN_ASSEMBLY_LICENSE_NOTE?.trim();
  const memberListPath = env.OPEN_ASSEMBLY_MEMBER_PATH?.trim();

  if (!apiKey) return null;
  return {
    apiKey,
    baseUrl,
    ...(memberListPath ? { memberListPath } : {}),
    ...(licenseNote ? { licenseNote } : {}),
  };
}

export function getOpenAssemblyConfigStatus(env: EnvLike = readOpenAssemblyEnv()): CollectorConfigStatus {
  return {
    ready: Boolean(env.OPEN_ASSEMBLY_API_KEY?.trim()),
    missing: env.OPEN_ASSEMBLY_API_KEY?.trim() ? [] : ["OPEN_ASSEMBLY_API_KEY"],
  };
}

export class OpenAssemblyCollector {
  sourceName = "open-assembly";

  constructor(
    private readonly config: OpenAssemblyConfig,
    private readonly fetcher: FetchLike = fetch,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async collect(): Promise<OpenAssemblyMemberRecord[]> {
    const url = buildOpenAssemblyUrl(this.config);
    const response = await this.fetcher(url);
    if (!response.ok) {
      throw new Error(`Open Assembly request failed with status ${response.status}.`);
    }

    const payload = await response.json();
    const rows = extractRows(payload);
    const fetchedAt = this.now().toISOString();

    // 인증키(Key)는 evidence로 보관·노출되는 sourceUrl에 절대 남기지 않는다(§4 비밀 분리). fetch엔 키가
    // 든 URL을 쓰지만, 공개 가능해야 하는 sourceUrl(불변 #2·#8)에서는 키를 떼어 안정 식별자만 남긴다.
    const publishableSourceUrl = stripAuthKey(url);

    return rows.map((raw) => ({
      source: "open_assembly",
      raw,
      fetchedAt,
      sourceUrl: publishableSourceUrl,
      licenseNote: this.config.licenseNote ?? "TODO: confirm Open Assembly license terms before public data release.",
    }));
  }
}

export interface OpenAssemblyMappedProfile {
  politicianId: string;
  displayName: string;
  party: EvidenceValue<string>[];
  district: EvidenceValue<string>[];
  position: EvidenceValue<string>[];
  /** 위원회 내 직책(JOB_RES_NM: 위원/간사/위원장, nullable). 출처 동반. JOB_RES_NM null이면 빈 배열(아래 ADR). */
  committeeRole: EvidenceValue<string>[];
  /** 공직 연락 채널(사무실 전화·이메일·호실·등록 채널 URL). 사람 승인된 공개 정보(아래 ADR). */
  contact: EvidenceValue<string>[];
}

/**
 * ADR (2026-06-13, 사람=프로젝트 오너 승인): Open Assembly 공직 연락 필드의 공개/비공개 분리.
 *
 * 두 집합을 **명확히 분리**한다(정책과 privacy scan이 서로 모순되지 않도록):
 *
 * 1) DROPPED_PII — 사인(보좌진) 실명. 무조건 제외(불변 #7: 공인의 *공적* 정보만 공개).
 *    STAFF(보좌관), SECRETARY(선임비서관), SECRETARY2(비서관). raw-archive privacy scan이 계속 차단한다.
 *
 * 2) APPROVED_PUBLIC_CONTACT — 의원이 국회에 **자기 등록**한 공직 연락 채널. 사람이 §0.7 판단으로
 *    공개 승인(FINAL): TEL_NO(사무실 전화), E_MAIL(사무실 이메일), ASSEM_ADDR(의원회관 호실),
 *    HOMEPAGE(등록 채널 URL — 공식 사이트/국회 프로필/블로그/SNS를 동일하게 자기공개 채널로 취급,
 *    링크만, 가공·평가 없음). 이 네 필드는 출처 메타데이터를 달고 공개된다(불변 #2).
 *    → 이는 identity-only를 넘어선 **의도적·문서화된 확장**이며, 사람 승인이 근거다.
 *
 * 주의: 이 두 집합은 절대 섞이지 않는다. APPROVED_PUBLIC_CONTACT는 privacy scan에서 제외(화이트리스트)되고,
 * DROPPED_PII는 scan이 계속 sensitive로 잡는다.
 */
export const PUBLIC_MAPPER_DROPPED_FIELDS = {
  /** 사인(보좌진) 실명 — 무조건 제외. raw scan도 계속 차단. */
  aideNames: ["STAFF", "SECRETARY", "SECRETARY2"] as const,
} as const;

/**
 * ADR (2026-06-13, 사람=프로젝트 오너 결정 (a)): position vs committee_role 분리.
 *
 * 내부 live dry-run으로 확인: JOB_RES_NM은 "국회의원"(공직)이 *아니라* 위원회 내 직책이다
 * (위원 250 / 간사 26 / 위원장 15 / null 9). 과거 매퍼는 JOB_RES_NM → position(`?? "국회의원"` fallback)이라
 * 291/300이 position 칸에 위원회 직책을 노출했다. 결정 (a)로 두 사실을 분리한다:
 *
 * 1) position = "국회의원"(공직). **지어낸 상수가 아니다** — nwvrqwxyaytdsfvhu("현직 국회의원 인적사항",
 *    list_total_count=300) **roster 소속**이 곧 현직 의원임을 definition상 함의한다. 따라서 출처(roster
 *    endpoint = open_assembly, sourceUrl, fetchedAt)를 단 identity 사실로 emit한다(불변 #1: 사실 미생성,
 *    #2: 출처 동반). roster에 있는 300명 전원에 적용된다(근거 = roster 소속).
 *
 * 2) committee_role = JOB_RES_NM(위원/간사/위원장). 출처를 단 identity 사실(roster가 그 사람의 속성으로
 *    직접 명시한 값). JOB_RES_NM이 null인 9건은 **아무것도 emit하지 않는다**(지어내지 않는다 — null→무 사실,
 *    contact 필드 처리와 동일). committee_role은 위원회 *이름*(CMIT_NM/CMITS)과 다르다 — 그 사람의 ROLE이지
 *    위원회 자체가 아니다. CMIT_NM/CMITS는 이번 iteration 범위 밖(미매핑 유지).
 *    TODO: 위원회 이름·소속 관계를 노출하려면 별도 검증 매퍼에서 committee 카테고리로 다룬다(이 둘을 섞지 않는다, 불변 #5).
 */

/** 사람 승인된 공개 연락 필드(raw key → 공개 field 이름). identity-only를 넘는 의도적 확장(위 ADR). */
export const APPROVED_PUBLIC_CONTACT_FIELDS = {
  TEL_NO: "office_phone",
  E_MAIL: "office_email",
  ASSEM_ADDR: "office_room",
  HOMEPAGE: "registered_channel_url",
} as const;

/**
 * nwvrqwxyaytdsfvhu("국회의원 인적사항", 현직 제22대) 실응답 필드 정렬.
 * 공개하는 것은 식별(identity) 사실뿐(name/party/district/position) — 기존 dry-run identity-only 가드 유지.
 * 나머지 확인된 필드는 "있음"만 기록하고 별도 검증 매퍼 전까지 노출하지 않는다(불변 #1·#2).
 */
export function mapOpenAssemblyMemberRecord(record: OpenAssemblyMemberRecord): OpenAssemblyMappedProfile | null {
  // 식별 필드(실응답으로 확인): MONA_CD(id) / HG_NM(name) / POLY_NM(party) / ORIG_NM(district) / JOB_RES_NM(position).
  // member_id/id 등 후순위 후보는 ALLNAMEMBER(NAAS_CD) 등 다른 endpoint 호환을 위해 남겨둔다.
  const name = firstString(record.raw.HG_NM, record.raw.name, record.raw.NAME);
  const memberId = firstString(record.raw.MONA_CD, record.raw.NAAS_CD, record.raw.member_id, record.raw.id);
  const party = firstString(record.raw.POLY_NM, record.raw.party);
  const district = firstString(record.raw.ORIG_NM, record.raw.district);
  // committee_role = JOB_RES_NM(위원/간사/위원장, nullable). position과 분리(위 ADR). null이면 노출 안 함.
  const committeeRoleValue = firstString(record.raw.JOB_RES_NM, record.raw.position);

  if (!name || !memberId || !record.sourceUrl || !record.licenseNote) return null;

  const source = toOpenAssemblySource(record, memberId);
  const politicianId = `open-assembly-${memberId}`;
  // position = "국회의원"(공직). roster 소속이 곧 현직 의원임을 함의 → 지어낸 상수가 아니라 roster 출처를 단 사실.
  const office = "국회의원";

  // 사람 승인된 공개 연락 필드만 매핑한다. 보좌진 실명(DROPPED_PII)은 여기서 읽지 않는다(불변 #7).
  const contact: EvidenceValue<string>[] = [];
  for (const [rawKey, fieldName] of Object.entries(APPROVED_PUBLIC_CONTACT_FIELDS)) {
    const value = firstString(record.raw[rawKey]);
    if (value) {
      contact.push(toEvidence(`${politicianId}-${fieldName}`, fieldName, value, source));
    }
  }

  return {
    politicianId,
    displayName: name,
    party: party ? [toEvidence(`${politicianId}-party`, "party", party, source)] : [],
    district: district ? [toEvidence(`${politicianId}-district`, "district", district, source)] : [],
    position: [toEvidence(`${politicianId}-position`, "position", office, source)],
    committeeRole: committeeRoleValue
      ? [toEvidence(`${politicianId}-committee-role`, "committee_role", committeeRoleValue, source)]
      : [],
    contact,
  };
}

export function mergeOpenAssemblyMappedProfile(mapped: OpenAssemblyMappedProfile): PoliticianProfile {
  return {
    politicianId: mapped.politicianId,
    displayName: mapped.displayName,
    party: mapped.party,
    district: mapped.district,
    position: mapped.position,
    committeeRole: mapped.committeeRole,
    contact: mapped.contact,
    birthYear: [],
    gender: [],
    education: [],
    careers: [],
    partyHistory: [],
    elections: [],
    activities: {
      bills: [],
      votes: [],
      committees: [],
    },
    discrepancies: [],
    news: [],
  };
}

function readOpenAssemblyEnv(): EnvLike {
  return {
    OPEN_ASSEMBLY_API_KEY: process.env.OPEN_ASSEMBLY_API_KEY,
    OPEN_ASSEMBLY_BASE_URL: process.env.OPEN_ASSEMBLY_BASE_URL,
    OPEN_ASSEMBLY_LICENSE_NOTE: process.env.OPEN_ASSEMBLY_LICENSE_NOTE,
    OPEN_ASSEMBLY_MEMBER_PATH: process.env.OPEN_ASSEMBLY_MEMBER_PATH,
  };
}

function toOpenAssemblySource(record: OpenAssemblyMemberRecord, memberId: string): SourceMeta {
  return {
    sourceId: `open-assembly-${memberId}`,
    sourceKind: "open_assembly",
    sourceOrg: "열린국회정보",
    sourceUrl: record.sourceUrl,
    fetchedAt: record.fetchedAt,
    licenseNote: record.licenseNote,
  };
}

function toEvidence(evidenceId: string, field: string, value: string, source: SourceMeta): EvidenceValue<string> {
  return {
    evidenceId,
    category: "identity",
    field,
    value,
    rawText: value,
    source,
    reviewStatus: "reviewing",
  };
}

function firstString(...values: unknown[]) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number") return String(value);
  }

  return null;
}

/**
 * sourceUrl로 보관·노출되는 URL에서 인증키(Key)를 제거한다(§4 비밀 분리). fetch엔 키가 든 URL을 쓰지만,
 * evidence.source.sourceUrl은 공개 가능해야 하므로(불변 #2·#8) 키를 떼어 안정 식별자만 남긴다. 파싱 실패 시
 * 쿼리 앞부분만 남긴다(출처 누락 금지).
 */
function stripAuthKey(rawUrl: string): string {
  try {
    const u = new URL(rawUrl);
    u.searchParams.delete("Key");
    return u.toString();
  } catch {
    return rawUrl.split("?")[0] ?? rawUrl;
  }
}

function buildOpenAssemblyUrl(config: OpenAssemblyConfig) {
  const base = config.baseUrl.replace(/\/$/, "");
  const path = config.memberListPath ?? DEFAULT_OPEN_ASSEMBLY_MEMBER_PATH;
  const url = new URL(`${base}/${path}`);
  // 인증 파라미터 이름은 대소문자 구분 — 공식 명세서상 `Key`(대문자 K)다. `KEY`로 보내면 서버가
  // 인증키 없음으로 보고 sample 기본값(pIndex=1/pSize=5 고정)을 돌려준다(2026-06-13 실측으로 확인).
  url.searchParams.set("Key", config.apiKey);
  url.searchParams.set("Type", "json");
  url.searchParams.set("pIndex", "1");
  // 명세서: pSize 최대 1000(ERROR-336). 현직 22대 인원(list_total_count=300)은 단일 페이지로 충분.
  url.searchParams.set("pSize", "300");
  return url.toString();
}

function extractRows(payload: unknown): Record<string, unknown>[] {
  if (!isRecord(payload)) return [];
  const directRows = findRows(payload);
  return directRows.filter(isRecord);
}

function findRows(value: unknown): unknown[] {
  if (Array.isArray(value)) {
    const rowContainer = value.find((item) => isRecord(item) && Array.isArray(item.row));
    if (isRecord(rowContainer) && Array.isArray(rowContainer.row)) return rowContainer.row;
    return value;
  }

  if (!isRecord(value)) return [];
  if (Array.isArray(value.row)) return value.row;

  for (const nested of Object.values(value)) {
    const rows = findRows(nested);
    if (rows.length > 0) return rows;
  }

  return [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
