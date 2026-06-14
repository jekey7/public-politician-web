# Iteration 20 - Dependency license inventory gate

## Architect

- 범위: package-lock dependency license metadata를 release gate에서 검사해 공개 가능한 코드 상태를 유지한다.
- 결정: dependency license 검증은 npm registry나 네트워크에 의존하지 않고 `package-lock.json`만 파싱한다.
- 결정: permissive/public-compatible license id는 allowlist로 관리하고, LGPL/MPL처럼 맥락 검토가 필요한 license는 문서화된 package path 예외로만 허용한다.

## ASSUMPTION

- `package-lock.json`의 license metadata가 현재 dependency license inventory의 source of truth다.
- `@img/sharp-*` LGPL 항목은 Next.js/sharp toolchain의 optional transitive binary package이며 프로젝트 소스에 수정/복사하지 않는 조건으로 문서화된 예외로 둔다.
- `axe-core` MPL 항목은 dev-only accessibility test tool이며 public snapshot/data 산출물에 포함하지 않는 조건으로 문서화된 예외로 둔다.

## Implementer

- `src/lib/dependency-licenses.ts`: package-lock license validator와 license expression parser 추가.
- `scripts/verify-dependency-licenses.ts`: dependency license release gate 추가.
- `tests/dependency-licenses.test.ts`: permissive 허용, missing license 실패, undocumented exception 실패, unsupported license 실패 검증.
- `docs/DEPENDENCY_LICENSE_POLICY.md`: allowed license ids와 문서화된 예외 기록.
- `package.json`, `docs/RELEASE_PROCEDURE.md`: release sequence에 dependency license gate 추가.

## Reviewer

### 확정된 것

- lockfile에 license metadata가 없는 dependency는 release gate에서 실패한다.
- allowlist에 없는 license id는 기본 실패한다.
- LGPL/MPL 같은 예외 license는 지정된 package path에서만 통과한다.
- dependency license gate는 network 없이 lockfile만 검사하므로 재현 가능하다.

### 남은 것

- 실제 소스별 약관/라이선스 검토와 approved policy 전환.
- Real browser focus order and computed contrast checks.
- Production collector integration with approved source terms.

### 다음 반복 권고

- Add a real browser runner later for focus order and computed contrast when the environment can support browser automation.
- Start production collector integration only after source review dossiers move from `pending_review` to `approved`.

### Verification

- `npm test` passed: typecheck and 53 tests.
- `npm run verify:dependency-licenses` passed: 428 packages checked.
- `npm run verify:release` passed: snapshot generation, static build/export, snapshot verification, source review dossier verification, source license verification, dependency license verification, UI verification, accessibility verification, design verification, public boundary verification, typecheck, 53 tests, lint, and moderate audit.
