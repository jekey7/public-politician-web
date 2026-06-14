# Iteration 12 - Full release gate

## Architect

- 범위: 릴리스 전 로컬 검증 명령을 하나로 묶는 `verify:all` 스크립트.
- 결정: `verify:ui`는 `out` 산출물이 필요하므로 `npm run build` 뒤에 실행한다.
- 결정: `verify:all`은 공개 스냅샷 생성, 정적 빌드, 스냅샷 검증, UI 검증, 테스트, 린트까지 포함하는 로컬 결정적 게이트로 둔다.
- 결정: npm advisory database에 의존하는 보안 감사 단계는 `audit:moderate`로 분리하고, 실제 릴리스용 `verify:release`에서 함께 실행한다.
- 결정: `next@15.5.19`가 요구하는 PostCSS 8.x 범위 안에서 `postcss@8.5.10` override를 적용해 moderate advisory를 해결한다.

## ASSUMPTION

- `npm audit --audit-level=moderate`는 npm registry 접근이 가능한 환경에서 실행해야 한다.
- 현재 공개 산출물은 mock-only이며 실제 공개 릴리스 전 소스 라이선스 확정이 필요하다.
- `npm audit` 결과는 실행 시점의 advisory database에 의존하므로 반복 기록에는 실행 결과를 함께 남긴다.

## Implementer

- `package.json`: `verify:all`, `audit:moderate`, `verify:release` 스크립트 추가.
- `package.json`, `package-lock.json`: transitive `postcss` dependency를 8.5.10으로 override.
- `docs/RELEASE_PROCEDURE.md`: 통합 게이트와 동일한 expanded sequence로 갱신.

## Reviewer

### 확정된 것

- `verify:all`은 `verify:ui`보다 먼저 build를 실행하도록 순서가 정리되었다.
- 릴리스 절차 문서는 단일 명령과 세부 명령 순서를 함께 제공한다.
- 보안 감사는 자동 강제 수정 대신 PostCSS patch override로 해결되었고, `npm ls postcss`에서 `postcss@8.5.10 overridden`으로 확인되었다.

### 남은 것

- Browser interaction tests for hydrated search filters and QA results.
- Accessibility checks for forms and external links.
- Visual regression checks against `DESIGN.md`.
- Safe framework dependency upgrade path should still be reviewed regularly before real public release.

### 다음 반복 권고

- Add a lightweight browser or DOM-level test for home filter state and QA citation/no-material state transitions.
- Track a safe framework dependency upgrade path; do not run `npm audit fix --force` if it proposes a major framework downgrade.

### Verification

- `npm run verify:all` passed: snapshot generation, static build/export, snapshot verification, UI verification, typecheck, 32 tests, and lint.
- `npm run audit:moderate` passed with 0 vulnerabilities at execution time.
- `npm run verify:release` passed end-to-end after the PostCSS override.
