/**
 * NEC ↔ Open Assembly **matching-only** normalization (불변 #4 안전판).
 *
 * 목적: 두 출처의 값이 *비교 목적상* 같은지 판단하기 위한 **canonical key**만 만든다.
 * 절대 하지 않는 것:
 *   - 원본 per-source 값을 덮어쓰지 않는다(raw는 EvidenceValue.value/rawText에 그대로 보존, 별도 인용 가능).
 *   - 두 출처를 병합·선택·억제하지 않는다. 정규화는 *매칭/비교*에만 쓰이고, 표면화되는 evidence는 raw다.
 *
 * 따라서 정규화가 **진짜 다른 값을 같은 키로 무너뜨리면**(예: 진짜 당적 변경을 표기차로 흡수) 그건
 * "지어낸 일치"이자 "사라진 불일치"다(불변 #1·#4 위반). 그런 위험이 있는 규칙은 포함하지 않고
 * ASSUMPTION으로 표시해 사람 검토로 올린다(아래 각 규칙 주석 참조).
 *
 * 모든 규칙은 **실 라이브 데이터(2026-06-14 dry-run)에서 관측된 차이**로만 동기화된다.
 * 관측되지 않은 가상의 변형을 위해 규칙을 넓히지 않는다(과대 정규화 = conflict 은폐 위험).
 */

/** 공통: 유니코드 정규화(NFC) + 트림 + 내부 공백 1칸. 표기상 동일성 비교의 최소 베이스. */
function baseNormalize(value: string): string {
  return value.normalize("NFC").trim().replace(/\s+/g, " ");
}

/**
 * 이름 정규화(매칭 전용, name은 NEC evidence로 절대 emit되지 않음).
 *
 * 관측된 차이(라이브): 한글 이름은 OA(HG_NM)·NEC(name) 모두 공백 없는 한글로 동일 표기였다.
 * NEC에 `hanjaName`(한자)이 별도로 있으나 매퍼는 `name`(한글)만 읽으므로 한자/한글 혼선은 비교에 들어오지 않는다.
 * → 규칙: 모든 공백 제거 + 소문자화 + NFC. (한글엔 무영향이나 방어적.)
 *
 * 포함하지 않은 규칙: 한자↔한글 음역 매핑(판단 의존 — 동명이인을 잘못 합칠 위험). 필요 시 ASSUMPTION으로 별도 검토.
 */
export function normalizeNameForMatch(value: string | null | undefined): string {
  if (!value) return "";
  return baseNormalize(value).toLowerCase().replace(/\s+/g, "");
}

/**
 * 정당명 정규화(매칭/비교 전용). raw 값은 보존 — 이 키는 isSameParty 판단에만 쓴다.
 *
 * 관측된 차이(라이브 2026-06-14, 아래 RULE-MOTIVATING EXAMPLES 표 참조):
 *   - 내부/주변 공백 차이만 있는 동일 정당명. (예: "OO 당" vs "OO당")
 *   - 그 외 표기차는 라이브에서 관측되지 않았다(약칭/전체명 혼용 등은 발견 시 규칙 추가).
 *
 * 포함하지 않은 규칙(의도적): 약칭↔정식명칭 사전(예: "민주" → "더불어민주당"). 이런 매핑은
 *   (1) 라이브에서 필요로 관측되지 않았고 (2) 잘못 매핑하면 진짜 당적 차이를 표기차로 흡수해
 *   content_conflict를 은폐할 수 있다(불변 #4). 관측되면 ASSUMPTION으로 사람 검토에 올린다.
 */
export function normalizePartyForMatch(value: string | null | undefined): string {
  if (!value) return "";
  // 공백·NFC만 정규화. 글자 자체는 바꾸지 않는다(진짜 당명 차이를 보존).
  return baseNormalize(value).replace(/\s+/g, "");
}

/**
 * 시도(광역시·도) **정식 명칭 ↔ 단축 토큰** canonical 매핑. 닫힌 집합(17개 행정구역 상수)이라 판단 의존이
 * 아니다 — 약칭 사전과 달리 새 항목이 생기지 않고, 진짜 차이를 흡수할 위험이 없다.
 *
 * 발견(라이브 2026-06-14): 두 출처가 시도를 **다른 형태**로 쓴다 →
 *   - OA `ORIG_NM` 접두: 단축형 "인천", "서울", "경기", "강원", "전북" …
 *   - NEC `sdName`:      정식형 "인천광역시", "서울특별시", "경기도", "강원특별자치도", "전북특별자치도" …
 * 따라서 단순 결합(sdName+sggName)은 OA와 안 맞는다(naive Option B 실패 → matched 233로 *감소*). 양쪽을
 * 이 표로 **canonical 단축 토큰**으로 환원해야 비로소 같은 키가 된다.
 */
export const KR_SIDO_CANONICAL: { readonly full: string; readonly short: string }[] = [
  { full: "서울특별시", short: "서울" },
  { full: "부산광역시", short: "부산" },
  { full: "대구광역시", short: "대구" },
  { full: "인천광역시", short: "인천" },
  { full: "광주광역시", short: "광주" },
  { full: "대전광역시", short: "대전" },
  { full: "울산광역시", short: "울산" },
  { full: "세종특별자치시", short: "세종" },
  { full: "경기도", short: "경기" },
  { full: "강원특별자치도", short: "강원" },
  { full: "충청북도", short: "충북" },
  { full: "충청남도", short: "충남" },
  { full: "전북특별자치도", short: "전북" },
  { full: "전라남도", short: "전남" },
  { full: "경상북도", short: "경북" },
  { full: "경상남도", short: "경남" },
  { full: "제주특별자치도", short: "제주" },
];

/** 단축 토큰들(긴 것부터, 접두 매칭 안정성용). */
const KR_SIDO_SHORT_TOKENS = KR_SIDO_CANONICAL.map((s) => s.short);

/** 정식형 또는 단축형 시도 문자열 → canonical 단축 토큰("인천광역시"|"인천" → "인천"). 없으면 빈 문자열. */
export function canonicalSido(value: string | null | undefined): string {
  if (!value) return "";
  const v = baseNormalize(value);
  const byFull = KR_SIDO_CANONICAL.find((s) => s.full === v);
  if (byFull) return byFull.short;
  const byShort = KR_SIDO_CANONICAL.find((s) => s.short === v);
  if (byShort) return byShort.short;
  return "";
}

/**
 * ✅ 선거구명 정규화 — **시도 canonical 인지, 권장 규칙**. 라이브 2026-06-14에서 충돌 0건.
 *
 * 동작:
 *  - OA `ORIG_NM`(예 "인천 서구갑"): 선행 단축 시도 토큰을 분리해 canonical 단축형으로 두고, 나머지를 선거구명으로.
 *    단 "세종특별자치시갑"처럼 시도 뒤에 공백이 없으면 분리하지 않는다(선거구명 자체일 수 있음 → 세종은 sido='세종').
 *  - NEC: `sggName`(예 "서구갑")만으로는 시도가 없으므로 호출부가 `sdName`(정식형 "인천광역시")을 sido 인자로 준다.
 *
 * 두 입력 모두 결과 키 = `{canonical 단축 시도}{선거구명}`(공백 제거). "인천광역시"+"서구갑" = "인천서구갑" =
 * OA "인천 서구갑". "대전 서구갑"은 "대전서구갑"으로 분리 보존 → 충돌 없음(불변 #4).
 *
 * 불변 #1: 이 함수는 **비교 키만** 만든다. emit되는 evidence는 각 출처 raw 그대로다. sdName을 *매칭에 읽는* 것은
 * 사실 생성이 아니다(공개 지리 식별자). 단 emit되는 NEC district를 bare sggName→full로 바꿀지는 별도 사람 결정.
 */
export function normalizeDistrictForMatchSidoAware(
  district: string | null | undefined,
  sido?: string | null,
): string {
  if (!district) return "";
  const base = baseNormalize(district);

  // 1) 선행 시도가 **정식형**으로 접두 + 공백된 경우(예 "인천광역시 서구갑") → canonical 단축형으로 환원.
  for (const { full, short } of KR_SIDO_CANONICAL) {
    if (base.startsWith(`${full} `)) {
      return `${short}${base.slice(full.length + 1)}`.replace(/\s+/g, "");
    }
  }
  // 2) 선행 시도가 **단축형**으로 접두 + 공백된 경우(OA "인천 서구갑"). 공백 필수(세종 보호).
  for (const short of KR_SIDO_SHORT_TOKENS) {
    if (base.startsWith(`${short} `)) {
      return `${short}${base.slice(short.length + 1)}`.replace(/\s+/g, "");
    }
  }
  // 3) 세종 등 **시도명이 선거구명에 내장된** 경우(예 OA·NEC 둘 다 "세종특별자치시갑", 공백 없음): 시도가 이미
  //    값 안에 있으므로 sido를 다시 붙이면 "세종세종…"으로 중복돼 진짜 일치를 깨고 conflict를 숨긴다(불변 #4).
  //    → 값이 이미 어떤 시도(정식/단축)로 시작하면 sido를 붙이지 않는다.
  const startsWithAnySido = KR_SIDO_CANONICAL.some((s) => base.startsWith(s.full) || base.startsWith(s.short));
  if (startsWithAnySido) {
    // 내장된 정식형 시도는 단축형으로 환원해 양쪽(정식/단축 내장) 표기를 같은 키로 맞춘다.
    for (const { full, short } of KR_SIDO_CANONICAL) {
      if (base.startsWith(full)) return `${short}${base.slice(full.length)}`.replace(/\s+/g, "");
    }
    return base.replace(/\s+/g, "");
  }
  // 4) 접두 시도가 전혀 없으면(NEC bare sggName 경로) sido 인자를 canonical 단축형으로 환원해 앞에 붙인다.
  const sd = canonicalSido(sido);
  return `${sd}${base}`.replace(/\s+/g, "");
}

/**
 * ⚠️ 선거구명 정규화 — **선거구명만(시도 제거), 측정 전용/단독 사용 금지**. 라이브 2026-06-14에서 6개 충돌.
 *
 * 시도를 제거하면 서로 다른 시의 같은 선거구명이 한 키로 무너진다("서구갑" ← 인천/대전/광주). NEC `sggName`은
 * 시도를 전혀 담지 않으므로 이 키 단독으로는 동명이인 false-match 잠재 위험이 있다 → 권장 규칙은 위 sido-aware.
 * 이 함수는 내부 dry-run에서 Option A 효과를 재현하기 위해서만 남겨둔다.
 */
export function normalizeDistrictForMatch(value: string | null | undefined): string {
  if (!value) return "";
  let base = baseNormalize(value);
  for (const short of KR_SIDO_SHORT_TOKENS) {
    if (base.startsWith(`${short} `)) {
      base = base.slice(short.length + 1);
      break;
    }
  }
  return base.replace(/\s+/g, "");
}

/** 정규화 키 기준 동일성(둘 다 비어있지 않고 키가 같을 때만 true). */
export function sameNormalizedKey(a: string | null | undefined, b: string | null | undefined): boolean {
  if (a == null || b == null) return false;
  return a !== "" && b !== "" && a === b;
}
