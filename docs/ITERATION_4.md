# Iteration 4 - Raw mapping and snapshot RAG

## Architect

- 범위: Open Assembly raw fixture mapping, snapshot 기반 RAG corpus, 인용 응답 테스트.
- 결정: Open Assembly raw record는 `sourceUrl`과 `licenseNote`가 없으면 화면 노출용 profile로 변환하지 않는다.
- 결정: RAG corpus는 `PublicSnapshot.verified_facts`에서만 생성한다. 뉴스 피드는 RAG 근거로 쓰지 않는다.
- 결정: RAG 응답은 citation이 없으면 `관련 자료 없음`만 반환한다.

## ASSUMPTION

- Open Assembly 실제 endpoint raw key는 아직 확정되지 않았다. 현재 mapper는 `NAAS_CD`, `HG_NM`, `POLY_NM`, `ORIG_NM`, `JOB_RES_NM`와 소수 fallback key만 지원한다.
- raw record 저장소는 아직 없다. 실제 collector 구현 전 별도 보존 위치를 정해야 한다.
- RAG는 현재 token 기반 목 검색이며, LLM 도입 시에도 citation contract는 유지한다.

## Implementer

- `src/lib/collectors/open-assembly.ts`: raw member fixture를 sourced `EvidenceValue`로 변환하는 mapper 추가.
- `tests/collectors.test.ts`: source metadata 보존과 source URL 누락 차단 검증.
- `src/lib/rag.ts`: snapshot fact row 기반 RAG corpus builder와 citation-only answer 함수.
- `src/lib/search.ts`: 질의응답을 snapshot 기반 RAG로 전환.
- `tests/rag.test.ts`: citation 포함 응답과 unsupported question 차단 검증.

## Reviewer

### 확정된 것

- Open Assembly raw fixture는 source URL과 license note가 있어야만 노출 가능한 evidence로 변환된다.
- raw 매핑 결과는 실제 `PoliticianProfile` 골격으로 병합 가능하다.
- RAG corpus가 검증 fact snapshot에서만 생성된다.
- 관련 근거가 없는 질문은 citation 없이 `관련 자료 없음`으로 응답한다.

### 남은 것

- Open Assembly 실제 endpoint 호출과 raw response 저장.
- raw key 매핑표를 공식 API 문서 기준으로 확정.
- RAG 검색 품질 개선과 LLM adapter의 JSON contract 검증.
- 브라우저 기반 UI 테스트.

### 다음 반복 권고

- raw record 보존 포맷을 `public/snapshots/raw`와 분리된 내부 산출물로 설계한다.
- LLM adapter 인터페이스에 structured output validator를 추가해 개체 정합/불일치 분류 결과를 엄격하게 검증한다.
