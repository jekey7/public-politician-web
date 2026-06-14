# Iteration 1 - MVP skeleton

## Architect

- 범위: 정적 Next.js 앱 골격, 출처 결합 데이터 모델, 목 교차검증 파이프라인, RAG 인터페이스.
- 결정: 실데이터처럼 오해될 수 있는 샘플은 모두 `mock` source kind와 `MOCK DATA ONLY` license note를 갖는다.
- 결정: 검증 대상 facts와 뉴스 피드는 타입과 UI 섹션에서 분리한다.
- 결정: RAG 응답은 citation이 없으면 항상 `관련 자료 없음`을 반환한다.

## ASSUMPTION

- 실제 공공 API 키와 데이터 접근 권한은 아직 없다. 따라서 collector는 `MockCollector`로 두고 실제 연동 지점은 TODO로 남긴다.
- 개인정보 경계 문서는 아직 별도 확정 전이다. 현재 목 데이터에는 실제 인물과 실제 사적 정보를 넣지 않는다.
- 디자인은 `DESIGN.md`의 어두운 캔버스, hazard accent, StoryStream rail, pill card 규칙을 우선 적용한다.

## Implementer

- `src/lib/types.ts`: source metadata, evidence value, discrepancy, news, AI/RAG contracts.
- `src/lib/mock-data.ts`: 공개 출처 구조를 흉내 내는 목 정치인 2명과 불일치 2건.
- `src/lib/ai.ts`: 개체 정합, 불일치 분류, 인용 응답 인터페이스와 mock 구현.
- `src/lib/verification.ts`: 수집 -> 분류 -> 저장 결과를 반환하는 파이프라인 골격.
- `src/app`: 메인/검색, 정치인 상세, 질의응답 화면.

## Reviewer

### 확정된 것

- AI가 새 사실을 생성하지 않는 구조로 제한했다.
- 화면에 표시되는 fact는 `EvidenceValue`를 통해 source metadata와 결합된다.
- 불일치 항목은 병합하지 않고 evidence id와 함께 별도 표시한다.
- 뉴스는 검증 데이터와 분리해 링크 중심으로만 표시한다.
- 정적 export 빌드가 통과한다.

### 남은 것

- 실제 데이터 소스별 collector 구현.
- 스냅샷 저장 포맷(JSON/CSV)과 공개 라이선스 문서화.
- 개인정보 공개 기준 문서 작성.
- 검색/필터는 UI 골격이며 실제 클라이언트 필터링 로직은 다음 반복 대상이다.

### 다음 반복 권고

- 데이터 스냅샷 스키마와 파일 출력기를 먼저 추가한다.
- 그 다음 메인 검색 필터를 목 데이터 기준으로 동작하게 만들어 UI와 데이터 계약을 더 좁힌다.
