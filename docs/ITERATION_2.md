# Iteration 2 - Snapshot and working filters

## Architect

- 범위: 정기 공개 스냅샷의 최소 구조, 목 파이프라인 출력 스크립트, 메인 화면 검색/필터 동작.
- 결정: 공개 스냅샷은 `verified_facts`, `discrepancies`, `news_feed`로 분리한다.
- 결정: CSV는 fact row만 우선 출력하고, 전체 구조와 뉴스/불일치는 JSON에 둔다.
- 결정: 개인정보 경계는 별도 문서로 먼저 고정하고 실제 collector 구현 전에 검토 기준으로 사용한다.

## ASSUMPTION

- 실제 데이터 라이선스 검토 전이므로 `public/snapshots` 산출물은 mock-only 공개 형식 검증용이다.
- 검색 필터는 목 데이터 기준의 클라이언트 필터로 시작한다. 실제 300명 규모에서도 정적 JSON 로딩으로 충분하다고 본다.

## Implementer

- `src/lib/snapshot.ts`: 공개 스냅샷 직렬화와 fact CSV 생성.
- `scripts/generate-snapshot.ts`: `runVerificationPipeline()` 결과를 `public/snapshots/latest.json`, `public/snapshots/facts.csv`로 출력.
- `src/app/home-search.tsx`: 이름/정당/지역/위원회 필터가 실제 목 데이터를 필터링.
- `src/app/politicians/[id]/page.tsx`: 불일치 카드에 관련 evidence의 원문 값, 출처 링크, 검수 상태, 수집 시각 표시.
- `docs/PUBLIC_DATA_POLICY.md`: 공적 정보 공개 기준과 제외 범위 초안.

## Reviewer

### 확정된 것

- 공개 스냅샷에 모든 fact row의 출처 메타데이터가 포함된다.
- 검증 데이터와 뉴스 피드는 스냅샷과 UI에서 분리된다.
- 불일치 섹션이 ID만 보여주지 않고 관련 출처 값을 함께 노출한다.
- 메인 IA의 검색/정당/지역/위원회 필터가 목 데이터 기준으로 동작한다.

### 남은 것

- 실제 collector별 raw record 타입과 source adapter 구현.
- JSON 스냅샷에 대한 스키마 검증 테스트.
- CSV 범위를 discrepancies/news까지 확장할지 결정.
- 성별/생년 표시 필요성은 공개 기준 문서의 ASSUMPTION대로 재검토가 필요하다.

### 다음 반복 권고

- 스냅샷 JSON 구조를 검증하는 테스트를 추가한다.
- Open Assembly collector 인터페이스와 환경변수 기반 API 설정을 mock adapter로 먼저 분리한다.
