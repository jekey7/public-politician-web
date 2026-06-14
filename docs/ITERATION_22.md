# Iteration 22 - Internal-only Open Assembly fixture dry-run

## Architect

- 범위: 실데이터(Open Assembly) 파이프라인의 shape(raw record → mapper → profile → snapshot)가 동작함을, 미승인 데이터를 공개 산출물로 흘리지 않으면서 internal-only로 증명한다.
- 결정: dry-run은 [src/lib/raw-records.ts](../src/lib/raw-records.ts)의 `mockOpenAssemblyRawRecords()` 목 fixture만 입력으로 쓰고 네트워크를 호출하지 않는다.
- 결정: dry-run이 만드는 snapshot-shaped object는 internal 검증 전용이며 `public/snapshots`로 절대 기록하지 않는다.
- 결정: open_assembly source policy는 `pending_review`로 유지한다. dry-run의 핵심 단언 중 하나는 source-license gate가 이 snapshot을 **여전히 거부**한다는 것이다.
- 결정: identity 외 category(education/career/party_history/election/bill/vote/committee)는 fixture에서 노출되면 안 된다. raw record가 그런 키를 담고 있어도 verified identity mapper가 무시한다.

## ASSUMPTION

- Open Assembly에서 현재 검증된 매핑은 identity 필드(`party` / `district` / `position`)뿐이다.
- 나머지 필드는 endpoint/raw key 확정과 source approval 이후 별도 mapper로 추가한다.

## Implementer

- `src/lib/public-pipeline.ts`: `runOpenAssemblyFixtureDryRun` / `assertOpenAssemblyFixtureDryRun` 추가.
  - raw archive 빌드(privacy scan) → 기존 `mapOpenAssemblyMemberRecord` / `mergeOpenAssemblyMappedProfile` → `buildPublicSnapshot`.
  - 5개 check: `snapshot_schema_valid`, `raw_privacy_scan_passed`, `only_identity_fields_exposed`, `no_guessed_fields`, `source_license_gate_still_rejects`.
- `scripts/verify-open-assembly-fixture.ts`: 목 fixture에 대해 dry-run을 실행하고 check별 결과를 출력한다.
- `tests/open-assembly-fixture.test.ts`: 전체 check 통과, identity-only 노출, license gate 거부 유지, privacy 누출 차단, 추정 필드 비노출, raw key가 있어도 무시됨을 검증.
- `package.json`: `verify:open-assembly-fixture` 스크립트 추가 및 `verify:all`에 편입.
- `docs/OPEN_ASSEMBLY_FIELD_MAPPING.md`, `docs/DATA_SOURCES.md`, `docs/RELEASE_PROCEDURE.md`: dry-run 절차와 경계 문서화.

## Reviewer

### 0장 불변 원칙 점검

- (1) AI 사실 생성 없음: dry-run은 매핑·검증만 한다. 새 사실을 만들지 않는다.
- (2) 출처 없는 데이터 비노출: 노출되는 모든 fact가 `source_kind=open_assembly` + `source_url` + `license_note`를 동반한다.
- (3) 모르면 모름: 검증되지 않은 학력/경력/선거/법안/표결/위원회 필드는 비워 두고 노출하지 않는다.
- (6) 재호스팅 없음: raw record는 internal-only archive로만 보관, 공개 산출물에 들어가지 않는다.
- (7) 공인의 공적 정보: privacy scan이 자택/연락처/주민번호 등 사적 키·값을 차단한다.
- (8) 공개 가능 상태: license gate가 `pending_review` 동안 open_assembly snapshot을 계속 거부한다.

### 확정된 것

- 실데이터 파이프라인 shape가 internal-only로 재현 가능하게 검증된다.
- dry-run은 공개 산출물을 만들지 않으며, open_assembly는 공개 release gate를 통과하지 못한다.
- fixture가 추정 필드를 담고 있어도 identity 필드만 노출된다.

### 남은 것

- 실제 소스별 약관/라이선스 검토와 approved policy 전환.
- approved 이후 실제 endpoint/field mapping 확정 및 identity 외 category mapper 추가.
- approved 이후 fixture dry-run을 live API 호출 전 end-to-end 단계로 확장.

### 다음 반복 권고

- Open Assembly source review dossier를 확정해 approval 판단 자료를 마련한다.
- approved 이후 identity 외 verified 필드 mapper를 추가하면서 dry-run check를 그에 맞게 확장한다(축소 금지).

### Verification

- `npm run verify:open-assembly-fixture` passed: 5 checks (schema, privacy, identity-only, no guessed fields, license gate still rejects).
- `npm test` passed: typecheck and 63 tests (57 → 63, +6).
- `npm run verify:release` passed: snapshot generation, static build/export, snapshot verification, source review dossier verification, source license verification, dependency license verification, public pipeline verification, open-assembly fixture dry-run verification, UI verification, accessibility verification, design verification, public boundary verification, typecheck, 63 tests, lint, and moderate audit (0 vulnerabilities).
- 공개 경계 확인: `public/snapshots/latest.json`에 `open_assembly` row 0개 (dry-run은 공개 산출물을 만들지 않음).
