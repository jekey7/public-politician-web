import type { EvidenceValue, PoliticianProfile } from "../types";
import type { NecMappedProfile } from "./nec";
import type { NecMergeResult } from "./nec-merge";
import { normalizeNameForMatch } from "./nec-normalize";

/**
 * NEC 교차검증 **커버리지 분류**(사람 결정 2, 2026-06-14): 지역구 당선인만(sgTypecode=2, 254명) 범위.
 *
 * 비례대표(46석)는 NEC 지역구 당선인 API에 **애초에 레코드가 없을 수밖에 없다** → 이는 매칭 실패가 아니라
 * **의도된 범위 밖(out-of-scope-for-this-source)**이다. 따라서 현직 OA 멤버를 다음으로 분류한다:
 *
 *   - matched: NEC 지역구 당선인과 합류된 OA 멤버(party/district에 nec 출처가 추가됨).
 *   - genuineUnmatched: NEC 레코드를 *가질 수 있었는데*(지역구 의원) 매칭되지 않은 OA 멤버 — 진짜 미매칭.
 *   - outOfScope: 비례대표 OA 멤버 — NEC 지역구 레코드가 존재할 수 없음. 버그/갭 아님(불변 #3: 모르면 모른다가
 *     아니라, *이 출처의 범위가 아님*을 명시적으로 라벨링).
 *
 * NEC-side 결과(ambiguous, content_conflict)는 mergeNecIntoProfiles/detector가 별도로 보고한다 —
 * 이 함수는 **OA 로스터 커버리지**만 분류한다. 순수 함수(입력 불변).
 *
 * 비례대표 판정: OA district(ORIG_NM)가 비례대표 표기인지로 본다. 안정 flag 필드가 따로 없어
 * district 표기에 의존한다(ASSUMPTION — 아래 isProportionalDistrict, 실데이터로 표기값 확인 필요).
 */

export interface NecCoverageClassification {
  /** NEC 지역구 당선인과 합류된 OA 멤버 수. */
  matched: number;
  /** 지역구 의원인데 NEC와 매칭되지 않은 OA 멤버(진짜 미매칭 — 조사 대상). */
  genuineUnmatched: number;
  /** 비례대표 OA 멤버(이 출처 범위 밖 — 버그 아님). */
  outOfScope: number;
  /**
   * 동명이인+동일정당 쌍둥이라 모호하게 보류된(withheld) OA 멤버 수(DECISION 2/ADR-7, 2026-06-14).
   * 안정 join key가 없어 NEC 교차검증을 **정직하게 보류**한 케이스. genuine-unmatched와 **분리** 집계한다
   * (불변 #3: 모르면 모른다 — 조용히 누락하지 않고 명시 라벨). 강제 해소·새 PII 도입 금지(불변 #7).
   */
  ambiguousWithheld: number;
  /** 분류 대상 총 OA 멤버 수(= matched + genuineUnmatched + outOfScope + ambiguousWithheld). */
  totalOaMembers: number;
  /** out-of-scope로 분류된 비례대표 OA displayName 목록(검수/투명성용, PII 아님 — 공개 신원). */
  outOfScopeMembers: string[];
  /** genuine-unmatched OA displayName 목록(조사용). */
  genuineUnmatchedMembers: string[];
  /** ambiguous-withheld OA displayName 목록("동명이인 — 식별 불가, NEC 교차검증 보류"로 표시할 대상). */
  ambiguousWithheldMembers: string[];
}

/** ambiguous-withheld 멤버에 붙일 표준 사유 문구(공개 표시용 — 불변 #3). */
export const NEC_AMBIGUOUS_WITHHELD_REASON = "동명이인 — 식별 불가, NEC 교차검증 보류";

/**
 * OA district 값이 비례대표 표기인지. Open Assembly `ORIG_NM`은 비례대표 의원에 "비례대표"를 담는다(표준 표기).
 * 방어적으로 "비례" 포함도 본다(예: "비례대표"). 지역구 표기(예: "서울 종로구")는 false.
 */
export function isProportionalDistrict(district: string | null | undefined): boolean {
  if (!district) return false;
  return district.replace(/\s+/g, "").includes("비례대표") || district.replace(/\s+/g, "").includes("비례");
}

function firstDistrict(evidences: EvidenceValue<string>[]): string | null {
  for (const e of evidences) {
    if (e.value?.trim()) return e.value.trim();
  }
  return null;
}

/** 합류된 멤버(=NEC 출처가 party 또는 district 배열에 들어온 OA 멤버)인지. */
function hasNecSource(profile: PoliticianProfile): boolean {
  return [...profile.party, ...profile.district].some((e) => e.source.sourceKind === "nec");
}

/**
 * 합류 결과(mergeNecIntoProfiles 산출 profiles)와 원본 OA 로스터를 받아 커버리지를 분류한다.
 * `mergedProfiles`는 NEC 출처가 합류된 profiles(merge.profiles), `oaRoster`는 합류 전 동일 순서/길이 로스터.
 *
 * `ambiguousNec`(선택, merge.ambiguous): 동명이인+동일정당이라 합류 보류된 NEC profile들. 이들의 이름과 같은
 * 지역구 OA 멤버는 genuine-unmatched가 아니라 **ambiguous-withheld**로 분리 분류한다(DECISION 2/ADR-7).
 * 생략하면(legacy 호출) 종전처럼 그 쌍둥이는 genuine-unmatched로 떨어진다(하위호환).
 */
export function classifyNecCoverage(
  mergedProfiles: PoliticianProfile[],
  oaRoster: PoliticianProfile[],
  ambiguousNec: NecMappedProfile[] = [],
): NecCoverageClassification {
  // ambiguous NEC profile들과 **이름이 같은** 지역구 OA 멤버를 ambiguous-withheld 후보로 표시한다.
  // (이름+정당이 같은 쌍둥이라 안정 join key 없이는 어느 쪽인지 식별 불가 → 보류. 강제 해소·새 PII 금지.)
  const ambiguousNameKeys = new Set(ambiguousNec.map((n) => normalizeNameForMatch(n.displayName)));

  const outOfScopeMembers: string[] = [];
  const genuineUnmatchedMembers: string[] = [];
  const ambiguousWithheldMembers: string[] = [];
  let matched = 0;

  mergedProfiles.forEach((merged, index) => {
    // 비례대표 판정은 합류 전 OA district로 한다(NEC district가 끼어들기 전 원본 신원 사실).
    const roster = oaRoster[index] ?? merged;
    const isProportional = isProportionalDistrict(firstDistrict(roster.district));

    if (hasNecSource(merged)) {
      matched += 1;
      return;
    }
    if (isProportional) {
      outOfScopeMembers.push(merged.displayName); // 비례대표 → 이 출처 범위 밖(미매칭 아님).
      return;
    }
    // 동명이인 보류(ambiguous-withheld): NEC 측이 모호로 보류한 이름과 같은 지역구 멤버 → 정직하게 보류 표시.
    if (ambiguousNameKeys.has(normalizeNameForMatch(merged.displayName))) {
      ambiguousWithheldMembers.push(merged.displayName);
      return;
    }
    genuineUnmatchedMembers.push(merged.displayName); // 지역구인데 매칭 안 됨 → 진짜 미매칭.
  });

  return {
    matched,
    genuineUnmatched: genuineUnmatchedMembers.length,
    outOfScope: outOfScopeMembers.length,
    ambiguousWithheld: ambiguousWithheldMembers.length,
    totalOaMembers: mergedProfiles.length,
    outOfScopeMembers,
    genuineUnmatchedMembers,
    ambiguousWithheldMembers,
  };
}

/**
 * `classifyNecCoverage`와 **동일한 규칙**으로 멤버별 커버리지 상태를 산출한다(carrier 사이드카 생성용).
 *
 * 반환은 `politicianId → status`다. 단, carrier가 필요한 두 상태만 담는다:
 *   - `ambiguous_withheld`: 동명이인 보류(불변 #3). 표준 사유 `NEC_AMBIGUOUS_WITHHELD_REASON`.
 *   - `out_of_scope`: 비례대표(이 출처 범위 밖).
 * matched / genuine-unmatched는 carrier가 없으므로 맵에 넣지 않는다(라벨을 지어내지 않는다 — 부재 = 없음).
 *
 * 카운트 함수(classifyNecCoverage)와 분기 조건을 1:1로 맞춰 두 산출물이 어긋나지 않게 한다(단일 진실).
 * 순수 함수(입력 불변). 강제 해소·새 PII 도입 금지(불변 #7).
 */
export function classifyNecCoveragePerProfile(
  mergedProfiles: PoliticianProfile[],
  oaRoster: PoliticianProfile[],
  ambiguousNec: NecMappedProfile[] = [],
): Record<string, { status: "ambiguous_withheld" | "out_of_scope"; reason: string }> {
  const ambiguousNameKeys = new Set(ambiguousNec.map((n) => normalizeNameForMatch(n.displayName)));
  const out: Record<string, { status: "ambiguous_withheld" | "out_of_scope"; reason: string }> = {};

  mergedProfiles.forEach((merged, index) => {
    if (hasNecSource(merged)) return; // matched — carrier 불필요.

    const roster = oaRoster[index] ?? merged;
    const isProportional = isProportionalDistrict(firstDistrict(roster.district));
    if (isProportional) {
      out[merged.politicianId] = { status: "out_of_scope", reason: NEC_OUT_OF_SCOPE_REASON };
      return;
    }
    if (ambiguousNameKeys.has(normalizeNameForMatch(merged.displayName))) {
      out[merged.politicianId] = { status: "ambiguous_withheld", reason: NEC_AMBIGUOUS_WITHHELD_REASON };
      return;
    }
    // genuine-unmatched — carrier 없음(NEC 사실 부재로 자연히 "자료 없음"이 됨).
  });

  return out;
}

/** out-of-scope(비례대표) 멤버에 붙일 표준 사유 문구(공개 표시용 — 미매칭/버그 아님, 출처 범위 밖). */
export const NEC_OUT_OF_SCOPE_REASON = "비례대표 — NEC 지역구 당선인 출처 범위 밖";

/** merge의 NEC-side 결과(ambiguous/unmatched NEC records)는 그대로 보고용으로 노출. */
export type { NecMergeResult, NecMappedProfile };
