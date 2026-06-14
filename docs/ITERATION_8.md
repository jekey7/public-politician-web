# Iteration 8 - Public snapshot schema

## Architect

- 범위: public snapshot JSON Schema, schema copy in snapshot generation, runtime snapshot validator.
- 결정: schema는 외부 소비자가 사용할 수 있도록 `public/snapshots/schema.json`으로 함께 배포한다.
- 결정: validator는 외부 의존성 없이 MVP 핵심 계약을 검사한다.
- 결정: raw archive와 privacy scan은 public snapshot schema에 포함하지 않는다.

## ASSUMPTION

- JSON Schema `$id`는 실제 도메인 확정 전까지 `example.invalid`를 사용한다.
- validator는 완전한 JSON Schema engine이 아니라 현재 스키마의 핵심 invariant를 코드로 검사한다.
- CSV는 fact row 전용이고, 전체 공개 데이터 계약은 JSON snapshot을 기준으로 한다.

## Implementer

- `schemas/public-snapshot.schema.json`: public snapshot schema draft.
- `scripts/generate-snapshot.ts`: schema를 `public/snapshots/schema.json`으로 복사.
- `src/lib/snapshot-validator.ts`: snapshot strict key/source/reference validator.
- `tests/snapshot.test.ts`: validator 통과, extra field 거부, missing evidence 참조 거부 테스트.

## Reviewer

### 확정된 것

- public snapshot은 schema와 함께 생성된다.
- fact/news/discrepancy row의 추가 필드는 validator에서 거부된다.
- fact row는 source metadata 필드가 빠지면 validator에서 실패한다.
- discrepancy가 존재하지 않는 evidence id를 참조하면 validator에서 실패한다.
- raw/internal-only 정보는 public snapshot schema 범위 밖에 남아 있다.

### 남은 것

- 실제 서비스 도메인에 맞춘 schema `$id` 확정.
- 표준 JSON Schema validator 도입 여부 결정.
- browser-level UI 테스트.
- 실제 Open Assembly 데이터로 schema 적합성 검증.

### 다음 반복 권고

- Playwright 또는 정적 DOM 검증을 추가해 메인 검색 필터와 QA citation 표시를 화면 기준으로 테스트한다.
- public snapshot schema를 docs에서 링크하고 릴리스 절차 초안을 작성한다.
