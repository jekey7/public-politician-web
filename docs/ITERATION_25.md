# Iteration 25 — 로컬 LLM 실측 하네스 (measurement harness)

Iteration 24는 `AiVerifier` seam 뒤에 로컬 Ollama + Qwen3 backend를 배선했지만, 동의어 매칭
개선과 ~300명 배치 지연은 **실모델로 확인되지 않은 상태**였다(빌드 환경에 Ollama 없음).
이번 반복의 목표는 "모델이 동작한다"고 주장하는 것이 아니라, **실측 시 정직하고 재현 가능한
숫자를 만들어 내는 하네스**를 만드는 것이다.

## Architect

- 범위: 측정 도구만 추가한다. detector core / AiVerifier seam / 라이브 사이트는 건드리지 않는다.
- 결정: 측정 ground truth는 **사람이 작성한 fixture 라벨**(`fixtures/verification-cases.json`).
  하네스는 규칙·LLM 결과를 그 라벨에 **대조해 측정**만 한다. LLM 출력을 사실로 취급하지 않는다(불변 #1).
- 결정: `measure:llm`은 **라이브 전용** — `/api/tags`로 도달성을 먼저 확인하고, 닿지 않으면
  명확한 메시지 + non-zero로 종료한다. **mock으로 조용히 fallback 하지 않는다**(mock 측정은 무의미).
- 결정: 같은 fixture를 두 번 돌려 분류 출력이 byte-identical인지(결정성) 검사하고, 어긋나면 실패로 본다
  (재현 가능한 스냅샷의 전제).
- 결정: 하네스의 순수 로직(파싱·요약·결정성 비교)은 Ollama를 mock 한 유닛 테스트로 검증하고,
  실제 라이브 측정은 opt-in 스크립트로만 돈다.

## Implementer

- `fixtures/verification-cases.json` (신규, version-controlled):
  - entity_match 6건 — canonical `경제학과 졸업 ≈ 경제학 학사` + 동의어/표기 차이 5건(법학과·대학원
    약어·서수 표기·법인 접두어·띄어쓰기). 각 케이스에 동의어 판단 근거(note)를 명시.
  - classification 5건 — content_conflict **3건 이상**(경제학과 vs 경영학과 / 생년 1965 vs 1966 /
    선거구 충돌)과 notation_variance 2건. "같은 항목·다른 표기"와 "실제 충돌"을 모델이 구분하는지 확인.
  - 모든 라벨은 사람이 작성한 expected이며, 값은 실존 인물과 무관한 예시(불변 #1·#7).
- `src/lib/measure-llm.ts` (신규, 순수 로직): fixture 파싱/검증, 규칙 vs LLM per-case 실행
  (`mockSyncVerifier`로 규칙 결과 산출), 요약 통계(카테고리별 정확도 · 규칙 오분류 교정 수 · 회귀 수 ·
  p50/p95 지연), 결정성 비교, JSON 리포트 빌드, 사람용 표 포맷. Ollama 호출은 주입된 `AiVerifier`로만.
- `scripts/measure-llm.ts` (신규, `npm run measure:llm`): 라이브 도달성 게이트 → fixture 2회 실행 →
  결정성 검사 → JSON 리포트(gitignore된 `data/internal/measurements/`)에 기록 + 표를 stdout 출력.
  결정성 실패 시 exit 2, 도달 불가 시 exit 1.
- `scripts/measure-llm-batch.ts` (신규, `npm run measure:llm:batch`): 복수 출처 mock 프로필을 fresh id로
  복제해 ~300명 부하를 만들고 라이브 모델로 cross-verification 배치를 돌려 총 wall time · 인당 평균 ·
  p50/p95 · 300명 환산 추정을 기록. `MEASURE_BATCH_COUNT`로 규모 조절. **resume 미지원**(아래 이유).
- `tests/measure-llm.test.ts` (신규): fixture 로딩/거부/중복 id, per-case 실행(규칙 오분류→LLM 교정),
  요약 수학(교정·회귀·카테고리 정확도·percentile), 결정성 비교(PASS/FAIL), 리포트·표 — 전부 Ollama mock.
- `docs/LOCAL_LLM_SETUP.md`: `npm run measure:llm` / `measure:llm:batch` 실행법 추가.

## 하네스가 측정하는 것

| 항목 | 의미 |
| --- | --- |
| per-category accuracy | 카테고리(synonym / content_conflict)별로 LLM·규칙이 expected 라벨을 맞춘 비율 |
| LLM corrected rule | 규칙이 틀린 케이스를 LLM이 바로잡은 수 (동의어 gap 해소의 핵심 지표) |
| regressions | 규칙은 맞았는데 LLM이 틀린 수 (개선의 대가) |
| p50 / p95 latency | per-call 지연 분포 |
| determinism | 같은 fixture 2회 실행의 분류 출력이 byte-identical인지 |
| batch timing | ~300명 cross-verification의 총/인당 시간과 스냅샷 갱신 추정 |

## 실행 방법

```bash
# 전제: 로컬에 Ollama가 떠 있고 모델이 pull 되어 있어야 한다.
ollama pull qwen3:4b           # 또는 보유 모델
curl http://localhost:11434/api/tags

# fixture 정확도 + 지연 + 결정성
npm run measure:llm

# 다른 모델/엔드포인트로 측정
OLLAMA_MODEL=qwen3:8b npm run measure:llm

# 배치 타이밍(기본 300명, 규모 조절 가능)
MEASURE_BATCH_COUNT=10 npm run measure:llm:batch
```

리포트는 `data/internal/measurements/`(gitignore)에 JSON으로, 요약 표는 stdout으로 나온다.

## Reviewer (0장 점검)

- (1) AI 사실 생성 없음: fixture expected는 전부 사람 작성. 하네스는 측정만 하고 어떤 산출물도
  공개 스냅샷/사이트에 넣지 않는다. 배치 부하 데이터는 mock 복제본으로 절대 공개되지 않는다.
  detector core / AiVerifier seam 불변. 런타임 LLM 호출 추가 없음.
- (2) 출처 결합·(4) 병합 금지: 하네스는 evidence 구조를 바꾸지 않고 비교만 한다.
- (5) 데이터 성격 분리: 측정 결과는 `data/internal/`에만, 공개 아티팩트와 분리.
- (8) 라이선스: 새 의존성 없음(node 내장 fs/test만). 로컬 추론 — 유료 클라우드 의존 없음.
- 비밀 분리: endpoint/model은 env로만. 측정 결과 디렉터리는 gitignore.
- dossier 불변: 어떤 source-review dossier도 approved로 바꾸지 않았다(이 과제와 무관).

## 정직한 보고 — 실측 결과

> 이 절은 실모델 측정 결과를 담는다. **숫자를 꾸미지 않는다.** 빌드 환경에 마침 로컬 Ollama가
> 떠 있어(`qwen3:8b` 설치, `qwen3:4b`는 미설치) 실제 측정을 수행했다. **계획된 타깃 모델은
> `qwen3:4b`이며, 아래 수치는 `qwen3:8b` 기준이다.** RTX 4060(8GB) + `qwen3:4b`로
> `npm run measure:llm`을 돌려 동일 표를 갱신할 것을 권장한다.

### 측정 환경
- 모델: **qwen3:8b** (계획 타깃 qwen3:4b 아님 — 미설치였음)
- 엔드포인트: `http://localhost:11434`
- 일시: 2026-06-12
- fixture schema: 1.0.0 (entity_match 6 + classification 5 = 11 cases)

### fixture 정확도 (`npm run measure:llm`)

| 카테고리 | LLM 정확도 | 규칙 정확도 |
| --- | --- | --- |
| synonym | 7/8 | 1/8 |
| content_conflict | 3/3 | 3/3 |
| **합계** | **10/11** | **4/11** |

- **LLM이 규칙 오분류를 교정한 케이스: 6** (회귀: **0**).
- 핵심 가설 확인됨: 규칙 matcher가 놓치던 동의어(`경제학과 졸업 ≈ 경제학 학사` 등)를 LLM이 잡는다.
  notation_variance 분류도 LLM이 맞춘 반면 규칙은 content_conflict로 오분류했다.
- 모델은 **실제 충돌을 동의어로 뭉개지 않았다**(content_conflict 3/3).
- **실패한 케이스(정직히 보고):** `match-career-title-variant`(`제20대` vs `20대 (재선)`)에서
  LLM이 같은 항목을 다르다고 판단(오답). 1건은 개선 대상으로 남는다.

### 지연 (`npm run measure:llm`)
- per-call **p50 ≈ 11~13초, p95 ≈ 23~24초** (qwen3:8b, thinking mode 포함).

### 결정성 (같은 fixture 2회)
- **간헐적으로 FAIL.** temperature 0 / seed 0에도 `match-career-title-variant`에서 두 실행의 출력이
  달라지는 경우가 관측됐다(3회 중 1회 FAIL, 2회 PASS). 즉 **현재 설정은 byte-identical 재현을
  보장하지 못한다.** 재현 가능한 스냅샷을 위해 추가 조치 필요(아래 "남은 것" 참조).

### 배치 타이밍 (`MEASURE_BATCH_COUNT=10 npm run measure:llm:batch`)
- 복수 출처 의원 1명당 ≈ **143초**(p95), 총 10명 11분 37초.
- **300명 환산 추정 ≈ 5.8시간** (qwen3:8b, 8GB, 직렬 처리 기준).
- 관측된 운영 이슈: classify 호출이 간헐적으로 길어져(>120초) 기본 타임아웃에서 abort 됨.
  배치 시 `OLLAMA_TIMEOUT_MS`를 넉넉히(예: 300000) 두는 것을 권장.

## 남은 것 / 다음 반복 권고

- **타깃 모델 실측:** `ollama pull qwen3:4b` 후 RTX 4060에서 `npm run measure:llm` 재실행해
  이 표를 qwen3:4b 기준으로 갱신(정확도·지연·결정성 모두). 4B가 정확도를 유지하면서 더 빠른지 확인.
- **결정성 확보:** thinking mode(`/no_think`는 프롬프트에 있으나 8b에서 사고 흔적 잔존 가능)와
  seed/temperature 처리를 점검. 필요 시 Ollama native `/api/chat`의 `options.seed`·`num_predict`
  고정, 또는 결정성 미보장 시 스냅샷에 모델 출력 해시를 기록해 변동을 추적.
- **배치 시간 단축:** 5.8h/300명(8b)은 야간 배치로는 가능하나 길다. 4B 측정, 동시성(병렬 요청),
  또는 변경분만 재검증하는 incremental 배치 검토.
- **career 표기 케이스 개선:** `제N대` 서수 표기 동의어를 규칙 normalize에서 선처리하거나 프롬프트 보강.
- **배치 abort 내성:** 현재 1건 timeout이 전체 배치를 멈춘다. per-member try/catch + 실패 목록
  리포트(부분 진행 보존) 추가 검토.

### resume를 지원하지 않는 이유 (문서화)
pairwise entity match는 매 갱신마다 전 출처쌍을 새로 계산하며, 중간 상태를 안전하게 저장할
자연스러운 체크포인트가 없다(detector core는 한 의원을 원샷으로 처리). 인당 처리가 분 단위라
처음부터 재시작하는 비용이 작다고 판단해 resume 대신 50명마다 진행 로그를 남기는 방식을 택했다.
대규모/장시간 배치가 상시화되면 per-member 결과 캐시 + skip-if-cached로 재개를 추가할 수 있다.

## Verification (이번 반복 빌드 환경)

- `npm test`: typecheck + **91 pass / 1 skip**(OLLAMA_INTEGRATION 미설정), fail 0. (82→91, +9: measure-llm 유닛)
- `npm run lint`: clean.
- `npm run verify:all`: snapshot 단계가 이 환경의 부분 가동 Ollama(`/api/tags`는 200,
  타깃 모델 미설치로 chat 404) 때문에 crash. **이는 사전 존재하던 fallback 취약점**으로,
  `createAiVerifier`가 `/api/tags`만 보고 backend를 고른 뒤 chat 실패 시 mock으로 떨어지지 못해
  발생한다. 측정 하네스와 무관하며(하네스는 라이브 전용이라 의도된 동작), 별도 후속으로 분리한다
  (아래 참조). 정상 dev/CI(11434에 아무것도 없음)에서는 mock fallback이 정상 동작한다.
- 실측 결과는 위 "정직한 보고"에 기록(꾸미지 않음).

### 분리한 후속 이슈 (이 과제 범위 밖, 발견 기록)
`createAiVerifier`의 도달성 게이트가 `/api/tags`만 검사한다. tags는 응답하지만 chat 모델이
없는/다른 환경에서 Ollama backend를 선택해 `npm run snapshot`이 crash 한다(목 우선 fallback
원칙 위반). 다음 반복에서 chat 호출 실패도 mock fallback으로 흡수하도록 보강 권장.
