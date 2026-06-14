# Open Assembly source review

## Review metadata

- source_kind: open_assembly
- status: approved
- publish_snapshot_allowed: true
- source_terms_url: https://open.assembly.go.kr/portal/policy/openUserAgreementPage.do
- source_copyright_url: https://open.assembly.go.kr/portal/policy/copyRightPage.do
- endpoint_id: nwvrqwxyaytdsfvhu
- service_name: 국회의원 인적사항
- provider: 국회사무처 (National Assembly Secretariat)
- license_type: 공공누리 제1유형 (KOGL Type 1, 출처표시) — 자유이용(상업적 이용·변경 허용), 출처표시 의무
- license_note_to_use: "출처: 열린국회정보, 국회의원 인적사항 (공공누리 제1유형, 출처표시), https://open.assembly.go.kr"
- reviewed_at: 2026-06-13
- reviewer: human owner (project owner, §0.7 publishability judgment)
- verified_by: Claude (Iteration 23, network source-verification)
- verified_at: 2026-06-12

> 이 status(`approved`)는 **사람(프로젝트 오너)** 이 2026-06-13에 §0.7 공개가능성 판단으로 직접 결정한 것이며,
> endpoint `nwvrqwxyaytdsfvhu`(국회의원 인적사항)에만 적용된다. 에이전트는 라이선스 status를 스스로 승인하지
> 않는다(불변 §0). 본 작업은 사람이 이미 내린 결정을 *기록·반영*하는 것이다.

## Human approval decision (2026-06-13)

**Decision: APPROVED for public release.**

- **Decided by:** human owner (project owner), exercising the §0.7 publishability judgment. This is the
  human gate that agents are **forbidden to self-approve** (CLAUDE.md/AGENTS.md Chapter 0). This document
  records a decision the human already made; no agent re-derived or re-judged the license.
- **Decision date:** 2026-06-13.
- **Scope of this approval:** ONLY the Open Assembly endpoint `nwvrqwxyaytdsfvhu` (국회의원 인적사항).
  The other 5 sources (`public_data_portal`, `rokps`, `nec`, `news_search`, `rss`) — and `manual_review`
  — remain `pending_review` and must each receive their own human-verified review doc + human approval
  before any of their data is released.

### Verified facts (portal metadata, confirmed by the human on 2026-06-13)

- Service name (메뉴명): **국회의원 인적사항**
- Endpoint id: **nwvrqwxyaytdsfvhu**
- Provider (제공기관): **국회사무처** (National Assembly Secretariat)
- Classification (분류체계): 국회의원 > 국회의원 현황 정보
- License (이용허락조건): **공공누리 제1유형 (KOGL Type 1, 출처표시 / attribution only)** — confirmed via the
  OPEN + attribution mark in the endpoint's "메타 정보".
- Published: 2019-12-13; last updated: 2026-06-13.
- Source policy basis: open.assembly.go.kr copyright policy states works opened under KOGL Type 1 are freely
  usable (commercial/non-commercial, modification, redistribution) with attribution; Open API Terms Article 7
  mandates attribution in the form `출처 : 열린국회정보, [서비스 메뉴명], [date]`.
- CC BY compatibility: KOGL Type 1 (attribution-only) is compatible with the project's CC BY data
  redistribution plan (불변 §0.8).

### Required attribution string (KOGL Type 1 출처표시 의무)

Every public exposure of this source's data MUST carry attribution. Emit, with a hyperlink to the source
(KOGL Type 1 online-link requirement):

```
출처: 열린국회정보, 국회의원 인적사항, <fetched_at date>
```

- Hyperlink target: <https://open.assembly.go.kr> (or the specific endpoint page below).
- `<fetched_at date>` is the snapshot/record `fetched_at` date for the data being shown.
- The SourceMeta `license_note` carried on emitted rows reflects: `공공누리 제1유형 (KOGL Type 1, attribution)`
  with the service name `국회의원 인적사항` (see `license_note_to_use` above).

### Reference URLs

- Endpoint metadata page: <https://open.assembly.go.kr/portal/openapi/openApiDetailPage.do> (service: 국회의원 인적사항, id `nwvrqwxyaytdsfvhu`)
- Copyright policy: <https://open.assembly.go.kr/portal/policy/copyRightPage.do>
- Open API terms of use: <https://open.assembly.go.kr/portal/policy/openUserAgreementPage.do>

> Note — approval does NOT enable real-data collection by itself. The public snapshot stays on the mock
> collector (`PUBLIC_PIPELINE_COLLECTOR` off) until enabling real collection is a separate explicit step.

## Scope

- 열린국회정보 Open API 현직(제22대) 의원 기본 정보. 현재 검증된 매핑 범위는 identity 필드(`party` / `district` / `position`)뿐이다.
- 의정활동(학력·경력·선거·법안·표결·위원회) 데이터는 endpoint와 raw key를 확정한 뒤 별도 mapper로 추가하며, 그 전에는 public snapshot에 노출하지 않는다.

## Verified facts (network-confirmed)

아래 사실은 2026-06-12에 열린국회정보 공개 정책 페이지에서 직접 확인했다. 인증 없이 공개 약관/저작권 페이지만 읽었다.

### License — 공공누리 제1유형

- 저작권 정책 페이지(`source_copyright_url`)에서 확인:
  - 인용: "공공누리의 제1유형 : 출처표시(공공저작물의 자유이용)"
  - 인용: "저작물의 출처를 구체적으로 표시하여야 합니다"
  - 제2·3·4유형(상업용금지/변경금지) 또는 공공누리 미부착 자료는 사전 협의 필요 → 본 프로젝트는 **제1유형 자료에 한정**해 사용한다.
- 출처: <https://open.assembly.go.kr/portal/policy/copyRightPage.do> (retrieved-at: 2026-06-12)

### Terms of use — 출처표시 의무 / 면책

- 이용약관 페이지(`source_terms_url`)에서 확인:
  - 제7조(출처표시 의무): "이용자는 국회 공개정보를 이용함에 있어 열린국회정보에서 제공된 정보임을 표시하여야 합니다" (예시 형식: `출처 : 열린국회정보, 서비스 메뉴명, [date]`)
  - 제4조(상업적 이용): 상업적 이용은 허용되되 국회는 결과에 책임지지 않는다.
  - 제9조(면책): "국회 공개정보는 열린국회정보 포털 수록내용대로 제공하며, 국회는 ... 오류나 누락, Open API 서비스 장애 등으로 인한 손해에 대한 책임을 지지 않습니다"
- 출처: <https://open.assembly.go.kr/portal/policy/openUserAgreementPage.do> (retrieved-at: 2026-06-12)
- 비영리·오픈소스 전제(AGENTS.md §0-8)와 충돌 없음: 제1유형은 CC BY와 호환 가능한 출처표시 라이선스다.

### API key requirement

- Open API 호출에는 인증키(KEY)가 필요하다. (인증키 발급: <https://open.assembly.go.kr/portal/openapi/openApiActKeyIssPage.do>)
  - 키는 `OPEN_ASSEMBLY_API_KEY` 환경변수로만 읽는다(하드코딩 금지). 본 검토 단계에서는 키를 발급/사용하지 않았다.
- 출처: <https://open.assembly.go.kr/portal/openapi/openApiIntroPage.do> (retrieved-at: 2026-06-12)

### Provider / 면책 관련

- 제공기관: 국회 국회사무처(National Assembly Secretariat). 공공데이터포털 미러는 이용허락범위 "제한 없음"으로 표기.
- 출처: <https://www.data.go.kr/data/15126133/openapi.do> , <https://www.data.go.kr/data/15125958/openapi.do> (retrieved-at: 2026-06-12)

## Endpoint & field verification (live API response — 2026-06-13)

`ALLNAMEMBER`를 인증키로 직접 호출(`Type=json&pIndex=1&pSize=5`)해 실응답을 확인했다. 응답 `RESULT.CODE = INFO-000`(정상 처리), `list_total_count = 3295`. 키는 환경변수(`OPEN_ASSEMBLY_API_KEY`)로만 전달했고 코드/문서에 기록하지 않았다.

### 확정된 사실 (verified)

- **Endpoint `ALLNAMEMBER`는 호출되지만 "제22대 현직 목록"이 아니다.** 응답은 **역대 전체 의원 명부**(`list_total_count = 3295`)다. 표본 5건 중 `제9대/제10대`(갈봉근), `제12·14·15대`(강경식), `제2·3·5대`(강경옥) 등 과거 대수가 섞여 있고, 제22대 현직은 1건(강경숙, `GTELT_ERACO: 제22대`)뿐이었다. → **현직 필터링/현직 전용 endpoint가 필요하다**(아래 open questions).
- **실응답 필드 코드(`row` 객체)** — 현재 mapper 가정 5개 중 1개만 일치:

  | mapper 가정 | 실제 필드 | 일치? | 비고 |
  | --- | --- | --- | --- |
  | `NAAS_CD` (member id) | `NAAS_CD` | ✅ | 예: `T2T8225E`. 일치 |
  | `HG_NM` (name) | **`NAAS_NM`** | ❌ | 한글명은 `NAAS_NM`(예: `강경숙`). `HG_NM`은 응답에 없음. 한자명 `NAAS_CH_NM`, 영문명 `NAAS_EN_NM` 별도 존재 |
  | `POLY_NM` (party) | **`PLPT_NM`** | ❌ | 게다가 대수별 이력이 `/`로 join된 값(예: `민주정의당/민주자유당/신한국당`). 단일 현재 정당이 아님 |
  | `ORIG_NM` (district) | **`ELECD_NM`** | ❌ | 역시 `/` join 이력(예: `부산 동래구갑/부산 동래구을`). 비례대표는 `ELECD_NM: 비례대표`, 과거 일부는 `null`. 구분값은 `ELECD_DIV_NM`(지역구/비례대표/전국구) |
  | `JOB_RES_NM` (position) | **`DTY_NM`** | ❌ | `DTY_NM`은 `위원`/`null`이며 `국회의원`이 아님. position을 직접 담는 필드는 사실상 없음(현직 여부는 `GTELT_ERACO`로 판별) |

- **신규 privacy 발견:** `row`에 공직 연락 정보가 포함된다 — `NAAS_TEL_NO`(사무실 전화), `NAAS_EMAIL_ADDR`(이메일), `NAAS_HP_URL`(개인 블로그/홈페이지), `OFFM_RNUM_NO`(의원회관 호실), 보좌진 실명 `AIDE_NM`/`CHF_SCRT_NM`/`SCRT_NM`, 약력 `BRF_HST`. 현직(강경숙) 행에 실제 값이 채워져 있었다(예: `02-784-5601`, 이메일, `의원회관 515호`). 이는 공인의 공적 직무정보이긴 하나, internal raw archive privacy scan이 이 키들을 어떻게 다루는지(차단/허용 화이트리스트) **실응답 기준으로 재검증 필요**. mapper는 identity(party/district/position)만 노출하므로 현재 공개 경로로는 새지 않지만, raw archive 보존 단계에서 명시 처리해야 한다.

> 위 표는 실응답 검증 결과이며, **license status는 변경하지 않았다(여전히 pending_review)**. mapper 수정은 사람(요청자) 확인 후 별도 작업으로 진행한다(아래 "Proposed mapper fix").

## Open questions (남은 항목)

- **제22대 현직 의원만** 가져오는 방법 확정: (a) 현직 전용 endpoint(서비스명)가 별도 존재하는지, 아니면 (b) `ALLNAMEMBER` 결과를 `GTELT_ERACO`에 `제22대` 포함 여부로 필터링해야 하는지. 표본만으로는 (b)가 유일한 확인된 경로다.
- `/`로 join된 다대수 이력 값(`PLPT_NM`, `ELECD_NM`, `ELECD_DIV_NM`)에서 **현재(제22대) 값만** 안전하게 추출하는 규칙 — 단순 "마지막 토큰"이 항상 현직 대수에 대응하는지 실데이터로 검증 필요(현직 다수 표본 필요).
- raw archive privacy scan이 위 연락/보좌진/약력 필드를 실응답 기준으로 통과/차단하는지 재검증(별도 작업).
- 의정활동(학력·경력·선거·법안·표결·위원회)용 별도 endpoint/필드 매핑 — identity 승인 이후 단계.

## Proposed mapper fix (NOT applied — awaiting human confirm)

아래는 실응답에 맞춘 **최소 격리 수정 제안**이다. 요청자 확인 전에는 적용하지 않는다. 공개 출력/스냅샷/라이선스 status는 건드리지 않는다.

- `src/lib/collectors/open-assembly.ts`의 `mapOpenAssemblyMemberRecord`에서 raw key 후보를 실응답으로 교체:
  - name: `HG_NM` → **`NAAS_NM`** (한글명)
  - party: `POLY_NM` → **`PLPT_NM`** (단, `/` join 처리 규칙 확정 후)
  - district: `ORIG_NM` → **`ELECD_NM`** (`/` join + null 처리)
  - position: `JOB_RES_NM`/`DTY_NM` 단일 필드 없음 → **현직 여부는 `GTELT_ERACO`에 `제22대` 포함으로 판별**, position 값은 상수(`"국회의원"`)로 두는 현재 동작 유지 검토
  - member id `NAAS_CD`는 그대로(일치)
- collector의 현직 필터: `ALLNAMEMBER` 결과를 `GTELT_ERACO` 기준으로 제22대만 통과시키는 필터 추가(또는 현직 전용 endpoint 확정 시 그쪽으로 전환).
- `/` join 값에서 현재 대수 추출 규칙은 **다수 현직 표본으로 검증 후** 확정(가정으로 채우지 않음).

## Approval criteria (for the human approver)

`status`를 `approved`로 바꾸기 전 아래가 모두 충족되어야 한다(`npm run verify:source-review-dossiers`, `npm run verify:source-licenses` gate와 연동).

1. License: 공공누리 제1유형 + 출처표시 — **확인됨**. `license_note_to_use`를 source metadata에 적용.
2. Endpoint/필드: 위 endpoint·필드 코드가 실응답으로 확정될 것. **(부분 진행 2026-06-13: 실응답으로 필드 코드 확인 완료 — 5개 가정 중 `NAAS_CD`만 일치, 나머지 4개는 `NAAS_NM`/`PLPT_NM`/`ELECD_NM`/`DTY_NM`로 정정 필요. 단 `ALLNAMEMBER`는 현직 전용이 아니라 역대 전체 명부였고, `/` join 이력값에서 현직값 추출 규칙·현직 필터가 미확정이라 항목 전체는 아직 미충족.)**
3. Privacy: 실응답 raw record가 internal raw archive privacy scan을 통과할 것(`npm run verify:open-assembly-fixture` shape 기준).
4. Scope: public snapshot에 노출할 필드를 identity로 한정(또는 추가 매핑이 검증된 범위로만 확장).
5. `reviewed_at` / `reviewer` 기입.

> AGENTS.md §0 원칙에 따라 approval 결정은 사람이 한다. 본 문서는 검증된 사실과 남은 질문만 표면화한다.

## Review notes

- Done(2026-06-12): 라이선스/약관 network 확인 — 공공누리 제1유형(출처표시), 상업적 이용·변경 허용, 면책 조항 확인.
- Done(2026-06-13): `ALLNAMEMBER` 실응답 검증(인증키 사용, 키는 env-only). 필드 코드 5개 중 `NAAS_CD`만 일치, 나머지 4개 정정 필요(`NAAS_NM`/`PLPT_NM`/`ELECD_NM`/`DTY_NM`). `ALLNAMEMBER`는 역대 전체 명부(3295건)로 확인 — 현직 필터/현직 전용 endpoint 필요. 연락·보좌진·약력 등 신규 privacy 필드 발견(별도 재검증 필요).
- Pending: 제22대 현직만 가져오는 endpoint/필터 확정 + `/` join 이력값에서 현직값 추출 규칙.
- Pending: mapper 필드 코드 정정 적용(요청자 확인 대기 — "Proposed mapper fix").
- Pending: raw archive privacy scan을 신규 연락/약력 필드 실응답 기준으로 재검증.
- Pending: 공개 스냅샷 허용 필드 범위 최종 결정 및 human approval.
