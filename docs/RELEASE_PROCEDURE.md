# Snapshot release procedure

이 문서는 공개 스냅샷을 배포하기 전 실행할 최소 절차다.

## Commands

Run the full local release gate:

```bash
npm run verify:all
```

Equivalent expanded sequence:

1. `npm run snapshot`
   - `public/snapshots/latest.json`
   - `public/snapshots/facts.csv`
   - `public/snapshots/schema.json`
   - `public/snapshots/manifest.json`
   - `data/internal/raw/open-assembly.mock.json` internal-only
   - cross-verification(정합·분류)은 Ollama 로컬 LLM backend로 batch 실행하며, Ollama가 없으면 규칙/mock으로 자동 fallback 한다.
     설정은 [docs/LOCAL_LLM_SETUP.md](LOCAL_LLM_SETUP.md). 사용된 backend는 실행 로그 마지막 줄에 표시된다.
2. `npm run build`
   - required before `npm run verify:ui`
   - writes static export HTML under `out`
3. `npm run verify:snapshot`
   - public snapshot schema validation
   - manifest counts validation
   - artifact byte size and SHA-256 validation
4. `npm run verify:source-review-dossiers`
   - confirms every real source kind has a review dossier
   - blocks approved source policies without concrete review metadata
5. `npm run verify:source-licenses`
   - blocks real-source rows until each source kind has an approved license policy
   - requires mock rows to keep an explicit mock-only license note
6. `npm run verify:dependency-licenses`
   - verifies package-lock dependency licenses against `docs/DEPENDENCY_LICENSE_POLICY.md`
   - blocks missing, unsupported, or undocumented exception licenses
7. `npm run verify:public-pipeline`
   - confirms the default public collector remains mock
   - blocks real-source public collector modes until source approval
8. `npm run verify:open-assembly-fixture`
   - internal-only Open Assembly fixture dry-run (raw record -> mapper -> profile -> snapshot shape)
   - asserts snapshot schema validity, raw archive privacy scan pass, identity-only field exposure,
     absence of guessed education/career/election/bill/vote/committee fields, and that the
     source-license gate still rejects the snapshot while open_assembly is pending_review
   - does not write any public artifact; the dry-run snapshot is internal validation only
9. `npm run verify:ui`
   - static export HTML release checks
10. `npm run verify:a11y`
   - static export accessibility smoke checks
11. `npm run verify:design`
   - DESIGN.md token and CSS rule drift checks
12. `npm run verify:public-boundary`
   - public/private artifact boundary checks
13. `npm test`
14. `npm run lint`

Run the network-backed dependency audit before an actual public release:

```bash
npm run audit:moderate
```

Or run both gates in sequence:

```bash
npm run verify:release
```

## Release boundary

- Public release artifacts are only files under `public/snapshots`.
- Internal raw archives under `data/internal/raw` are not public release artifacts.
- Real-source rows are forbidden in public snapshots until `src/lib/source-license.ts` marks the source kind approved after documented license review.
- Approved real-source policies require matching `docs/source-reviews/*.md` dossiers with concrete review metadata.
- Dependency licenses must pass `docs/DEPENDENCY_LICENSE_POLICY.md` before public release.
- Public snapshot generation defaults to the mock collector and real-source collector modes are blocked until source approval.
- Raw archive release is forbidden until source license, privacy scan, and retention policy are approved.

## Required files

- `latest.json`: full public snapshot.
- `facts.csv`: fact rows for simple external review.
- `schema.json`: JSON Schema for `latest.json`.
- `manifest.json`: file sizes, SHA-256 checksums, and row counts.

## ASSUMPTION

- Current artifacts are mock-only until real collectors are connected and licenses are reviewed.
- A future GitHub Release should attach the four public files and mention the exact commit SHA.
- Dependency audit results depend on the current npm advisory database and may require framework upgrades rather than automatic `audit fix --force`.
