# Source review dossiers

실제 source kind를 public snapshot에 포함하기 전 작성하는 검토 기록이다.

## Required metadata

각 dossier는 아래 필드를 유지한다.

- `source_kind`: `SourceKind` 값.
- `status`: `src/lib/source-license.ts`의 policy status와 같은 값.
- `publish_snapshot_allowed`: `approved` 전까지 `false`.
- `source_terms_url`: 약관 또는 라이선스 원문 URL. 검토 전이면 `TBD`.
- `license_note_to_use`: public snapshot에 넣을 확정 license note. 검토 전이면 `TBD`.
- `reviewed_at`: ISO date. 검토 전이면 `TBD`.
- `reviewer`: 검토자 식별자. 검토 전이면 `TBD`.

## Approval rule

`src/lib/source-license.ts`에서 source policy를 `approved`로 바꾸려면 먼저 이 dossier를 갱신해야 한다.

- `publish_snapshot_allowed: true`
- `source_terms_url`은 `https://` URL
- `license_note_to_use`, `reviewed_at`, `reviewer`는 `TBD`, `TODO`, `ASSUMPTION` 없는 확정 값
- 검토 결과가 AGENTS.md 0장 원칙과 `docs/PUBLIC_DATA_POLICY.md`에 맞는다는 판단 근거

`npm run verify:source-review-dossiers`가 이 조건을 검증한다.
