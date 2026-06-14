# Iteration 9 - Public release manifest

## Architect

- 범위: public snapshot release manifest, checksum generation, public data links in UI.
- 결정: release manifest는 public artifacts만 대상으로 한다.
- 결정: internal raw archive는 manifest 대상에서 제외한다.
- 결정: footer에 public data 링크를 노출해 투명성 원칙을 화면에서도 드러낸다.

## ASSUMPTION

- checksum은 SHA-256으로 충분하다고 본다.
- 실제 릴리스 태그/버전 정책은 아직 없다. 현재 manifest는 `latest` artifact 기준이다.
- mock data warning은 UI에 계속 유지한다.

## Implementer

- `src/lib/release-manifest.ts`: manifest type, builder, validator.
- `scripts/generate-snapshot.ts`: `manifest.json` 생성.
- `tests/release-manifest.test.ts`: checksum, count, required artifact 검증.
- `src/app/layout.tsx`: public snapshot 링크 footer 추가.
- `src/app/globals.css`: footer link 스타일 추가.

## Reviewer

### 확정된 것

- `public/snapshots/manifest.json`이 생성된다.
- manifest에는 `latest.json`, `facts.csv`, `schema.json`의 bytes와 SHA-256이 포함된다.
- manifest count가 snapshot fact/discrepancy/news 수와 일치하는지 테스트한다.
- internal raw archive는 public manifest 대상에서 제외된다.
- UI footer에서 공개 snapshot, CSV, schema, manifest 링크를 제공한다.

### 남은 것

- 실제 릴리스 버전/태그 정책.
- GitHub Release 업로드 절차.
- 브라우저 테스트로 footer 링크와 QA citation DOM 검증.
- 실제 데이터 연결 후 manifest checksum 재검증.

### 다음 반복 권고

- 브라우저 또는 정적 HTML 테스트를 도입해 공개 데이터 링크, 메인 필터, QA citation 표시를 검증한다.
- 릴리스 절차 문서를 추가해 snapshot/schema/manifest 배포 순서를 명시한다.
