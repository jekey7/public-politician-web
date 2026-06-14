# Iteration 26 — 모델 비결정성에도 재현 가능한 스냅샷 (self-consistency voting)

Iteration 25의 실측 하네스는 **temperature 0 / seed 0이 thinking 모델(qwen3)의 byte-identical
분류 출력을 보장하지 못한다**는 것을 확인했다(3회 중 1회 FAIL, `match-career-title-variant`에서
간헐 발산). 이는 불변 #8(객관성은 증명 — 재현 가능한 스냅샷)을 깨고 "검증 가능한 객관성" 전제를
흔든다: 같은 입력이 스냅샷마다 다른 cross-verification 결과를 내면 이용자가 우리 출력을 재현할 수 없다.

이번 반복의 목표는 **모델 내부의 비결정성을 고치는 것이 아니다.** GPU 부동소수점 비결정성은 thinking
모델에서 temp0/seed0을 신뢰 불가하게 만드는 알려진 한계이지 프롬프트로 없앨 버그가 아니다. 목표는
모델을 **잡음 섞인 분류기**로 보고, 그 위에서 **재현 가능한 스냅샷을 만들어 내는 시스템**을 세우는 것이다.

---

## 1. 진단 (먼저 정확히 — 추측 금지)

### 발산이 라벨 층까지 도달하는가, `<think>` 텍스트에서 멈추는가?

**도달한다 — 파싱된 분류 라벨이 뒤집힌다.** 코드로 확정할 수 있다:

- Iteration 25 하네스의 결정성 비교(`compareForDeterminism`)와 지문(`classificationFingerprint`,
  [src/lib/measure-llm.ts](../src/lib/measure-llm.ts))은 **이미 raw 텍스트를 비교하지 않는다.**
  두 함수 모두 per-case 결과에서 **파싱·검증을 마친 `llmResult`** 만 투영한다:
  - entity_match → `{ id, kind, llmResult(boolean), llmConfidence }`
  - classification → `{ id, kind, llmResult(DiscrepancyKind) }`
- `llmResult`는 `OllamaAiVerifier`가 `<think>…</think>`/코드펜스를 제거하고(`parseJsonObject`),
  `ai-validators`의 hard guard를 통과시킨 **최종 라벨**이다. 즉 Iteration 25가 FAIL로 본 발산은
  `match-career-title-variant`의 **`isSameEntity` boolean이 실행 간 뒤집힌 것**이며,
  `<think>` 텍스트만 흔들린 게 아니다. (텍스트만 흔들렸다면 지문이 같아 PASS였을 것이다.)

결론: **우리가 신경 쓰는 층(최종 분류 라벨)에서 비결정성이 발생한다.** 따라서 텍스트 정규화만으로는
부족하고, 라벨 자체를 안정화하는 메커니즘이 필요하다.

### 어떤 케이스가, 얼마나 자주 뒤집히는가

- Iteration 25 실측(qwen3:8b): `match-career-title-variant`(`제20대` vs `20대 (재선)`)에서
  3회 중 1회 발산. 다른 10개 케이스는 안정적이었다. 즉 **경계가 모호한(저신뢰) 케이스에서 잡음이
  라벨을 뒤집는다** — 모델이 자신 있게 같은/다름을 가르는 케이스는 흔들리지 않는다.
- 이 관찰이 메커니즘 선택을 직접 이끈다: **다수결로 잡음을 흡수하고, 그래도 갈리는(=경계) 케이스는
  저신뢰로 정직하게 surface** 하면 된다(불변 #3).

> 주: Iteration 25 실측은 계획 타깃 qwen3:4b가 아니라 qwen3:8b에서 나왔다(당시 4B 미설치).
> 이번 반복의 메커니즘은 **모델 무관(model-agnostic)** 이어야 하며(아래 ADR), 4B/RTX 4060에서
> 재실행 시에도 그대로 성립해야 한다.

---

## 2. ADR — 재현성 메커니즘: self-consistency voting (핀잉 아님)

검토한 후보:

- **(a) self-consistency voting** — 각 분류/정합을 N회 샘플링해 다수결 라벨을 채택. 표 분포를
  메타데이터로 기록. 표가 갈리면(동률/임계치 미만) 저신뢰로 surface.
- **(b) cache-and-pin** — (input-hash, model-version)별 모델 출력을 커밋된 캐시에 핀. 재실행은
  입력/모델이 안 바뀌면 핀을 읽음.
- **(c) 둘의 결합** — 한 번 투표하고 그 결과를 핀.

### 결정: (a) self-consistency voting을 핵심으로 채택한다.

**근거:**

1. **핀잉(b)은 첫 실행을 신뢰하게 만들지 못한다.** 캐시는 모델이 *우연히* 낸 한 표를 그대로 얼린다.
   그 한 표가 틀린 발산(예: `match-career-title-variant` 오답)이면, 핀은 그 오답을 재현 가능하게
   만들 뿐 신뢰도를 올리지 못한다. 투표는 잡음을 직접 공격한다 — N표 다수결을 통과한 라벨은 단일
   추출보다 훨씬 안정적이다.
2. **투표는 저신뢰를 정직하게 드러낸다(불변 #3).** 표가 갈리는 케이스 = 모델이 확신 못 하는 경계
   케이스. 핀잉은 이를 숨기지만 투표는 `lowConfidence`로 표면화해 검수중(`llm_interface_low_confidence`)
   으로 표시한다. 이는 기존 검수 상태 배지 설계와 정합한다.
3. **모델 무관**(요구사항). 다수결은 4B든 8B든 동일하게 성립한다. 모델 버전이 바뀌면 핀 캐시 전체가
   무효화되는 (b)의 취약점이 없다.
4. **결정성은 투표 위에 구성으로 보장된다.** 표 multiset이 주어지면 다수결 계산은 **순수·결정적**이다
   (`tallyVotes`). 소수 잡음이 다수를 뒤집지 못하는 한 최종 라벨은 실행 간 동일하다. CI 게이트가 바로
   이 성질을 검증한다(§4).

핀잉(b)은 **버리지 않는다**: 표가 모여 라벨이 안정되면, 그 라벨을 (input-hash, model-version)로
캐시해 재질의를 줄이는 incremental 최적화는 다음 반복의 후속으로 남긴다(§6). 이번엔 정확성·정직성을
먼저 세운다.

### 불변 준수

- **#1 (AI는 사실을 만들지 않는다):** 투표/회복력 래퍼는 **라벨만 안정화**한다(같은 항목 여부 /
  불일치 종류). 새 사실·문장을 만들지 않는다. 후보 라벨은 전부 wrapped verifier가 낸 것이다.
  RAG 답변은 투표 대상이 아니며 mock 규칙 경로에 그대로 위임한다(모델이 문장을 짓지 않음).
- **#8 (객관성은 증명):** 모든 표 분포를 검사 가능한 `VoteLedger`로 기록하고, 배치 시 내부(gitignore)
  아티팩트 `data/internal/vote-ledger/latest.json`로 떨군다. 블랙박스가 아니다.
- **#4 (병합 금지)·#5 (성격 분리):** detector core는 그대로 — 어떤 evidence도 병합하지 않는다.
  표 분포는 내부 아티팩트로, 공개 스냅샷과 분리된다.

### 구현 위치

- 새 모듈 [src/lib/voting-verifier.ts](../src/lib/voting-verifier.ts):
  - `tallyVotes` — 순수 다수결 + 신뢰 지표(동률/임계치 미만 → `lowConfidence`). 동률은 사전순
    대표값으로 결정적 처리.
  - `VotingAiVerifier` — 임의의 `AiVerifier`를 감싸 N회 샘플링 후 다수결. `VoteLedger`에 표 기록.
  - `ResilientAiVerifier` — per-call mock fallback(§5).
  - `lowConfidenceFieldsFromLedger` — 파이프라인 표시용 저신뢰 field 집합 도출.
- 배선: [src/lib/ollama.ts](../src/lib/ollama.ts)의 `createAiVerifier`가
  `Voting(Resilient(Ollama))`를 조립한다. **detector core·AiVerifier seam은 불변** — 기존 seam
  뒤의 구성만 바뀐다(불변 유지, [[ollama-backend]]·[[cross-verification-detector]] 설계 계승).
- 설정(env, 하드코딩 금지): `AI_VOTE_SAMPLES`(기본 5, 홀수 권장), `AI_VOTE_THRESHOLD`(기본 0.6).

---

## 3. 저신뢰를 정직하게 surface

- `VotingAiVerifier`는 표가 갈리면(동률 또는 다수표 < 임계치) `VoteLedger`에 `lowConfidence=true`로
  기록한다. 한쪽 라벨을 조용히 채택하지 않는다.
- 배치 파이프라인([src/lib/verification.ts](../src/lib/verification.ts) `markDiscrepancyConfidence`)은
  저신뢰 field의 discrepancy를 **`detector: "llm_interface_low_confidence"`** 로 표시한다.
  확신 분류는 `llm_interface`, 규칙/mock fallback은 `rule`.
- 타입·스키마·검증기에 `llm_interface_low_confidence`를 추가했다([src/lib/types.ts](../src/lib/types.ts),
  [schemas/public-snapshot.schema.json](../schemas/public-snapshot.schema.json),
  [src/lib/snapshot-validator.ts](../src/lib/snapshot-validator.ts)). 공개 스냅샷이 "이 분류는
  저신뢰 — 검수중"을 정직하게 담는다(불변 #3). 표 분포 자체는 내부 ledger에만(불변 #5).

---

## 4. 결정성을 CI 게이트로

- [tests/voting-verifier.test.ts](../tests/voting-verifier.test.ts):
  - **통제된 비결정 stub**(`FlakyVerifier`): 호출 카운터로 N호출마다 1번 라벨을 뒤집어 qwen3의 흔들림을
    **결정적으로 재현**(라이브 LLM 불필요). samples=5에서는 최대 2표만 틀리므로 다수결은 항상 안정.
  - **CI GATE**: 같은 fixture를 voting으로 2회 실행 → `classificationFingerprint`가 byte-identical,
    `compareForDeterminism().deterministic === true`. **Iteration 25에서 FAIL 하던 검사가 라벨
    수준에서 PASS — 구성상 보장.**
  - **대조군**: 투표 없이(samples=1) 같은 stub은 두 실행이 갈린다 → 투표의 필요성을 입증.
  - 동률·임계치 미만 → 저신뢰 기록, 깨끗한 다수결 → 저신뢰 아님, env 파싱, 파이프라인 표시까지 커버.
- 라이브 하네스([scripts/measure-llm.ts](../scripts/measure-llm.ts))도 RAW(진단) 2회 + VOTED(게이트)
  2회를 돌려, raw 흔들림은 정직히 보고하되 **게이트는 VOTED 결정성으로 판정**한다. 4B/RTX 4060에서
  재실행하면 이 표가 갱신된다.

---

## 5. Iteration 25에서 분리했던 fallback 버그 — 이번에 고침

Iteration 25는 `createAiVerifier`가 `/api/tags`만 보고 backend를 골라, tags는 200이지만 chat
모델이 없는/다른 환경에서 Ollama를 선택해 `npm run snapshot`/`verify:all`이 chat 404로 크래시하는
취약점을 분리해 두었다(목 우선 원칙 위반). **이번 반복에서 두 겹으로 고쳤다:**

1. **모델 존재 확인(`isOllamaReachable`):** `/api/tags` 응답을 파싱해 **설정된 `OLLAMA_MODEL`이
   실제 설치 목록에 있는지** 확인한다. 없으면 ok:false → mock으로 깨끗이 fallback. 태그 생략(`qwen3`)은
   `qwen3:latest`와도 매칭. 회귀 테스트: tags 200 + 모델 부재 → mock 선택, chat 미도달 확인.
2. **per-call 회복력(`ResilientAiVerifier`):** 모델이 *설치돼 있어도* 개별 chat 호출이 실패할 수
   있다(타임아웃·과부하·간헐 파싱 거부). 그 경우 **해당 호출만 규칙 mock으로 떨어뜨리고** 전체 배치를
   멈추지 않는다. 몇 건이 fallback 됐는지 세어 스냅샷 로그·ledger에 정직하게 보고한다.

   → 실제로 **이 빌드 환경에서 발견**됐다: Iteration 25 이후 누군가 `qwen3:4b`를 설치해, (1)의 모델
   확인은 통과했지만 voting(5×)으로 늘어난 chat 호출 중 하나가 기본 60s 타임아웃에서 abort 됐다.
   (1)만으로는 못 막고 (2)가 흡수한다.

추가로, CI/`verify:all`이 로컬 모델 유무·속도에 휘둘리지 않도록 **명시적 mock opt-out**을 더했다:
`SNAPSHOT_AI_BACKEND=mock` 또는 `--mock` 플래그. `verify:all`은 `snapshot:mock`을 써 결정적·빠르게
돈다. 라이브 LLM 배치는 의도적으로 `npm run snapshot`을 직접 돌리는 별도 단계다(BATCH 전용 설계와 정합).

---

## 6. 정직한 보고 — 메커니즘이 덮지 못하는 잔여 비결정성

> 숫자를 꾸미지 않는다. 메커니즘의 한계를 명시한다.

- **투표는 비결정성을 *통계적으로* 줄이지 *제거*하지 않는다.** 보장은 "표 multiset이 같으면 다수결이
  결정적"이라는 것이다. 잡음이 **체계적**이어서 다수표 자체가 실행 간 흔들리면(예: 모델이 어떤 케이스에서
  50:50에 가깝게 진동하면) 다수결도 흔들릴 수 있다. 그런 케이스는 본질적으로 저신뢰이며, **메커니즘은
  그것을 숨기지 않고 `lowConfidence`로 surface** 한다 — 즉 "조용한 발산"을 "정직한 검수중"으로 바꾼다.
  완전한 byte-identical 보장이 필요하면 §2의 핀잉(b)을 voted 결과 위에 얹어야 한다(후속).
- **샘플 수 ↔ 안정성 trade-off.** samples=5는 ≤2표 잡음을 흡수한다(다수결 ≥3). 잡음 비율이 그보다
  높으면 samples를 키워야 한다(`AI_VOTE_SAMPLES`). 정확한 필요 N은 4B 실측으로 정해야 한다(아래).
- **배치 시간 5× 증가.** 투표가 호출 수를 samples배로 늘린다. Iteration 25의 qwen3:8b 직렬 추정
  ~5.8h/300명이 samples=5면 산술적으로 ~수십 시간이 된다. **야간 배치로도 부담** — 4B 실측 + 동시성/
  incremental(변경분만) + voted 결과 핀잉이 다음 반복의 핵심 과제다.
- **라이브 4B 미실측(이 문서 작성 시점):** 메커니즘은 모델 무관으로 설계했지만, 실제 4B에서 (i) raw
  흔들림 빈도, (ii) samples=5가 충분한지, (iii) voted 정확도가 raw 단일과 같은지는 RTX 4060에서
  `npm run measure:llm`을 돌려 확인해야 한다. 본 반복은 그 측정을 라이브로 수행하는 하네스를 갖췄다.

### LIVE_RESULTS — qwen3:4b 실측 (이 빌드 환경, 2026-06-12)

`npm run snapshot`(mock 강제 없이, `Voting(Resilient(Ollama))`, `AI_VOTE_SAMPLES=5`,
기본 `OLLAMA_TIMEOUT_MS=60000`)를 라이브 qwen3:4b로 돌린 결과:

| 항목 | 값 |
| --- | --- |
| 결과 | **exit 0 — 크래시 없음** (Iteration 25에서 같은 환경 변화가 chat 크래시를 유발했던 것과 대비) |
| backend | `ollama` (voting 적용) |
| wall time | **41m 57s** — mock 데이터셋(복수 출처 의원 ~2명, LLM 호출 소수)에 대해 |
| 저신뢰(검수중) discrepancy | 0 |
| **live-LLM 호출 mock fallback** | **23건** |

**정직한 해석 — 이 수치는 메커니즘의 성공인 동시에 운영 경고다:**

1. **회복력은 작동했다(설계 검증):** 라이브 qwen3:4b가 5× voting 부하에서 호출 23건을 실패했다
   (기본 60s 타임아웃 초과 또는 간헐적 잘못된 분류 출력 — §5에서 실측으로 재현된 그 실패들).
   `ResilientAiVerifier`가 **23건 모두를 규칙 mock으로 흡수**해 배치를 멈추지 않았다. Iteration 25라면
   첫 실패에서 전체가 크래시했을 것이다.
2. **그러나 "0 저신뢰"는 크게 에누리해 읽어야 한다.** fallback이 23건이라는 것은 많은 표가 **부분적/
   전적으로 mock 라벨로 결정**됐다는 뜻이다. 즉 이 스냅샷은 상당 부분 "ollama"라기보다 "ollama가
   타임아웃해서 mock으로 떨어진" 결과다. **타임아웃이 너무 잦아 LLM의 동의어 개선 효과를 거의
   못 누렸다.** 이는 voting(호출 5×)이 60s 타임아웃과 결합될 때의 실측 병목이다.
3. **시간이 비현실적이다.** 의원 ~2명에 41m 57s. 이대로면 300명 환산은 수십 시간을 한참 넘는다.
   voting의 5× 호출 증가 + 빈번한 60s 타임아웃 재시도가 곱해진 결과다.

**→ 즉시 권고(다음 반복):**
- 배치 시 `OLLAMA_TIMEOUT_MS`를 크게(예: 300000) 두어 타임아웃發 fallback을 줄인다. 60s는
  qwen3:4b thinking 모드 + voting에는 너무 짧다.
- fallback 23건은 "정직한 degrade"지만, **fallback율이 높으면 LLM을 쓰는 의미가 옅어진다.**
  fallback율을 ledger로 모니터링하고, 임계 초과 시 배치를 경고/실패시키는 게이트를 검토한다.
- voting 5× 비용을 줄이는 incremental(변경분만) + voted 결과 핀잉이 시급하다.
- 결정성 게이트(`npm run measure:llm`의 VOTED x2)는 이 환경에서 별도 실행 권장 — 위 스냅샷 실측은
  타이밍/회복력 확인용이고, 라벨 재현성 게이트는 measure 하네스가 RAW/VOTED로 따로 측정한다.

---

## Reviewer (0장 점검)

- **(1) AI 사실 생성 없음:** 투표/회복력/핀잉은 라벨만 안정화한다. 새 사실·요약·서술 없음. RAG는
  여전히 모델을 호출하지 않는다(mock 규칙 경로). 후보 라벨은 전부 wrapped verifier 출력.
- **(2) 출처 결합·(4) 병합 금지:** detector core 불변 — evidence 병합 없음, 모든 evidenceId 보존.
- **(3) 모르면 모른다:** 표가 갈리면 한쪽을 고르지 않고 `llm_interface_low_confidence`(검수중)로 surface.
- **(5) 데이터 성격 분리:** 표 분포는 내부(gitignore) ledger에만. 공개 스냅샷엔 라벨·검수 상태만.
- **(8) 객관성은 증명:** 표가 검사 가능(ledger). 결정성은 CI 게이트로 강제. 라이브 하네스가 raw/voted
  결정성을 정직히 보고. 새 의존성 없음(node 내장만) — 라이선스/공개 가능 상태 불변.
- 비밀 분리: 모든 설정은 env로만. dossier 불변 — 어떤 source-review dossier도 건드리지 않았다.
- 라이브 LLM은 BATCH 전용 — 라이브 사이트 런타임 호출 없음 불변.

## 확정 / 남은 것 / 다음 반복 권고

- **확정:** 라벨 수준 재현성 메커니즘(voting) + CI 게이트 + 저신뢰 정직 surface + fallback 버그 2겹
  수정 + CI mock opt-out. 유닛 테스트로 구성상 보장.
- **남은 것:** 라이브 4B 실측(흔들림 빈도·필요 N·voted 정확도), 배치 시간(5×) 단축, voted 결과
  핀잉(incremental 재현성).
- **다음 반복 권고:** RTX 4060 + qwen3:4b로 `npm run measure:llm` 실행 → 이 문서의 LIVE_RESULTS
  절 갱신. samples 튜닝. voted 결과 (input-hash, model-version) 캐시로 재질의 절감.

## Verification (이번 반복 빌드 환경)

- `npm test`: typecheck + **104 pass / 1 skip**(OLLAMA_INTEGRATION 미설정), fail 0.
  (91→104, +13: voting-verifier 유닛 + ollama fallback 회귀.)
- `npm run typecheck`: clean.
- `npm run lint`: clean.
- `npm run verify:all`: **PASS.** `snapshot:mock`(결정적 mock backend) → build → 전 verify
  스크립트 → test → lint 까지 통과. **Iteration 25에서 이 단계를 크래시시키던 fallback 취약점이
  사라졌다** — 이제 (i) `verify:all`은 명시적 mock으로 로컬 모델과 무관하게 돌고, (ii) 라이브 경로도
  per-call 회복력으로 크래시하지 않는다.
- **라이브 경로 실측(qwen3:4b, 이 빌드 환경):** `npm run snapshot`(mock 강제 없이, voting 적용)을
  라이브 qwen3:4b로 돌려 **exit 0 — 크래시 없이** 완료. live-LLM 호출 23건이 실패했으나 회복력
  래퍼가 전부 mock으로 흡수했다(Iteration 25라면 첫 실패에서 크래시). 단 41m 57s 소요 + 잦은
  타임아웃이라는 운영 경고가 있다 — 정직한 수치·해석은 §6 LIVE_RESULTS 절 참조.

### 한 줄 요약
모델은 못 고친다 — 대신 시스템을 고쳤다. 잡음 분류기 위에 다수결을 얹어 라벨을 안정화하고(CI 게이트로
강제), 갈리는 케이스는 검수중으로 정직하게 드러내며, 라이브 호출 실패는 per-call mock으로 흡수한다.
