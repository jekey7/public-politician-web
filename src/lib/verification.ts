import { MockAiVerifier, type AiVerifier } from "./ai";
import { MockCollector } from "./collectors/mock";
import { attachDetectedDiscrepancies } from "./cross-verification";
import { createAiVerifier, type AiBackend } from "./ollama";
import type { PinCacheArtifact } from "./pin-cache";
import { lowConfidenceFieldsFromLedger, type VoteLedger } from "./voting-verifier";
import type { Collector } from "./collectors/types";
import type { Detector, Discrepancy, PoliticianProfile } from "./types";

export interface VerificationPipelineResult {
  profiles: PoliticianProfile[];
  discrepancies: Discrepancy[];
  generatedAt: string;
}

export interface BatchVerificationResult extends VerificationPipelineResult {
  /** 실제로 사용된 AI backend(ollama | mock). 목 우선 fallback 시 사람이 상태를 알 수 있게 표면화한다. */
  aiBackend: AiBackend;
  aiBackendReason?: string;
  /** ollama backend일 때 self-consistency voting의 표 분포 ledger(검사 가능, 불변 #8). */
  voteLedger?: VoteLedger;
  /** 저신뢰(투표 분열)로 검수중 표시된 discrepancy 수. 0이어도 보고한다(정직성). */
  lowConfidenceCount: number;
  /** 배치 중 라이브 LLM 호출이 실패해 mock으로 떨어진 호출 수(정직한 degrade 보고). */
  llmCallFallbacks: number;
  /**
   * 갱신된 입력 해시 캐시(핀). 배치 스크립트가 내부(gitignore) 아티팩트로 저장해 다음 배치의 재현성·
   * 비용 절감에 쓴다. ollama backend일 때만 존재(mock은 결정적이라 핀하지 않음).
   */
  pinCache?: PinCacheArtifact;
  /** 핀 캐시 히트/미스 통계(검사·보고용). */
  pinCacheStats?: { hits: number; misses: number; size: number };
}

/**
 * LLM 투표 결과(ledger)에 따라 discrepancy의 detector를 정직하게 갱신한다.
 *
 * detector core는 항상 "rule"로 둔다(LLM 비의존, mock 공유). LLM backend로 돌았을 때만 여기서
 *   - 투표가 갈린 field의 discrepancy → "llm_interface_low_confidence" (검수중으로 surface),
 *   - 그 외 LLM 분류 discrepancy → "llm_interface"
 * 로 표시한다. 한쪽 라벨을 조용히 확정하지 않고 분열을 드러낸다(불변 #3·#4).
 *
 * 순수 함수 — profiles를 복사해 새 detector를 부여한 사본을 반환한다(입력 불변).
 */
export function markDiscrepancyConfidence(
  profiles: PoliticianProfile[],
  lowConfidenceFields: Set<string>,
): PoliticianProfile[] {
  return profiles.map((profile) => ({
    ...profile,
    discrepancies: profile.discrepancies.map((discrepancy) => {
      const detector: Detector = lowConfidenceFields.has(discrepancy.field)
        ? "llm_interface_low_confidence"
        : "llm_interface";
      return { ...discrepancy, detector };
    }),
  }));
}

/**
 * 수집 → 정합 → 탐지 → 저장 파이프라인.
 * collector가 모은 출처별 EvidenceValue에 대해 cross-verification으로 불일치를 탐지하고,
 * 탐지 결과를 profile에 부착해 반환한다. 입력 profile의 기존(사전 작성) discrepancies는 사용하지 않고
 * 항상 탐지로 새로 만든다.
 */
export async function runVerificationPipeline(
  collector: Collector<PoliticianProfile> = new MockCollector(),
  ai: AiVerifier = new MockAiVerifier(),
): Promise<VerificationPipelineResult> {
  const collected = await collector.collect();
  const generatedAt = new Date().toISOString();

  const profiles = await Promise.all(
    collected.map((profile) => attachDetectedDiscrepancies(profile, ai, { detectedAt: generatedAt })),
  );

  const discrepancies = profiles.flatMap((profile) => profile.discrepancies);

  return {
    profiles,
    discrepancies,
    generatedAt,
  };
}

/**
 * BATCH 진입점. 데이터 갱신 시점에 Ollama(로컬 LLM) backend를 선택해 cross-verification을 돌린다.
 * Ollama가 닿지 않으면 규칙/mock verifier로 깔끔하게 fallback 하고, 어떤 backend를 썼는지 반환한다.
 * 라이브 사이트의 런타임 LLM 호출은 없다(결과를 저장해 정적으로 노출).
 */
export async function runBatchVerificationPipeline(
  collector: Collector<PoliticianProfile> = new MockCollector(),
  /** 이전 배치에서 저장한 핀 캐시(있으면 동일 입력은 재호출 없이 동결 결과 반환 — 재현성). */
  initialPinCache?: PinCacheArtifact,
): Promise<BatchVerificationResult> {
  const selection = await createAiVerifier(undefined, undefined, initialPinCache);
  const result = await runVerificationPipeline(collector, selection.verifier);

  // mock backend는 결정적이라 투표하지 않으므로 detector를 "rule" 그대로 둔다.
  // ollama backend일 때만 투표 ledger를 읽어 저신뢰 분류를 검수중으로 표시한다.
  let profiles = result.profiles;
  let lowConfidenceCount = 0;
  if (selection.backend === "ollama" && selection.voteLedger) {
    const lowConfidenceFields = lowConfidenceFieldsFromLedger(selection.voteLedger);
    profiles = markDiscrepancyConfidence(result.profiles, lowConfidenceFields);
    lowConfidenceCount = profiles
      .flatMap((profile) => profile.discrepancies)
      .filter((discrepancy) => discrepancy.detector === "llm_interface_low_confidence").length;
  }

  const discrepancies = profiles.flatMap((profile) => profile.discrepancies);

  return {
    profiles,
    discrepancies,
    generatedAt: result.generatedAt,
    aiBackend: selection.backend,
    aiBackendReason: selection.reason,
    voteLedger: selection.voteLedger,
    lowConfidenceCount,
    llmCallFallbacks: selection.resilient?.stats().total ?? 0,
    pinCache: selection.pinCache?.toArtifact(),
    pinCacheStats: selection.pinCache?.stats(),
  };
}
