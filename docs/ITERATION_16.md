# Iteration 16 - Design token gate

## Architect

- 범위: `DESIGN.md`의 핵심 시각 규칙을 CSS 토큰/규칙 smoke gate로 고정한다.
- 결정: 실제 픽셀 렌더링과 contrast 계산은 아직 브라우저 러너 대상이며, 이번 반복은 코드 기반으로 확정 가능한 CSS drift를 막는다.
- 결정: 검증 대상은 `src/app/globals.css`이며 `verify:design`을 `verify:all`에 포함한다.

## ASSUMPTION

- 이 검증은 token/rule drift 방지용이며 실제 viewport별 레이아웃, focus style, computed contrast를 대체하지 않는다.
- 새 컴포넌트가 의도적으로 새 색상이나 radius를 추가하면 `DESIGN.md`와 verifier를 함께 갱신해야 한다.

## Implementer

- `scripts/verify-design.ts`: 필수 디자인 토큰, raw color palette, no-gradient, allowed shadow, radius scale, key component CSS rule 검증.
- `package.json`: `verify:design` script 추가 및 `verify:all` sequence에 포함.
- `docs/RELEASE_PROCEDURE.md`: 릴리스 절차에 design gate 추가.

## Reviewer

### 확정된 것

- canvas black, mint, ultraviolet, hover blue, muted text 등 핵심 색상 토큰이 고정되었다.
- gradient 사용은 gate에서 차단된다.
- shadow는 primary button hover의 1px ring만 허용된다.
- radius는 현재 디자인에서 사용하는 2px, 20px, 24px, 40px로 제한된다.
- primary button, StoryStream rail, result/accent/warning cards, mono uppercase label group 규칙이 검증된다.
- 이 변경은 데이터 사실, 출처, 불일치, 뉴스 재호스팅 경계에 영향을 주지 않는다.

### 남은 것

- Real browser visual regression checks for rendered pages.
- Computed color contrast checks for dark canvas, accent cards, and focus states.
- Focus order and keyboard navigation checks.

### 다음 반복 권고

- Add a privacy/public-boundary release gate that confirms internal raw archives are never linked from public pages or manifest.
- Later, add a real browser runner for computed contrast and responsive layout snapshots.

### Verification

- `npm run verify:release` passed: snapshot generation, static build/export, snapshot verification, UI verification, accessibility verification, design verification, typecheck, 41 tests, lint, and moderate audit.
