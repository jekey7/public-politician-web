# Iteration 23 - Open Assembly license verification + real cross-verification pipeline

두 directive를 한 iteration에서 다뤘다. 보고는 분리한다.

---

## Directive 1 — Open Assembly source-review dossier (network-verified)

### Architect

- 범위: "no live network" 제약이 source-review 검증 한정으로 해제됨에 따라, 열린국회정보 공개 약관/저작권 페이지를 직접 읽어 dossier의 TBD/ASSUMPTION을 검증된 사실로 교체한다.
- 제약 유지: 정책을 `approved`로 직접 바꾸지 않는다(AGENTS.md §0 — 승인은 사람). 공개 약관/저작권/소개 페이지만 읽고, 인증/쓰기/폼 제출/API 키 사용은 하지 않는다. 가져온 URL + retrieved-at을 source metadata로 기록한다.

### Implementer

- `docs/source-reviews/open_assembly.md`: 검증된 사실로 갱신.
  - License: **공공누리 제1유형(출처표시)** — 상업적 이용·변경 허용, 출처표시 의무. (저작권 정책 페이지 인용)
  - Terms: 제7조 출처표시 의무, 제4조 상업적 이용 허용, 제9조 면책. (이용약관 페이지 인용)
  - API key(KEY) 필요 → `OPEN_ASSEMBLY_API_KEY` env로만 읽음(이번 검토에서 키 미발급/미사용).
  - 모든 사실에 출처 URL + retrieved-at(2026-06-12) 기록. `status`는 `pending_review` 유지, `publish_snapshot_allowed: false` 유지.
  - Open questions(인증키 필요): 제22대 현직 의원 목록 endpoint 확정, raw 응답 필드 코드 검증. 상세 서비스 페이지가 표를 JS로 렌더링해 정적 fetch로 필드 코드를 추출하지 못함 → 인증키 호출이 필요한 human 단계로 표면화.
  - Approval criteria 섹션 추가(license 확인됨 / endpoint·field 검증 / privacy scan 통과 / scope 한정 / reviewed_at·reviewer 기입).
- `docs/DATA_SOURCES.md`: Open Assembly 라이선스 검증 결과 반영.

### Reviewer (0장 점검)

- (8) 공개 가능: 공공누리 제1유형은 출처표시 라이선스로 CC BY 호환, 비영리·오픈소스 전제와 충돌 없음.
- (2) 출처 결합: 검증 사실마다 출처 URL + retrieved-at을 dossier에 기록해 verifiable 상태 유지.
- 승인 경계 준수: 정책을 approved로 바꾸지 않았고, dossier verifier(`verify:source-review-dossiers`)가 `pending_review`로 통과.

### Verification

- `npm run verify:source-review-dossiers` passed: 7 real source dossiers (open_assembly는 여전히 pending).

---

## Directive 2 — Real cross-verification pipeline (정합 + 탐지)

### Architect

- 범위: 손으로 작성한 mock discrepancies를 제거하고, 규칙 기반 entity-matching(정합) + discrepancy-detection(탐지)으로 대체한다. LLM은 연결하지 않고(불변 원칙 #1) classifier/matcher interface를 호출하는 skeleton을 만든다.
- 결정: 탐지 핵심 로직은 동기(`detectProfileDiscrepanciesSync`)로 구현하고, 비동기 `AiVerifier`는 그 위의 얇은 wrapper(`materializeSyncVerifier`로 pairwise match·classify 선계산)로 둔다. → 정적 mock 데이터(모듈 로드 시점)와 async 파이프라인이 **동일한 탐지 로직**을 공유한다. 사전 작성 discrepancy 단일 진실 공급원 제거.
- 정합: pairwise `matchEntity`를 union-find로 묶어 cluster 생성.
- 탐지: cluster 1개 + 동일 표기 → 불일치 없음 / cluster 1개 + 표기 상이 → 표기 차이 / cluster 2개 이상 → 내용 충돌·정보 누락. 종류 분류는 classifier interface가 결정.

### Implementer

- `src/lib/cross-verification.ts` (신규): `SyncCrossVerifier` interface, `detectProfileDiscrepanciesSync`(동기 핵심), `detectProfileDiscrepancies`/`attachDetectedDiscrepancies`(async wrapper), union-find clustering.
- `src/lib/ai.ts`: 규칙 로직을 `mockSyncVerifier`(동기)로 추출하고 `MockAiVerifier`가 위임. `classifyDiscrepancy`는 출처 수/표기/부분문자열 관계로 notation_variance·content_conflict·missing_from_source를 구분.
- `src/lib/verification.ts`: 입력 profile의 사전 작성 discrepancies를 쓰지 않고 항상 탐지로 새로 생성해 부착. 수집 → 정합 → 탐지 → 저장 흐름.
- `src/lib/mock-data.ts`: 손으로 작성한 discrepancies 배열 제거. `rawPoliticians`에서 동기 탐지로 discrepancies를 채워 `politicians` export.
- `scripts/verify-ui.ts`: detail 검증을 탐지 생성 label(`education 내용 충돌`)로 갱신(사전 작성 문자열 의존 제거).
- `tests/cross-verification.test.ts` (신규, 10 tests): 단일 출처 제외, 완전 일치 무탐지, 표기 차이/내용 충돌/정보 누락 분류, 출처 보존(병합 금지), async=sync 일치, 사전 discrepancy 폐기 후 재탐지, 파이프라인 통합.

### 탐지 결과(mock 데이터)

- mock-001: education → content_conflict(행정학과/행정학 학사/정치외교학과), career → notation_variance(부분문자열, 사전 데이터엔 없던 신규 탐지), committees → content_conflict.
- mock-001 party(동일 표기 2출처) → 무탐지(false positive 없음 확인). mock-002(단일 출처) → 무탐지.

### Reviewer (0장 점검)

- (1) AI 사실 생성 없음: 탐지는 기존 출처 evidence를 match/classify만 한다. `kind`는 classifier가, cluster는 matcher가 결정. 코드가 새 사실을 만들지 않는다. `detector`는 정직하게 `rule`(LLM 미연결).
- (2) 출처 결합: discrepancy는 `evidenceIds`로 출처별 evidence를 참조하고, evidence는 `SourceMeta`를 유지.
- (4) 병합 금지·드러내기: `evidenceIds`에 관련 evidence를 모두 담고 값을 고르거나 합치지 않는다.

### 확정된 것

- 정적 mock UI와 async 파이프라인이 동일한 규칙 기반 탐지를 사용한다. 사전 작성 discrepancy는 제거됨.
- 표기 차이/내용 충돌/정보 누락 분류가 출처 텍스트 규칙으로 도출된다(하드코딩 라벨 아님).

### 남은 것

- LLM matcher/classifier 실제 연결(현재 interface는 mock 규칙). 연결 시 `AiVerifier` 구현만 교체하면 됨.
- committees 같은 prefix 상이 표기를 표기 차이로 보려면 더 정교한 정합 신호 필요(현재 규칙은 부분문자열 기준이라 content_conflict로 분류 — 정직한 규칙 기반 결과).

### Verification

- `npm test` passed: typecheck + 72 tests (63 → 72, +9: 신규 cross-verification 10, snapshot 1 흡수 등).
- `npm run verify:all` passed: snapshot 생성, static build/export, snapshot·source-review·source-license·dependency-license·public-pipeline·open-assembly-fixture·UI·a11y·design·public-boundary 검증, typecheck, 72 tests, lint.
- `npm run audit:moderate` passed: 0 vulnerabilities (→ `verify:release` 전체 green).
