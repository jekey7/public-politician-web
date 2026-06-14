# Iteration 6 - Fetch-injected Open Assembly collector and citation UI

## Architect

- 범위: Open Assembly HTTP collector 골격, fetch injection 테스트, QA citation UI 보강.
- 결정: collector는 `fetch`를 주입받아 네트워크 없이 테스트한다.
- 결정: Open Assembly 응답은 raw row를 보존하고, public exposure는 별도 mapper가 source metadata를 확인한 뒤 수행한다.
- 결정: QA citation UI는 evidence id와 원문 링크 행동을 명시한다.

## ASSUMPTION

- 기본 endpoint path는 `ALLNAMEMBER`로 둔다. 공식 API 문서 확인 후 수정 가능하다.
- collector의 `licenseNote` 기본값은 TODO 문구이며, 실제 공개 릴리스 전 확정해야 한다.
- Open Assembly 응답 shape은 endpoint마다 다를 수 있어 `row` 배열을 재귀적으로 찾는 보수적 파서를 둔다.

## Implementer

- `src/lib/collectors/open-assembly.ts`: `OpenAssemblyCollector.collect()`가 URL을 만들고 injected fetch로 raw rows를 수집하도록 구현.
- `tests/collectors.test.ts`: URL query, raw row 보존, fetchedAt, license note, 실패 응답 거부 검증.
- `src/app/qa/qa-client.tsx`: citation 카드에 evidence id와 원문 링크 안내 추가.
- `src/app/globals.css`: citation/evidence/news metadata 스타일 정리.

## Reviewer

### 확정된 것

- Open Assembly collector는 API 키를 URL query에 넣고 JSON 요청을 구성한다.
- HTTP 실패는 raw record로 조용히 변환하지 않고 에러로 처리한다.
- 수집 raw row는 `OpenAssemblyMemberRecord`에 `sourceUrl`, `fetchedAt`, `licenseNote`와 함께 보존된다.
- QA citation은 출처 기관, snippet, evidence id, 원문 링크를 함께 보여준다.

### 남은 것

- 공식 endpoint path와 필드명 확인.
- 실제 API 응답의 오류 코드/body shape 처리.
- raw archive 민감정보 스캔.
- Playwright 등 브라우저 기반 UI 회귀 테스트.

### 다음 반복 권고

- 브라우저 테스트를 도입해 메인 필터와 QA citation 표시를 실제 DOM 기준으로 검증한다.
- Open Assembly mapper의 필드 매핑표를 docs에 추가하고 테스트 fixture를 필드별로 확장한다.
