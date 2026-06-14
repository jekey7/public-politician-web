# Iteration 28 — 투표 메커니즘이 실제로 동작하는지 검증 (모델 변경 없음)

Iter-27은 라이브 qwen3:4b에서 fallback 0의 유효 실측을 처음 달성했지만, 4b가 현재 fixture에서 너무
안정적이라(control samples=1도 8/8 byte-identical) **voting의 안정화 delta를 귀속하지 못했다**
(판정: INCONCLUSIVE-on-this-sample). 즉 "흔들릴 거리가 없어서" voting이 일하는 모습을 관측하지 못했다.

이번 반복은 **모델 정확도가 아니라 투표 계층(layer) 자체**를 검증한다. 답할 질문:

> raw LLM 출력이 실행마다 흔들릴 때, 자기 일관성 투표 계층이 (a) 흔들림을 안정적 다수결로 흡수하고,
> (b) 진짜로 갈린 표를 조용히 한쪽으로 고르지 않고 **검수중/저신뢰**로 드러내는가?

**범위 밖(명시):** 다른 모델 테스트 안 함. GPU 부동소수점 비결정성 모델 레벨 수정 안 함. 300명 배치 재실행 안 함.

---

## 1. 투표 계층 위치와 사양 (코드 확인)

투표 계층은 [`src/lib/voting-verifier.ts`](../src/lib/voting-verifier.ts)에 이미 구현돼 있다. 이번 반복은
그 계층을 **검증**한다(신규 구현 아님). 확인된 사양:

| 항목 | 값 | 근거 |
| --- | --- | --- |
| **N (표 수)** | `samples`, 기본 **5** | `DEFAULT_VOTING_CONFIG`. `AI_VOTE_SAMPLES`로 override |
| **다수결 계산** | `tallyVotes()` — 순수·결정적. 라벨 카운트 → 최다 득표가 승자 | `voting-verifier.ts:121` |
| **split 임계치** | `confidenceThreshold`, 기본 **0.6** | `AI_VOTE_THRESHOLD`로 override |
| **split 판정식** | `lowConfidence = isTie \|\| confidence < threshold` | `voting-verifier.ts:137` |
| **split 시 상태** | `lowConfidence: true` → ledger 기록 → `lowConfidenceFieldsFromLedger` → 파이프라인이 `detector = "llm_interface_low_confidence"`(검수중)로 표시 | `verification.ts:44` |
| **동률(tie) 처리** | 대표값은 **사전순 첫 라벨**(표시용·결정성용)이되 **반드시 `lowConfidence=true`**. 코인플립 아님 | `voting-verifier.ts:128–137` |

핵심: 동률에서 사전순 대표 라벨을 고르는 것은 **결정성**(같은 표 → 같은 직렬화)을 위한 표시값일 뿐이며,
그와 **함께** `lowConfidence` 플래그가 "신뢰 불가"를 전달한다. 즉 한쪽을 조용히 확정하지 **않는다**.

---

## 2. 결정적 투표 검증 하네스 설계

신규 테스트 파일 [`tests/voting-scenarios.test.ts`](../tests/voting-scenarios.test.ts) (11 케이스).

**설계 핵심 — `ScriptedVerifier`:** 호출 순서대로 **미리 짜인 라벨 시퀀스를 그대로** 돌려주는 stub.
라이브 LLM/GPU 비결정성에 전혀 의존하지 않으므로 각 시나리오의 표 분포가 정확히 재현 가능하다(과제 2 요구).
기존 `FlakyVerifier`의 modulo(`flipEvery`) 방식과 달리, **정확한 tally(예: 4-vs-1, 3-vs-2)를 의도대로
주입**할 수 있어 "소수 반대표가 버려지지 않고 관측되는가"를 엄밀히 단언할 수 있다.

각 시나리오는 **entity matching**(`match:true/false`)과 **inconsistency classification**
(`notation_variance`/`content_conflict`/`missing_from_source`) **두 역할에 대칭 적용**한다.

---

## 3. 결과표 (시나리오 → 기대 → 실제 → pass/fail)

모든 케이스는 라이브 LLM 없이 결정적 주입으로 100% 재현된다. `npx tsx --test tests/voting-scenarios.test.ts`.

| # | 시나리오 (주입 표 분포) | 역할 | 기대 | 실제 | 결과 |
| --- | --- | --- | --- | --- | --- |
| 1 | **Unanimous 5/5** (`same`×5) | match | `true`, lowConf=false, tally `{same:5}` | 동일 | ✅ |
| 1 | **Unanimous 5/5** (`notation_variance`×5) | classify | `notation_variance`, lowConf=false | 동일 | ✅ |
| 2 | **Clear majority 4/5** (`same`×4,`different`×1) | match | `true`, lowConf=false, **tally `{different:1,same:4}`(반대표 보존)** | 동일 | ✅ |
| 2 | **Clear majority 4/5** (`content_conflict`×4,`notation_variance`×1) | classify | `content_conflict`, **소수 의견 tally에 보존** | 동일 | ✅ |
| 3 | **Bare majority 3/5** (conf=0.6 == threshold) | match | **통과**(lowConf=false) — 경계 포함(`>=`) | 동일 | ✅ |
| 3 | **Bare majority 3/5, threshold 0.7로 상향** (0.6 < 0.7) | classify | **검수중**(lowConf=true) — 임계치가 실제로 작동 | 동일 | ✅ |
| 4 | **True split 2/2 동률** | match | **lowConf=true**, 양쪽 표 tally 보존, 조용한 승자 없음 | 동일 | ✅ |
| 4 | **No-majority 2/2/1** (conf=0.4) | classify | **lowConf=true**, 저신뢰 field로 surface | 동일 | ✅ |
| 5 | **Wavering raw, 같은 multiset 다른 순서** | match | 두 실행 voted 라벨/tally **byte-identical** | 동일 | ✅ |
| 5 | **Wavering raw (순수 tallyVotes), 3가지 순서** | classify | 3 순서 모두 동일 outcome(결정성) | 동일 | ✅ |
| 4b | **Tie → 종단 검증** (NO SILENT MERGE) | classify→pipeline | tie field가 최종 profile에서 **`llm_interface_low_confidence`**(검수중)로 표시, 절대 조용히 확정 안 됨 | 동일 | ✅ |

**스펙 명시(과제 2의 'bare majority' 요구):** `lowConfidence = isTie || confidence < threshold`이므로
3/5 = 0.6은 `< 0.6`이 아니다 → **경계 포함(통과)**. 이는 매직넘버가 아니라 임계치의 명시 동작이며,
케이스 3 두 줄(통과 vs 임계치 상향 시 검수중)로 양방향 단언한다.

---

## 4. 안정성 단언 (Iter-27이 관측 못한 것)

케이스 5가 핵심: raw 라벨 시퀀스를 실행마다 **다른 순서로 흔들되**(예: `different`가 3번째 → 1번째)
multiset(4 same, 1 different)을 유지하면, voted 최종 라벨/tally/lowConfidence가 두 실행에서
**byte-identical**이다. 즉 **투표가 흔들리는 raw 라벨을 재현 가능한 최종 라벨로 변환**한다.

이것이 Iter-27이 라이브 4b에서 관측하지 못한 바로 그 성질이다(4b는 흔들리지 않아서 보여줄 게 없었다).
여기서는 **주입으로 흔들림을 강제 발현**시켜 안정화를 직접 관측한다.

---

## 5. 임계치/N sanity

- **N과 threshold는 magic number가 아니다:** `VotingConfig`로 노출, `AI_VOTE_SAMPLES`/`AI_VOTE_THRESHOLD`
  환경변수로 override(`votingConfigFromEnv`, 기존 `voting-verifier.test.ts`가 파싱·fallback 검증). 본 문서 §1에 문서화.
- **N이 짝수(동률 가능)면 tie → 검수중:** 케이스 4(2/2)가 짝수 N=4에서 동률이 **코인플립이 아니라 검수중**으로
  라우팅됨을 단언. 사전순 대표 라벨은 표시·결정성용일 뿐 lowConfidence가 함께 surface.
- 기본 N=5(홀수)는 동률을 줄이지만 케이스 4·4b는 동률이 *발생할 때*의 처리를 짝수 N으로 명시 검증한다.

---

## 6. 가드레일 / 회귀

- `npm test`(typecheck 포함): **116 pass / 1 skip(OLLAMA_INTEGRATION 미설정) / 0 fail** — 105 → 116(신규 11).
- `npm run lint`: clean.
- 기존 `tests/voting-verifier.test.ts`(FlakyVerifier CI 게이트)는 그대로 — 이번 반복은 그 위에
  **시나리오 매트릭스를 얹었을 뿐** 기존 게이트를 변경하지 않았다.
- 공개 스냅샷/소스 라이선스/프라이버시 경계 등 다른 verify는 이번 변경(테스트·문서만 추가)으로 영향 없음.

---

## 7. 정직한 verdict

판정은 두 가지를 **분리**한다(과제 요구):

**(1) 투표 LAYER는 사양대로 정확히 동작하는가 — 이번 반복의 범위: YES (확정).**
11개 시나리오 전부 pass. 특히:
- 흔들리는 입력을 안정적 다수결로 **흡수**한다(케이스 5, byte-identical).
- 진짜 split(동률/임계치 미만)을 **검수중/저신뢰로 surface**하며, 종단(profile detector)까지
  `llm_interface_low_confidence`로 표시한다(케이스 4·4b). **조용히 한쪽을 고르는 경로는 없다.**
- 소수 반대표가 tally에 **보존돼 검사 가능**하다(케이스 2) — 버려지지 않는다(불변 #4·#8).
- 임계치·N이 실제로 동작한다(케이스 3: 같은 3/5라도 임계치 상향 시 검수중으로 넘어감).

**(2) 라이브 qwen3:4b가 production에서 이 투표를 실제로 *필요로* 하는가 — 여전히 OPEN.**
Iter-27 clean run에서 4b는 현재 fixture를 control(samples=1)만으로도 8/8 안정적으로 분류했다. 즉 이
fixture의 케이스들에선 voting이 흡수할 잡음이 발현되지 않았다. 이번 반복은 **계층의 정확성**을 증명했을 뿐,
4b가 그것을 production에서 얼마나 자주 발동시키는지는 입증하지 않는다(over-claim 금지). 그 귀속은 잡음이
*실제로 나타나는* 모델/fixture(8b·더 어려운 경계 케이스)에서 따로 측정해야 한다(다음 반복).

> 한 줄: **투표 계층은 사양대로 정확히 작동한다(흔들림 흡수 + split을 검수중으로 드러냄, 조용한 병합
> 없음). 4b가 그것을 production에서 실제로 필요로 하는지는 별개의 미결 문제다.**

split 표가 조용히 확정되는 경로는 **발견되지 않았다**(케이스 4·4b가 그것을 FAIL로 잡도록 설계됐고 통과).

---

## Reviewer (Chapter 0 점검)

- **#1 AI는 사실을 만들지 않는다:** 투표는 wrapped verifier가 낸 **라벨만 안정화**한다. ScriptedVerifier도
  주입된 라벨을 돌려줄 뿐 새 사실·문장을 생성하지 않는다.
- **#3 모르면 모른다 / #4 불일치는 드러낸다:** split/동률/임계치 미만이 **반드시** `lowConfidence`로
  surface 되고 종단 detector까지 검수중으로 표시됨을 케이스 4·4b가 단언. **조용한 승자 선택 없음**(원칙 위반 시 FAIL).
- **#5 데이터 성격 분리 / #8 객관성은 증명:** 모든 표 분포(소수 반대표 포함)가 검사 가능한 ledger tally에
  보존된다(블랙박스 아님). 이번 변경은 테스트·문서만 추가 — 공개 스냅샷·소스 dossier 불변.

## 확정 / 남은 것 / 다음 반복 권고

- **확정:** 투표 계층의 4개 시나리오(만장일치/명백한 다수/근소 다수/진짜 split)를 **두 역할에 대칭**으로
  결정적 주입 검증. 흔들림 흡수(안정성)·소수 반대표 보존·임계치 작동·tie→검수중 종단 라우팅 모두 pass.
  **조용한 병합 경로 없음 확인.** 116/1skip/0fail, lint clean.
- **남은 것:** 라이브 4b가 production에서 voting을 실제로 필요로 하는 빈도(잡음 발현)는 미결 —
  Iter-27 그대로. 4b는 현재 fixture에 너무 안정적.
- **다음 반복 권고:** 잡음이 *실제 발현*되는 모델/fixture(8b·더 어려운 경계 케이스)에서 voting의 안정화
  delta를 라이브 귀속 측정 → 그 split 분포로 N(samples) 튜닝.
