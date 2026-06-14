# Iteration 14 - Hydrated DOM interaction tests

## Architect

- 범위: 실제 브라우저 러너 도입 전, jsdom으로 hydrated client component interaction을 검증한다.
- 결정: Playwright 같은 무거운 브라우저 의존성은 아직 도입하지 않고, React DOM + jsdom으로 input/select 이벤트와 async QA answer state를 확인한다.
- 결정: `QaClient`는 Next search params wrapper로 유지하고, 테스트 가능한 `QaSearch` 컴포넌트를 분리한다.
- 결정: Next build에서는 자동 JSX 런타임이 처리되지만 Node test import에서도 안정적으로 렌더링되도록 client component에 `React` import를 명시한다.

## ASSUMPTION

- jsdom 테스트는 실제 브라우저 레이아웃, focus order, CSS rendering, network prefetch behavior를 대체하지 않는다.
- Full accessibility and visual regression coverage still requires a browser runner later.

## Implementer

- `package.json`, `package-lock.json`: `jsdom`, `@types/jsdom` dev dependency 추가.
- `src/app/home-search.tsx`: Node DOM test import를 위한 `React` import 추가.
- `src/app/qa/qa-client.tsx`: `QaSearch` component 분리 및 export.
- `tests/home-search-dom.test.ts`: 홈 검색 input/select interaction과 empty state DOM 테스트.
- `tests/qa-dom.test.ts`: QA citation-backed answer와 fixed no-material answer DOM 테스트.

## Reviewer

### 확정된 것

- 홈 검색은 hydrated DOM에서 검색어, 지역 select 변경에 따라 렌더링 결과 수와 의원 카드가 바뀐다.
- QA는 hydrated DOM에서 출처가 있는 질문에는 citation evidence를 표시하고, 근거가 없는 질문에는 정확히 `관련 자료 없음`만 표시한다.
- 테스트는 기존 mock evidence와 RAG 규칙만 사용하며 AI가 새 사실을 만들지 않는다.
- 출처 없는 사실 노출, 불일치 병합, 뉴스 원문 재호스팅과 관련된 변경은 없다.

### 남은 것

- Real browser interaction tests for focus order, keyboard navigation, and CSS-driven states.
- Accessibility checks for form labels, link names, external-link affordances, and color contrast.
- Visual regression checks against `DESIGN.md`.

### 다음 반복 권고

- Add an accessibility verification script against static HTML and component markup.
- Later, add Playwright or another real browser runner only when layout/focus/CSS assertions are required.

### Verification

- `npm run verify:release` passed: snapshot generation, static build/export, snapshot verification, UI verification, typecheck, 41 tests, lint, and moderate audit.
