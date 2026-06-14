# Iteration 24 - Wire AiVerifier to a local LLM (Ollama + Qwen3 4B)

## Architect

- 범위: cross-verification의 matching+classification을 mock/rule에서 로컬 LLM으로 교체한다. 기존 `AiVerifier` seam 뒤의 **구현만** 바꾸고 detector core는 건드리지 않는다.
- 결정(사전 확정, 재논의 안 함): 서빙 Ollama(OpenAI 호환 11434), 모델 Qwen3 4B Q4(Apache 2.0), HW RTX 4060 Laptop 8GB, 실행 BATCH 전용(런타임 LLM 호출 없음).
- 결정: base URL/model은 env(`OLLAMA_BASE_URL`/`OLLAMA_MODEL`)에서만 읽고 미설정 시 localhost 기본값. 하드코딩 금지.
- 결정: LLM 출력은 `ai-validators.ts` hard guard를 반드시 통과(불변 원칙 #1). RAG 답변 문장 조합은 LLM이 만들지 않고 규칙 경로에 위임.
- 결정: 목 우선 — Ollama 미도달 시 크래시 없이 규칙/mock으로 fallback 하고 backend 상태를 surface.

## Implementer

- `src/lib/ollama.ts` (신규):
  - `ollamaConfigFromEnv` (localhost 기본값), `OllamaAiVerifier implements AiVerifier`.
  - OpenAI 호환 `/v1/chat/completions` 호출. `temperature: 0`, `seed: 0`, `response_format: json_object`로 결정성 확보. `fetch` 주입 가능(테스트에서 mock).
  - `matchEntity`/`classifyDiscrepancy`는 LLM JSON 출력을 `validateEntityMatchOutput`/`validateDiscrepancyKindOutput`으로 검증 — 실패 시 거부(throw). `<think>` 태그·코드펜스 섞인 출력에서 JSON만 안전 추출.
  - `answerWithCitations`는 모델을 호출하지 않고 규칙 기반(MockAiVerifier) 경로 위임 — LLM이 사실을 서술하지 않게.
  - `createAiVerifier` factory: `/api/tags`로 도달성 확인 후 `OllamaAiVerifier` 또는 `MockAiVerifier` 선택, `{verifier, backend, reason}` 반환.
- `src/lib/verification.ts`: `runBatchVerificationPipeline` 추가 — `createAiVerifier`로 backend 선택 후 기존 `runVerificationPipeline`에 위임, `aiBackend`/`aiBackendReason` 표면화. 기존 `runVerificationPipeline`(주입형) 시그니처는 그대로 둬서 테스트 결정성 유지.
- `scripts/generate-snapshot.ts`: batch 진입점을 `runBatchVerificationPipeline`로 교체, 사용 backend를 로그 마지막 줄에 출력.
- `tests/ollama.test.ts` (신규): config 기본값, temperature/seed 전송, think/fence 파싱, {kind} 검증, **invalid 출력 거부(guard)**, RAG 미호출, HTTP 실패 throw, fallback→mock, reachable→ollama, 도달성 체크. + `OLLAMA_INTEGRATION=1` gated 실모델 통합 테스트(기본 skip).
- `docs/LOCAL_LLM_SETUP.md` (신규): Ollama 설치, `ollama pull qwen3:4b`, env 표, 동작 방식, batch 실행, opt-in 통합 테스트.
- `docs/RELEASE_PROCEDURE.md`: snapshot 단계에 LLM backend/fallback 설명 링크.

## Reviewer (0장 점검)

- (1) AI 사실 생성 없음: LLM은 matching+classification만. 출력은 hard guard(`ai-validators.ts`) 통과 필수, 위반 시 거부. RAG 문장은 LLM이 만들지 않음. detector core 불변.
- (2) 출처 결합: LLM은 rawText만 비교하고 evidence/SourceMeta 구조를 바꾸지 않음.
- (4) 병합 금지: detector core가 그대로라 evidenceIds 보존·불일치 표시 동작 불변.
- (8) 라이선스: Qwen3 Apache 2.0, Ollama 로컬 — 비영리/오픈소스 전제와 호환. 유료 클라우드 의존 없음.
- 비밀 분리: endpoint/model은 env로만. 키 불필요(로컬).

## 알려진 matching gap에 대한 실측 — 정직한 보고

- 목표: Iteration 23 Reviewer가 남긴 gap(동의어/표기 차이, 예: `경제학과 ≈ 경제학 학사`를 규칙 matcher가 content_conflict로 오분류) 해소.
- **이 환경에서는 실모델을 돌리지 못했다**(Ollama 미설치). 따라서:
  - 코드/프롬프트는 해당 케이스를 같은 항목으로 보도록 설계됨.
  - 유닛 테스트는 **mock된 LLM 응답**으로 의도된 동작(동의어→isSameEntity:true, guard 거부)을 검증한다. 즉 *배선과 guard*는 검증됨.
  - 실제 개선 여부(규칙 matcher가 놓치던 동의어를 LLM이 실제로 잡는지)는 `OLLAMA_INTEGRATION=1 npm test`의 통합 테스트로만 확인 가능하며, **로컬에 Ollama+qwen3:4b가 떠 있을 때 실행해야 한다.** 통합 테스트는 그 케이스(`경제학과 졸업` ≈ `경제학 학사`)를 assert 한다.
- 결론: "개선했다"고 단정하지 않는다. **개선을 목표로 배선·guard·통합 테스트를 갖췄고, 실측 확인은 로컬 Ollama 실행에 위임**한다.

## 남은 것 / 다음 반복 권고

- 로컬에서 `OLLAMA_INTEGRATION=1 npm test`로 동의어 케이스 실측 후, 결과를 ITERATION_24 후속 노트에 기록.
- batch 처리량/지연(약 300명 × 필드별 pairwise) 측정 — 8GB VRAM 예산 내 처리 시간 확인.
- classify 프롬프트의 missing_from_source 실효성(현재도 detector 구조상 드물게만 도달) — expected-source-set 모델링은 별도 과제.

## Verification

- `npm test` passed: typecheck + 82 tests pass, 1 integration test skipped(`OLLAMA_INTEGRATION` 미설정). (63→72→83 누적, 이번 +11: ollama 유닛 10 + gated 통합 1)
- `npm run snapshot`: Ollama 미도달 → mock fallback 정상, backend 상태 로그 출력 확인.
- `npm run verify:all` passed: 전체 게이트 green (snapshot·build·각 verifier·typecheck·82 tests·lint).
- `npm run audit:moderate` passed: 0 vulnerabilities (→ `verify:release` green).

## 불변 dossier 경계

- 어떤 source-review dossier도 approved로 바꾸지 않았다(이 과제와 무관, 승인은 사람의 결정).
