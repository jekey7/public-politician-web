# NEC source review

## Review metadata

- source_kind: nec
- status: approved
- publish_snapshot_allowed: true
- source_terms_url: https://www.data.go.kr/data/15000864/openapi.do
- source_copyright_url: https://www.data.go.kr/ugs/selectPortalPolicyView.do
- service_name: 중앙선거관리위원회_당선인 정보 조회 서비스 (WinnerInfoInqireService2)
- operation: getWinnerInfoInqire
- provider: 중앙선거관리위원회 (National Election Commission)
- dataset_id: 15000864
- service_url: http://apis.data.go.kr/9760000/WinnerInfoInqireService2/getWinnerInfoInqire
- service_url_correction_note: 이전 기록 `…/ElecInfoInqireService`는 라이브에서 동작하지 않는 잘못된 경로였다. 2026-06-14 라이브 검증으로 `WinnerInfoInqireService2/getWinnerInfoInqire`가 정상(INFO-00, 254행)임을 확인하고 사람 승인으로 정정(아래 ADR-3).
- license_type: 이용허락범위 "제한 없음" (no usage restriction) — CC BY보다 관대, 프로젝트 오픈소스 데이터 전제와 호환(불변 #8)
- license_note_to_use: 출처: 중앙선거관리위원회, 당선인 정보 조회 서비스 (이용허락범위 제한 없음), https://www.data.go.kr/data/15000864/openapi.do
- reviewed_at: 2026-06-13
- reviewer: human owner (project owner, §0.7 publishability judgment)
- investigated_by: Claude (second-source investigation pass + mock collector implementation)
- investigated_at: 2026-06-13

> 이 status(`approved`)는 **사람(프로젝트 오너)** 이 2026-06-13에 §0.7 공개가능성 판단으로 직접 결정한 것이며,
> dataset `15000864`(당선인 정보 조회 서비스)에**만** 적용된다. 에이전트는 라이선스 status를 스스로 승인하지
> 않는다(불변 §0). 본 문서는 사람이 이미 내린 결정을 *기록·반영*한다.
>
> **승인 ≠ 공개 go-live.** 라이선스 게이트만 열렸을 뿐, 실 NEC 수집은 별도 사람 go/no-go로 잠겨 있다
> (`NEC_COLLECTOR` OFF, `PUBLIC_PIPELINE_COLLECTOR` OFF). 공개 출력은 여전히 100% mock이며 이번 변경으로
> 공개 사실/출처/불일치는 **하나도 바뀌지 않았다**(open_assembly 승인 때와 동일 패턴).

## Human approval decision (2026-06-13)

**Decision: APPROVED for public release (license-wise).**

- **Decided by:** human owner (project owner), exercising the §0.7 publishability judgment. This is the
  human gate that agents are **forbidden to self-approve** (CLAUDE.md Chapter 0). This document records a
  decision the human already made; no agent re-derived or re-judged the license.
- **Decision date:** 2026-06-13.
- **Basis (verified by the human on the portal):** the data.go.kr dataset page for `15000864` shows
  **이용허락범위 = "제한 없음"** (no usage restriction), confirmed directly on the portal by the owner. This is
  **more permissive than CC BY** and is compatible with the project's open-source data premise (불변 #8).
- **Attribution (project policy):** even though the label is "제한 없음", source attribution is kept as a
  project rule. Every NEC fact already carries SourceMeta (`source_org=중앙선거관리위원회`, `source_url`,
  `fetched_at`); the OUTPUT-ready note is `license_note_to_use` above and lives in `.env` as `NEC_LICENSE_NOTE`.
- **Scope of this approval:** ONLY the single NEC dataset `15000864` (당선인 정보 조회 서비스). It does **not**
  approve any other NEC dataset (e.g. 후보자 `15000908`), nor any other pending source (`public_data_portal`,
  `rokps`, `news_search`, `rss`, `manual_review`) — those remain `pending_review`.

> Note — approval does NOT enable real-data collection by itself. The public snapshot stays on the mock
> collector (`PUBLIC_PIPELINE_COLLECTOR` off, `NEC_COLLECTOR` off) until enabling real NEC collection is a
> separate explicit human step.

## Why this source (cross-verification rationale)

이 프로젝트의 핵심 차별점은 **출처 간 불일치 표면화**(불변 #4)다. 그러려면 Open Assembly가 매핑하는
필드와 **겹치는 값을 독립적으로 제공**하는 두 번째 출처가 필요하다(추가 필드가 아니라 *겹치는* 필드).

중앙선거관리위원회 당선인 정보 API가 두 번째 collector 후보로 선정된 근거:

1. **독립성** — 제공기관이 **중앙선거관리위원회**로, Open Assembly(국회사무처)와 **다른 기관**이다.
   공공데이터포털의 `국회 국회사무처_*` API들(예: `15126020` 역대 국회의원 현황, `15126133` 통합 API)은
   제공기관이 국회사무처로 Open Assembly와 **동일**하여 사실상 같은 원천의 미러다 → 독립 교차검증이 안 된다.
2. **현직 의원 커버리지** — 당선인 API는 제22대 국회의원선거(`sgId=20240410`, `sgTypecode=2`)의 **당선자**를
   제공한다. 즉 현재 의석을 가진 의원과 직접 대응된다(헌정회/rokps는 *역대(former)* 의원만 다뤄 현직과 겹치지 않음).
3. **필드 중첩(overlap)** — 아래 표 참조. party/district는 직접 중첩, education/career는 Open Assembly의
   향후 의정활동 매퍼와 중첩 예정. 이는 비교 가능한 값을 제공하는 후보다.

## Implemented scope (2026-06-13, this iteration — MOCK mode, license still pending)

두 번째 collector를 **mock 모드**로 구현했다. 실 fetch와 라이선스 게이트는 **잠겨 있다**(사람 승인 전).

- **Collector**: `src/lib/collectors/nec.ts` — `NecCollector`(Open Assembly collector와 동일 인터페이스).
  실 endpoint shape(서비스 경로·`sgId=20240410`·`sgTypecode=2`·`serviceKey`·페이지)를 상수+TODO로 인코딩하되,
  실 fetch는 OFF 스위치(`NEC_COLLECTOR`, 기본 `off`) 뒤에 잠금. ServiceKey는 `NEC_API_KEY` env-only.
- **두 데이터셋 배선**: 당선인(`15000864`, `dataset="winner"`) primary + 후보자(`15000908`,
  `dataset="candidate"`) auxiliary — 동일 매퍼를 통과하고 출처 식별자(`nec-<dataset>-…`)에 반영(아래 ADR-2).
- **매퍼 범위 = identity-only(party, district 둘뿐)**: `mapNecRecord`. PII(birthday/gender/edu/career/
  job/addr/age)는 **읽지 않고 버린다**(`NEC_DROPPED_PII_FIELDS`, 불변 #7). 각 값은 NEC SourceMeta
  (`source_org=중앙선거관리위원회`, `source_url`, `fetched_at`) 동반(불변 #2).
- **엔티티 매칭(사람 승인)**: `src/lib/collectors/nec-merge.ts` — 이름+정당+지역구로 같은 OA 멤버에 합류.
  no-match/multi-match 처리는 아래 ADR-1.
- **교차검증 활성화**: `src/lib/collectors/nec-pipeline.ts`의 dry-run으로 collector→매퍼→매칭→탐지를 묶어
  party/district가 2-출처가 되고, 당적 변경자(switcher)의 party가 `content_conflict`로 두 출처를 인용하며
  surface됨을 증명(테스트 `tests/nec-collector.test.ts`). **공개 출력은 mock 그대로(byte-identical)**.
- **공개 차단 유지(승인 후에도)**: 라이선스 게이트는 이제 nec(`approved`)를 *허용*하지만, 공개 go-live는
  여전히 별도 잠금이다 — `PUBLIC_PIPELINE_COLLECTOR` OFF + `NEC_COLLECTOR` OFF로 실 fetch가 꺼져 있어 공개
  스냅샷에 nec 행 자체가 들어가지 않는다. dry-run은 내부 전용이며 `public/`에 쓰지 않는다(불변 #5/#8).

## ADR-1 (2026-06-13): NEC↔Open Assembly 엔티티 매칭 방식 = 이름 + 정당 + 지역구

- **맥락**: NEC는 Open Assembly의 `MONA_CD`에 대응하는 안정 join key를 제공하지 않는다. 사람이 승인한
  매칭 근거는 (이름, 정당, 지역구) 조합이며 오매칭 리스크 수용 범위도 사람이 승인했다.
- **결정**: 이름 일치 + (정당 또는 지역구 중 **하나 이상** 일치)인 OA profile을 후보로 본다. 정당 또는
  지역구 중 하나만 요구하는 이유: **당적 변경자**(party 갈림)도 지역구로 매칭되어 conflict가 *매칭 실패로
  숨지 않게* 하기 위함이다(불변 #4: 불일치는 드러나야 한다).
- **모호성 처리(잘못된 합류 금지)**:
  - 후보 0개(**no-match**): 합류하지 않고 `unmatched`로 반환(조용한 삭제 금지, 불변 #1).
  - 후보 2개 이상(**multi-match**, 동명이인 등): 합류하지 않고 `ambiguous`로 반환(잘못된 사람에 붙이느니
    붙이지 않는다, 불변 #3).
  - 후보 정확히 1개(**unique-match**): 그 멤버의 party/district 배열에 NEC evidence를 **나란히 추가**.
    값이 같든 다르든 추가하며 병합·선택·억제하지 않는다(불변 #4). discrepancy 재탐지는 파이프라인이 한다.

## ADR-2 (2026-06-13): 두 데이터셋(당선인 15000864 + 후보자 15000908) 동시 배선

- **맥락**: 사람이 두 데이터셋을 모두 쓰기로 결정. 당선인은 현직 의원과 가장 정확히 대응, 후보자는 보조.
- **결정**: 둘 다 동일 `NecCollector`/`mapNecRecord`를 통과시키되 `dataset` 태그(`winner`/`candidate`)를
  달아 출처 식별자(`nec-winner-…` / `nec-candidate-…`)와 추적성을 구분한다. 두 데이터셋은 같은 성질(선거
  공개정보)이라 데이터 성격 분리(불변 #5)를 위반하지 않는다. 당선인을 primary로, 후보자를 보조로 둔다.

## ADR-3 (2026-06-14): 서비스 경로 상수 정정 — WinnerInfoInqireService2/getWinnerInfoInqire (사람 승인)

- **맥락**: 라이브 dry-run에서 `WinnerInfoInqireService2/getWinnerInfoInqire`가 정상 응답(`resultCode=INFO-00`,
  `totalCount=254` 지역구 당선인)했다. 그러나 `src/lib/collectors/nec.ts`의 `NEC_WINNER_SERVICE_PATH` 상수와
  이 문서의 `service_url`은 잘못된 `ElecInfoInqireService/getWinnerInfoInqire`로 기록돼 있었다(라이브에서 동작 안 함).
- **결정(사람 승인된 버그 수정)**: 상수를 라이브 검증된 경로로 정정한다.
  - service = **WinnerInfoInqireService2**, operation = **getWinnerInfoInqire**, dataset = **data.go.kr 15000864**.
  - `NEC_WINNER_SERVICE_PATH = "WinnerInfoInqireService2/getWinnerInfoInqire"`.
- **라이선스 범위 재확인(불변 §0.7)**: 2026-06-13 사람 라이선스 승인 텍스트는 **dataset `15000864`("당선인 정보
  조회 서비스")** 를 명시했고, `ElecInfoInqireService`라는 *특정 서비스 문자열*을 승인 근거로 든 적이 없다(문서
  `service_name`은 처음부터 `WinnerInfoInqireService2`였고, `ElecInfoInqireService`는 URL 칸에만 잘못 적힌 기록
  오류였다). 승인이 **dataset을 지칭**했으므로 operation 경로 정정은 **승인 범위 안의 버그 수정**이다 —
  라이선스 재확인 항목이 아니다. (만약 승인이 `ElecInfoInqireService`를 *특정해* 승인했다면 재확인 항목으로
  올렸겠지만, 그렇지 않다.) 에이전트는 라이선스를 스스로 재승인하지 않으며, 본 ADR은 dataset 범위 내 정정만 기록한다.
- **mock URL 표시**: `nec-mock.ts`의 mock sourceUrl 문자열(`…/ElecInfoInqireService/…`)은 공개 출력에 들어가지
  않는 mock 표식이라 이번 정정 범위 밖이다(공개 byte-identity 유지를 위해 손대지 않음). 실 fetch 경로는 상수로만 결정된다.

## ADR-4 (2026-06-14): NEC 교차검증 범위 = 지역구 당선인만, 비례대표는 의도된 범위 밖 (사람 결정 (a))

- **맥락**: NEC 당선인 API(`sgTypecode=2`)는 **지역구 당선인 254명**만 반환한다. 비례대표 46석은 이 응답에 없다
  (별도 election type). 따라서 현직 300 로스터와 1:1이 아니다.
- **결정**: NEC "second source live"의 운영 범위는 **지역구 당선인 254명**으로 한정한다. 비례대표 46석은
  **이 출처의 의도된 범위 밖(out-of-scope-for-this-source)** 으로 분류한다 — `unmatched`가 아니고, 버그도 아니고,
  메워야 할 갭도 아니다.
- **분류 구현(`src/lib/collectors/nec-coverage.ts`)**: 현직 OA 멤버를 매칭 후 다음으로 분류한다:
  - `matched`: NEC 지역구 당선인과 합류된 OA 멤버.
  - `genuineUnmatched`: 지역구 의원인데(=NEC 레코드를 *가질 수 있었는데*) 매칭 안 된 OA 멤버 — 진짜 미매칭(조사 대상).
  - `outOfScope`: 비례대표 OA 멤버 — NEC 지역구 레코드가 **존재할 수 없음** → 범위 밖으로 명시 라벨.
  `unmatched`는 *NEC 레코드를 가질 수 있었던* 멤버에만 쓴다. 비례대표를 `unmatched`로 세지 않는다.
- **비례대표 판정(ASSUMPTION)**: 전용 flag 필드가 현재 로스터(`nwvrqwxyaytdsfvhu`)에 없어, OA district(`ORIG_NM`)
  표기가 "비례대표"인지로 판정한다(`isProportionalDistrict`). OA가 별도 비례 flag를 제공하면 그 필드로 교체한다.
  필요 필드: 안정적 비례대표 여부 flag(없으면 district 표기 의존을 유지하고 본 ASSUMPTION을 표면화).
- **이번 iteration에서 안 하는 것**: 비례대표 출처를 추가하지 않는다. 아래 backlog 참조.

### Backlog (별도 future iteration — Chapter 1 게이트 통과 필요, 이번에 구현 안 함)

- **[비례대표 교차검증 출처]**: 비례대표 46석을 교차검증하려면 별도 소스/election type(예: 비례대표 당선인
  데이터셋 또는 정당 비례명부)을 Chapter 1 게이트(원칙 적합/분류/영향범위/편입)로 정식 평가해야 한다. 현재는
  의도된 범위 밖으로 둔다. 이 backlog 항목은 *기록만* 하며 구현하지 않는다.

## Field overlap with Open Assembly mapper

현재 Open Assembly mapper(`src/lib/collectors/open-assembly.ts`)가 노출하는 identity 필드와의 중첩:

| 항목 | Open Assembly (현재 매핑) | NEC 당선인 API (출력 필드, 검증 필요) | 중첩 | 교차검증 의미 |
| --- | --- | --- | --- | --- |
| 이름 | `HG_NM` (displayName) | 성명(name) | join key용 | 매칭 키(아래) |
| 정당 | `POLY_NM` → party | 정당명(jdName) | ✅ 직접 중첩 | **핵심 비교 필드** — 단, NEC는 *선거일(2024-04-10) 시점* 값, Open Assembly는 *현재* 값 → 선거 후 당적 변경자는 의도된 `content_conflict`로 표면화(노이즈가 아니라 신호) |
| 지역구 | `ORIG_NM` → district | 선거구명(sggName) | ✅ 직접 중첩 | **핵심 비교 필드** — 비례대표 표기(`비례대표` vs 정당명 비례순번) 정규화 검증 필요 |
| 직(공직) | 상수 `"국회의원"` (roster 소속) | (당선 직위) | △ 간접 | NEC는 "당선" 사실로 국회의원직을 함의 — position 비교는 보조적 |
| committee_role | `JOB_RES_NM` (위원/간사/위원장) | 없음 | ✗ | NEC 미제공 — 비교 대상 아님 |
| 학력 | 미매핑(향후 의정활동 매퍼) | 학력(edu) | ◐ 잠재 중첩 | Open Assembly education 매퍼 확정 시 비교 가능 |
| 경력 | 미매핑(향후 의정활동 매퍼) | 경력1·2(career1/career2) | ◐ 잠재 중첩 | 위와 동일 |
| 생년/성별 | 미매핑 | 생년월일(birthday)·성별(gender) | ◐ 잠재 중첩 | 추가 비교 필드(식별 보강) |

> **중첩 품질 요약:** party·district 두 핵심 identity 필드가 **즉시 교차검증 가능**하고, education·career는
> Open Assembly 의정활동 매퍼가 붙으면 추가로 겹친다. 단일 출처라 비교 불가였던 party/district가 이 출처로
> 처음 2-출처가 되어 `detectProfileDiscrepanciesSync`의 `uniqueSources >= 2` 조건을 실제로 충족시킨다.

## Entity-matching feasibility

- **안정적 공통 join key 없음.** Open Assembly의 `MONA_CD`(또는 `NAAS_CD`)에 대응하는 식별자를 NEC API는
  제공하지 않는다. NEC는 선거 단위(`sgId`)+후보/당선자 식별자 체계를 쓴다.
- 따라서 매칭은 **이름 + 정당 + 지역구** 조합에 의존해야 한다(`MockAiVerifier`/주입된 verifier의
  `matchEntity`가 담당). 동명이인·비례대표·당적 변경 케이스의 매칭 규칙은 실데이터로 검증 필요.
- 이는 cross-verification 코어(`src/lib/cross-verification.ts`)가 이미 verifier에 매칭을 위임하는 구조와
  부합한다 — collector는 NEC 행을 `EvidenceValue`로 매핑만 하고, 같은 인물 여부 판단은 verifier가 한다.

## Verified facts (network-confirmed, 2026-06-13)

아래는 공공데이터포털 공개 페이지에서 인증 없이 확인했다. 인증키를 사용한 실 API 호출은 하지 않았다(조사 단계).

### Dataset / endpoint

- 제공기관: **중앙선거관리위원회**. dataset id `15000864`("당선인 정보").
- 서비스 URL: `http://apis.data.go.kr/9760000/WinnerInfoInqireService2/getWinnerInfoInqire` (당선인 조회 오퍼레이션).
  (조사 단계 2026-06-13에는 `ElecInfoInqireService`로 잘못 기록했으나 2026-06-14 라이브 검증으로 정정 — ADR-3.)
- 커버리지: 국회의원선거 **제14대~제22대**(2026 기준) 등 — 제22대(현직)는 `sgId=20240410`, `sgTypecode=2`.
- 인증: 공공데이터포털 **ServiceKey 필요**(개발계정 자동승인, 트래픽 10,000/일). 키는 환경변수로만 읽는다
  (하드코딩 금지, 예: `NEC_API_KEY` — 아래 open questions에서 변수명 확정).
- 출처: <https://www.data.go.kr/data/15000864/openapi.do> (retrieved-at: 2026-06-13)

### 후보 보완 데이터셋(참고)

- `15000908` 중앙선거관리위원회_후보자 정보: 후보자(낙선 포함) 단위. 현직 매칭에는 당선인(`15000864`)이 더
  정확하나, 학력·경력 필드 동일 제공. 보조 출처로 후순위.
- `15000897` 중앙선거관리위원회_코드 정보: `sgId`/`sgTypecode`/`sdName`/`sggName` 코드 조회용(파라미터 확정에 필요).

### License (사람 확인 완료 2026-06-13 — APPROVED)

- 공공데이터포털 dataset `15000864` 페이지의 **"이용허락범위: 제한 없음"** 표기를 **사람(오너)이 포털에서 직접
  확인**했다. "제한 없음"은 CC BY보다 관대하며 프로젝트 오픈소스 데이터 전제(불변 #8)와 호환된다.
- 출처표시는 "제한 없음"임에도 **프로젝트 정책으로 유지**한다(모든 NEC 사실이 SourceMeta를 동반,
  `license_note_to_use` 참조).
- 출처: <https://www.data.go.kr/data/15000864/openapi.do>, <https://www.data.go.kr/ugs/selectPortalPolicyView.do>,
  <https://www.copyright.or.kr/gov/nuri/rule_info/index.do> (retrieved-at: 2026-06-13)
- 적용 범위: 이 dataset(`15000864`) 1건에 한정. 후보자(`15000908`) 등 다른 NEC dataset과 다른 pending 출처는
  영향 없음(여전히 `pending_review`).

## Open questions (남은 항목)

- NEC 당선인 API의 **정확한 출력 element 이름**을 실응답(ServiceKey)으로 확정(jdName/sggName/edu/career1 등은
  포털 문서 기준 추정 — 실 XML/JSON 키로 검증 필요). 키는 env-only로만 사용.
- `sgId`/`sgTypecode` 값과 비례대표(`sgTypecode` 구분, 정당명부) 처리 — `15000897` 코드 API로 확정.
- party/district **정규화 규칙**: NEC 선거구명 표기 vs Open Assembly `ORIG_NM` 표기 차이, 비례대표 표기 통일.
- **선거일 시점 vs 현재 시점** 차이를 discrepancy로 어떻게 라벨링할지(당적 변경은 `content_conflict`로 표면화 —
  병합·선택 금지, 불변 #4). detector/label 문구 설계.
- 환경변수명 확정(`NEC_API_KEY` 등) 및 collector config 인터페이스(mock-first 스켈레톤).
- 공개 스냅샷 포함 여부는 별도 단계 — 이번엔 mock-only 유지, `PUBLIC_PIPELINE_COLLECTOR` OFF.

## License approval — DONE (license gate only)

License approval(아래 1)는 **사람이 2026-06-13에 완료**해 `status: approved`가 되었다. 단 라이선스 승인은
**라이선스 게이트만** 연다 — 실 수집/공개 go-live는 여전히 별도 잠금이다(아래 "남은 사람 go/no-go").

1. ~~License: dataset의 이용허락 조건을 사람이 직접 확인하고 CC BY 호환임을 판단~~ → **DONE 2026-06-13**:
   "제한 없음" 포털 확인, CC BY보다 관대, 호환. `reviewed_at`/`reviewer`/`license_note_to_use` 기입 완료.

## 남은 사람 go/no-go (license 승인으로 *열리지 않는* 별도 결정)

1. **[실 수집/공개 go-live]** `NEC_COLLECTOR=nec` + `PUBLIC_PIPELINE_COLLECTOR`로 실 fetch를 켤지 —
   open_assembly와 동일하게 **라이선스 승인과 분리된 별도 사람 결정**. 이번 iteration에서 켜지 않음.
   켜기 전 충족: 실응답 element 확정(ServiceKey), party/district 정규화 규칙, 동명이인/비례대표/당적변경 매칭
   실데이터 검증.
2. **[PII 필드]** 생년월일·성별·학력·경력·주소를 공개에 노출할지. 기본값은 **identity(party/district) 한정**.
   확장 시 ADR + SourceMeta + 사람 승인 필요(불변 #7). **라이선스 승인은 PII 노출을 승인하지 않는다.**
3. **[보조 출처 승인]** 후보자(`15000908`)는 ADR-2로 *배선*은 됐으나 **라이선스는 미승인**(이번 승인은
   `15000864` 단건). 보조 출처를 실제로 쓰려면 별도 사람 라이선스 승인 필요.

> AGENTS.md §0 원칙에 따라 approval 결정은 사람이 한다. 본 문서는 사람 결정을 기록·반영한다.

## Internal LIVE dry-run findings (2026-06-14 — keyed, NEC_COLLECTOR still OFF)

> 내부 전용 live dry-run(`scripts/dry-run-nec-cross-verification-live.ts`, `npm run dry-run:nec-live`)을
> ServiceKey로 1회 실행. 산출물은 `data/internal/nec-dry-run/live-latest.json`(gitignore)에만 기록했고
> 공개 출력(`facts.csv`/`latest.json`)은 **SHA256 byte-identical로 무변화**임을 확인했다. 키 값과 raw PII
> *값*은 어디에도 기록하지 않았다(아래는 비밀이 아닌 발견만). NEC 총 호출 5회(예산 10,000/일 대비 무시 가능).

- **실 서비스 경로 = `WinnerInfoInqireService2/getWinnerInfoInqire`** (dossier `service_name`과 일치). 라이브에서
  정상 응답(`resultCode=INFO-00`, `resultMsg=NORMAL SERVICE`). ⚠️ `src/lib/collectors/nec.ts`의
  `NEC_WINNER_SERVICE_PATH` 상수는 `ElecInfoInqireService/getWinnerInfoInqire`로 되어 있어 **실 경로와 다르다** —
  실 수집 go-live 전 사람 확인 후 상수 정정 필요(이번 dry-run은 공개 collector 상수를 건드리지 않고 스크립트에서
  실 경로를 직접 호출했다).
- **커버리지 = 254 (300 아님).** `sgTypecode=2`(국회의원선거) 당선인 API는 **지역구 당선자 254명**만 반환한다.
  비례대표 46석은 이 응답에 없다(별도 election type). 따라서 현직 300 로스터와 1:1 대응이 아니며, 이는 매칭
  실패가 아니라 **데이터셋 경계**다 — 비례대표 교차검증을 원하면 비례 당선인 소스/타입을 별도로 확정해야 한다.
- **실 응답 element 이름 확정**(open question 해소): 한 행의 키는
  `num, sgId, sgTypecode, huboid, sggName, sdName, wiwName, giho, gihoSangse, jdName, name, hanjaName,
  gender, birthday, age, addr, jobId, job, eduId, edu, career1, career2, dugsu, dugyul`.
  → 매퍼가 읽는 identity 키 `name`(매칭 전용)·`jdName`(party)·`sggName`(district)가 모두 실재한다.
- **PII drop 실증(불변 #7).** 실 행은 dropped-PII 8개(`gender, birthday, age, addr, job, edu, career1, career2`)와
  `hanjaName`을 **실제로 담고 있다**. 매퍼 출력 객체 키는 정확히 `{politicianId, displayName, party, district}`
  뿐이고 PII 필드명·값은 매핑 출력에 **부재**(254/254). 즉 PII 미노출은 "스캔 안 해서"가 아니라 매퍼가
  identity-only로 **버려서**임이 실데이터로 확인됨.
- **프라이버시 스캔**: raw·mapped 모두 `passed`(0 findings). 승인 식별 필드(party/district) false-block 0건.
  (election PII는 RRN/전화/이메일·보좌진 실명 패턴에 안 걸리는 게 설계 의도 — 노출 차단의 주체는 스캐너가 아니라
  identity-only 매퍼다.)
- **실 교차검증(merge, ADR-1)**: OA 라이브 로스터 300 × NEC 254 → **match 234 / unmatched 19 / ambiguous 1**.
  party `content_conflict` **1건**(선거일 시점 NEC ≠ 현재 OA 당적), 두 출처(open_assembly+nec) 모두 인용·병합 없음
  (불변 #4). unmatched 19는 비례대표 승계 등 **선거일 명부 ≠ 현 로스터** 차이로 예상된 mismatch이며 강제 매칭하지
  않고 기록만 했다. ambiguous 1은 동명이인 후보 2개로 합류 보류(불변 #3).
- **공개 차단 유지**: 이 fetch는 `selectNecCollector`/`NEC_COLLECTOR`(OFF)와 `PUBLIC_PIPELINE_COLLECTOR`(OFF)를
  **거치지 않고** 내부 스크립트 경로로만 실행됐다. 공개 스냅샷에 NEC 행이 들어갈 경로는 여전히 없다(불변 #5/#8).

> ⚠️ 위 "실 서비스 경로가 상수와 다르다"·"unmatched 19" 두 항목은 **2026-06-13 1차 dry-run 시점 기록**이며,
> 아래 2026-06-14 activation 실행으로 *해소·갱신*됐다(상수 정정 ADR-3, 커버리지 분류 ADR-4).

## Internal LIVE dry-run findings — activation pass (2026-06-14, decisions 1·2 적용 후)

> 사람 결정 1·2를 적용한 뒤 **수정된 공개 code path(`NecCollector` → `NEC_WINNER_SERVICE_PATH`)** 로 재실행.
> NEC 호출 3회(페이지 100/100/54). 산출물 `data/internal/nec-dry-run/live-latest.json`(gitignore). 공개 출력
> `facts.csv`/`latest.json` **SHA256 byte-identical 무변화** 재확인. 키·raw PII 값 미기록.

- **경로 정정 검증(ADR-3)**: `NEC_WINNER_SERVICE_PATH = "WinnerInfoInqireService2/getWinnerInfoInqire"` 로 정정한
  뒤, **공개 collector가 쓰는 바로 그 code path**(`NecCollector.collect`)로 호출해 `INFO-00`/254행 정상 동작 확인.
- **페이지네이션 버그 수정(경로 정정의 정확성 요건)**: WinnerInfoInqireService2는 `numOfRows=300`을 보내도
  **페이지당 100행만** 반환한다(라이브 확인). 기존 단일 300요청 collector는 100행만 받아 254 중 154를 잃었다.
  → `NecCollector.collect`를 totalCount 기반 페이지네이션(100/page, 상한 50page)으로 고쳐 254/254 전량 수집.
  (이는 "수정된 경로가 실제로 동작"의 정확성 요건이지 범위 확장이 아니다. 단위 테스트로 잠금.)
- **커버리지 분류(ADR-4, decision 2)**: OA 300명 = **matched 234 / genuine-unmatched 20 / out-of-scope(비례대표) 46**
  (234+20+46=300). 비례대표 46은 `unmatched`가 아니라 **이 출처 범위 밖**으로 분류(`classifyNecCoverage`).
  비례 판정은 OA district="비례대표" 표기(ASSUMPTION — 전용 flag 없음). NEC-side: ambiguous 1, party
  `content_conflict` 1(두 출처 open_assembly+nec 인용, 병합 없음 — 불변 #4). genuine-unmatched 20 = 지역구인데
  현 로스터와 안 맞는 케이스(보궐·의석 변동 등 — 조사 대상이지 비례대표와 구분됨).
- **공개 차단 유지**: `NEC_COLLECTOR` OFF, `PUBLIC_PIPELINE_COLLECTOR` OFF 그대로. 이번 변경으로 공개 출력 무변화.

## Pre-go-live NORMALIZATION REVIEW (2026-06-14 — INTERNAL only, go-live NOT flipped)

> 목적(불변 #1·#4 부하): 공개 노출 전에, surface된 교차출처 불일치가 **진짜**인지 **표기 노이즈**인지 판정한다.
> 표기차를 content_conflict로 만드는 정규화 갭은 사실상 **불일치 조작**이므로 공개 전에 막아야 한다.
> 산출물: `data/internal/nec-dry-run/normalization-classify.json`(gitignore). NEC 호출 3회(페이지 100/100/54).
> 공개 `facts.csv`/`latest.json` **SHA256 byte-identical 무변화** 확인. 키·raw PII 값 미기록.
> 가드: `NEC_COLLECTOR` OFF, `PUBLIC_PIPELINE_COLLECTOR` OFF 유지. 정규화는 **매칭/비교 전용**이며 raw 값을
> 덮어쓰지 않는다(각 출처 EvidenceValue 그대로 보존·개별 인용 가능).

### PART A — 라이브 불일치 분류(실제 차이 문자열 기준; name/party/district = 공개 식별 필드, PII 아님)

- **genuine-unmatched 20** 분해(정규화 후 매칭 결과 기준 버킷):
  - **real-no-match 13**: 같은 이름의 NEC 지역구 당선인 자체가 없음 → 진짜 미매칭(보궐 당선·승계·사퇴 등 선거일
    명부 ≠ 현 로스터). 예: 김남국(경기 안산시갑), 송영길(인천 연수구갑), 한동훈(부산 북구갑), 이광재(경기 하남시갑) 등.
    이들은 표기 문제가 아니라 **현직 명부와 선거일 명부의 실질 차이**다(강제 매칭 금지).
  - **notation-only-now-matched 5**: 시도 표기차(아래 ADR-5)만 갈렸을 뿐 같은 사람 — 정규화로 unique 매칭됨.
    강선우(서울 강서구갑), 김병기(서울 동작구갑), 이춘석(전북 익산시갑), 장경태(서울 동대문구을), 조정식(경기 시흥시을).
    **이 5명은 모두 OA party=무소속, NEC party=더불어민주당** → 매칭되면 party가 **진짜 content_conflict로 surface**된다
    (무소속 전환은 드러나야 할 신호). 즉 표기차 때문에 *매칭이 실패해 진짜 conflict가 숨어 있던* 케이스다.
  - **ambiguous-after-norm 2**: 박지원 2명(동명이인, 둘 다 더불어민주당, 전남 해남군완도군진도군 / 전북 군산시김제시부안군을).
    NEC 박지원 당선인은 1명(해남군완도군진도군). 이름+정당이 같은 쌍둥이라 지역구 정규화로도 unique 해소 불가 →
    **여전히 ambiguous**(합류 보류, 불변 #3). 안정 join key(MONA_CD↔NEC id)가 있어야 해소된다.
- **content_conflict 1(raw)**: **김종민** — OA party=`무소속`, NEC party=`새로운미래`. 정규화해도 두 키가 다르다
  (`normalizedKeysEqual=false`) → **TRUE PARTY DIFFERENCE**(선거일 시점 ≠ 현재의 진짜 당적 변경). 표기 변형이
  아니므로 정규화가 흡수해선 안 된다 — surface 유지.
- **ambiguous 1(raw)**: 위 박지원 동명이인. 추가로 필요한 disambiguating 필드 = 안정 join key 또는 시도-aware 지역구.

### PART B — 정규화 규칙(매칭 전용, 비파괴). 실제 관측 문자열로만 동기화. `src/lib/collectors/nec-normalize.ts`.

| 규칙 | 동기 부여 실제 예 | 처리 | 위험/판정 |
| --- | --- | --- | --- |
| **party** | "더불어민주당" vs " 더불어 민주당 " | NFC+트림+공백제거. 글자 자체 보존. | 안전. 약칭↔정식명 사전은 **불포함**(라이브 미관측 + 진짜 당적차 은폐 위험, 불변 #4). |
| **name**(매칭 전용, emit 안 됨) | "김 공개"≈"김공개" | NFC+공백제거+소문자. | 안전. 한자↔한글 음역 매핑은 불포함(동명이인 오합류 위험). |
| **district (권장, sido-aware)** | OA "서울 강서구갑" ↔ NEC sggName "강서구갑"+sdName "서울특별시" | 양쪽을 canonical **단축 시도 + 선거구명** 키로 환원(`normalizeDistrictForMatchSidoAware`). | **안전(충돌 0)**. 아래 ADR-5. |
| **district (Option A, 측정 전용·금지)** | 시도 제거 후 선거구명만 | bare 선거구명 키. | ⚠️ **6개 충돌**(예 "서구갑"←인천/대전/광주) → 동명이인 false-match 잠재 위험. **단독 사용 금지.** |

> 핵심 비파괴 증명: 정규화는 비교 키만 만든다. 예) 강선우 — OA raw "서울 강서구갑", NEC raw "강서구갑" 두 값이
> 각자 출처 메타와 함께 **그대로 보존**되고, 정규화는 동일성 판단용 키("서울강서구갑")만 산출한다(불변 #4).

### ADR-5 (2026-06-14): 시도(광역시·도) 표기 정규화 = canonical 단축 토큰 (사람 결정 필요 항목 포함)

- **맥락(라이브 발견)**: 두 출처가 시도를 **다른 형태**로 쓴다. OA `ORIG_NM` 접두 = **단축형**("인천","경기","강원"),
  NEC `sdName` = **정식형**("인천광역시","경기도","강원특별자치도"). 따라서 (a) 시도를 *제거*하면(Option A) 다른 시의
  같은 선거구명이 충돌(6건), (b) 단순 `sdName+sggName` 결합은 OA와 안 맞아 매칭이 *감소*(측정상 234→233)하고
  **이미 떠 있던 김종민 conflict까지 숨겼다**(불변 #4 위반). → 둘 다 부적합.
- **결정(정규화 규칙)**: 17개 시도 **정식형↔단축형 canonical 매핑**(`KR_SIDO_CANONICAL`, 닫힌 행정구역 상수 —
  약칭 사전과 달리 판단 의존 아님)으로 양쪽을 **단축 시도 + 선거구명** 키로 환원한다. 라이브 결과: **충돌 0건**,
  formerly-colliding 14개 선거구가 시별로 분리 보존(예 "인천서구갑"≠"대전서구갑").
- **세종 엣지케이스(잠금)**: 세종은 시도명이 선거구명에 내장되고 공백이 없다("세종특별자치시갑"). 단순 prepend는
  "세종세종…"으로 중복돼 김종민(세종특별자치시갑, 무소속↔새로운미래) 매칭을 깨고 **진짜 conflict를 숨겼다**.
  → 값이 이미 어떤 시도로 시작하면 prepend 안 함 + 내장 정식형은 단축형으로 환원("세종갑"). 단위 테스트로 잠금
  (`tests/nec-normalize.test.ts`). 수정 후 김종민 conflict 정상 surface 확인.
- **[사람 결정 — 매핑 노출 범위] → RESOLVED by ADR-6 (2026-06-14)**: 권장(sido-aware) 매칭은 NEC `sdName`(시도,
  공개 지리 식별자 — PII 아님, `NEC_DROPPED_PII_FIELDS`에 없고 privacy scan 무탐지)을 **매칭에 읽어야** 한다.
  ~~현재 매퍼는 sdName을 읽지도 emit하지도 않는다~~ → **ADR-6에서 사람 승인으로 채택**: 매퍼가 sdName을 **매칭
  전용** `districtMatchKey` 산출에만 읽고(emit 안 함), emit district는 **OA 단축형(bare `sggName`/`ORIG_NM`)
  유지**로 결정. 이 검토 절은 측정이었고, 채택 결정·코드 반영은 아래 ADR-6에 기록한다.

### PART C — 정규화 적용 재실행(before→after delta)

| 구분 | matched | genuine-unmatched | out-of-scope(비례) | ambiguous | content_conflict |
| --- | --- | --- | --- | --- | --- |
| **before(legacy)** | 234 | 20 | 46 | 1 | 1 |
| **after(권장 Option B, 충돌 0)** | **239** (+5) | **15** (−5) | 46 | 1 | **6** (+5) |
| Option A(측정 전용·금지) | 239 | 15 | 46 | 1 | 6 | *(같은 수치지만 6개 district 충돌 위험)* |

- **notation-only로 새로 매칭된 5명** = 시도 표기차만 갈렸던 강선우/김병기/이춘석/장경태/조정식. real no-match로
  **여전히 미매칭 13명**(보궐·승계 등 진짜 차이), ambiguous 2(박지원 동명이인).
- **정규화로 새로 surface된 conflict 5건** = 위 5명의 무소속↔더불어민주당(진짜 무소속 전환). 기존 김종민(무소속↔
  새로운미래) 1건과 합쳐 **총 6건 모두 진짜**(survives normalization). 표기차가 conflict로 둔갑한 가짜는 **0건**.
- **raw 보존 확인**: 강선우 — OA raw "서울 강서구갑" + NEC raw "강서구갑" 모두 각자 출처와 함께 보존, 키만 "서울강서구갑".

### PART D — ORIG_NM "비례대표" ASSUMPTION 검증(ADR-4)

- 라이브 OA 300 중 `ORIG_NM`에 비례대표 표기 = **정확히 46명**(제22대 비례 의석 수와 일치). distinct 값 = `["비례대표"]`
  단일 표기. NEC 지역구 응답 254행 중 비례대표 라벨 = **0**(winner API엔 비례대표 행이 없음 — 범위 경계 재확인).
  matched 멤버 중 비례대표로 오라벨된 경우 = **0**(지역구 미매칭이 비례로 잘못 숨겨지지 않음).
- **판정: ASSUMPTION 성립 → CONFIRMED(승격, 2026-06-14, ADR-6 채택과 함께).** `ORIG_NM="비례대표"`가 비례대표
  46석을 정확히 격리하며 지역구 멤버를 오라벨하지 않음이 라이브 254 NEC + OA 300으로 검증됨(Part D: 정확히 46, 0
  오라벨, NEC winner 행 0). 더 이상 ASSUMPTION이 아니다. (단 OA가 전용 비례 flag를 추가하면 그 필드로 교체 —
  표기 의존은 현재 안전하게 동작함이 실데이터로 확인된 fallback이다.)

### 정규화 후 신뢰도 / go-live 안전성 판단

- 정규화(권장 Option B) 적용 시 surface되는 **6개 content_conflict는 모두 진짜 당적 차이**다(무소속 전환 5 + 새로운미래
  전환 1). 표기 노이즈가 conflict로 둔갑한 사례 **0건**. 즉 "정규화 갭이 가짜 불일치를 만든다"는 위험은 **해소**됐다.

## ADR-6 (2026-06-14): sido-aware 정규화를 공개 매칭 **기본값으로 채택** + emit 형태 = OA 단축형 (DECISION 1, 사람 승인)

- **맥락**: 위 normalization review(Parts A–D)에서 sido-aware(Option B, `normalizeDistrictForMatchSidoAware`)가
  충돌 0·가짜 conflict 0으로 검증됐고, 사람이 이를 **공개 매칭 기본값으로 채택**하기로 결정(DECISION 1).
- **결정(코드 반영)**:
  - **기본 정규화기 전환**: `mergeNecIntoProfiles`의 기본값을 legacy → **`NEC_MATCH_NORMALIZER_SIDO_AWARE`**
    (17-토큰 행정 매핑, 0-충돌 버전). Option A(시도 제거, 6충돌)는 채택하지 **않는다** — 측정 전용으로만 남긴다.
  - **매퍼가 sdName을 매칭에 읽음**: `mapNecRecord`가 NEC `sdName`(시도, **공개 지리 식별자 — PII 아님**,
    `NEC_DROPPED_PII_FIELDS`에 없고 privacy scan 무탐지)을 읽어 **매칭 전용** canonical 키 `districtMatchKey`
    (예 "서울강서구갑")를 산출한다. sido-aware 정규화기는 `useNecDistrictMatchKey`로 이 키를 우선 비교에 쓴다.
  - **emit 형태 = OA 단축형(불변 #4 비파괴)**: 정규화는 **매칭/비교 전용**이며 raw를 덮어쓰지 않는다. emit되는
    NEC `district` EvidenceValue 값은 **raw `sggName` 그대로**이고, OA `district`는 OA 단축형 `ORIG_NM`
    (예 "서울 강서구갑") 그대로다. **sdName은 *값*으로 어디에도 노출되지 않는다**(비교 키 산출에만 사용 —
    불변 #1: 두 공개 지리 필드 결합은 충실 표현이지 사실 생성이 아니다). 표시/canonical district = OA 단축형,
    NEC 정식형(sdName)은 매칭 정규화에만 쓰고 emit하지 않으며, NEC raw `sggName`은 출처 evidence로 개별 인용 가능.
  - **raw 보존 재확인**: 강선우(OA "서울 강서구갑" + NEC "강서구갑") 두 raw가 각자 출처 메타와 함께 보존되고
    키만 "강서구갑/서울강서구갑"으로 비교됨을 라이브로 재확인. 세종(김종민, OA·NEC 둘 다 "세종특별자치시갑")도
    두 raw 보존 + 정규화 키 "세종갑"으로 매칭되어 무소속↔새로운미래 conflict가 정상 surface됨을 재확인.
- **비례 ASSUMPTION 승격**: Part D 검증으로 `ORIG_NM="비례대표"` 가정을 **confirmed**로 승격(위 Part D 참조).
- **공개 영향 없음**: `NEC_COLLECTOR`/`PUBLIC_PIPELINE_COLLECTOR` OFF 유지 → 공개 출력 SHA256 byte-identical 무변화.

## ADR-7 (2026-06-14): 동명이인+동일정당 쌍둥이 = **ambiguous-withheld**(식별 불가, 보류) (DECISION 2(a), 사람 승인)

- **맥락**: 박지원류 same-name+same-party 쌍둥이는 안정 join key(MONA_CD↔NEC id)가 없어 sido-aware 지역구
  정규화로도 unique 해소되지 않는다(이름+정당으로 둘 다 후보 → 모호). 라이브: 박지원 2명(둘 다 더불어민주당,
  전남 해남군완도군진도군 / 전북 군산시김제시부안군을), NEC 박지원 당선인 1명.
- **결정(DECISION 2 = option (a))**:
  - **강제 해소하지 않는다**: 잘못된 사람에 NEC를 붙이느니 붙이지 않는다(`mergeNecIntoProfiles`가 ambiguous로 보류).
  - **새 PII 필드를 도입하지 않는다**(불변 #7): 쌍둥이를 가르려고 생년월일 등 식별 정보를 추가하지 않는다.
  - **정직하게 표면화한다**(불변 #3): genuine-unmatched에 조용히 섞지 않고 **별도 ambiguous-withheld 상태**로 분류한다
    (`classifyNecCoverage(…, merge.ambiguous)` → `ambiguousWithheld`/`ambiguousWithheldMembers`). 표준 사유 문구
    `NEC_AMBIGUOUS_WITHHELD_REASON = "동명이인 — 식별 불가, NEC 교차검증 보류"`. NEC 교차검증은 이들에 대해
    **보류**되지만 누락이 아니라 명시 표시된다.
- **검증**: 라이브 분류 = matched 239 / genuine-unmatched 13 / **ambiguous-withheld 2(박지원·박지원)** /
  out-of-scope 46 / content_conflict 6. 단위 테스트로 쌍둥이가 genuine-unmatched가 아닌 ambiguous-withheld로
  분류됨을 잠금(`tests/nec-collector.test.ts`).

### 정규화 채택 후 라이브 회귀 결과(regression gate, 2026-06-14 — NEC_COLLECTOR OFF 유지)

> 정규화 기본값 전환 후 동일 분류(`npm run nec:normalize-classify`)를 **회귀 검사**로 재실행. 공개 code path
> (`mapNecRecord`→`mergeNecIntoProfiles` sido-aware 기본)로 측정. NEC 호출 3회(페이지 100/100/54), 예산 무시 가능.
> 공개 `facts.csv`/`latest.json` **SHA256 byte-identical 무변화** 확인. 키·raw PII 값 미기록(report는 gitignore).

| 구분 | matched | genuine-unmatched | ambiguous-withheld | out-of-scope(비례) | content_conflict |
| --- | --- | --- | --- | --- | --- |
| before(legacy, 비교용) | 234 | 18(+박지원 2 보류=20) | 2 | 46 | 1 |
| **after(sido-aware, 공개 기본)** | **239** | **13** | **2** | 46 | **6** |

- regression gate **PASS** — 위 after 수치가 리뷰 기대치와 정확히 일치(`report.regressionGate.pass=true`).
- content_conflict **6건 전부 진짜 당적 변경**(강선우/김병기/이춘석/장경태/조정식 무소속←더불어민주당 + 김종민
  무소속←새로운미래). 표기차가 conflict로 둔갑한 가짜 **0건**.

## Remaining before go-live (이제 사람 플립 하나만 남음)

DECISION 1(ADR-6: sido-aware 채택 + emit 단축형)·DECISION 2(ADR-7: ambiguous-withheld)가 **코드에 반영·검증**됐고
비례 ASSUMPTION이 **confirmed**로 승격됐다. 정규화/매칭/동명이인 표시 관련 사람 결정은 **모두 종결**됐다.

> **남은 단 하나의 항목 = 사람의 go-live 플립**: `NEC_COLLECTOR=nec` + public-pipeline에 nec collector 배선
> (`PUBLIC_PIPELINE_COLLECTOR`). 이것은 정규화 채택과 **분리된 별도 사람 go/no-go**이며 이번 iteration은 켜지
> **않았다**. 이 플립 외에 정규화·매칭·표시 측면에서 go-live를 막는 기술 항목은 **없다**.
>
> (참고: PII 노출 확장·보조 데이터셋 `15000908` 라이선스는 *이* go-live와 무관한 별개 결정으로 여전히 미승인 —
> 위 "남은 사람 go/no-go" 절 참조. 현재 범위는 identity-only(party/district) + 당선인 `15000864` 단건이다.)

## Review notes

- Done(2026-06-14): **정규화 채택 + go-live 준비**(DECISION 1·2, ADR-6·7) — sido-aware를 공개 매칭 **기본값으로
  채택**(`mergeNecIntoProfiles` 기본 전환), 매퍼가 sdName을 **매칭 전용** `districtMatchKey`로 읽음(emit 안 함,
  OA 단축형 유지), 박지원류 쌍둥이를 **ambiguous-withheld**로 분리 표시, 비례 ASSUMPTION→**confirmed** 승격.
  regression gate **PASS**(matched 239/genuine-unmatched 13/ambiguous-withheld 2/out-of-scope 46/conflict 6, 6 전부
  진짜). typecheck/tests(전체 통과)/lint 통과, 공개 SHA256 byte-identical, NEC 호출 3회, 키·PII 미기록. **남은 것:
  사람 go-live 플립(`NEC_COLLECTOR=nec` + public-pipeline 배선)뿐**.
- Done(2026-06-14): **정규화 사전 검토(Parts A–D)** — 위 절. 권장 sido-aware 규칙 충돌 0, 가짜 conflict 0, 세종
  엣지케이스 잠금, ORIG_NM 비례 ASSUMPTION 성립 확인. typecheck/tests(167 pass)/lint 통과, 공개 byte-identical.
- Done(2026-06-13): 후보 출처 비교 — NEC 당선인 API를 두 번째 collector 후보로 선정(독립 기관 + 현직 커버 +
  party/district 직접 중첩). 국회사무처 미러 API들과 헌정회(역대 한정)는 부적합으로 제외.
- Done(2026-06-13): dataset/endpoint/커버리지/라이선스 표기("제한 없음") network 확인. 인증키 미사용.
- Done(2026-06-13): **mock 모드 collector 구현**(`NecCollector`), identity-only 매퍼(party/district, PII drop),
  이름+정당+지역구 매칭(`mergeNecIntoProfiles`, no-match/multi-match 처리), 두 데이터셋 배선(ADR-2),
  교차검증 활성화 증명(당적 변경자 party → `content_conflict`, 두 출처 인용). 실 fetch는 `NEC_COLLECTOR` OFF
  + 라이선스 pending으로 잠금. 공개 출력 byte-identical(timestamp 외 변화 없음). 테스트 `tests/nec-collector.test.ts`.
- Done(2026-06-13): **사람 라이선스 승인 기록** — dataset `15000864` "제한 없음" 사람 확인 → `status: approved`,
  `publish_snapshot_allowed: true`. policy(`sourceLicensePolicies.nec`)도 approved로 flip, `NEC_LICENSE_NOTE`를
  env에 추가(하드코딩 금지). **승인은 라이선스 게이트만 연다** — `NEC_COLLECTOR`/`PUBLIC_PIPELINE_COLLECTOR`
  OFF 유지로 실 fetch·공개 go-live는 안 함. 공개 출력 byte-identical(timestamp 외 변화 없음).
- Done(2026-06-13): 내부 cross-verification dry-run 실행(offline, `data/internal` 전용·gitignore, 공개 아님).
- Pending(사람): 실 수집/공개 go-live(별도 go/no-go), 실응답 element/정규화/매칭 실데이터 검증, PII·보조출처 승인 → 위 "남은 사람 go/no-go".
