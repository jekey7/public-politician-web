# Iteration 13 - Search and QA state tests

## Architect

- 범위: hydrated browser runner 도입 전, 홈 검색 필터와 QA citation/no-material 상태의 핵심 로직을 순수 함수 테스트로 고정한다.
- 결정: UI 렌더링 테스트는 아직 도입하지 않고, `HomeSearch`와 `QaClient`가 의존하는 `src/lib/search.ts` public functions를 검증한다.
- 결정: 테스트 데이터는 mock-only이며, 화면에 표시되는 값은 기존 `SourceMeta`가 붙은 profile fields에서만 나온다.

## ASSUMPTION

- Full browser interaction coverage still requires Playwright or another browser runner later.
- Current search assertions cover mock MVP behavior, not real collector ranking or pagination.

## Implementer

- `tests/search.test.ts`: no-filter results, party/region/committee filtering, query matching, filter options, QA cited/no-material state tests.

## Reviewer

### 확정된 것

- 홈 검색 필터의 기본 동작과 빈 브라우저 없이 검증 가능한 상태 계산이 테스트로 고정되었다.
- QA는 관련 자료가 있으면 citation metadata를 포함하고, 없으면 정확히 `관련 자료 없음`과 빈 citation을 반환한다.
- 테스트는 새 사실을 만들지 않고 기존 mock evidence와 공개 스냅샷 빌더만 사용한다.

### 남은 것

- Browser interaction tests for actual input/select changes and rendered result updates.
- Accessibility checks for forms, labels, focus states, and external links.
- Visual regression checks against `DESIGN.md`.

### 다음 반복 권고

- Add a lightweight browser runner for hydrated home search and QA form flows.
- Add accessibility checks for form labels, link names, and focus order.

### Verification

- `npm run verify:release` passed: snapshot generation, static build/export, snapshot verification, UI verification, typecheck, 37 tests, lint, and moderate audit.
