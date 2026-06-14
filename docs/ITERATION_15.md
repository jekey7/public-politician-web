# Iteration 15 - Static accessibility gate

## Architect

- 범위: 정적 export 산출물에 대한 기본 접근성 smoke gate를 릴리스 검증에 추가한다.
- 결정: 외부 접근성 엔진은 아직 도입하지 않고, `jsdom`으로 배포 HTML의 landmark, heading, label, link, button, image 기본 조건을 검사한다.
- 결정: `verify:a11y`는 `npm run build` 이후 `out` HTML을 대상으로 실행하며 `verify:all`에 포함한다.

## ASSUMPTION

- 이 검증은 기본 마크업 회귀 방지용이며 실제 브라우저의 focus order, contrast, CSS state 검증을 대체하지 않는다.
- QA form처럼 client-hydrated markup은 DOM interaction tests에서 별도로 검증한다.

## Implementer

- `scripts/verify-a11y.ts`: `out`의 home, QA, politician detail pages를 검사하는 접근성 smoke verifier.
- `package.json`: `verify:a11y` script 추가 및 `verify:all` sequence에 포함.
- `docs/RELEASE_PROCEDURE.md`: 릴리스 절차에 accessibility gate 추가.

## Reviewer

### 확정된 것

- 정적 HTML은 `lang="ko"`, title, 단일 `main`, 단일 `h1`을 가진다.
- 모든 `nav`는 accessible name을 가진다.
- 정적 HTML에 포함된 form controls, links, buttons는 accessible name을 가진다.
- `target="_blank"` 링크는 `rel="noreferrer"`를 가진다.
- 이미지가 추가되면 `alt` 누락을 gate에서 잡는다.

### 남은 것

- Real browser focus order and keyboard navigation checks.
- Color contrast checks against the dark Verge-inspired palette.
- Visual regression checks against `DESIGN.md`.

### 다음 반복 권고

- Add a DESIGN.md visual/token verification script for canvas color, no-gradient/no-shadow drift, and key accent colors.
- Add real browser checks later for focus and computed contrast.

### Verification

- `npm run verify:release` passed: snapshot generation, static build/export, snapshot verification, UI verification, accessibility verification, typecheck, 41 tests, lint, and moderate audit.
