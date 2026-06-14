import type { NecRecord } from "./nec";

/**
 * NEC mock fixtures (실 fetch 잠금 상태에서 collector/mapper/매칭/탐지를 구동).
 *
 * 값은 모두 가상이며, mock-data.ts의 Open Assembly mock 멤버(displayName/party/district)와
 * 매칭되도록 맞춰져 있다. 두 가지 경우를 반드시 포함한다:
 *   (a) 합의(agree): NEC가 party+district 모두 Open Assembly와 일치 → conflict 없음.
 *   (b) 당적 변경(switcher): NEC party가 Open Assembly와 다름(지역구는 같아 매칭됨)
 *       → party가 content_conflict로 surface(두 출처 모두 인용). 선거일 시점 vs 현재의 정당 차이.
 *
 * fetchedAt/sourceUrl/licenseNote는 mock 표시를 단다(공개 라이선스 게이트가 nec를 계속 reject).
 */
const NEC_MOCK_FETCHED_AT = "2024-04-10T00:00:00.000Z"; // 선거일 시점 스냅샷임을 드러냄
const NEC_MOCK_SOURCE_URL =
  "https://example.invalid/mock/nec/ElecInfoInqireService/getWinnerInfoInqire?sgId=20240410&sgTypecode=2";
const NEC_MOCK_LICENSE_NOTE = "MOCK DATA ONLY - NEC fixture; real license pending human review (nec)";

function mockRow(raw: Record<string, unknown>, dataset: NecRecord["dataset"] = "winner"): NecRecord {
  return {
    source: "nec",
    dataset,
    raw,
    fetchedAt: NEC_MOCK_FETCHED_AT,
    sourceUrl: NEC_MOCK_SOURCE_URL,
    licenseNote: NEC_MOCK_LICENSE_NOTE,
  };
}

/**
 * Open Assembly mock 멤버(mock-data.ts)에 대응하는 NEC mock 당선인 행.
 * - 김공개 / 서울 목구갑: party=가상정당(OA와 동일), district 동일 → (a) 합의 케이스.
 * - 이투명 / 부산 예시구을: NEC party=다른정당(OA의 "샘플정당"과 다름), district 동일
 *   → (b) switcher: 지역구로 매칭되고 party는 content_conflict로 드러난다.
 * raw에는 NEC가 실제로 주는 PII 필드도 일부러 넣어, 매퍼가 그것들을 **버리는지** 테스트로 검증한다.
 */
export function mockNecRecords(): NecRecord[] {
  return [
    mockRow({
      num: 1,
      name: "김공개",
      jdName: "가상정당", // OA와 동일 → 합의
      sggName: "서울 목구갑", // OA와 동일
      // 아래는 NEC가 주지만 매퍼가 버려야 하는 PII(값은 가상):
      birthday: "19780101",
      gender: "여",
      edu: "한국공개대학교 정치외교학과 졸업",
      career1: "전 공개시민연대 대표",
      job: "정치인",
      addr: "서울특별시 목구 가상로 1",
    }),
    mockRow({
      num: 2,
      name: "이투명",
      jdName: "다른정당", // OA는 "샘플정당" → switcher (선거 후 당적 변경) → content_conflict
      sggName: "부산 예시구을", // OA와 동일 → 지역구로 매칭
      birthday: "19820505",
      gender: "남",
      edu: "샘플대학교 법학과 졸업",
      career2: "전 예시구의회 의원",
      job: "변호사",
      addr: "부산광역시 예시구 샘플대로 2",
    }),
  ];
}
