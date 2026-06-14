import type { EvidenceValue, PoliticianProfile, SourceMeta } from "../types";
import type { Collector, CollectorConfigStatus } from "./types";
import { normalizeDistrictForMatchSidoAware } from "./nec-normalize";

/**
 * 두 번째 출처: 중앙선거관리위원회(NEC) — data.go.kr 공개 API.
 *
 * 목적(불변 #4): Open Assembly와 **독립된 기관**이 같은 식별 필드(party/district)를 제공하므로,
 * 두 출처가 갈리면 `content_conflict`로 *표면화*한다(병합·선택·억제 금지). 특히 NEC는 **선거일 시점**
 * 스냅샷이라, 선거 후 당적을 바꾼 의원은 party가 갈린다 — 이는 버그가 아니라 **드러나야 할 신호**다.
 *
 * 상태(2026-06-13): 라이선스는 사람 승인됨(dataset 15000864, "제한 없음"). 그러나 **승인 ≠ 공개 go-live** —
 * 실 fetch는 여전히 OFF 스위치(`NEC_COLLECTOR`, 기본 off) 뒤에 잠겨 있고 공개 출력은 100% mock 그대로다.
 * 실 NEC 수집 활성화는 open_assembly와 동일하게 별도 사람 go/no-go다.
 *
 * 라이선스 게이트(불변 §0.7): nec policy는 사람이 2026-06-13에 approved로 결정(`src/lib/source-license.ts`).
 * 에이전트는 라이선스를 스스로 승인하지 않는다 — 이 코드는 사람 결정을 반영할 뿐이다.
 *
 * 두 데이터셋(사람 결정): 당선인(15000864) primary + 후보자(15000908) auxiliary. 아래 ADR 참조.
 */

/**
 * 실 endpoint shape (TODO — 실 fetch는 사람 라이선스 승인 + NEC_COLLECTOR=nec 전까지 잠금).
 *
 * 당선인 정보(primary):
 *   GET http://apis.data.go.kr/9760000/WinnerInfoInqireService2/getWinnerInfoInqire
 *   params: serviceKey=<NEC_API_KEY, env-only>, sgId=20240410, sgTypecode=2,
 *           pageNo=1, numOfRows=300, resultType=json
 *   (2026-06-14 라이브 검증: WinnerInfoInqireService2가 정상 응답 INFO-00, totalCount=254 지역구 당선인.
 *    기존에 잘못 기록됐던 ElecInfoInqireService는 라이브에서 동작하지 않는 경로였다 — 사람 승인 버그 수정.)
 * 후보자 정보(auxiliary):
 *   GET http://apis.data.go.kr/9760000/PofelcddInfoInqireService/getPoelpcddRegistSttusInfoInqire
 *   params: 위와 동일 (sgId=20240410, sgTypecode=2)
 *
 * 예상 응답 필드(포털 문서 기준 — 실응답 키는 ServiceKey로 별도 검증 필요, dossier open question):
 *   name(성명), jdName(정당명), sggName(선거구명), sdName(시도명),
 *   edu(학력), career1/career2(경력), birthday(생년월일), gender(성별), job(직업), addr(주소)
 *   → 이 중 mapper가 노출하는 것은 **party(jdName), district(sggName) 둘뿐**(아래 PII 정책).
 */
export const NEC_WINNER_SERVICE_PATH = "WinnerInfoInqireService2/getWinnerInfoInqire"; // 당선인(15000864), 라이브 검증 2026-06-14
export const NEC_CANDIDATE_SERVICE_PATH = "PofelcddInfoInqireService/getPoelpcddRegistSttusInfoInqire"; // 후보자(15000908)
export const NEC_22ND_ASSEMBLY_SG_ID = "20240410"; // 제22대 국회의원선거
export const NEC_ASSEMBLY_ELECTION_SG_TYPECODE = "2"; // 선거종류코드: 국회의원선거

/** 어느 데이터셋에서 온 행인지(둘 다 동일 mapper를 통과하지만 출처 식별자에 반영). */
export type NecDataset = "winner" | "candidate";

export interface NecConfig {
  apiKey: string;
  baseUrl: string;
  sgId?: string;
  sgTypecode?: string;
  licenseNote?: string;
}

/** NEC 한 행(당선인/후보자). raw는 보존하되 mapper는 식별 필드만 읽는다. */
export interface NecRecord {
  source: "nec";
  dataset: NecDataset;
  raw: Record<string, unknown>;
  fetchedAt: string;
  sourceUrl: string;
  licenseNote: string;
}

/**
 * 매퍼 노출 범위(사람 결정): **identity-only — party, district 둘뿐**.
 *
 * 아래 PII 필드는 매퍼에서 **읽지 않고 버린다**(불변 #7: 공인의 *공적* 정보만, 그리고 추가 노출은
 * 별도 ADR+사람 승인 필요). NEC가 응답에 담더라도 EvidenceValue로 만들지 않는다.
 */
export const NEC_DROPPED_PII_FIELDS = [
  "birthday", // 생년월일 — PII 경계, 사람 판단 전까지 미노출
  "gender", // 성별
  "edu", // 학력 — 향후 ADR로 교차검증 확장 가능하나 지금은 미노출
  "career1", // 경력
  "career2",
  "job", // 직업
  "addr", // 주소 — PII
  "age", // 연령
] as const;

type EnvLike = Partial<
  Record<"NEC_API_KEY" | "NEC_BASE_URL" | "NEC_LICENSE_NOTE" | "NEC_SG_ID" | "NEC_SG_TYPECODE", string>
>;
type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Pick<Response, "ok" | "status" | "json">>;

export function necConfigFromEnv(env: EnvLike = readNecEnv()): NecConfig | null {
  const apiKey = env.NEC_API_KEY?.trim();
  const baseUrl = env.NEC_BASE_URL?.trim() || "http://apis.data.go.kr/9760000";
  const licenseNote = env.NEC_LICENSE_NOTE?.trim();
  const sgId = env.NEC_SG_ID?.trim();
  const sgTypecode = env.NEC_SG_TYPECODE?.trim();

  if (!apiKey) return null;
  return {
    apiKey,
    baseUrl,
    ...(sgId ? { sgId } : {}),
    ...(sgTypecode ? { sgTypecode } : {}),
    ...(licenseNote ? { licenseNote } : {}),
  };
}

export function getNecConfigStatus(env: EnvLike = readNecEnv()): CollectorConfigStatus {
  return {
    ready: Boolean(env.NEC_API_KEY?.trim()),
    missing: env.NEC_API_KEY?.trim() ? [] : ["NEC_API_KEY"],
  };
}

/**
 * 실 NEC collector (당선인/후보자 한 데이터셋). 실 fetch path를 갖되, 이 iteration에서는
 * 공개 경로에서 호출되지 않는다(아래 selectNecCollectorMode가 기본 mock). injected fetch로만 테스트.
 */
export class NecCollector implements Collector<NecRecord> {
  sourceName = "nec";

  constructor(
    private readonly config: NecConfig,
    private readonly dataset: NecDataset = "winner",
    private readonly fetcher: FetchLike = fetch,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async collect(): Promise<NecRecord[]> {
    // data.go.kr WinnerInfoInqireService2는 페이지당 100행으로 cap된다(numOfRows=300을 보내도 100만 옴 —
    // 2026-06-14 라이브 확인). 따라서 첫 페이지의 totalCount를 읽어 끝까지 페이지네이션한다. 무한루프
    // 방지를 위해 MAX_PAGES로 상한을 둔다(254/100 → 3페이지면 충분, 상한은 안전 여유).
    const fetchedAt = this.now().toISOString();
    const numOfRows = 100;
    const MAX_PAGES = 50;
    const all: Record<string, unknown>[] = [];
    let totalCount = Infinity; // 첫 페이지에서 확정.
    let firstUrl = "";

    for (let pageNo = 1; pageNo <= MAX_PAGES; pageNo += 1) {
      const url = buildNecUrl(this.config, this.dataset, pageNo, numOfRows);
      if (pageNo === 1) firstUrl = url;
      const response = await this.fetcher(url);
      if (!response.ok) {
        throw new Error(`NEC request failed with status ${response.status}.`);
      }
      const payload = await response.json();
      const rows = extractRows(payload);
      const reported = extractTotalCount(payload);
      if (pageNo === 1 && reported !== null) totalCount = reported;

      all.push(...rows);

      // 종료 조건: totalCount를 다 덮었거나(확정된 경우), 이 페이지가 비었거나 numOfRows 미만이면 마지막 페이지.
      const covered = Number.isFinite(totalCount) && all.length >= totalCount;
      const partialOrEmpty = rows.length === 0 || rows.length < numOfRows;
      if (covered || partialOrEmpty) break;
    }

    // sourceUrl은 페이지 파라미터가 없는 안정 식별자(첫 페이지 URL)로 단다 — evidence 출처는 데이터셋·서비스다.
    // 단, 인증키(serviceKey)는 **절대** sourceUrl에 남기지 않는다(§4 비밀 분리, 불변 #2 출처는 공개 가능해야).
    // fetch엔 키가 들어간 URL을 쓰되, evidence로 보관·노출되는 sourceUrl에서는 키를 제거한다.
    const publishableSourceUrl = stripServiceKey(firstUrl);
    return all.map((raw) => ({
      source: "nec",
      dataset: this.dataset,
      raw,
      fetchedAt,
      sourceUrl: publishableSourceUrl,
      licenseNote:
        this.config.licenseNote ?? "TODO: confirm NEC (data.go.kr) license terms before public data release.",
    }));
  }
}

export interface NecMappedProfile {
  politicianId: string;
  displayName: string;
  /** identity-only: party, district 둘뿐. PII는 매퍼에서 버린다(NEC_DROPPED_PII_FIELDS). */
  party: EvidenceValue<string>[];
  district: EvidenceValue<string>[];
  /**
   * **매칭 전용** sido-aware canonical district 키(ADR-6, 사람 결정 2026-06-14). emit되지 않는다.
   *
   * NEC `sggName`은 시도를 담지 않으므로(예 "강서구갑"), 매칭 시 다른 시의 동일 선거구명이 충돌한다
   * (불변 #4 위험). 이를 막기 위해 매퍼가 **공개 지리 식별자** `sdName`(예 "서울특별시", PII 아님 —
   * `NEC_DROPPED_PII_FIELDS`에 없음)을 **매칭 비교에만** 읽어 canonical 단축 시도+선거구 키를 만든다
   * (예 "서울강서구갑"). 이 키는 emit되는 `district` EvidenceValue(raw `sggName` 그대로)와 별개다 —
   * 즉 sdName은 *값*으로 노출되지 않고 비교 키 산출에만 쓰인다(불변 #1: 두 공개 지리 필드 결합은 사실
   * 생성이 아니다). 호출자(mergeNecIntoProfiles 기본)가 이 키로 OA district와 비교한다.
   *
   * sdName이 응답에 없으면 undefined → 매처는 emit된 raw district 값으로 sido-aware 정규화를 시도한다
   * (OA처럼 시도 접두가 값에 이미 있으면 그대로 동작, 없으면 시도 없는 키가 되어 충돌 위험은 호출자 책임).
   */
  districtMatchKey?: string;
}

/**
 * NEC 행 → identity-only EvidenceValue(party, district). 각 값은 SourceMeta를 동반한다(불변 #2).
 *
 * PII 정책(불변 #7, 사람 결정): birthday/gender/edu/career/job/addr/age는 **읽지 않는다**(위 DROPPED).
 * 추가 노출은 별도 ADR + 사람 승인 필요.
 *
 * 안정 join key(MONA_CD 대응) 없음 → politicianId는 NEC 내부 식별용으로만 만든다(`nec-<dataset>-<n>`
 * 또는 raw id). Open Assembly 멤버와의 실제 정합은 이름+정당+지역구 매칭(mergeNecIntoProfiles)이 한다.
 */
export function mapNecRecord(record: NecRecord, index: number): NecMappedProfile | null {
  const name = firstString(record.raw.name, record.raw.HG_NM, record.raw.huboname);
  const party = firstString(record.raw.jdName, record.raw.party, record.raw.jdname);
  const district = firstString(record.raw.sggName, record.raw.district, record.raw.sggname);
  // sdName(시도, 공개 지리 식별자 — PII 아님)은 **매칭 비교에만** 읽는다. EvidenceValue로 만들지 않는다(아래).
  const sido = firstString(record.raw.sdName, record.raw.sidoName);

  // 식별·출처가 없으면 노출하지 않는다(불변 #2·#3).
  if (!name || !record.sourceUrl || !record.licenseNote) return null;
  // identity 비교 대상(party/district) 둘 다 없으면 교차검증에 기여하지 못하므로 만들지 않는다.
  if (!party && !district) return null;

  const rawId = firstString(record.raw.num, record.raw.id);
  const politicianId = `nec-${record.dataset}-${rawId ?? index}`;
  const source = toNecSource(record, politicianId);

  // 매칭 전용 canonical 키(ADR-6): bare sggName + sdName → "서울강서구갑". emit 안 됨(district는 raw sggName 유지).
  const districtMatchKey = district ? normalizeDistrictForMatchSidoAware(district, sido) : "";

  return {
    politicianId,
    displayName: name,
    party: party ? [toEvidence(`${politicianId}-party`, "party", party, source)] : [],
    district: district ? [toEvidence(`${politicianId}-district`, "district", district, source)] : [],
    ...(districtMatchKey ? { districtMatchKey } : {}),
  };
}

function readNecEnv(): EnvLike {
  return {
    NEC_API_KEY: process.env.NEC_API_KEY,
    NEC_BASE_URL: process.env.NEC_BASE_URL,
    NEC_LICENSE_NOTE: process.env.NEC_LICENSE_NOTE,
    NEC_SG_ID: process.env.NEC_SG_ID,
    NEC_SG_TYPECODE: process.env.NEC_SG_TYPECODE,
  };
}

function toNecSource(record: NecRecord, politicianId: string): SourceMeta {
  return {
    sourceId: politicianId,
    sourceKind: "nec",
    sourceOrg: "중앙선거관리위원회",
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
 * sourceUrl로 보관·노출되는 URL에서 인증키(serviceKey)를 제거한다(§4 비밀 분리). fetch엔 키가 든 URL을
 * 쓰지만, evidence.source.sourceUrl은 공개 가능해야 하므로(불변 #2·#8) 키를 떼어 안정 식별자만 남긴다.
 * 페이지 파라미터(pageNo)도 떼어 데이터셋·서비스 단위의 안정 식별자로 만든다. 파싱 실패 시 빈 문자열은
 * 만들지 않고(출처 누락 금지) 서비스 path만 재구성한다.
 */
function stripServiceKey(rawUrl: string): string {
  try {
    const u = new URL(rawUrl);
    u.searchParams.delete("serviceKey");
    u.searchParams.delete("pageNo");
    return u.toString();
  } catch {
    return rawUrl.split("?")[0] ?? rawUrl;
  }
}

function buildNecUrl(config: NecConfig, dataset: NecDataset, pageNo = 1, numOfRows = 100) {
  const base = config.baseUrl.replace(/\/$/, "");
  const path = dataset === "winner" ? NEC_WINNER_SERVICE_PATH : NEC_CANDIDATE_SERVICE_PATH;
  const url = new URL(`${base}/${path}`);
  // 인증키는 env-only(NEC_API_KEY). 코드/문서에 하드코딩 금지(불변, §4 secrets).
  url.searchParams.set("serviceKey", config.apiKey);
  url.searchParams.set("sgId", config.sgId ?? NEC_22ND_ASSEMBLY_SG_ID);
  url.searchParams.set("sgTypecode", config.sgTypecode ?? NEC_ASSEMBLY_ELECTION_SG_TYPECODE);
  url.searchParams.set("pageNo", String(pageNo));
  // 서버가 페이지당 100으로 cap한다(라이브 확인) — 페이지네이션으로 전량 수집(collect 참조).
  url.searchParams.set("numOfRows", String(numOfRows));
  url.searchParams.set("resultType", "json");
  return url.toString();
}

/** data.go.kr 응답 envelope에서 totalCount를 찾는다(중첩 위치 방어적 탐색). 없으면 null. */
function extractTotalCount(payload: unknown): number | null {
  if (Array.isArray(payload)) {
    for (const item of payload) {
      const found = extractTotalCount(item);
      if (found !== null) return found;
    }
    return null;
  }
  if (!isRecord(payload)) return null;
  if (payload.totalCount !== undefined) {
    const n = typeof payload.totalCount === "number" ? payload.totalCount : Number(payload.totalCount);
    if (!Number.isNaN(n)) return n;
  }
  for (const nested of Object.values(payload)) {
    const found = extractTotalCount(nested);
    if (found !== null) return found;
  }
  return null;
}

function extractRows(payload: unknown): Record<string, unknown>[] {
  if (!isRecord(payload)) return [];
  return findRows(payload).filter(isRecord);
}

function findRows(value: unknown): unknown[] {
  if (Array.isArray(value)) {
    const rowContainer = value.find((item) => isRecord(item) && Array.isArray(item.item));
    if (isRecord(rowContainer) && Array.isArray(rowContainer.item)) return rowContainer.item;
    return value;
  }
  if (!isRecord(value)) return [];
  if (Array.isArray(value.item)) return value.item;
  for (const nested of Object.values(value)) {
    const rows = findRows(nested);
    if (rows.length > 0) return rows;
  }
  return [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
