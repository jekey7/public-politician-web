# Iteration 19 - Source review dossier gate

## Architect

- 범위: 실제 source kind를 `approved`로 전환하기 전에 사람이 남겨야 할 검토 기록을 release gate로 고정한다.
- 결정: source license policy의 `reference`는 개별 dossier 파일을 가리키게 한다.
- 결정: pending source는 `publish_snapshot_allowed: false`이면 통과하고, approved source는 구체적인 약관 URL, license note, 검토일, 검토자가 있어야 한다.

## ASSUMPTION

- 현재 모든 non-mock source는 실제 약관 검토 전이므로 dossier status는 `pending_review`다.
- Dossier의 `TBD` 값은 pending source에서만 허용된다.

## Implementer

- `docs/source-reviews/*.md`: real source kind별 pending review dossier 추가.
- `src/lib/source-review-dossiers.ts`: dossier metadata parser와 validator 추가.
- `scripts/verify-source-review-dossiers.ts`: 모든 real source dossier와 policy alignment를 검증하는 gate 추가.
- `tests/source-review-dossiers.test.ts`: pending 통과, pending public 허용 실패, approved metadata 누락 실패 검증.
- `src/lib/source-license.ts`: non-mock source policy reference를 개별 dossier로 변경.
- `package.json`, `docs/DATA_SOURCES.md`, `docs/RELEASE_PROCEDURE.md`: release 절차에 dossier gate 추가.

## Reviewer

### 확정된 것

- 모든 real source kind는 `docs/source-reviews/{source_kind}.md` dossier를 가진다.
- Source license policy status와 dossier status가 다르면 gate에서 실패한다.
- Pending source dossier는 public snapshot 허용을 `false`로 유지해야 한다.
- Approved source는 `https://` 약관 URL, 확정 license note, 검토일, 검토자가 없으면 실패한다.

### 남은 것

- 실제 소스별 약관/라이선스 검토와 approved policy 전환.
- Real browser focus order and computed contrast checks.
- Production collector integration with approved source terms.

### 다음 반복 권고

- Add a dependency license inventory gate so code dependency licenses remain publicly compatible.
- Add a real browser runner later for focus order and contrast.

### Verification

- `npm test` passed: typecheck and 48 tests.
- `npm run verify:source-review-dossiers` passed: 7 real source dossiers verified.
- `npm run verify:release` passed: snapshot generation, static build/export, snapshot verification, source review dossier verification, source license verification, UI verification, accessibility verification, design verification, public boundary verification, typecheck, 48 tests, lint, and moderate audit.
