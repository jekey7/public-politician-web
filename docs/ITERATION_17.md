# Iteration 17 - Public/private artifact boundary gate

## Architect

- 범위: internal raw archive가 public release artifacts, static HTML links, public artifact links, manifest에 섞이지 않는지 검증한다.
- 결정: 기존 raw privacy scan은 원자료 내용의 민감정보 여부를 보고, 이번 gate는 공개/비공개 산출물 경계 누출을 본다.
- 결정: `verify:public-boundary`는 `npm run build`와 snapshot 생성 이후 실행되어 `public`, `out`, `data/internal/raw`의 현재 산출물을 검사한다.

## ASSUMPTION

- 현재 raw archive는 mock-only internal verification artifact다.
- 실제 raw archive 공개는 source license, privacy scan, retention policy 승인 전까지 금지된다.

## Implementer

- `scripts/verify-public-boundary.ts`: public snapshots, manifest file list, public artifact links, static HTML hrefs, public/out text, internal raw marker 검증.
- `package.json`: `verify:public-boundary` script 추가 및 `verify:all` sequence에 포함.
- `docs/RELEASE_PROCEDURE.md`: 릴리스 절차에 public boundary gate 추가.

## Reviewer

### 확정된 것

- `public`에는 `snapshots` 하위의 공개 스냅샷 파일만 허용된다.
- public snapshot manifest는 `latest.json`, `facts.csv`, `schema.json`만 artifact file로 열거한다.
- public artifact links는 `/snapshots/*`만 가리킨다.
- 정적 HTML anchor는 `data/internal`, `internal/raw`, `open-assembly.mock.json`을 링크하지 않는다.
- public/out 산출물 텍스트에는 internal raw archive path나 filename이 포함되지 않는다.
- internal raw archive는 `visibility: "internal_only"`와 passed privacy scan을 유지한다.

### 남은 것

- Real browser focus order and computed contrast checks.
- Real data source license review and public data license selection.
- Production collector integration with approved source terms.

### 다음 반복 권고

- Add a source license tracking gate that blocks real-source public snapshots until each source has an approved license note.
- Add a real browser runner later for focus order and contrast.

### Verification

- `npm run verify:release` passed: snapshot generation, static build/export, snapshot verification, UI verification, accessibility verification, design verification, public boundary verification, typecheck, 41 tests, lint, and moderate audit.
