import type { EvidenceValue, PoliticianProfile } from "../types";
import type { NecMappedProfile } from "./nec";
import {
  normalizeNameForMatch,
  normalizePartyForMatch,
  normalizeDistrictForMatch,
  normalizeDistrictForMatchSidoAware,
} from "./nec-normalize";

/**
 * NEC(두 번째 출처) 식별 evidence를 같은 의원의 Open Assembly profile에 **합류**시킨다.
 *
 * 왜 합류가 필요한가: cross-verification은 profile *한 개*의 evidence 배열 안에서 출처를 비교한다
 * (`detectProfileDiscrepanciesSync`는 `uniqueSources >= 2`인 field만 검사). NEC collector는 별도
 * profile을 만들므로, 같은 인물이면 한 profile의 party/district 배열에 NEC evidence를 **추가**해야
 * 비로소 2-출처가 되어 탐지가 작동한다.
 *
 * 무엇을 하지 않는가(불변 #4): 값을 **병합·선택·억제하지 않는다**. NEC party가 Open Assembly와
 * 달라도 두 EvidenceValue를 *나란히* 배열에 넣을 뿐이다. 다르면 cross-verification이
 * `content_conflict`로 드러낸다. 선거일 시점(NEC) vs 현재(OA)의 당적 변경자는 **드러나야 할 신호**다.
 *
 * ── 매칭 기준(사람 승인): 이름 + 정당 + 지역구 ──
 * 안정 join key(MONA_CD 대응)가 NEC에 없다. 그래서 사람이 승인한 매칭 근거는 (name, party, district)
 * 조합이다. 아래 정책으로 **잘못된 사람을 조용히 합치지 않는다**:
 *
 *   1) 후보 매칭: NEC profile의 이름이 같고(정규화 후), 그리고 정당 또는 지역구 중 **최소 하나가
 *      일치**하는 Open Assembly profile들을 후보로 모은다. (정당이 갈린 switcher도 지역구로 매칭되게,
 *      지역구 표기차가 있어도 정당으로 매칭되게 — 의도된 conflict가 매칭 실패로 숨지 않도록.)
 *   2) **no-match (후보 0개)**: 합류하지 않는다. NEC evidence는 버려지지 않고 `unmatched`로 반환된다
 *      (조용한 삭제 금지 — 호출자가 검사/보고할 수 있다). 사실을 지어내지 않는다(불변 #1).
 *   3) **multi-match (후보 2개 이상, 모호)**: 합류하지 않는다. 잘못된 사람에 붙이느니 붙이지 않는다.
 *      해당 NEC profile은 `ambiguous`로 반환된다(호출자가 검수 — 불변 #3: 모르면 모른다).
 *   4) **unique-match (후보 정확히 1개)**: 그 profile의 party/district 배열에 NEC evidence를 추가한다.
 *      값이 같든 다르든 추가한다(다르면 conflict로 surface). discrepancy 재탐지는 호출자(파이프라인)가
 *      한다 — 이 함수는 evidence만 합류시키고 탐지는 하지 않는다.
 *
 * 순수 함수: 입력 profiles를 복사해 새 배열을 반환한다(입력 불변).
 */

export interface NecMergeResult {
  /** NEC evidence가 합류된(또는 변화 없는) profile 목록. 입력과 같은 길이/순서. */
  profiles: PoliticianProfile[];
  /** 매칭된 Open Assembly profile이 없어 합류하지 못한 NEC profile들(조용히 버리지 않음). */
  unmatched: NecMappedProfile[];
  /**
   * 후보가 2개 이상이라 모호해 합류하지 않은 NEC profile들(검수 필요 — 잘못된 합류 금지).
   *
   * DECISION 2(ADR-7, 2026-06-14): 동명이인+동일정당 쌍둥이(예 박지원)는 안정 join key가 없어 sido-aware
   * 지역구 정규화로도 unique 해소되지 않는다(이름+정당으로 둘 다 후보 → 모호). 이들은 **강제 해소하지 않고**
   * 새 PII 식별자도 도입하지 않으며(불변 #7), "동명이인 — 식별 불가, NEC 교차검증 보류"로 *정직하게 표면화*한다
   * (불변 #3: 모르면 모른다). 호출자(`classifyNecCoverage`)는 이 목록의 OA 쌍둥이를 genuine-unmatched와
   * **분리해** ambiguous-withheld로 보고한다(조용히 누락 금지).
   */
  ambiguous: NecMappedProfile[];
}

/**
 * 매칭 정규화기(불변 #4 안전판). 출처별 raw 값은 절대 바꾸지 않고, **비교용 key**만 만든다.
 *
 * 기본값(ADR-6, 사람 결정 2026-06-14): **sido-aware** 정규화기. name/party는 NFC+공백 정규화, district는
 * canonical 단축 시도+선거구 키(`normalizeDistrictForMatchSidoAware`). NEC 측 district는 매퍼가 sdName으로
 * 미리 산출한 `districtMatchKey`를 우선 쓰고(아래 isCandidateMatch), 없으면 raw 값으로 정규화한다. 이 전환은
 * 사람이 승인했다(라이브 충돌 0, 가짜 conflict 0 — dossier PART C/ADR-5·6). raw 값은 절대 덮어쓰지 않는다.
 *
 * 다른 모드(명시 주입 시):
 *  - legacy(`LEGACY_MATCH_NORMALIZER`): 트림+소문자+공백1칸만. 시도 접두/표기차를 흡수하지 않는다(이전 기본).
 *  - Option A(`NEC_MATCH_NORMALIZER_OPTION_A_MEASUREMENT_ONLY`): 시도 제거 — **측정 전용, 충돌 6건, 채택 금지**.
 */
export interface MatchNormalizer {
  name: (value: string) => string;
  party: (value: string) => string;
  district: (value: string) => string;
  /**
   * true이면 NEC 측 district 비교에 매퍼가 sdName으로 산출한 `districtMatchKey`를 우선 쓴다(없으면 raw 값에
   * `district` 적용). sido-aware 정규화기만 켠다 — bare sggName엔 시도가 없어 `district`만으론 시도를 복원할 수
   * 없기 때문. legacy/Option-A 같은 다른 regime은 이 플래그를 켜지 않아 자기 `district` 규칙을 그대로 따른다
   * (그래서 before/측정 베이스라인이 충실하게 보존된다).
   */
  useNecDistrictMatchKey?: boolean;
}

const legacyNormalize = (value: string) => value.trim().toLowerCase().replace(/\s+/g, " ");

/**
 * ✅ 기본 매칭 정규화기(ADR-6, 사람 승인) — sido-aware. district는 canonical 단축 시도+선거구 키.
 *
 * OA 측 district("서울 강서구갑")는 시도 접두가 값에 이미 있어 그대로 정규화된다. NEC 측은 bare sggName이라
 * 시도가 없지만, 매퍼가 sdName으로 산출한 `districtMatchKey`를 isCandidateMatch가 우선 사용한다
 * (`useNecDistrictMatchKey`). 충돌 0(다른 시 동일 선거구명 분리 보존).
 */
export const NEC_MATCH_NORMALIZER_SIDO_AWARE: MatchNormalizer = {
  name: normalizeNameForMatch,
  party: normalizePartyForMatch,
  district: (value) => normalizeDistrictForMatchSidoAware(value),
  useNecDistrictMatchKey: true,
};

/**
 * ⚠️ 측정 전용 정규화기(Option A district = 선거구명만). **공개 매칭 기본값으로 채택 금지.**
 *
 * 라이브 2026-06-14에서 이 district 규칙은 6개 충돌 키를 만든다("서구갑" ← 인천/대전/광주 등). 이 인터페이스는
 * district를 문자열 하나로만 받으므로 시도를 복원할 수 없어 Option B(권장, 충돌 0)를 표현하지 못한다. 따라서
 * 이 정규화기는 **내부 측정(dry-run)에서 Option A 효과를 재현**하기 위해서만 존재한다. 안전한 채택 경로는
 * 매퍼가 NEC `sdName`을 읽어 district를 시도 인지 형태로 비교하는 것이며(normalizeDistrictForMatchSidoAware),
 * 그것은 매핑 노출 범위를 바꾸는 **사람 결정**이다(dossier 참조). 그 전까지 기본은 legacy로 유지한다.
 */
export const NEC_MATCH_NORMALIZER_OPTION_A_MEASUREMENT_ONLY: MatchNormalizer = {
  name: normalizeNameForMatch,
  party: normalizePartyForMatch,
  district: normalizeDistrictForMatch,
};

/**
 * 이전 기본(legacy) 정규화기 — 트림+소문자+공백1칸만. sido-aware 채택 전 동작. 이제 **기본이 아니다**(ADR-6).
 * 측정/비교(before 베이스라인)에서만 명시적으로 주입해 쓴다.
 */
export const LEGACY_MATCH_NORMALIZER: MatchNormalizer = {
  name: legacyNormalize,
  party: legacyNormalize,
  district: legacyNormalize,
};

function firstValue(evidences: EvidenceValue<string>[], normalize: (v: string) => string): string | null {
  for (const evidence of evidences) {
    if (evidence.value?.trim()) return normalize(evidence.value);
  }
  return null;
}

/** 같은 인물 후보인지: 이름 일치 + (정당 또는 지역구 중 하나 이상 일치). 비교는 주입된 정규화기 key로 한다. */
function isCandidateMatch(oa: PoliticianProfile, nec: NecMappedProfile, nz: MatchNormalizer): boolean {
  if (nz.name(oa.displayName) !== nz.name(nec.displayName)) return false;

  const necParty = firstValue(nec.party, nz.party);
  // sido-aware regime(useNecDistrictMatchKey)에서만 매퍼가 sdName으로 산출한 canonical 키를 우선 쓴다(bare
  // sggName엔 시도가 없어 nz.district만으론 시도 복원 불가). 다른 regime(legacy/Option-A)은 자기 district 규칙을
  // raw 값에 그대로 적용한다(베이스라인 충실 보존). 키가 비면 raw 값으로 fallback.
  const necDistrict =
    nz.useNecDistrictMatchKey && nec.districtMatchKey && nec.districtMatchKey !== ""
      ? nec.districtMatchKey
      : firstValue(nec.district, nz.district);
  const oaParty = firstValue(oa.party, nz.party);
  const oaDistrict = firstValue(oa.district, nz.district);

  const partyMatch = necParty !== null && oaParty !== null && oaParty === necParty;
  const districtMatch = necDistrict !== null && oaDistrict !== null && oaDistrict === necDistrict;

  return partyMatch || districtMatch;
}

export function mergeNecIntoProfiles(
  openAssemblyProfiles: PoliticianProfile[],
  necProfiles: NecMappedProfile[],
  normalizer: MatchNormalizer = NEC_MATCH_NORMALIZER_SIDO_AWARE,
): NecMergeResult {
  // 합류 대상 인덱스별로 모을 NEC evidence를 미리 계산한다(입력 불변 유지를 위해).
  const additions = new Map<number, { party: EvidenceValue<string>[]; district: EvidenceValue<string>[] }>();
  const unmatched: NecMappedProfile[] = [];
  const ambiguous: NecMappedProfile[] = [];

  for (const nec of necProfiles) {
    const matchedIndexes: number[] = [];
    openAssemblyProfiles.forEach((oa, index) => {
      if (isCandidateMatch(oa, nec, normalizer)) matchedIndexes.push(index);
    });

    if (matchedIndexes.length === 0) {
      unmatched.push(nec); // no-match: 조용히 버리지 않음.
      continue;
    }
    if (matchedIndexes.length > 1) {
      ambiguous.push(nec); // multi-match: 모호 → 합류 안 함(잘못된 합류 금지).
      continue;
    }

    const index = matchedIndexes[0]!;
    const bucket = additions.get(index) ?? { party: [], district: [] };
    // 병합·선택하지 않는다 — 나란히 추가만 한다(불변 #4).
    bucket.party.push(...nec.party);
    bucket.district.push(...nec.district);
    additions.set(index, bucket);
  }

  const profiles = openAssemblyProfiles.map((profile, index) => {
    const addition = additions.get(index);
    if (!addition) return profile;
    return {
      ...profile,
      party: [...profile.party, ...addition.party],
      district: [...profile.district, ...addition.district],
    };
  });

  return { profiles, unmatched, ambiguous };
}
