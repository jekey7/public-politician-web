# Iteration 3 - Snapshot tests and collector contract

## Architect

- 범위: 스냅샷 구조 검증 테스트, Open Assembly 환경변수 계약, collector 분리.
- 결정: `npm test`는 타입체크와 Node test runner를 함께 실행한다.
- 결정: 실제 Open Assembly collector는 아직 네트워크 호출을 하지 않는다. 약관, 필드 매핑, raw 보존 정책이 먼저 필요하다.
- 결정: mock collector를 별도 파일로 분리해 실제 collector와 테스트 fixture의 책임을 나눈다.

## ASSUMPTION

- Open Assembly endpoint와 필드 매핑은 아직 확정되지 않았다.
- 실제 API 키는 로컬 `.env` 또는 배포 환경변수에서만 제공한다.
- 현재 public snapshot은 목 데이터 구조 검증용이며 실제 공개 데이터 릴리스가 아니다.

## Implementer

- `tests/snapshot.test.ts`: fact/source 결합, 불일치 evidence 참조, 뉴스 재호스팅 금지 구조 검증.
- `tests/collectors.test.ts`: Open Assembly 환경변수 계약 검증.
- `src/lib/collectors/types.ts`: collector 공통 인터페이스.
- `src/lib/collectors/mock.ts`: 목 collector 분리.
- `src/lib/collectors/open-assembly.ts`: Open Assembly config와 불활성 collector 골격.
- `.env.example`: 필요한 환경변수 문서화.
- `docs/DATA_SOURCES.md`: 데이터 소스 연동 규칙과 TODO.

## Reviewer

### 확정된 것

- 스냅샷 구조가 테스트로 보호된다.
- 출처 없는 fact가 스냅샷에 들어가면 테스트가 실패한다.
- 불일치가 존재하지 않는 evidence id를 참조하면 테스트가 실패한다.
- 뉴스 스냅샷에는 본문/이미지/썸네일 복제 필드가 없다.
- Open Assembly API 키는 하드코딩하지 않고 환경변수로만 읽는다.

### 남은 것

- Open Assembly 실제 endpoint 호출과 raw record 저장.
- collector 결과를 `PoliticianProfile`로 정합하는 adapter.
- RAG 코퍼스 인덱싱 구조.
- UI 수준의 브라우저 상호작용 테스트.

### 다음 반복 권고

- Open Assembly raw record 타입과 `EvidenceValue` 매핑 adapter를 mock raw fixture로 먼저 구현한다.
- 이후 RAG 코퍼스 빌더를 스냅샷 기반으로 분리해 출처 인용 응답을 테스트한다.
