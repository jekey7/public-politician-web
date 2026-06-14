# Iteration 21 - Public pipeline collector guard

## Architect

- 범위: public snapshot 생성 파이프라인에서 collector mode를 명시하고, 실데이터 collector가 source approval 전 사용되지 않게 차단한다.
- 결정: 기본 public pipeline collector는 `mock`으로 유지한다.
- 결정: `PUBLIC_PIPELINE_COLLECTOR=open_assembly`는 source license policy가 `approved`가 되기 전 실패한다.
- 결정: Open Assembly profile adapter는 raw records를 `mapOpenAssemblyMemberRecord`와 `mergeOpenAssemblyMappedProfile`로 변환하되, 현재 public pipeline에서는 approval guard 때문에 선택되지 않는다.

## ASSUMPTION

- Open Assembly source review dossier가 `pending_review`인 동안 public snapshot에는 mock 데이터만 들어간다.
- `OPEN_ASSEMBLY_LICENSE_NOTE`는 source approval 이후 public pipeline 연결 시 필수다.

## Implementer

- `src/lib/public-pipeline.ts`: collector mode parser, public pipeline collector selector, Open Assembly profile adapter, source approval guard 추가.
- `scripts/verify-public-pipeline.ts`: 기본 mock mode와 pending real-source guard 검증.
- `tests/public-pipeline.test.ts`: default mock, unsupported mode 실패, pending Open Assembly 실패, Open Assembly adapter mapping 검증.
- `src/lib/collectors/open-assembly.ts`: `OPEN_ASSEMBLY_LICENSE_NOTE` env support 추가.
- `scripts/generate-snapshot.ts`: public pipeline collector selector를 통해 snapshot collector 선택.
- `package.json`, `docs/DATA_SOURCES.md`, `docs/RELEASE_PROCEDURE.md`: public pipeline gate와 env 계약 추가.

## Reviewer

### 확정된 것

- public snapshot generation은 env를 설정하지 않으면 mock collector만 사용한다.
- `PUBLIC_PIPELINE_COLLECTOR=open_assembly`는 source policy가 `pending_review`인 현재 상태에서 실패한다.
- Open Assembly adapter는 identity와 source metadata가 있는 raw record만 public profile로 변환한다.
- 실데이터 collector 연결은 source dossier와 license policy가 approved 된 뒤에만 다음 단계로 진행할 수 있다.

### 남은 것

- 실제 소스별 약관/라이선스 검토와 approved policy 전환.
- Open Assembly approved 이후 실제 endpoint/field mapping 확정 및 public pipeline 연결.
- Real browser focus order and computed contrast checks.

### 다음 반복 권고

- Add a real browser runner later for focus order and computed contrast when the environment can support browser automation.
- After source approval, add an Open Assembly fixture-based end-to-end snapshot generation path before live API use.

### Verification

- `npm test` passed: typecheck and 57 tests.
- `npm run verify:public-pipeline` passed: default mock mode and pending real-source collector guard.
- `npm run verify:release` passed: snapshot generation, static build/export, snapshot verification, source review dossier verification, source license verification, dependency license verification, public pipeline verification, UI verification, accessibility verification, design verification, public boundary verification, typecheck, 57 tests, lint, and moderate audit.
