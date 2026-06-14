import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  mapOpenAssemblyMemberRecord,
  mergeOpenAssemblyMappedProfile,
} from "../src/lib/collectors/open-assembly";
import { runNecCrossVerificationDryRun } from "../src/lib/collectors/nec-pipeline";
import { mockNecRecords } from "../src/lib/collectors/nec-mock";
import type { PoliticianProfile } from "../src/lib/types";

/**
 * INTERNAL-ONLY NEC cross-verification dry-run (offline, mock fixtures).
 *
 * 불변 #5/#8: 출력은 `data/internal/`(gitignore)에만 쓰며 공개 스냅샷과 분리한다. 네트워크 호출 없음.
 * 라이선스 승인 후에도 공개 go-live는 별도 잠금(NEC_COLLECTOR off)이라, 이 dry-run은 공개 방출이 아니라
 * 내부 sanity check다. mock 픽스처(김공개 합의 / 이투명 당적변경)로 교차검증 활성화를 검증한다.
 */

const outputDir = join(process.cwd(), "data", "internal", "nec-dry-run");

function oaProfile(raw: Record<string, unknown>): PoliticianProfile {
  const mapped = mapOpenAssemblyMemberRecord({
    source: "open_assembly",
    fetchedAt: "2026-06-13T00:00:00.000Z",
    sourceUrl: "https://example.invalid/open-assembly/roster",
    licenseNote: "fixture license",
    raw,
  });
  if (!mapped) throw new Error("fixture OA profile failed to map");
  return mergeOpenAssemblyMappedProfile(mapped);
}

async function main() {
  // Open Assembly side (mock, current-term values). 이투명은 "샘플정당" — NEC는 선거일 "다른정당"(switcher).
  const openAssemblyProfiles = [
    oaProfile({ MONA_CD: "M-KIM", HG_NM: "김공개", POLY_NM: "가상정당", ORIG_NM: "서울 목구갑" }),
    oaProfile({ MONA_CD: "M-LEE", HG_NM: "이투명", POLY_NM: "샘플정당", ORIG_NM: "부산 예시구을" }),
  ];

  const result = runNecCrossVerificationDryRun(openAssemblyProfiles, mockNecRecords());

  const matched = openAssemblyProfiles.length - result.merge.unmatched.length - result.merge.ambiguous.length;
  const partyConflicts = result.discrepancies.filter((d) => d.field === "party" && d.kind === "content_conflict");
  const agreements = openAssemblyProfiles.filter(
    (p) => !partyConflicts.some((c) => c.discrepancyId.includes(p.politicianId)),
  );

  const summary = {
    note: "INTERNAL-ONLY NEC cross-verification dry-run (mock fixtures, offline). NOT public output (불변 #5/#8).",
    generatedAt: new Date().toISOString(),
    openAssemblyMembers: openAssemblyProfiles.length,
    necMappedProfiles: result.merge.profiles.length,
    matched,
    unmatched: result.merge.unmatched.map((p) => p.displayName),
    ambiguous: result.merge.ambiguous.map((p) => p.displayName),
    multiSourceFieldPairs: result.multiSourceFieldCount,
    partyContentConflicts: partyConflicts.length,
    agreementMembers: agreements.map((p) => p.displayName),
    switcherProof: partyConflicts.map((c) => {
      const profile = result.profiles.find((p) => c.discrepancyId.includes(p.politicianId));
      const cited = (profile?.party ?? []).filter((e) => c.evidenceIds.includes(e.evidenceId));
      return {
        member: profile?.displayName,
        discrepancyId: c.discrepancyId,
        kind: c.kind,
        citedSourceKinds: [...new Set(cited.map((e) => e.source.sourceKind))],
        citedValues: cited.map((e) => `${e.value} (${e.source.sourceKind})`),
      };
    }),
    checks: result.checks,
    ok: result.ok,
  };

  await mkdir(outputDir, { recursive: true });
  await writeFile(join(outputDir, "latest.json"), `${JSON.stringify(summary, null, 2)}\n`, "utf8");

  console.log("=== INTERNAL NEC cross-verification dry-run (offline, NOT public) ===");
  console.log(JSON.stringify(summary, null, 2));
  if (!result.ok) process.exitCode = 1;
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
