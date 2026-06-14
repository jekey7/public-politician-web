# Dependency license policy

이 프로젝트는 코드와 검증 과정을 공개 가능한 상태로 유지해야 한다.
새 의존성을 추가하거나 lockfile이 바뀌면 `npm run verify:dependency-licenses`가 package-lock의 license metadata를 검사한다.

## Allowed license ids

현재 gate는 아래 SPDX license id를 공개 호환 license로 허용한다.

- `0BSD`
- `Apache-2.0`
- `BSD-2-Clause`
- `BSD-3-Clause`
- `BlueOak-1.0.0`
- `CC-BY-4.0`
- `CC0-1.0`
- `ISC`
- `MIT`
- `MIT-0`
- `Python-2.0`

## Documented exceptions

아래 license는 자동 허용하지 않고, 지정된 package path에서만 문서화된 예외로 허용한다.

- `LGPL-3.0-or-later`: `@img/sharp-*` transitive optional image binaries. Next.js build toolchain이 끌고 오는 optional dependency이며, 프로젝트 소스에 복사하거나 수정하지 않는다.
- `MPL-2.0`: `axe-core` dev dependency. 정적 접근성 smoke test 도구로만 사용하며 public snapshot/data 산출물에 포함하지 않는다.

## Blocked by default

- license metadata가 없는 package
- GPL/AGPL 계열처럼 공개 배포 조건 검토가 필요한 강한 copyleft license
- 위 허용 목록 또는 문서화된 예외에 없는 license id

예외를 늘려야 하면 먼저 이 문서에 이유와 범위를 남기고 `src/lib/dependency-licenses.ts`의 policy를 함께 갱신한다.
