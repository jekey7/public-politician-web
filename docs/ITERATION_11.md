# Iteration 11 - Static UI verification

## Architect

- 범위: static export HTML verification, public artifact link constants, UI release gate.
- 결정: `verify:ui`는 `out` HTML을 읽어 정적 배포에서 핵심 링크와 문구가 빠지지 않았는지 검사한다.
- 결정: client-hydrated controls are not asserted from static HTML. They remain a future browser test target.
- 결정: public artifact links are centralized in code and tested separately.

## ASSUMPTION

- `verify:ui`는 `npm run build` 후 실행해야 한다.
- QA form text is client-rendered after hydration, so the static gate checks the server-rendered hero and fallback.
- Full interaction coverage requires Playwright or another browser runner later.

## Implementer

- `src/lib/public-artifacts.ts`: public snapshot artifact links.
- `src/app/layout.tsx`: footer links use shared artifact list.
- `scripts/verify-ui.ts`: static export HTML verifier.
- `tests/public-artifacts.test.ts`: artifact link list and internal path exclusion tests.
- `package.json`: `verify:ui` script.

## Reviewer

### 확정된 것

- `out/index.html` contains public data links and mock search result markers.
- `out/qa.html` contains RAG/citation-only hero text and no-material rule text.
- `out/politicians/mock-001.html` contains detected differences, evidence list markers, and related news.
- footer artifact links cannot accidentally point to `data/internal`.

### 남은 것

- Hydrated browser interaction tests for main filters and QA query results.
- Accessibility checks for forms and links.
- Visual regression checks against DESIGN.md.

### 다음 반복 권고

- Add a lightweight browser test runner if feasible, or add component-level tests for search and RAG UI state transitions.
- Add `verify:all` script that runs snapshot, build, verify:snapshot, verify:ui, test, lint, and audit in release order.
