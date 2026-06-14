import { mockSyncVerifier } from "../ai";
import { detectProfileDiscrepanciesSync } from "../cross-verification";
import { sourceLicensePolicies } from "../source-license";
import type { Discrepancy, PoliticianProfile } from "../types";
import { mapNecRecord, NecCollector, necConfigFromEnv, type NecConfig, type NecRecord } from "./nec";
import { mergeNecIntoProfiles, type NecMergeResult } from "./nec-merge";
import { mockNecRecords } from "./nec-mock";

/**
 * NEC collector OFF-스위치 — PUBLIC_PIPELINE_COLLECTOR와 같은 잠금 패턴.
 *
 * 기본값 "off": 실 fetch 안 함. 공개 스냅샷은 mock-data.ts(MockCollector)만 쓰므로 이 스위치는
 * 공개 출력에 영향을 주지 않는다. 실 fetch는 사람이 (1) nec 라이선스를 approved로 올리고
 * (2) NEC_COLLECTOR=nec 로 켤 때만 가능하다. 둘 중 하나라도 아니면 잠긴다.
 */
export type NecCollectorMode = "off" | "nec";

export interface NecCollectorEnv extends Record<string, string | undefined> {
  NEC_COLLECTOR?: string;
  NEC_API_KEY?: string;
}

export function parseNecCollectorMode(value: string | undefined): NecCollectorMode {
  const normalized = value?.trim();
  if (!normalized || normalized === "off") return "off";
  if (normalized === "nec") return "nec";
  throw new Error(`Unsupported NEC_COLLECTOR: ${value}`);
}

/** nec가 사람 승인 전이면 실 collector 활성화를 거부한다(불변 §0.7). */
export function assertNecApprovedForRealCollection() {
  const policy = sourceLicensePolicies.nec;
  if (policy.status !== "approved") {
    throw new Error(
      `nec is ${policy.status}; a human must approve ${policy.reference} (§0.7) before enabling real NEC collection`,
    );
  }
}

/**
 * 실 NEC collector를 만들지, 잠근 채로 둘지 결정한다. 이 iteration에서 어떤 공개 경로도 이 함수를
 * "nec" 모드로 호출하지 않는다 — 켜려면 사람이 라이선스 승인 + NEC_COLLECTOR=nec 둘 다 해야 한다.
 */
export function selectNecCollector(env: NecCollectorEnv = process.env): {
  mode: NecCollectorMode;
  collector: NecCollector | null;
} {
  const mode = parseNecCollectorMode(env.NEC_COLLECTOR);
  if (mode === "off") return { mode, collector: null };

  // 라이선스 게이트 먼저(사람 승인 전이면 throw). 그 다음에야 키를 읽는다.
  assertNecApprovedForRealCollection();
  const config: NecConfig | null = necConfigFromEnv(env);
  if (!config) throw new Error("NEC_API_KEY is required when NEC_COLLECTOR=nec");
  return { mode, collector: new NecCollector(config) };
}

export interface NecCrossVerificationDryRunResult {
  ok: boolean;
  merge: NecMergeResult;
  profiles: PoliticianProfile[];
  discrepancies: Discrepancy[];
  /** party/district가 실제로 2-출처가 된 profile 수(교차검증 활성화 증거). */
  multiSourceFieldCount: number;
  checks: { name: string; passed: boolean; detail: string }[];
}

/**
 * 내부 전용 NEC 교차검증 dry-run: NEC mock 행 → identity 매퍼 → 이름+정당+지역구 매칭으로
 * Open Assembly profile에 합류 → cross-verification 탐지. 공개 출력은 건드리지 않는다.
 *
 * 검증 항목:
 *   1. NEC 매퍼는 identity(party/district)만 만들고 PII는 버린다(직렬화에 PII 부재).
 *   2. 합류 후 최소 한 field가 2-출처가 된다(교차검증 실제 작동).
 *   3. switcher의 party가 content_conflict로 surface되고 두 출처(open_assembly+nec)를 모두 인용한다.
 *   4. nec를 실 출처로 둔 스냅샷은 라이선스 게이트가 여전히 reject한다(공개 차단 유지).
 */
export function runNecCrossVerificationDryRun(
  openAssemblyProfiles: PoliticianProfile[],
  necRecords: NecRecord[] = mockNecRecords(),
  detectedAt = "2026-06-13T00:00:00.000Z",
): NecCrossVerificationDryRunResult {
  const necMapped = necRecords
    .map((record, index) => mapNecRecord(record, index))
    .filter((profile): profile is NonNullable<typeof profile> => profile !== null);

  const merge = mergeNecIntoProfiles(openAssemblyProfiles, necMapped);
  const profiles = merge.profiles.map((profile) => ({
    ...profile,
    discrepancies: detectProfileDiscrepanciesSync(profile, mockSyncVerifier, { detectedAt }),
  }));
  const discrepancies = profiles.flatMap((profile) => profile.discrepancies);

  const checks: NecCrossVerificationDryRunResult["checks"] = [];

  // Check 1: PII가 노출 evidence로 새지 않는다.
  const serialized = JSON.stringify(necMapped);
  const leakedPii = ["19780101", "19820505", "변호사", "정치인", "샘플대로", "가상로"].filter((pii) =>
    serialized.includes(pii),
  );
  checks.push({
    name: "nec_mapper_drops_pii",
    passed: leakedPii.length === 0,
    detail: leakedPii.length === 0 ? "no PII in mapped NEC evidence" : `PII leaked: ${leakedPii.join(", ")}`,
  });

  // Check 2: 합류로 최소 한 field가 2-출처가 됐다.
  const multiSourceFieldCount = countMultiSourceFields(profiles);
  checks.push({
    name: "cross_verification_activated",
    passed: multiSourceFieldCount > 0,
    detail: `${multiSourceFieldCount} (profile, field) pairs now have >=2 sources`,
  });

  // Check 3: switcher party가 content_conflict로 두 출처 인용하며 surface.
  const conflict = discrepancies.find((d) => d.field === "party" && d.kind === "content_conflict");
  const conflictSources = conflict ? sourceKindsForDiscrepancy(profiles, conflict) : new Set<string>();
  const citesBoth = conflictSources.has("open_assembly") && conflictSources.has("nec");
  checks.push({
    name: "party_switch_content_conflict_surfaced",
    passed: Boolean(conflict) && citesBoth,
    detail: conflict
      ? `party content_conflict cites: ${[...conflictSources].join(", ")}`
      : "no party content_conflict surfaced",
  });

  // Check 4: 공개 go-live는 *여전히* 차단된다 — 라이선스 승인 후에는 라이선스 게이트가 아니라 OFF 스위치가
  // 막는다. NEC_COLLECTOR 기본 OFF면 selectNecCollector가 collector를 만들지 않으므로(=실 fetch 없음)
  // nec 행이 공개 스냅샷에 애초에 들어갈 수 없다. dry-run은 내부 전용이고 공개 경로와 분리된다(불변 #5/#8).
  const offSwitch = selectNecCollector({}); // no env → default OFF
  const realFetchBlocked = offSwitch.mode === "off" && offSwitch.collector === null;
  checks.push({
    name: "real_fetch_blocked_by_off_switch",
    passed: realFetchBlocked,
    detail: realFetchBlocked
      ? "NEC_COLLECTOR defaults OFF → no real collector built → nec rows cannot reach public output"
      : "off-switch did not block real NEC collection",
  });

  return {
    ok: checks.every((check) => check.passed),
    merge,
    profiles,
    discrepancies,
    multiSourceFieldCount,
    checks,
  };
}

function countMultiSourceFields(profiles: PoliticianProfile[]): number {
  let count = 0;
  for (const profile of profiles) {
    for (const evidences of [profile.party, profile.district]) {
      const sources = new Set(evidences.map((evidence) => evidence.source.sourceKind));
      if (sources.size >= 2) count += 1;
    }
  }
  return count;
}

function sourceKindsForDiscrepancy(profiles: PoliticianProfile[], discrepancy: Discrepancy): Set<string> {
  const kinds = new Set<string>();
  for (const profile of profiles) {
    const all = [...profile.party, ...profile.district];
    for (const evidence of all) {
      if (discrepancy.evidenceIds.includes(evidence.evidenceId)) kinds.add(evidence.source.sourceKind);
    }
  }
  return kinds;
}
