# Iteration 5 - Internal raw archive and AI output validation

## Architect

- 범위: raw record 내부 보존 포맷, snapshot generation 확장, LLM structured output validator.
- 결정: raw record archive는 `data/internal/raw`에 생성하고 `.gitignore`로 기본 비공개 처리한다.
- 결정: public snapshot과 internal raw archive는 목적과 공개 범위를 분리한다.
- 결정: LLM adapter가 붙기 전에도 entity matching, discrepancy classification, RAG answer의 구조를 runtime validator로 고정한다.

## ASSUMPTION

- 현재 raw archive는 mock fixture만 포함한다.
- 실제 raw record는 약관/라이선스 검토 전 공개 릴리스에 포함하지 않는다.
- validator는 외부 schema library 없이 현재 MVP 계약만 검사한다.

## Implementer

- `src/lib/raw-records.ts`: internal raw archive type, builder, mock Open Assembly raw fixture.
- `scripts/generate-snapshot.ts`: public snapshot과 별도로 internal raw archive 생성.
- `.gitignore`: `data/internal/` 비공개 처리.
- `src/lib/ai-validators.ts`: entity match, discrepancy kind, RAG answer runtime validator.
- `tests/raw-records.test.ts`: raw archive가 internal-only로 표시되는지 검증.
- `tests/ai-validators.test.ts`: LLM structured output 계약 검증.

## Reviewer

### 확정된 것

- raw records는 public snapshot과 분리되어 내부 경로에 생성된다.
- raw archive에는 `internal_only` visibility와 공개 금지 warning이 포함된다.
- RAG answered output은 citation이 없으면 validator에서 거부된다.
- no-material RAG output은 정확히 `관련 자료 없음`과 빈 citations만 허용된다.
- discrepancy classification은 허용된 세 종류만 통과한다.

### 남은 것

- 실제 Open Assembly HTTP collector.
- raw archive의 보존/폐기 정책과 민감정보 스캔.
- LLM provider adapter와 prompt/schema 파일.
- UI 상호작용 테스트와 접근성 점검.

### 다음 반복 권고

- Open Assembly HTTP collector를 네트워크 호출 없이도 테스트 가능한 fetch 주입 방식으로 구현한다.
- QA 화면에 citation source metadata를 더 명확히 보여주고, 브라우저 테스트를 추가한다.
