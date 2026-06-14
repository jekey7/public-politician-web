# Iteration 18 - Source license gate

## Architect

- 범위: public snapshot에 실데이터 source kind가 들어오기 전 소스별 license review 상태를 실행 가능한 gate로 검증한다.
- 결정: `docs/DATA_SOURCES.md`의 절차 문구만으로는 release 차단이 되지 않으므로 `src/lib/source-license.ts`에 source kind별 policy를 둔다.
- 결정: 현재 MVP는 mock-only이므로 mock source는 명시적인 `MOCK DATA ONLY` note가 있으면 통과한다.
- 결정: `open_assembly`, `public_data_portal`, `rokps`, `nec`, `news_search`, `rss`, `manual_review`는 license review 전까지 `pending_review`로 두고 public snapshot 포함을 차단한다.

## ASSUMPTION

- 아직 실제 소스 약관 검토가 완료되지 않았으므로 모든 non-mock source kind는 공개 스냅샷에서 금지된다.
- 승인된 실제 소스가 생기면 해당 source kind policy를 `approved`로 바꾸고 license note 문구를 TODO/ASSUMPTION 없는 확정 문구로 갱신한다.

## Implementer

- `src/lib/source-license.ts`: source license policy와 snapshot source license validator 추가.
- `scripts/verify-source-licenses.ts`: `public/snapshots/latest.json` 대상으로 release gate 추가.
- `tests/source-license.test.ts`: 현재 mock-only 통과, mock note 누락 실패, real-source pending 실패 검증.
- `package.json`: `verify:source-licenses` script 추가 및 `verify:all` sequence에 포함.
- `docs/RELEASE_PROCEDURE.md`, `docs/DATA_SOURCES.md`: source license gate와 public release boundary 갱신.

## Reviewer

### 확정된 것

- mock-only snapshot은 `MOCK DATA ONLY` license note와 mock-only assumption이 있어야 통과한다.
- non-mock source kind는 source license policy가 `approved`가 아니면 public snapshot release gate에서 실패한다.
- 승인된 source라도 `TODO`, `ASSUMPTION`, `provisional`, `replace`, `confirm` 같은 임시 문구가 license note에 남으면 실패한다.

### 남은 것

- 실제 소스별 약관/라이선스 검토와 approved policy 전환.
- Real browser focus order and computed contrast checks.
- Production collector integration with approved source terms.

### 다음 반복 권고

- Add a source review dossier template for each real source before turning any policy to `approved`.
- Add a real browser runner later for focus order and contrast.

### Verification

- `npm test` passed: typecheck and 44 tests.
- `npm run verify:release` passed: snapshot generation, static build/export, snapshot verification, source license verification, UI verification, accessibility verification, design verification, public boundary verification, typecheck, 44 tests, lint, and moderate audit.
