# Iteration 29 — 공개 파이프라인 NEC 증거 렌더링 사전 검증 (go-live 전 dry-run, flip 없음)

이 반복은 **검증 전용**이다. 사람의 go-live flip은 여기서 수행하지 않는다(§0.7: `NEC_COLLECTOR` 활성화 및
`PUBLIC_PIPELINE_COLLECTOR` 연결은 사람 전용 결정이며 끝까지 OFF로 둔다). 목적은 **사람의 go/no-go 이전에**,
공개 파이프라인이 실제로 NEC 데이터를 방출할 때 올바르게 동작하는지를 *내부 dry-run 스냅샷*으로 확인하는 것이다.

검증 후 공개 출력은 **바이트 동일**로 유지하며, 내부 산출물은 `data/internal/`(gitignored)에만 남긴다.

---

## 0. 무엇을 새로 만들었나 — 그리고 왜

기존 `dry-run-nec-cross-verification-live.ts`는 검증 **수치(facts)** 를 보고할 뿐, 공개 파이프라인이 실제로
방출하는 **스냅샷 객체(latest.json / facts.csv)** 를 만들지 않았다. Iter-29 과제 1은 "NEC collector를 켠 채
non-mock 스냅샷을 재생성"하라고 명시한다. 따라서 신규 스크립트
[`scripts/dry-run-nec-snapshot.ts`](../scripts/dry-run-nec-snapshot.ts) 를 추가했다. 이 스크립트는:

- OA roster + NEC 당선인을 **라이브** 수집(공개 collector와 동일한 `NecCollector`/`OpenAssemblyCollector` 경로),
- `mapNecRecord → mergeNecIntoProfiles → detectProfileDiscrepanciesSync → classifyNecCoverage` 로 처리,
- **공개 파이프라인이 쓰는 바로 그 라이브러리 함수** `buildPublicSnapshot` / `factsToCsv` 로 스냅샷을 빌드,
- 결과를 `data/internal/nec-dry-run/snapshot-latest.json` / `snapshot-facts.csv` / `snapshot-report.json` 에만 기록.

공개 `public/snapshots/*` 는 **읽지도 쓰지도 않는다**. `NEC_COLLECTOR`는 OFF 그대로다(스크립트가 collector를
직접 생성하는 내부 read-only 경로이며, 어떤 NEC 행도 공개 경로로 가지 않는다).

기존 라이브 보고서(`live-latest.json`)와 달리 `classifyNecCoverage(detected, oaProfiles, merge.ambiguous)`
처럼 **`merge.ambiguous`를 세 번째 인자로 넘겨** 박지원 쌍둥이가 genuine-unmatched로 섞이지 않고
ambiguous-withheld로 분리되게 했다(불변 #3).

라이브 수집 규모: NEC 254행, OA 300 profiles, NEC 호출 **3회**(페이지당 100 cap → 100/100/54), 예산 10,000/day,
cap 6. 재생성 스냅샷: 총 facts **2,764**(그중 nec **478**), discrepancies **243**.

---

## 1. 발견 (FINDING) — 사전 차단해야 할 비밀 누출, 그리고 그 수정

재생성 스냅샷을 실제로 직렬화하자, **인증키가 evidence의 `source_url`로 새어 스냅샷 JSON과 facts.csv에 노출**되는
것이 드러났다. 이는 mock-only 공개 출력에서는 한 번도 발현되지 않던(실 collector가 꺼져 있었으므로) 결함이며,
**바로 이번처럼 실 collector가 켜진 go-live 조건에서만 나타난다.** 정직하게 보고한다: 이 dry-run이 없었다면
사람이 go-live flip을 했을 때 공개 facts.csv에 API 키가 실릴 뻔했다.

원인은 NEC·OA collector **양쪽** 공통이었다. `NecCollector`(`serviceKey=<key>`)와
`OpenAssemblyCollector`(`Key=<key>`) 모두 키가 든 fetch URL을 그대로 `record.sourceUrl`로 보관했고, 그 값이
모든 `EvidenceValue.source.sourceUrl` → 스냅샷/CSV로 흘렀다.

**수정(소스 레벨, §4 비밀 분리):** collector가 fetch에는 키 든 URL을 쓰되, evidence로 보관·노출되는 `sourceUrl`
에서는 키(및 page 파라미터)를 제거한 **공개 가능한 안정 식별자**만 남기도록 했다.

- `src/lib/collectors/nec.ts` — `stripServiceKey()` 추가, `collect()`가 이를 적용.
- `src/lib/collectors/open-assembly.ts` — `stripAuthKey()` 추가, `collect()`가 이를 적용.
- 회귀 가드: `tests/nec-collector.test.ts` / `tests/collectors.test.ts`에 "fetch URL엔 키가 있어도 `sourceUrl`엔
  키가 없어야 한다"는 단언을 추가(불변 #2 — `sourceUrl`은 여전히 존재하고 안정 서비스 경로를 유지).

수정 후 방출된 NEC `source_url` 예:
`http://apis.data.go.kr/9760000/WinnerInfoInqireService2/getWinnerInfoInqire?sgId=20240410&sgTypecode=2&numOfRows=100&resultType=json`
— 키 없음, 출처는 보존. 재실행 시 `key literal in artifact: false`, `key in facts CSV: false`.

---

## 2. 공개 경계 검증 (재생성 스냅샷 기준 — mock fixture 아님)

| 불변 | 검사 | 결과 |
| --- | --- | --- |
| **#2 출처 동반** | NEC fact 478건 전부 `source_url`/`source_org`(중앙선거관리위원회)/`fetched_at` 보유. 누락 0건. `source_url`은 키 제거됨(§1). | ✅ PASS |
| **#4 불일치 병합 금지** | party content_conflict **6건**, 전부 두 출처 값을 **나란히, 병합 없이, 각각 인용 가능**(`presentsBothUnmerged=true`). | ✅ PASS |
| **sdName 미방출** | 라이브에서 본 sdName(시도)이 emit된 district 값으로 등장 0건. district는 raw `sggName`만, sdName은 매칭 비교 전용. | ✅ PASS |
| **#3 모르면 모른다 (ambiguous-withheld)** | 박지원×2가 genuine-unmatched로 **접히지 않음**(`notInGenuineUnmatched=true`). `classifyNecCoverage`가 `ambiguousWithheld=2`로 분리, 표준 사유 `"동명이인 — 식별 불가, NEC 교차검증 보류"`. | ✅ PASS |
| **out-of-scope 비례 오분류 금지** | 비례대표 46석은 unmatched가 아니라 out-of-scope로 분류(OA district 표기 "비례대표"). | ✅ PASS |

**커버리지(라이브):** matched **239** / genuine-unmatched **13** / ambiguous-withheld **2** / out-of-scope(비례) **46**
= 총 300. (메모리상의 직전 측정 239/13/2/46/6과 일치 — sido-aware 기본 정규화.)

**6건 진짜 당적 변경 spot-check(불변 #4):** 전부 OA=무소속(현재) vs NEC=선거일 정당 — 사후 탈당/무소속 전환자로,
*버그가 아니라 드러나야 할 신호*다.

| 의원 | OA(현재) | NEC(선거일) |
| --- | --- | --- |
| 강선우 | 무소속 | 더불어민주당 |
| 김병기 | 무소속 | 더불어민주당 |
| 김종민 | 무소속 | 새로운미래 |
| 이춘석 | 무소속 | 더불어민주당 |
| 장경태 | 무소속 | 더불어민주당 |
| 조정식 | 무소속 | 더불어민주당 |

(이 dry-run의 detector는 `rule`/mock verifier다 — 이번 과제는 *불일치 surfacing*의 검증이지 AI 분류 정확도가
아니다. 두 출처를 병합 없이 나란히 인용하는 것이 핵심.)

genuine-unmatched 13명(조사용, PII 아님 — 공개 신원): 김남국, 김남준, 김성범, 김의겸, 김태규, 송영길, 유의동,
윤용근, 이광재, 이진숙, 임문영, 전은수, 한동훈. (지역구인데 NEC 당선인과 매칭 안 됨 — 보궐/사퇴/승계 등으로
선거일 당선인≠현직일 수 있는 정상 신호이며, 강제 매칭하지 않는다.)

---

## 3. UI 렌더링 상태 (정직한 보고 — gap 포함)

> 검출된 상태가 실제 화면에 어떻게 나타나는지, 빌드된 정적 HTML(`out/politicians/*.html`)로 확인했다.
> **렌더러가 없는 상태는 메우지 않고 gap으로 보고한다.**

| 요구 상태 | 렌더링 | 근거 |
| --- | --- | --- |
| **(a) content_conflict 불일치 배지 + 두 출처** | ✅ **렌더됨** | 상세 페이지가 `warning-card` + `rail-time` 배지(`CONTENT_CONFLICT`)로 표시하고, 각 discrepancy의 두 출처를 **나란히** 링크된 evidence로 보여준다(빌드 HTML에서 확인: committees 충돌이 열린국회정보/헌정회 두 값을 각각 표시). 실 party-switch 6건도 동일 렌더러를 그대로 탄다. |
| **(c) NEC 출처 attribution/link** | ✅ **렌더됨** | 중앙선거관리위원회가 `source_org`로, `source.sourceUrl`이 `href`로 fact 목록과(참여 시) discrepancy evidence에 렌더된다. |
| **(b) ambiguous-withheld "보류" 상태** | ❌ **렌더 안 됨 — 정직한 GAP** | 빌드 HTML에 "보류" 텍스트 0건. 아래 상세. |

### GAP 상세 — 무엇이 없는가 (papering over 금지)

1. **타입에 carrier가 없다.** `ambiguous-withheld`는 `classifyNecCoverage`의 **커버리지 분류 결과**일 뿐,
   `PoliticianProfile`·`Discrepancy`·`PublicSnapshot` 어디에도 이를 담을 필드가 없다. 따라서 스냅샷에 실리지 않는다.
2. **UI가 이 상태를 참조하지 않는다.** `src/app/**` 어디에도 `보류`/`ambiguousWithheld`/`withheld`/`outOfScope`/
   `classifyNecCoverage` 참조가 없다. ambiguous-withheld도 out-of-scope(비례)도 화면에 *명시 라벨*로 표시되지 않는다.
3. **더 근본적 gap — 상세 페이지는 스냅샷을 읽지 않는다.** `src/app/politicians/[id]/page.tsx`는
   `getPoliticianById`(=`src/lib/mock-data.ts`)에서만 읽는다. 재생성된 NEC 스냅샷(또는 어떤 공개 `latest.json`)도
   현재 UI의 렌더링 소스가 **아니다**. 즉 go-live로 NEC 데이터가 스냅샷에 실려도, **UI를 스냅샷에 연결하기 전에는**
   실제 NEC 충돌/보류가 화면에 나타나지 않는다.

> 요약: 불일치 배지와 출처 링크는 렌더링 준비됨(상태 (a)(c)). 그러나 **"보류"의 정직한 표면화(상태 (b))와
> 스냅샷→UI 배선은 아직 구현되지 않았다.** 이는 누락된 렌더러이자 배선이며, 실패가 아니라 **다음 반복이 해소할
> finding**이다.

---

## 4. Revert + 가드레일 재확인

- **공개 출력 바이트 동일** (반복 전 == 반복 후, SHA256):
  - `public/snapshots/latest.json`: `A0A1304676FF65BD879E036264FF0B3F70968022F6613443C3AECA96B1FA6E65`
  - `public/snapshots/facts.csv`: `F9FFFEF62EAF4F0B0FAD4F6B475E77D464AD2FB3687B9312EAF68407AA40A920`
- **`NEC_COLLECTOR`**: 미설정/OFF (끝까지 flip 안 함). **`PUBLIC_PIPELINE_COLLECTOR`**: 미설정(mock 기본, 손대지 않음).
- **`NEC_API_KEY`**: `.env`에만 존재. 본 문서·추적 파일 어디에도 없음(전체 소스 스캔 결과 0건). 로그엔 redact된 URL만
  (`***REDACTED***`). NEC 호출 **3회/예산 10,000일** (cap 6, 루프/재시도 없음).
- 내부 산출물은 `data/internal/nec-dry-run/`(.gitignore의 `data/internal/`로 제외).

### 테스트 / 린트 / 타입체크

- `npm test`(typecheck 포함): **169 pass / 1 skip(OLLAMA_INTEGRATION 미설정) / 0 fail**.
- `npm run lint`: clean.
- `npm run typecheck`(tsc --noEmit): clean.
- `npm run verify:public-boundary`: PASS(공개 스냅샷·manifest·HTML 링크·내부 raw 분리 정상 — 내부 경로 누출 없음).

소스 변경은 두 collector의 `sourceUrl` 키 제거 + 테스트 2건 강화뿐이며, 공개 mock 스냅샷 산출물은 불변(바이트 동일).

---

## 5. Verdict — 공개 파이프라인은 go-live 렌더링 준비가 됐는가?

**부분 준비 (CONDITIONAL).**

- **데이터/공개경계 계층: 준비됨(확정).** 재생성 non-mock 스냅샷에서 불변 #2·#3·#4가 모두 성립한다(mock fixture가
  아니라 라이브 239/13/2/46/6 스냅샷 기준). 6건 당적 변경이 두 출처를 병합 없이 드러내고, 박지원 보류가 정직하게
  분리되며, 비례 46이 오분류되지 않고, sdName이 값으로 새지 않는다.
- **비밀 경계: 발견→수정 완료(확정).** 키가 `source_url`로 새던 결함을 이번 dry-run이 잡아 소스에서 막았다. 이
  수정이 없었다면 go-live가 키를 공개했을 것이다 — **dry-run의 직접적 성과**.
- **렌더링 계층: 미완(차단 요인 아님, 그러나 go-live 전 필요).** 불일치 배지·출처 링크는 렌더링되지만, (1) "보류"
  상태 렌더러가 없고 (2) 상세 페이지가 스냅샷이 아니라 mock-data를 읽는다. 따라서 *지금 go-live 하면 NEC 충돌/보류가
  사용자 화면에 보이지 않는다.*

> 한 줄: **데이터·공개경계·비밀 계층은 go-live 준비 완료(이번 dry-run이 키 누출까지 잡아 막음). 그러나
> 스냅샷→UI 배선과 "보류" 렌더러는 아직 없다 — 사람 flip 전에 이 두 gap을 닫아야 사용자가 실제로 NEC 교차검증
> 결과를 본다.** go-live flip은 수행하지 않았고, `NEC_COLLECTOR`는 OFF로 끝난다.

---

## Reviewer (Chapter 0 점검 — 재생성 스냅샷 기준)

- **#1 AI는 사실을 만들지 않는다:** dry-run은 라이브 collector가 준 party/district를 매칭·분류할 뿐, 새 사실을
  생성하지 않는다. detector=rule(mock)이라 LLM 서술도 없다. ✅
- **#2 출처 동반:** NEC fact 478건 전부 source 메타데이터 보유, `source_url`은 키 제거 후에도 안정 식별자 유지. ✅
- **#3 모르면 모른다:** 박지원 쌍둥이를 강제 매칭하지 않고 ambiguous-withheld로 분리, 표준 사유 명시. ✅
  (단, 이 정직한 상태가 *UI에는 아직 노출되지 않음* — §3 gap으로 보고.)
- **#4 불일치는 병합하지 않고 드러낸다:** 6건 당적 변경이 두 출처 값을 나란히 보존(`presentsBothUnmerged`). 어느
  쪽도 조용히 선택·억제하지 않음. ✅
- **#5 데이터 성격 분리 / #8 객관성은 증명:** 재생성 스냅샷은 `data/internal/`에만, 공개 출력은 바이트 동일.
  표·충돌·커버리지가 report로 검사 가능(블랙박스 아님). ✅
- **#7 공인의 공적 정보만:** mapper는 party/district만 emit, `NEC_DROPPED_PII_FIELDS`(생년월일/성별/학력/경력/
  직업/주소/연령)는 버린다. sdName도 값으로 노출 안 함(매칭 전용). ✅

## 확정 / 남은 것 / 다음 반복 권고

- **확정:** (1) 라이브 NEC 증거를 담은 non-mock 스냅샷을 공개 라이브러리 함수로 재생성하고 불변 #2·#3·#4를 그 위에서
  검증. (2) 키가 `source_url`로 새던 사전-go-live 결함을 발견·소스 수정·회귀 테스트로 고정. (3) 공개 출력 바이트 동일,
  `NEC_COLLECTOR` OFF 유지. 169 pass/1 skip/0 fail, lint·typecheck·public-boundary clean.
- **남은 것(정직한 gap):** ① 상세 페이지가 mock-data를 읽음 — 공개 스냅샷(`latest.json`)을 렌더링 소스로 배선해야
  실 NEC 데이터가 화면에 나타난다. ② ambiguous-withheld "보류"/out-of-scope(비례)를 담을 스냅샷 필드 + 정직한
  "보류" 렌더러가 없음.
- **다음 반복 권고:** 두 gap을 닫는 작업 — (a) `PublicSnapshot`에 coverage/withheld 상태 carrier 추가(불변 #3을
  타입으로 표현), (b) 상세 페이지를 스냅샷 기반으로 전환, (c) "보류"·"범위 밖" 명시 라벨 렌더러 추가. 그 후 다시
  go/no-go 판단을 사람에게 올린다(flip은 여전히 사람 전용).
