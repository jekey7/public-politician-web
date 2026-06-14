# Open Assembly field mapping draft

이 문서는 Open Assembly raw member record를 MVP `EvidenceValue`로 바꾸는 임시 매핑표다.
공식 endpoint와 필드명이 확정되기 전까지는 `ASSUMPTION`으로 취급한다.

## Member identity fields

| MVP field | Raw key candidates | Category | Exposure rule |
| --- | --- | --- | --- |
| `politicianId` | `NAAS_CD`, `member_id`, `id` | internal id | 값이 없으면 record를 노출하지 않는다. |
| `displayName` | `HG_NM`, `name`, `NAME` | identity | 값이 없으면 record를 노출하지 않는다. |
| `party` | `POLY_NM`, `party` | identity | 값이 있으면 source metadata와 함께 보존한다. |
| `district` | `ORIG_NM`, `district` | identity | 값이 있으면 source metadata와 함께 보존한다. |
| `position` | `JOB_RES_NM`, `position` | identity | 값이 없으면 `국회의원` 목 기본값을 사용한다. |

## Required source metadata

- `sourceUrl`
- `sourceOrg`
- `fetchedAt`
- `licenseNote`

`sourceUrl` 또는 `licenseNote`가 없으면 mapper는 `null`을 반환한다.

## Not mapped yet

- 학력
- 경력
- 선거 이력
- 발의 법안
- 표결
- 위원회

위 항목은 endpoint와 raw key를 확정한 뒤 별도 mapper로 추가한다. 추정 필드명을 근거로 public snapshot에 노출하지 않는다.

## Internal fixture dry-run (Iteration 22)

매핑이 의도대로 동작하는지를 공개 산출물 없이 검증하기 위한 internal-only dry-run이 있다.

- 구현: [src/lib/public-pipeline.ts](../src/lib/public-pipeline.ts)의 `runOpenAssemblyFixtureDryRun` / `assertOpenAssemblyFixtureDryRun`.
- 입력: [src/lib/raw-records.ts](../src/lib/raw-records.ts)의 `mockOpenAssemblyRawRecords()` 목 raw record.
- 명령어: `npm run verify:open-assembly-fixture` (`verify:all`에 포함).
- 흐름: raw record → `buildInternalRawArchive`(privacy scan) → `mapOpenAssemblyMemberRecord` → `mergeOpenAssemblyMappedProfile` → `buildPublicSnapshot`(internal 검증 전용).

dry-run은 다음 5가지를 단언한다.

1. snapshot schema가 통과한다.
2. raw archive privacy scan이 통과한다.
3. 매핑된 identity 필드(`party` / `district` / `position`)만 노출된다.
4. 추정 학력/경력/선거/법안/표결/위원회 필드가 나타나지 않는다 (raw record에 그런 키가 있어도 mapper가 무시).
5. open_assembly가 `pending_review`인 동안 source-license gate가 snapshot을 **여전히 거부**한다.

이 dry-run의 snapshot은 internal 검증 전용이며 `public/snapshots`로 절대 기록되지 않는다.
