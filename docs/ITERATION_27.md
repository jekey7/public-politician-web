# Iteration 27 — self-consistency voting의 라벨 안정화 효과를 라이브 qwen3:4b에서 실측

Iteration 26은 self-consistency voting 메커니즘(voting-verifier.ts, VoteLedger, `llm_interface_low_confidence`
surfacing, ResilientAiVerifier)을 세우고 **FlakyVerifier stub으로 결정성을 구성상 보장**했다. 하지만
유일했던 라이브 run(qwen3:4b, 5× voting)은 60s 기본 타임아웃으로 **23건 mock fallback**해 사실상
mock 결정이었다. 그래서 핵심 질문이 실증적으로 미확인 상태로 남았다:

> **self-consistency voting이 qwen3:4b의 실행 간 비결정성을 실제로 안정적인 byte-identical 분류
> 라벨로 바꾸는가 — stub이 아니라 REAL 모델 출력에서?**

Iteration 27의 목표는 이 질문에 **라이브 LLM 호출로** 답하는 것이다(작은 샘플이라도). 광범위한 처리량
최적화는 목표가 아니다 — 실측이 mock으로 떨어지지 않고 완료되게 만드는 최소한의 성능 작업만 한다.

> **하드 전제(이번 환경에서 충족됨):** Ollama 도달 가능 + `qwen3:4b` 설치 확인(`/api/tags`로
> 정확히 probe). 모델 부재면 STOP — mock 대체 금지. 이번 실행 환경에서 `qwen3:4b`가 실제로
> 설치돼 있어 측정이 라이브로 진행됐다.

---

## 1. 단일 호출 지연 실측 → 타임아웃 사이징 (추측 금지)

먼저 단일 qwen3:4b `/v1/chat/completions` 호출을 코드와 동일한 파라미터(`temperature:0`, `seed:0`,
`response_format:json_object`, `/no_think` system 접미사)로 직접 측정해 per-call 타임아웃을 정했다.

| 호출 종류 | 실측 지연 | completion tokens | 비고 |
| --- | --- | --- | --- |
| match (worst case) | **~44–52s** | ~29 | 정합 케이스는 reasoning 트레이스가 매우 길다 |
| classify | **~19s** | ~8 | 분류는 짧게 사고 |

**결정적 발견 — `/no_think`가 실제로 사고를 끄지 못한다:** OpenAI 호환 endpoint를 통과한
`/no_think` system 접미사에도 qwen3:4b는 **여전히 긴 `reasoning` 필드를 생성**한다(응답에서 직접 확인).
이 긴 사고가 52s 지연의 원인이며, **이것이 Iteration 26의 23건 fallback을 실증적으로 설명한다**:
기본 60s 타임아웃에 match 호출(~52s)이 위험할 만큼 가깝고, voting(5×)으로 GPU 경합이 늘면 넘어간다.

**타임아웃 사이징(측정 기반):** 관측 worst case ~52s에 voting 경합 여유를 크게 둬 **300000ms(300s)**로
잡았다. 이 값에서 정상 repeat의 fallback은 0이 됐다(§3 — Iteration 26의 60s 병목이 사라짐).

**다음 반복 후보(이번엔 적용 안 함, 측정 충실성 유지):** Ollama native `/api/chat`의 `think:false`로
같은 match 호출이 **~52s → ~2.0s(~25× 빠름)**, 여전히 유효 JSON 반환. 이는 배치 시간을 극적으로
줄일 실측된 레버다. 하지만 이번은 **측정 반복**이므로 출하 구성(thinking on) 그대로 측정한다 —
`think:false`를 켜면 측정 대상 자체가 바뀐다.

---

## 2. mock-fallback 하드 가드를 갖춘 라이브 voting 측정 하네스

새 스크립트 [scripts/measure-voting-stability.ts](../scripts/measure-voting-stability.ts)
(`npm run measure:voting-stability`):

- 같은 작은 fixture(11 케이스 = 동의어/정합 6 + 분류 5)를 **VOTED(samples=5) ×R** + **CONTROL(samples=1) ×R**
  로 end-to-end 반복한다.
- **하드 가드(과제 1):** mock fallback이 **1건이라도** 있으면 **loud하게 ABORT**(exit 3)하고 verdict를
  `INVALID`로 찍는다 — fallback 오염된 run을 실측으로 오인할 수 없다. fallback율을 명시 보고한다
  (실측이 성립하려면 total === 0).
- per-case 라벨 agreement(R회에서 byte-identical인가)를 VOTED vs CONTROL로 정량화한다.
- per-case 표 분포(깨끗한 다수결 vs 저신뢰 split)를 ledger로 기록한다 → N=5가 적절한지 판단.
- **라이브 전용**: 닿지 않으면 mock 없이 즉시 종료. 결과 JSON은 gitignore된
  `data/internal/measurements/voting-stability-latest.json`에만(불변 #5/#8).
- VOTED와 CONTROL 반복 수를 독립 설정 가능(`VOTING_STABILITY_REPEATS` /
  `VOTING_STABILITY_CONTROL_REPEATS`). control은 6×(samples) 싸므로, baseline이 발산할 기회를
  더 주려면 control 반복만 키운다(투표 귀속 검정 강화).

---

## 3. 실측 결과

### 3-0. 첫 run(2026-06-12) — 하드 가드가 작동해 INVALID 처리 (정직히 기록)

`OLLAMA_TIMEOUT_MS=300000`, VOTED ×3, CONTROL ×3:

| repeat | wall time | fallbacks |
| --- | --- | --- |
| VOTED 1/3 | 1818s (~30m) | 0 |
| VOTED 2/3 | 1686s (~28m) | 0 |
| VOTED 3/3 | **12428s (~3.5h)** | **1** |
| CONTROL 1–3/3 | ~325s each (~5.4m) | 0 |

- repeat 1·2는 깨끗(0 fallback) — 300s 타임아웃으로 Iter-26의 60s 병목이 해소됨이 확인됐다.
- **repeat 3은 단일 호출이 300s 타임아웃마저 초과**(GPU 열적 스로틀 또는 runaway reasoning 트레이스로
  추정)해 **12428s(~3.5h)** 걸렸고 그 1건이 fallback 됐다. `ResilientAiVerifier`가 흡수(크래시 없음).
- 데이터 자체는 11/11 모두 byte-identical(5/5 sweep, 저신뢰 0)이었지만, **하드 가드가 의도대로
  이 run을 `INVALID`로 찍었다** — fallback 1건은 "그 라벨이 mock으로 결정됐을 수 있음"을 뜻하므로
  실측으로 카운트하지 않는다. 이것이 과제 1이 요구한 정확한 동작이다: fallback 오염된 run을 다시는
  실측으로 오인할 수 없다.

→ 타임아웃을 **600000ms**로 올리고(긴 tail 흡수), control 반복을 **8**로 키워(baseline 발산 기회 확대)
**clean 재실행**했다.

### 3-1. clean run(2026-06-12) — VOTED ×3, CONTROL ×8, timeout 600s, fallback 0

<!-- CLEAN_RUN_TABLE_START -->
**fallback total = 0 — VALID 실측** (하드 가드 통과, exit 0). `voting-stability-latest.json`,
generatedAt `2026-06-12T16:23:57Z`, `OLLAMA_TIMEOUT_MS=600000`.

| run | wall time / repeat | fallbacks | 라벨 안정성 |
| --- | --- | --- | --- |
| VOTED(samples=5) ×3 | 2151s / 1862s / 1717s (~30m each) | **0/0/0** | **11/11 byte-identical ×3** |
| CONTROL(samples=1) ×8 | ~332–340s each (~5.6m) | **0×8** | **11/11 byte-identical ×8** |

per-case 라벨 agreement (VOTED ×3 | CONTROL ×8) — **모두 단일 라벨, split·동률·저신뢰 0건**:

| case | VOTED | CONTROL |
| --- | --- | --- |
| match-canonical-econ-degree | `true` ×3 | `true` ×8 |
| match-law-degree | `true` ×3 | `true` ×8 |
| match-grad-school-abbrev | `true` ×3 | `true` ×8 |
| match-career-title-variant | `true` ×3 | `true` ×8 |
| match-company-suffix | `true` ×3 | `true` ×8 |
| match-major-spacing | `true` ×3 | `true` ×8 |
| classify-notation-econ | `notation_variance` ×3 | `notation_variance` ×8 |
| classify-conflict-econ-vs-biz | `content_conflict` ×3 | `content_conflict` ×8 |
| classify-conflict-birthyear | `content_conflict` ×3 | `content_conflict` ×8 |
| classify-conflict-district | `content_conflict` ×3 | `content_conflict` ×8 |
| classify-notation-district-spacing | `notation_variance` ×3 | `notation_variance` ×8 |

**표 분포(ledger):** 11개 정합/분류 호출 전부 **5/5 만장일치(confidence 1.0)** — 3회 voted repeat
모두 동일. split·동률·임계치 미만 0건 → `lowConfidence` 0건.

**핵심 관측:** control(samples=1)을 **8회**로 늘려 baseline에 발산 기회를 충분히 줬는데도 **단 한 번도
흔들리지 않았다(8/8 byte-identical)**. 즉 qwen3:4b는 이 케이스들에서 단일 추출만으로도 라벨이 안정적이다.
첫 run에서 보였던 3.5h tail은 이번엔 재현되지 않았다(voted 모두 ~30m) — 그 tail은 outlier였다.
<!-- CLEAN_RUN_TABLE_END -->

---

## 4. Iteration 25 negatives 재검토 — 결정성 vs 정확성

Iteration 25(qwen3:**8b**)의 두 정직한 부정 결과:

1. **`match-career-title-variant`(`제20대` vs `20대 (재선)`) 오답:** 8b LLM이 같은 항목을 다르다고 판단.
2. **결정성 간헐 FAIL:** 같은 케이스에서 temp0/seed0에도 3회 중 1회 발산.

**qwen3:4b 실측 발견(clean run, fallback 0):** `match-career-title-variant`가 4b에서는
**`true`(정답)로 VOTED 5/5 ×3 + CONTROL(samples=1) 8/8 모두 안정**하게 나온다 — 8b와 **반대**. 즉:

- **이 Iter-25 부정 결과는 모델 특정적이다.** qwen3:4b에서는 재현되지 않는다(정확도·결정성 모두).
  8b가 틀리고 흔들리던 케이스를 4b는 단일 추출(samples=1)로도 8회 연속 맞히고 흔들리지 않는다 —
  voting 없이도(control 8/8) 안정적이다.
- **결정성 vs 정확성 구분(과제 명시):** voting은 *결정성*을 고치지 *정확성*을 고치지 않는다.
  만약 모델이 어떤 케이스를 **일관되게 틀리면(consistently-wrong majority)**, voting은 그 오답을
  안정적으로 재현할 뿐 교정하지 못한다 — 그런 경우는 여전히 틀린 것이며 숨기지 않고 그렇게 보고한다.
  이번 4b 측정에서는 그 케이스가 일관되게 **맞았으므로** 해당 위험이 발현되지 않았다(8b였다면
  consistently-wrong 여부를 따로 봐야 했다).

> 핵심: 이번 샘플에서 voting이 교정한 오답은 없다(교정은 voting의 일이 아니다). voting의 일은
> 라벨을 실행 간 안정화하는 것이고, consistently-wrong은 별개의 정확성 문제로 surface 된다.

---

## 5. 정직한 verdict — voting이 라벨을 안정화하는가?

<!-- VERDICT_START -->
**판정: PARTIALLY YES, BUT INCONCLUSIVE-ON-THIS-SAMPLE (확정 — clean run, fallback 0).**

질문은 "voting이 qwen3:4b의 실행 간 비결정성을 안정적 byte-identical 라벨로 바꾸는가"였다.
clean 실측의 정직한 답:

1. **voting 쪽은 완전히 안정적이다 — 그러나 이 샘플에선 그 안정성을 voting에 *귀속할 수 없다*.**
   VOTED ×3가 11/11 byte-identical인 것은 사실이지만, **CONTROL(samples=1)도 8/8 byte-identical**
   이다. baseline이 8회 전부 안 흔들렸으므로 "voting *덕분에* 안정됐다"는 인과를 이 샘플은 입증하지
   못한다. voting이 흡수할 잡음 자체가 관측되지 않았다.

2. **이것은 Iteration 25(qwen3:8b)와의 핵심 차이다.** 8b는 같은 `match-career-title-variant`에서
   3회 중 1회 발산했다. **4b는 그 케이스를 8/8 안정적으로, 게다가 `true`(정답)로** 낸다. 즉
   Iter-25가 본 라벨 발산은 **모델(8b) 특정적**이며 4b에서 재현되지 않는다 — 적어도 이 fixture에선.

3. **그러므로 이 샘플로 N(=5)을 낮추는 결정을 내려선 안 된다.** 5/5 만장일치만 봤다고 voting이
   불필요하다 결론짓는 것은, voting이 겨냥하는 **잡음 발현 케이스를 이 샘플이 포함하지 않았다**는
   사실을 무시하는 것이다. voting의 가치(8b·경계 케이스 보험)는 잡음이 실제로 나타나는 곳에서
   측정해야 한다(§6).

4. **정직한 결론:** 이번 측정은 (a) 라이브 4b에서 fallback 0의 **유효한** 실측을 처음으로 달성했고,
   (b) 4b가 이 fixture에서 **단일 추출만으로도 byte-identical**임을 보였으며(따라서 이 케이스들엔
   voting이 *필수는 아님*), (c) 그러나 voting의 **안정화 delta를 귀속하지는 못했다**(잡음 미발현).
   이는 과제가 환영한 정직한 미결 결과다 — voting이 해롭다는 게 아니라, **이 샘플이 voting이 겨냥하는
   비결정성을 발현시키지 못했다**는 뜻이다. CI 게이트(stub)가 "잡음이 *있을 때* voting이 라벨을
   안정화한다"는 구성적 보장을 여전히 증명하며, 이번 실측은 그것과 모순되지 않는다.

> 한 줄: **4b는 이 케이스들에서 너무 안정적이라(8/8) voting의 효과가 발현될 여지가 없었다.**
> voting이 라벨을 안정화한다는 *명제*는 stub CI 게이트로 증명돼 있고, 라이브에서 그 delta를 보려면
> 잡음이 나타나는 모델/케이스(8b·더 어려운 경계 fixture)에서 재측정해야 한다.
<!-- VERDICT_END -->

---

## 6. N(samples) 튜닝 — 5가 맞는가?

이번 실측에서 모든 표가 **5/5 만장일치**였다(split·동률·임계치 미만 0건). 즉:
- 이 샘플에선 N=3이든 N=5든 결과가 같았을 것이다(흡수할 잡음 자체가 없음).
- N=5의 비용(5× 호출)은 이 샘플에선 순수 오버헤드였다. 하지만 N을 줄이는 결정은 **잡음이 실제로
  발현되는 모델/케이스**(예: 8b의 경계 케이스)에서 split 빈도를 봐야 정당화된다 — 이 샘플만으로
  N을 낮추는 것은 성급하다. **8b 또는 더 어려운 fixture에서 split 분포를 측정하는 것이 N 튜닝의
  선결 조건**이다(다음 반복).

---

## 7. 범위 밖(이번 반복) — 다음 반복 후보

측정이 voting을 검증하면 다음을 후속으로:
- **`think:false`로 배치 시간 단축**(~25× 측정됨) — 단 측정 충실성 위해 이번엔 미적용.
- 전체 ~300명 배치 런타임 최적화, incremental(변경분만) 스냅샷, voted 결과 핀잉(재질의 절감).
- **잡음이 발현되는 모델/fixture에서 voting 귀속 재측정** — 4b가 이 샘플에서 너무 안정적이라
  귀속이 안 됐으므로, 8b 또는 더 어려운 경계 케이스로 voting의 실제 안정화 delta를 잡는다.

---

## Reviewer (0장 점검)

- **(1) AI 사실 생성 없음:** 측정 하네스는 라벨을 ground-truth fixture에 **대조만** 한다. voting은
  라벨만 안정화한다 — 새 사실·요약·서술 없음. source-review dossier·공개 스냅샷 불변.
- **(3) 모르면 모른다:** 하드 가드가 fallback 오염을 `INVALID`로 정직히 표면화. 저신뢰 split은
  여전히 `llm_interface_low_confidence`로 surface(이번 샘플엔 split 0).
- **(5)/(8) 데이터 성격 분리·객관성은 증명:** 모든 측정 결과는 gitignore된 `data/internal`에만.
  표 분포는 검사 가능한 ledger로 기록. 공개 스냅샷과 분리.
- **정직성:** 첫 run의 3.5h tail·1 fallback·INVALID 판정·INCONCLUSIVE 귀속을 숨기지 않고 기록.
  숫자를 꾸미지 않는다.

## 확정 / 남은 것 / 다음 반복 권고

- **확정:** (i) 단일 호출 지연 실측(match ~52s, classify ~19s) + 측정 기반 타임아웃 사이징,
  (ii) mock-fallback 하드 가드를 갖춘 라이브 측정 하네스(fallback 오염 run을 INVALID로 강제),
  (iii) Iter-25 부정 결과가 **모델 특정적**임을 발견(4b는 `match-career-title-variant`를 맞히고
  흔들지 않음), (iv) 결정성 vs 정확성 구분 명문화.
- **확정(추가):** clean run(VOTED×3/CONTROL×8/600s) **fallback 0의 유효 실측 달성** — 라이브 4b에서
  voting·control 모두 11/11 byte-identical. **단 control(8/8)도 안 흔들려 voting 안정화 delta는
  귀속되지 않음**(INCONCLUSIVE-on-this-sample, §5). 4b는 이 fixture에서 단일 추출로도 결정적.
- **남은 것:** 잡음이 *실제로 발현되는* 모델/fixture(8b·더 어려운 경계 케이스)에서 voting의 안정화
  delta를 라이브로 귀속 측정. 그 결과로 N(samples) 튜닝.
- **다음 반복 권고:** `think:false` 배치 가속(~25× 측정됨), voted 결과 핀잉/incremental,
  8b·경계 케이스 split 분포로 N 튜닝.

## Verification

- `npm run typecheck`: clean(새 스크립트 포함).
- `npm test`: **105 pass / 1 skip(OLLAMA_INTEGRATION 미설정) / 0 fail.**
- `npm run lint`: clean.
- `npm run verify:all`: **PASS** (snapshot:mock → build → 전 verify → test → lint). 결정적 mock 경로
  불변 — 새 라이브 하네스는 verify:all에 들어가지 않는다(별도 수동 측정).
- 라이브 측정: §3-1 참조(라이브 qwen3:4b, fallback 0, VALID).
- mock-backed CI 게이트(`tests/voting-verifier.test.ts`의 FlakyVerifier)는 그대로 — 라이브 LLM 없이
  결정성 보장을 증명하는 빠른 결정적 경로. 이번 반복은 그 위에 **실측**을 얹었을 뿐 게이트를 바꾸지 않았다.
