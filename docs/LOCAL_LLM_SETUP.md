# 로컬 LLM 설정 (Ollama + Qwen3 4B)

cross-verification(정합·불일치 분류)의 AI backend를 로컬 LLM으로 돌리기 위한 설정. **로컬 추론만 사용하며 유료 클라우드 API를 호출하지 않는다.** BATCH 전용 — 데이터 갱신 시점에 ~300명을 처리해 결과를 저장하고, 라이브 사이트는 런타임 LLM 호출을 하지 않는다.

## 결정 사항

- 서빙 런타임: **Ollama** (OpenAI 호환 endpoint `localhost:11434` 제공).
- 모델: **Qwen3 4B, Q4 양자화** (Apache 2.0 — 프로젝트 오픈소스/라이선스 불변 원칙과 호환).
- 하드웨어 목표: RTX 4060 Laptop, 8GB VRAM. Q4 4B는 이 예산 안에 든다.

## 설치 및 모델 준비

```bash
# 1. Ollama 설치 (https://ollama.com/download — Windows/macOS/Linux)
#    Windows: 설치 후 Ollama가 백그라운드 서비스로 11434 포트를 연다.

# 2. Qwen3 4B 모델 pull (기본 태그가 Q4_K_M 양자화)
ollama pull qwen3:4b

# 3. 서버 동작 확인
curl http://localhost:11434/api/tags

# 4. (선택) 단발 동작 확인
ollama run qwen3:4b "JSON only: {\"ok\": true}"
```

## 환경변수

코드는 아래 env만 읽는다. 미설정 시 localhost 기본값으로 동작한다. **하드코딩 금지.**

| 변수 | 기본값 | 설명 |
| --- | --- | --- |
| `OLLAMA_BASE_URL` | `http://localhost:11434` | Ollama OpenAI 호환 endpoint base URL |
| `OLLAMA_MODEL` | `qwen3:4b` | 사용할 모델 태그. **`/api/tags`에 이 모델이 없으면** Ollama를 고르지 않고 mock으로 fallback(Iteration 26). |
| `OLLAMA_TIMEOUT_MS` | `60000` | 호출 타임아웃(ms). batch이므로 넉넉히. voting은 호출 수를 늘리므로 더 길게 권장(예: 300000). |
| `AI_VOTE_SAMPLES` | `5` | self-consistency voting 샘플 수(홀수 권장). 라벨 비결정성을 다수결로 흡수(Iteration 26). |
| `AI_VOTE_THRESHOLD` | `0.6` | 다수표 비율이 이 값 미만이거나 동률이면 저신뢰(검수중)로 표시. |
| `SNAPSHOT_AI_BACKEND` | (없음) | `mock`이면 라이브 LLM을 건너뛰고 결정적 규칙 verifier 사용(CI/verify용). `--mock` 플래그와 동등. |

## 동작 방식

- 구현: [src/lib/ollama.ts](../src/lib/ollama.ts)의 `OllamaAiVerifier`가 기존 `AiVerifier` interface 뒤에 붙는다.
  detector core([src/lib/cross-verification.ts](../src/lib/cross-verification.ts))는 그대로 두고 **구현만 교체**한다.
- 호출: OpenAI 호환 `/v1/chat/completions`. `temperature: 0`, `seed: 0`, `response_format: json_object`.
- **재현성(Iteration 26):** temp0/seed0이 thinking 모델의 byte-identical 라벨을 보장하지 못하므로
  ([docs/ITERATION_26.md](./ITERATION_26.md)), 각 분류/정합을 `AI_VOTE_SAMPLES`회 샘플링해 **다수결
  라벨**을 채택한다(`VotingAiVerifier`). 표가 갈리면 저신뢰로 검수중(`llm_interface_low_confidence`)
  표시. 표 분포는 검사 가능한 ledger로 내부(gitignore) 아티팩트 `data/internal/vote-ledger/`에 기록.
- **회복력:** 배치 중 chat 호출 1건이 실패해도(타임아웃·404) 전체 스냅샷을 멈추지 않고 그 호출만
  규칙 mock으로 떨어뜨린다(`ResilientAiVerifier`). fallback 횟수는 스냅샷 로그에 보고된다.
- LLM 역할 한정(불변 원칙 #1): **개체 정합 + 불일치 분류**만 한다. 사실 생성·요약·서술 금지.
  모든 출력은 [src/lib/ai-validators.ts](../src/lib/ai-validators.ts)의 hard guard를 통과해야 하며,
  형식/범위/허용값을 어기면 통과시키지 않고 거부(throw)한다.
- RAG 답변 문장 조합은 LLM이 만들지 않는다 — 규칙 기반 경로(mock)에 위임한다.
- **목 우선 fallback:** Ollama가 닿지 않으면 크래시 없이 규칙/mock verifier로 떨어지고,
  사용된 backend(`ollama` | `mock`)와 이유를 surface 한다. `npm run snapshot` 로그 마지막 줄에서 확인 가능.

## 배치 실행

```bash
# Ollama가 떠 있고 OLLAMA_MODEL이 설치돼 있으면 ollama backend(voting 적용)로,
# 아니면 mock으로 자동 fallback. 라이브 호출 실패는 per-call mock으로 흡수(크래시 없음).
npm run snapshot
# 로그 예: "cross-verification AI backend: ollama"
#         "cross-verification low-confidence (split-vote, 검수중) discrepancies: N"
#         "cross-verification live-LLM call fallbacks to mock (resilience): M"
#         또는 "cross-verification AI backend: mock (Ollama unreachable/model missing ...)"

# CI/검증용: 로컬 모델 유무와 무관하게 결정적 mock으로 강제(빠름). verify:all이 이걸 쓴다.
npm run snapshot:mock
```

## 실측 하네스 (`npm run measure:llm`)

라이브 모델의 **분류·정합 품질과 지연을 정직하게 측정**하는 하네스. fixture의 expected 라벨은
사람이 작성한 ground truth이며, 하네스는 규칙·LLM 결과를 그에 대조해 측정만 한다(사실 생성 없음).

```bash
# 전제: 로컬 Ollama가 떠 있고 모델이 pull 되어 있어야 한다.
ollama pull qwen3:4b
curl http://localhost:11434/api/tags

# fixture 정확도 + per-call 지연(p50/p95) + 결정성(2회 실행 byte-identical) 측정
npm run measure:llm

# 다른 모델/엔드포인트로 측정
OLLAMA_MODEL=qwen3:8b npm run measure:llm

# 배치 타이밍: ~300명 cross-verification의 총/인당 시간 + 300명 환산 추정
MEASURE_BATCH_COUNT=10 npm run measure:llm:batch
# classify 호출이 길어질 수 있으니 배치는 타임아웃을 넉넉히:
OLLAMA_TIMEOUT_MS=300000 MEASURE_BATCH_COUNT=10 npm run measure:llm:batch
```

- **라이브 전용**: `/api/tags`로 도달성을 먼저 확인하고, 닿지 않으면 명확한 메시지 + non-zero로
  종료한다. mock으로 조용히 fallback 하지 않는다(mock 측정은 무의미).
- 출력: 머신 판독용 JSON은 `data/internal/measurements/`(gitignore)에, 사람용 표는 stdout으로.
- exit code: 도달 불가 1, 결정성 실패 2.
- fixture: [fixtures/verification-cases.json](../fixtures/verification-cases.json) — 동의어 6 + 분류 5.
  하네스 순수 로직은 [src/lib/measure-llm.ts](../src/lib/measure-llm.ts), 유닛 테스트는
  [tests/measure-llm.test.ts](../tests/measure-llm.test.ts)(Ollama mock).
- 결과 해석과 알려진 한계(결정성 간헐 실패 등)는 [docs/ITERATION_25.md](./ITERATION_25.md) 참조.

### voting 안정화 실측 (`npm run measure:voting-stability`)

라이브 qwen3:4b에서 **self-consistency voting이 라벨을 실행 간 안정화하는지** 직접 측정하는 하네스
(Iteration 27). 같은 fixture를 VOTED(samples=5)와 CONTROL(samples=1)로 각각 여러 번 돌려 라벨
agreement를 비교한다. **mock fallback이 1건이라도 있으면 ABORT(exit 3, verdict=INVALID)** — fallback
오염된 run을 실측으로 오인하지 않게 한다.

```bash
# 타임아웃은 넉넉히(qwen3:4b thinking + voting의 worst case 단일 호출 ~52s, tail은 더 길 수 있음)
OLLAMA_TIMEOUT_MS=600000 npm run measure:voting-stability

# CONTROL 반복을 독립으로 키워 baseline 발산 기회를 더 준다(투표 귀속 검정 강화). control은 6× 싸다.
OLLAMA_TIMEOUT_MS=600000 VOTING_STABILITY_REPEATS=3 VOTING_STABILITY_CONTROL_REPEATS=8 \
  npm run measure:voting-stability
```

- 결과 JSON: `data/internal/measurements/voting-stability-latest.json`(gitignore) — per-case agreement,
  표 분포(ledger), fallback율, verdict.
- 결과 해석은 [docs/ITERATION_27.md](./ITERATION_27.md) 참조.

## 통합 테스트(opt-in)

CI는 실모델 없이 통과한다(유닛 테스트는 Ollama 호출을 mock 한다). 실제 로컬 Ollama로 검증하려면:

```bash
# 로컬에서 Ollama + qwen3:4b 가 떠 있는 상태에서만
OLLAMA_INTEGRATION=1 npm test
```

플래그가 없으면 `tests/ollama.test.ts`의 integration 테스트는 skip 된다.
