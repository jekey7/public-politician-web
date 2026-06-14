# Iteration 31 — Go-live flip: ① real-data public + ③ NEC cross-verification, search gated

이번 반복은 **사람(프로젝트 오너)이 명시 승인한 go-live flip**이다. 에이전트가 스스로 승인한 것이 아니다.
조건은 검색 기능을 임시로 게이트한 뒤, `PUBLIC_PIPELINE_COLLECTOR=open_assembly`와 `NEC_COLLECTOR=nec`를
같은 공개 파이프라인에서 함께 켜는 것이다.

---

## 0. §0.7 사람 승인 기록 (2026-06-14)

프로젝트 오너는 2026-06-14에 다음 결정을 명시 승인했다.

- ① `PUBLIC_PIPELINE_COLLECTOR=open_assembly`: 열린국회정보 OA collector를 실제 공개 스냅샷 파이프라인에 연결한다.
- ③ `NEC_COLLECTOR=nec`: 중앙선거관리위원회 NEC collector를 같은 실제 공개 스냅샷 파이프라인에 연결한다.
- 단, 검색 화면은 스냅샷 기반 검색 rewrite 전까지 임시 게이트로 막고 정직한 안내만 노출한다.

이는 라이선스 승인(2026-06-13, OA KOGL Type 1 / NEC 제한 없음) 이후의 **별도 운영 승인**이다.
이번 문서는 그 사람 결정을 기록할 뿐이며, 승인 주체를 에이전트로 간주하지 않는다.

---

## 1. ADR-8 — 스냅샷 기반 검색 rewrite 전 임시 검색 게이트

### 문제

Iter-30에서 상세 페이지는 공개 스냅샷을 읽도록 배선됐지만, 홈 검색은 클라이언트 번들이어서 여전히
`src/lib/search.ts`의 mock-data 검색 결과를 노출했다. ①을 켜면 공개 스냅샷에는 실제 OA 300명이 들어가는데,
검색 화면은 3개 이하의 목 항목만 보여 사용자가 공개 데이터 상태를 오해할 수 있다.

### 결정

스냅샷 기반 검색 인덱스 rewrite는 다음 반복으로 미루고, 이번 go-live의 사전조건으로 홈 검색 UI를 임시 게이트한다.

- `src/app/home-search.tsx`에 `SEARCH_GATE_ENABLED`와 `SearchGateNotice`를 둔다.
- 표시 문구는 다음 하나뿐이다: `검색 기능은 현재 개발 중이며, 복구되는 대로 제공할 예정입니다.`
- 검색 input/select/results는 노출하지 않는다. 따라서 stale mock 결과가 조용히 보이는 경로가 없다.
- 상세 페이지는 막지 않는다. `/politicians/{id}` 직접 URL은 공개 스냅샷 기반으로 계속 동작한다.

### TODO

후속 반복에서 공개 스냅샷으로부터 정적 검색 인덱스를 생성하고, `SearchGateNotice`를 snapshot-based search UI로
교체한다. 이때 mock-data 기반 `searchPoliticians`의 홈 검색 의존을 제거하거나 QA 전용 경계로 분리한다.

---

## 2. 구현 변경

- 공개 파이프라인:
  - `selectPublicPipelineCollector()`가 `PUBLIC_PIPELINE_COLLECTOR=open_assembly`를 선택한 뒤,
    `NEC_COLLECTOR=nec`일 때만 NEC collector를 추가로 실행한다.
  - NEC 행은 기존 `mapNecRecord` → `mergeNecIntoProfiles` 경로를 그대로 사용한다.
  - 불일치 탐지는 기존 `runBatchVerificationPipeline`이 수행한다.
  - NEC API 호출은 공개 파이프라인 내부에서 `3/6` budget guard로 카운트하고, 로그 URL의 `serviceKey`는
    `***REDACTED***`로만 출력한다.
- 공개 carrier:
  - `latest.json` 본문 스키마는 변경하지 않았다.
  - `public/snapshots/latest-coverage.json`을 공개 manifest checksum 대상에 추가했다.
  - mock 모드에서는 빈 coverage carrier를 쓰고, NEC live 모드에서는 `ambiguous_withheld`와 `out_of_scope`만 담는다.
- 문구:
  - 홈/상세의 mock-era copy를 실제 공개 스냅샷 설명으로 바꿨다.

---

## 3. 공개 스냅샷 생성 결과 (real public output)

실행 경로는 `scripts/dry-run-nec-snapshot.ts`가 아니라 표준 `npm run snapshot`이다. 환경은 다음처럼 명시했다.

- `PUBLIC_PIPELINE_COLLECTOR=open_assembly`
- `NEC_COLLECTOR=nec`
- `SNAPSHOT_AI_BACKEND=mock`

`SNAPSHOT_AI_BACKEND=mock`은 수집을 mock으로 바꾸지 않는다. OA/NEC 수집은 실제 API를 호출했고, 불일치 분류만
검증된 deterministic rule-based verifier로 고정했다. 로컬 Ollama 자동 선택은 이번 go-live에서 불필요하게 오래
걸려 timeout을 유발했으므로 사용하지 않았다.

파이프라인 출력:

- OA profile: **300**
- total facts: **2764**
- OA facts: **2286**
- NEC facts: **478**
- discrepancies: **243** = notation_variance **237** + content_conflict **6**
- NEC coverage: matched **239** / genuine-unmatched **13** / ambiguous-withheld **2** / out-of-scope(비례) **46**
- NEC calls: **3/6** local guard, 일일 10,000 budget 대비 3 calls
- Open Assembly calls: roster 1 call (`pSize=300`)

---

## 4. SHA256 변경 — 의도된 첫 공개 데이터 변경

이번 변경은 프로젝트 시작 이후 **첫 의도적 public `latest.json` / `facts.csv` 변경**이다.
Iter-29/30에서 검토한 internal dry-run 내용과 일치하며, unexpected drift가 아니다.

| artifact | before | after |
| --- | --- | --- |
| `public/snapshots/latest.json` | `A0A1304676FF65BD879E036264FF0B3F70968022F6613443C3AECA96B1FA6E65` | `32A5A785255A60FD16A5B8405BF1C5157F7C596B44739ABE503C9A4850556A0B` |
| `public/snapshots/facts.csv` | `F9FFFEF62EAF4F0B0FAD4F6B475E77D464AD2FB3687B9312EAF68407AA40A920` | `C4A53D44B72F4BEA59449D0BB74B697859B144DC42570F8E0BA5FBF8209F75D7` |
| `public/snapshots/latest-coverage.json` | 없음 | `0BE34F9A693ED03D3D27E20AAF0C44A6744C0BADD53071457BE1056AE2594829` |

---

## 5. Chapter 0 invariant checks — real public output 기준

- **#2 출처 동반 / 키 제거:** NEC facts **478**건 모두 `source_url/source_org/fetched_at`을 갖는다.
  `source_url`의 `serviceKey`/`Key` 노출 **0**. `latest.json`/`facts.csv` 인증 파라미터 노출 **0**.
  NEC sample URL:
  `http://apis.data.go.kr/9760000/WinnerInfoInqireService2/getWinnerInfoInqire?sgId=20240410&sgTypecode=2&numOfRows=100&resultType=json`
- **#4 불일치 비병합:** party `content_conflict` **6**건은 두 출처 값을 모두 보존한다.
  - 강선우: OA `무소속` / NEC `더불어민주당`
  - 김병기: OA `무소속` / NEC `더불어민주당`
  - 김종민: OA `무소속` / NEC `새로운미래`
  - 이춘석: OA `무소속` / NEC `더불어민주당`
  - 장경태: OA `무소속` / NEC `더불어민주당`
  - 조정식: OA `무소속` / NEC `더불어민주당`
- **#3 모르면 모른다:** 박지원 2명(`open-assembly-8BF5855P`, `open-assembly-H7X3372O`)은
  `latest-coverage.json`에서 `ambiguous_withheld`이고, 빌드 HTML에서 `보류 — NEC 교차검증 식별 불가`로 렌더된다.
  genuine-unmatched나 verified로 접히지 않는다.
- **#5 데이터 성격 분리:** coverage carrier는 `latest.json` 본문 밖 `latest-coverage.json`에 있다.
  본문 schema는 유지했고, carrier는 보류/범위밖 상태만 담는다.
- **라이선스 표기:** `npm run verify:source-licenses` 통과. 공개 rows의 source kinds는 `nec`, `open_assembly`.
  - OA note: `출처: 열린국회정보, 국회의원 인적사항 (공공누리 제1유형, 출처표시), https://open.assembly.go.kr`
  - NEC note: `출처: 중앙선거관리위원회, 당선인 정보 조회 서비스 (이용허락범위 제한 없음), https://www.data.go.kr/data/15000864/openapi.do`
- **비밀:** `.env` 외 `src/scripts/tests/docs/public/out/schemas`에서 실제 `OPEN_ASSEMBLY_API_KEY` /
  `NEC_API_KEY` literal scan 결과 **0**. 공개 로그의 NEC URL은 `***REDACTED***`.

---

## 6. Build / render verification

- `npm run build`: 성공. Next static generation **305 pages**.
  - `/` + `/qa` + `/_not-found`
  - `/politicians/[id]` real OA profiles **300**
  - build log: `Generating static pages (305/305)`
- 홈 검색:
  - `out/index.html`에 `SEARCH TEMPORARILY UNAVAILABLE`와
    `검색 기능은 현재 개발 중이며, 복구되는 대로 제공할 예정입니다.` 렌더.
  - `<input>` / `<select>` 없음.
  - `김공개` / `이투명` stale mock 결과 없음.
- 상세 페이지 direct URL spot-check:
  - 강선우 `open-assembly-MNZ4401T`: `CONTENT_CONFLICT`, OA/NEC 두 출처와 두 party 값 렌더.
  - 강대식 `open-assembly-L2I9861C`: NEC 출처와 `NOTATION_VARIANCE` 렌더.
  - 박지원 `open-assembly-8BF5855P`, `open-assembly-H7X3372O`: `ambiguous_withheld` 보류 카드 렌더.
  - 강경숙 `open-assembly-T2T8225E`: `out_of_scope` 범위 밖 카드 렌더.
- `npm run verify:ui`: pass.
- `npm run verify:public-boundary`: pass.
- `npm run verify:snapshot`: pass, 4 public artifacts / 2764 facts.
- `npm run verify:public-pipeline`: pass.

---

## 7. Tests / lint / typecheck

최종 실행 결과:

- `npm run typecheck`: pass.
- `npm test`: pass.
- `npm run lint`: pass.

---

## 8. Reviewer — Chapter 0 점검

- **확정:** 플랫폼은 이제 ① OA real public pipeline과 ③ NEC cross-verification이 실제 공개 산출물에 활성화된
  상태다. 검색은 ADR-8에 따라 임시 게이트됐다.
- **확정:** 공개 `latest.json`/`facts.csv` 변경은 의도된 첫 데이터 flip이며, Iter-29/30 dry-run 수치와 일치한다.
- **확정:** 상세 페이지는 real public snapshot을 기준으로 300명에 대해 정적으로 생성되며, 보류/범위밖 carrier도
  공개 sidecar로 inspect 가능하다.
- **남은 것:** snapshot-based search rewrite. 현재 홈 검색은 정직하게 닫혀 있으며 stale mock 검색 UI는 없다.
- **다음 반복 권고:** `latest.json`에서 정적 검색 인덱스를 생성하고, 검색 UI를 그 인덱스에 연결한 뒤 ADR-8 gate를 제거한다.

한 줄 결론: **플랫폼은 ①과 ③이 활성화된 live public data 상태이며, 검색은 후속 rewrite 전까지 의도적으로 게이트됐다.**
