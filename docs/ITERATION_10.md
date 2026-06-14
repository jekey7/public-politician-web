# Iteration 10 - Snapshot release verification

## Architect

- 범위: public snapshot artifact verifier, release procedure, checksum mismatch test.
- 결정: `verify:snapshot`은 generated public artifacts를 다시 읽어서 manifest와 맞는지 검증한다.
- 결정: public snapshot validation, manifest count validation, byte size/SHA-256 validation을 하나의 release gate로 묶는다.
- 결정: internal raw archive는 release procedure에서 명시적으로 public artifact가 아니라고 적는다.

## ASSUMPTION

- 현재 release target은 `public/snapshots`의 latest artifacts다.
- 실제 GitHub Release 업로드는 아직 자동화하지 않는다.
- `tsx` 실행은 일부 sandbox에서 worker spawn 제한이 있을 수 있다.

## Implementer

- `scripts/verify-snapshot.ts`: public snapshot artifact verifier.
- `src/lib/release-manifest.ts`: artifact content verification helper.
- `tests/release-manifest.test.ts`: checksum mismatch rejection test.
- `package.json`: `verify:snapshot` script.
- `docs/RELEASE_PROCEDURE.md`: release commands and artifact boundary.

## Reviewer

### 확정된 것

- `npm run verify:snapshot`이 public snapshot, schema, manifest, checksums를 재검증한다.
- tampered artifact content는 checksum mismatch로 실패한다.
- release procedure가 snapshot generation, verification, test, lint, build, audit 순서를 명시한다.
- internal raw archive는 release boundary 밖으로 명시됐다.

### 남은 것

- GitHub Release automation.
- 실제 데이터 snapshot에 대한 release verification.
- UI 브라우저 테스트.
- 릴리스 버전 정책.

### 다음 반복 권고

- 정적 HTML 또는 브라우저 테스트로 footer public data 링크와 QA citation DOM을 검증한다.
- release manifest에 commit SHA 또는 build metadata를 추가할지 결정한다.
