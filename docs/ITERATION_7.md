# Iteration 7 - Raw privacy scan and Open Assembly mapping draft

## Architect

- 범위: internal raw archive privacy scan, Open Assembly field mapping draft, mapper fixture expansion.
- 결정: internal raw archive도 사적 정보 후보가 발견되면 생성 스크립트에서 실패한다.
- 결정: public snapshot에는 privacy scan 결과와 raw records를 포함하지 않는다.
- 결정: Open Assembly field mapping은 공식 endpoint 확인 전까지 draft/ASSUMPTION으로만 둔다.

## ASSUMPTION

- sensitive key/value scanner는 보수적 휴리스틱이다. 공식 데이터 소스별 필드 확정 후 allowlist와 blocklist를 조정해야 한다.
- `OPEN_ASSEMBLY_FIELD_MAPPING.md`의 raw key candidates는 현재 adapter가 지원하는 후보이며 공식 확정값이 아니다.
- raw archive는 reproducibility를 위한 내부 산출물이며 공개 릴리스 대상이 아니다.

## Implementer

- `src/lib/raw-records.ts`: raw privacy scan, findings, internal archive assertion 추가.
- `tests/raw-records.test.ts`: sensitive key/value 차단 및 archive assertion 검증.
- `tests/collectors.test.ts`: Open Assembly fallback field names와 identity 누락 차단 검증.
- `docs/OPEN_ASSEMBLY_FIELD_MAPPING.md`: 현재 mapper의 field mapping draft 문서화.

## Reviewer

### 확정된 것

- raw archive는 `privacy_scan.status`를 포함한다.
- 주소/전화/이메일/주민번호/가족 관련 key 또는 value 후보가 있으면 blocked finding이 생성된다.
- snapshot generation은 blocked raw archive를 쓰지 못한다.
- Open Assembly mapper는 identity가 없는 raw record를 노출하지 않는다.
- Open Assembly field mapping의 확정 전 상태가 문서에 명시됐다.

### 남은 것

- 실제 Open Assembly 공식 필드 확인.
- raw privacy scanner의 allowlist/blocklist 정교화.
- raw archive 보존 기간과 폐기 정책.
- 브라우저 기반 UI 테스트.

### 다음 반복 권고

- Playwright 또는 대체 브라우저 테스트로 메인 필터와 QA citation DOM을 검증한다.
- 공개 스냅샷에 대한 JSON schema 파일을 추가해 외부 소비자가 구조를 검증할 수 있게 한다.
