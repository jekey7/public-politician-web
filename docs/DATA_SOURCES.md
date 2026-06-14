# 데이터 소스 연동 계약

실데이터 collector는 AGENTS.md 0장 원칙을 통과한 뒤에만 화면과 공개 스냅샷으로 연결한다.

## 공통 collector 규칙

- collector는 raw record를 먼저 보존하고, 화면 노출용 값은 `EvidenceValue`로 변환한다.
- `EvidenceValue`에는 `SourceMeta`가 반드시 있어야 한다.
- 출처별 값이 다르면 collector 단계에서 덮어쓰지 않는다.
- API 키와 토큰은 환경변수로만 읽는다.
- 소스 약관과 라이선스가 불명확하면 public snapshot에 포함하지 않는다.
- public snapshot 포함 여부는 [src/lib/source-license.ts](../src/lib/source-license.ts)의 source license policy와
  `npm run verify:source-licenses` gate를 통과해야 한다.
- 실제 source kind의 policy를 `approved`로 바꾸기 전 [docs/source-reviews](source-reviews/README.md)의 dossier를
  작성하고 `npm run verify:source-review-dossiers`를 통과해야 한다.
- public snapshot 생성 파이프라인은 `PUBLIC_PIPELINE_COLLECTOR`로 collector mode를 고르며, 기본값은 `mock`이다.
  `open_assembly` mode는 source policy가 `approved`가 되기 전 `npm run verify:public-pipeline`에서 차단된다.

## Open Assembly

- 환경변수:
  - `OPEN_ASSEMBLY_API_KEY`
  - `OPEN_ASSEMBLY_BASE_URL` optional, 기본값 `https://open.assembly.go.kr/portal/openapi`
  - `OPEN_ASSEMBLY_LICENSE_NOTE` public pipeline 연결 시 필수
  - `PUBLIC_PIPELINE_COLLECTOR=open_assembly` source approval 이후에만 사용
- 현재 구현:
  - [src/lib/collectors/open-assembly.ts](../src/lib/collectors/open-assembly.ts)
  - 설정 검증과 불활성 collector 골격만 제공한다.
- internal-only dry-run:
  - `npm run verify:open-assembly-fixture`로 raw record → mapper → profile → snapshot shape를 공개 산출물 없이 검증한다.
  - [src/lib/public-pipeline.ts](../src/lib/public-pipeline.ts)의 `runOpenAssemblyFixtureDryRun`가 schema 통과, privacy scan 통과,
    identity 필드만 노출, 추정 필드 부재, source-license gate가 `pending_review` open_assembly를 여전히 거부함을 단언한다.
  - dry-run snapshot은 internal 검증 전용이며 `public/snapshots`로 기록되지 않는다. 자세한 내용은
    [docs/OPEN_ASSEMBLY_FIELD_MAPPING.md](OPEN_ASSEMBLY_FIELD_MAPPING.md#internal-fixture-dry-run-iteration-22) 참고.
- 라이선스(검증됨, 2026-06-12): 공공누리 제1유형(출처표시) — 상업적 이용·변경 허용, 출처표시 의무.
  [docs/source-reviews/open_assembly.md](source-reviews/open_assembly.md)에 출처 URL과 retrieved-at 기록. 정책 자체는 사람이 승인한다.
- TODO:
  - 제22대 현직 의원 목록 endpoint 확정 (인증키 필요).
  - 원천 필드별 `FactCategory` 매핑표 작성 (현재는 identity 필드만 검증됨).
  - raw record 저장 위치와 공개 스냅샷 포함 범위 결정.

## Mock

- 현재 MVP UI와 테스트는 [src/lib/collectors/mock.ts](../src/lib/collectors/mock.ts)를 사용한다.
- 목 데이터는 실제 정치인 사실로 해석하면 안 된다.
