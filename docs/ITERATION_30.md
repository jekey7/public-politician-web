# Iteration 30 — Iter-29의 두 렌더링 gap 닫기 (스냅샷→UI 배선 + "보류" 렌더러; flip 없음)

Iter-29는 데이터·공개경계·비밀 계층이 go-live 준비됐음을 확정했고(키가 `source_url`로 새던 결함도 dry-run이 잡아
수정), 두 **렌더링 gap**만 남겼다. 이번 반복은 그 둘을 닫는다. 사람의 go-live flip은 **여기서 수행하지 않는다** —
`NEC_COLLECTOR` OFF로 끝나고, 공개 출력은 바이트 동일이다.

  - **GAP 1** — 상세 페이지가 (재)생성 스냅샷이 아니라 mock-data를 읽는다.
  - **GAP 2** — ambiguous-withheld("보류") 상태에 렌더러가 없다.

---

## 0. 무엇을 배선했나 (GAP 1 — 스냅샷 → 상세 페이지)

상세 페이지의 **단일 진실 공급원**을 명시적으로 만들었다. 새 라이브러리 두 개:

- [`src/lib/snapshot-reader.ts`](../src/lib/snapshot-reader.ts) — `buildPublicSnapshot`의 **역(inverse)**.
  평면 스냅샷 행(`verified_facts`/`discrepancies`/`news_feed`)을 `PoliticianProfile[]`로 재구성한다. 같은
  `(category, field)` 라우팅으로 evidence를 올바른 배열에 되돌린다(party/district/position/committee_role/
  contact/birthYear/gender/education/career/partyHistory/elections/bills/votes/committees). 값·출처·불일치를
  **그대로** 옮길 뿐 새 사실을 만들지 않는다(불변 #1·#2·#4). 빈 스냅샷이면 빈 배열(크래시 금지).
- [`src/lib/profile-source.ts`](../src/lib/profile-source.ts) — `loadProfilesSource()`:
  1. 공개 스냅샷(`public/snapshots/latest.json`)이 있으면 → 재구성해 사용(`source="snapshot"`).
  2. **없을 때만** → mock-data 폴백(`source="mock"`).
  즉 스냅샷이 있으면 mock은 무시된다(우선순위 명시적, implicit 아님). 환경변수 `PROFILE_SNAPSHOT_PATH`로
  내부 dry-run 스냅샷을 주입해 end-to-end 렌더링을 점검할 수 있다(공개 출력은 손대지 않음).

상세 페이지([`src/app/politicians/[id]/page.tsx`](../src/app/politicians/[id]/page.tsx))의 `generateStaticParams`와
조회를 `getProfiles()`/`getProfileById()`로 전환했다. **현재 커밋된 공개 스냅샷은 mock 데이터**이므로, 공개 빌드는
여전히 동일 mock 내용을 렌더한다 — 단 이제 *스냅샷 경로*를 타므로, go-live로 NEC 사실이 스냅샷에 실리면 추가 배선
없이 화면에 나타난다. (공개 빌드 결과: `/politicians/mock-001`·`mock-002` 그대로, 검색 페이지 ID와 일치.)

> **알려진 경계(정직한 보고):** 검색 화면(`home-search.tsx`/`src/lib/search.ts`)은 클라이언트 번들이라 `node:fs`로
> 스냅샷을 읽을 수 없어 mock-data 유지다. 커밋된 공개 스냅샷이 곧 mock이므로 현재는 ID가 일치해 깨지지 않는다.
> 검색을 스냅샷 기반으로 옮기려면 정적 검색 인덱스 산출이 필요하며 — 별도 작업으로 남긴다(이번 scope는 상세 페이지).

---

## 1. "보류" 렌더러 설계 (GAP 2 — ambiguous-withheld + out-of-scope)

### Carrier — 공개 스냅샷 스키마를 건드리지 않는다

ambiguous-withheld는 *사실*도 *불일치*도 아니다 — 출처 간 **값**이 아니라 **교차검증 가능 여부**다. 공개 스냅샷
본문 스키마(`additionalProperties:false`, `validatePublicSnapshot`)에 필드를 추가하면 공개 `latest.json` 바이트
동일이 깨진다. 그래서 carrier를 **본문 밖 사이드카**로 설계했다:

- `PoliticianProfile.necCoverage?: NecCoverage`(선택) — `{ status: "ambiguous_withheld" | "out_of_scope"; reason }`.
  matched/genuine-unmatched는 carrier가 **없다**(matched는 NEC 출처가 배열에 보이고, genuine-unmatched는 NEC 사실
  부재 = 별도 라벨 없이 자연히 "자료 없음"). 즉 carrier는 *정직한 비-식별*을 표현하는 두 상태만 담는다(불변 #3).
- 사이드카 아티팩트 `snapshot-coverage.json`(`{ generated_at, coverage: { politician_id → {status, reason} } }`) —
  공개 스냅샷 본문과 **분리**(불변 #5). `profile-source`가 스냅샷 옆에서 찾으면 carrier를 동반시키고, 없으면 carrier
  없이 둔다(불변 #3: 라벨을 지어내지 않는다). [`classifyNecCoveragePerProfile`](../src/lib/collectors/nec-coverage.ts)이
  카운트 분류기(`classifyNecCoverage`)와 **동일 분기**로 politician_id별 상태를 산출한다(단일 진실).

### 렌더러 — 검증됨/검수중과 시각적으로 구분, NEC 매칭처럼 보이지 않게

상세 페이지에 `NecCoverageNotice` 컴포넌트 + `.withheld-card` 스타일(밝은 배경 + 호박색 테두리/라벨)을 추가했다.
불일치 카드(어두운 `warning-card`)와도, 사실 목록의 검증됨/검수중과도 다른 색·구조다.

- **ambiguous_withheld(보류):** 라벨 "보류 — NEC 교차검증 식별 불가", 본문 "NEC 교차검증을 보류했습니다… 이는
  **검증됨도 검수중도 아니며, NEC 매칭이 성립한 상태가 아닙니다.**", 사유 "동명이인 — 식별 불가, NEC 교차검증 보류".
- **out_of_scope(범위 밖):** 라벨 "범위 밖 — NEC 지역구 출처 대상 아님", 사유 "비례대표 — NEC 지역구 당선인 출처
  범위 밖"(미매칭/버그 아님을 명시).

쌍둥이를 가르기 위한 **PII를 추가하지 않는다**(불변 #7). 보류가 **정답 terminal 상태**이지 해소할 문제가 아니다.

---

## 2. End-to-end 렌더링 결과 (내부 non-mock 스냅샷 기준 — mock fixture 아님)

내부 dry-run을 재생성(`scripts/dry-run-nec-snapshot.ts`, 이번에 `snapshot-coverage.json` 사이드카도 방출)한 뒤,
`PROFILE_SNAPSHOT_PATH`를 그 스냅샷으로 주입해 **305 페이지** 정적 빌드(300 OA 멤버 + home/qa/not-found)를 했다.
이는 GAP 1이 닫혔다는 직접 증거다(상세 페이지가 스냅샷의 `generateStaticParams`로 300명을 생성).

재생성 dry-run 수치: NEC 254행 / OA 300 profiles / NEC 호출 **3/6** / matched **239** · genuine-unmatched **13** ·
ambiguous-withheld **2** · out-of-scope(비례) **46** = 300. content_conflict(party) **6**, 전부 두 출처 병합 없이.
키 누출 0(아래 §4).

### 상태별 spot-check (빌드 HTML 직접 확인)

| 상태 | 멤버 (politician_id) | 렌더링 결과 |
| --- | --- | --- |
| **content_conflict 불일치 배지 + 두 출처** | 강선우 (`open-assembly-MNZ4401T`) | ✅ `CONTENT_CONFLICT` + `warning-card`, 열린국회정보·중앙선거관리위원회 두 출처 나란히. **보류 카드 없음.** |
| **NEC 출처 링크 (matched)** | 강대식 (`open-assembly-L2I9861C`) | ✅ 열린국회정보 + 중앙선거관리위원회(NEC) 출처, district `NOTATION_VARIANCE` 표기차 surface. **보류 카드 없음.** |
| **ambiguous-withheld "보류"** | 박지원 ×2 (`open-assembly-8BF5855P`, `open-assembly-H7X3372O`) | ✅ `withheld-card`(`data-coverage-status="ambiguous_withheld"`), "보류 — NEC 교차검증 식별 불가", 사유 "동명이인 — 식별 불가, NEC 교차검증 보류". 카드 안의 "검증됨/검수중" 문구는 *"이는 검증됨도 검수중도 아니다"* 라는 정직한 부인뿐. |
| **out-of-scope 비례** | 강경숙 (`open-assembly-T2T8225E`) | ✅ `withheld-card`(`out_of_scope`), "범위 밖 — NEC 지역구 출처 대상 아님", "비례대표 — NEC 지역구 당선인 출처 범위 밖". |

세 카드 종류(불일치=어두운 warning-card / 보류·범위밖=호박색 withheld-card / 사실=fact-card)가 **시각적으로 구분**되며,
보류 카드는 매칭된 멤버(강선우·강대식)에는 **나타나지 않는다**. 검증됨/검수중과 접히지 않는다.

### 공개(mock) 빌드 확인 — 폴백 vs 스냅샷 우선순위

`PROFILE_SNAPSHOT_PATH` 미설정으로 재빌드하면 공개 스냅샷(mock)을 읽어 `/politicians/mock-001`·`mock-002` 생성.
mock-001 상세는 김공개 + DISCREPANCIES + `CONTENT_CONFLICT` 배지를 렌더하고, **보류 카드는 없다**(mock엔 coverage
사이드카가 없으므로 — 불변 #3: 라벨을 지어내지 않음). 스냅샷 우선·mock 폴백이 의도대로 동작.

---

## 3. 테스트 / 린트 / 타입체크

- `npm test`(typecheck 포함): **178 tests / 177 pass / 1 skip(OLLAMA_INTEGRATION 미설정) / 0 fail**.
  - 신규 [`tests/snapshot-reader.test.ts`](../tests/snapshot-reader.test.ts) 8건: 재구성이 `buildPublicSnapshot`의
    충실한 역(round-trip), 필드 라우팅 정확, 불일치 두 출처 보존(불변 #4), 사이드카 carrier 동반(불변 #3),
    사이드카 없으면 carrier 없음(라벨 미생성), 빈 스냅샷 무크래시.
  - [`tests/nec-collector.test.ts`](../tests/nec-collector.test.ts)에 `classifyNecCoveragePerProfile` carrier가
    카운트 분류기와 1:1 일치(matched/genuine-unmatched는 carrier 없음, 비례=out_of_scope, 쌍둥이=ambiguous_withheld) 추가.
- `npm run lint`(eslint): clean.
- `npm run typecheck`(tsc --noEmit): clean.
- `npm run verify:public-boundary`: PASS. `npm run verify:snapshot`: PASS(29 facts).

---

## 4. 가드레일 + revert

- **공개 출력 바이트 동일** (반복 전 == 반복 후, SHA256 — Iter-29 값과도 동일):
  - `public/snapshots/latest.json`: `A0A1304676FF65BD879E036264FF0B3F70968022F6613443C3AECA96B1FA6E65`
  - `public/snapshots/facts.csv`: `F9FFFEF62EAF4F0B0FAD4F6B475E77D464AD2FB3687B9312EAF68407AA40A920`
  - 빌드는 `public/snapshots/*`를 **읽기만** 하고 쓰지 않는다. 내부 스냅샷 빌드 후에도 두 해시 불변.
- **`NEC_COLLECTOR`**: OFF(flip 안 함). **`PUBLIC_PIPELINE_COLLECTOR`**: 미설정(손대지 않음). NEC 호출 **3회/예산 10,000**.
- **`NEC_API_KEY`(64자)·`OPEN_ASSEMBLY_API_KEY`(32자)**: `.env`에만 존재. 내부 스냅샷/CSV/coverage/report·공개
  출력 **어디에도 없음**(스캔 결과 전부 false). 로그엔 redact된 URL만(`***REDACTED***`).
- **Iter-29 key-strip 재확인:** 재생성 NEC `source_url` =
  `http://apis.data.go.kr/9760000/WinnerInfoInqireService2/getWinnerInfoInqire?sgId=20240410&sgTypecode=2&numOfRows=100&resultType=json`
  — `serviceKey` 없음, 출처 보존. 키-스트립 수정이 이번 실데이터 실행에서도 유효.
- **PII 미도입(불변 #7):** coverage 사이드카는 `politician_id` + status + 표준 사유만 담는다. 쌍둥이를 가르는 어떤
  식별자도 추가하지 않는다 — 보류가 terminal 상태.
- 내부 산출물은 `data/internal/nec-dry-run/`(.gitignore 제외), `out/`도 gitignore. 공개 빌드로 `out/`을 publishable
  mock 상태로 복원하고 종료.

---

## 5. Verdict — 두 gap이 닫혔고, 렌더링 계층은 go-live 준비됐는가?

**둘 다 닫힘. 렌더링 계층 go-live 준비 완료(데이터·공개경계·비밀 계층은 Iter-29에서 이미 확정).**

- **GAP 1(스냅샷→UI):** 닫힘. 상세 페이지가 스냅샷을 단일 진실 공급원으로 읽고(mock은 스냅샷 부재 시에만 폴백),
  내부 non-mock 스냅샷으로 300 멤버가 실제로 렌더됨을 305-페이지 빌드로 검증. go-live로 NEC 사실이 스냅샷에 실리면
  추가 배선 없이 화면에 나타난다.
- **GAP 2(보류 렌더러):** 닫힘. ambiguous-withheld·out-of-scope를 공개 스냅샷 스키마를 건드리지 않는 사이드카
  carrier로 운반하고, 검증됨/검수중·불일치 카드와 시각적으로 구분되는 정직한 "보류"/"범위 밖" 카드로 렌더. 매칭된
  멤버에는 나타나지 않고, NEC 매칭처럼 보이지 않는다(불변 #3 가시화).

> 한 줄: **스냅샷→UI 배선과 "보류" 렌더러를 둘 다 구현·검증했다. 이제 go-live로 NEC 교차검증 결과(불일치·보류·범위밖)가
> 실제 사용자 화면에 정직하게 나타난다. 공개 출력 바이트 동일, `NEC_COLLECTOR` OFF로 끝 — 깨끗한 사람 go/no-go를 남긴다.**

---

## Reviewer (Chapter 0 점검 — 내부 non-mock 스냅샷 기준 end-to-end)

- **#1 AI는 사실을 만들지 않는다:** 재구성기는 스냅샷 행의 값/출처/불일치만 되돌릴 뿐 새 사실을 만들지 않는다.
  보류 carrier는 *비-식별*을 라벨링할 뿐 어떤 값도 생성·선택하지 않는다. ✅
- **#2 출처 동반:** 재구성된 evidence는 `source_id/kind/org/url/fetched_at/license_note`를 그대로 보존(round-trip
  테스트로 단언). NEC `source_url`은 키 제거 후에도 안정 서비스 경로 유지. ✅
- **#3 모르면 모른다:** 박지원 쌍둥이를 강제 매칭하지 않고 "보류" 카드로 *명시 표면화* — 검증됨/검수중·NEC 매칭과
  접히지 않음. 사이드카가 없으면 carrier도 없음(라벨을 지어내지 않음). 이번 반복이 Iter-29의 "UI 미노출" gap을 해소. ✅
- **#4 불일치는 병합하지 않고 드러낸다:** 강선우 등 6건 content_conflict가 두 출처(OA 현재 vs NEC 선거일)를 나란히,
  병합 없이 렌더(빌드 HTML로 확인). 재구성도 evidenceId 참조를 보존(테스트). ✅
- **#5 데이터 성격 분리 / #8 객관성은 증명:** 보류 carrier는 공개 스냅샷 본문(verified_facts/discrepancies/news_feed)
  밖 사이드카로 분리 — 공개 스키마·바이트 동일 보존. 상태별 렌더가 spot-check로 검사 가능(블랙박스 아님). ✅
- **#7 공인의 공적 정보만:** coverage 사이드카는 politician_id + status + 표준 사유만 — 쌍둥이 가르는 PII 0. ✅

## 확정 / 남은 것 / 다음 반복 권고

- **확정:** (1) 상세 페이지를 스냅샷 단일 진실 공급원으로 전환(mock은 폴백) — 내부 non-mock 스냅샷으로 300 멤버 렌더
  검증. (2) ambiguous-withheld/out-of-scope를 스키마 불변 사이드카 carrier로 운반 + 정직한 "보류"/"범위 밖" 렌더러
  추가 — 검증됨/검수중과 구분. (3) 공개 출력 바이트 동일, `NEC_COLLECTOR` OFF, 키 누출 0, Iter-29 key-strip 유효.
  178 tests(177 pass/1 skip/0 fail), lint·typecheck·public-boundary·snapshot clean.
- **남은 것(정직한 경계):** 검색 화면은 클라이언트 번들이라 아직 mock-data 기반(커밋 스냅샷=mock이라 ID 일치로
  현재는 무해). 스냅샷 기반 검색은 정적 인덱스 산출이 필요 — 별도 작업.
- **다음 반복 권고:** 렌더링 gap이 닫혔으므로 **사람 go/no-go**를 다시 올린다(flip은 여전히 사람 전용:
  `NEC_COLLECTOR`/`PUBLIC_PIPELINE_COLLECTOR` 활성화 + coverage 사이드카를 공개 파이프라인 산출에 포함). 원한다면
  후속으로 검색 화면을 정적 스냅샷 인덱스 기반으로 전환.
