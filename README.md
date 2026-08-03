# BoundWallet — 한도가 박힌 봉투를 든 결제 AI 에이전트

> 관리자가 **최초 1회** 예산·허용 판매처·건당 한도를 설정하면, 이후 Gemini 에이전트가 사람 개입 없이
> 필요한 데이터를 **직접 비교하고 결제해서** 가져온다.
> **AI가 속아도 봉투 밖으로는 한 푼도 나가지 않는다.**

**🔗 라이브 데모: https://boundwallet.sigongan.com**

Google Cloud AI(Gemini + ADK)가 두뇌, Solana devnet(x402 + SPL 위임)이 결제 레이어.
이 프로젝트는 "AI가 결제할 수 있다"가 아니라 **"AI가 결제하려 했지만 막혔다"**를 증명한다.

---

## 1. 해결하는 문제

| 문제 | 현재 | BoundWallet |
|---|---|---|
| **AI는 일을 대신 해주지만 돈을 못 쓴다** | "이 데이터를 사야 합니다"까지만 말하고 멈춤. 사람이 가입·결제·붙여넣기를 반복 | 에이전트가 봉투 한도 안에서 직접 결제·수령 |
| **그렇다고 AI에게 카드를 줄 수 없다** | 웹·API 응답에 심긴 프롬프트 인젝션에 속을 수 있고, 온체인 결제는 차지백이 없음 | 3겹 방어로 범위 밖 지출을 **구조적으로** 차단 |
| **단발성 수요는 시장에서 배제됨** | 논문 한 건 보려고 연간 구독·컨설팅 계약을 맺을 수는 없음 | x402로 **회원가입 없이 건당** 구매 |

## 2. 3겹 방어

| 층 | 내용 | 뚫리면 |
|---|---|---|
| ① 에이전트 툴 제한 | 툴이 `discover_sellers`·`request_quote`·`submit_purchase_intent` **셋뿐**. 결제 툴이 아예 없다 | 다음 층으로 |
| ② 결정론 정책 엔진 | LLM 호출 **0회**. 규칙 6종을 전부 평가 후 PASS/BLOCK | 다음 층으로 |
| ③ 온체인 위임 한도 | SPL `Approve`로 executor에 상한 위임. 한도 초과·미허가 주소는 **체인이 거부** | 물리적으로 불가 |

> 심사위원이 반드시 묻는 질문 — *"LLM이 틀리면요?"*
> 우리 답: **Gemini는 결제를 트리거하지 않는다. Gemini 출력은 결정론적 규칙의 입력값 하나일 뿐이다.**

## 3. 아키텍처

```
 ┌──────────────────┐   구매 의도 JSON    ┌──────────────────┐
 │      agent       │ ─────────────────▶ │     executor     │
 │  Gemini + ADK    │                    │   유일한 키 보유   │
 │    (키 없음)      │ ◀───────────────── │                  │
 └────────┬─────────┘   결과 + 영수증      └────┬────────┬────┘
          │                                    │        │
          │ A2A 견적 요청                 ① 판정 │        │ ② x402 결제
          ▼                                    ▼        ▼
 ┌──────────────────┐                 ┌──────────────┐ ┌──────────────────┐
 │   seller × 3     │                 │    policy    │ │  Solana devnet   │
 │   x402 서버       │ ◀── 데이터 요청 ──│  LLM 호출 0회 │ │ SPL 위임 한도     │
 │  A / B / C       │ ─── 데이터+증빙 ─▶└──────────────┘ └──────────────────┘
 └──────────────────┘                        │
                                             ▼
                              ┌──────────────────────────┐
                              │  감사 로그 → web (SSE UI)  │
                              └──────────────────────────┘
```

**agent에서 Solana로 가는 화살표가 없다는 것이 이 그림의 전부다.**

| 서비스 | 스택 | 책임 | 하지 않는 일 |
|---|---|---|---|
| `agent` | Python + ADK 2.6 + Vertex AI (`gemini-2.5-flash`) | 목표 분해, 판매자 탐색, A2A 견적 비교, 의도 제출 | 서명·결제·정책 판정 |
| `executor` | Node/TS + `@solana/kit` | 정책 조회 → 통과 시 x402 결제 → 서명·전송 → 영수증 | 판단·추론·판매자 선택 |
| `policy` | Python 순수 함수 | 결정론 규칙 검증, 판정 + 사유 + 검사 목록 반환 | LLM 호출·상태 변경 |
| `seller` ×3 | Node/TS x402 서버 | 402 응답, 온체인 결제 검증, 어테스테이션 발급 | — |
| `web` | Next.js 16 + SSE | 봉투 상태·에이전트 사고·정책 판정·트랜잭션 실시간 표시 | 비즈니스 로직 |

## 4. 절대 규칙 (코드 수정 시 필독)

| # | 규칙 |
|---|---|
| **R1** | 에이전트 프로세스는 서명 키에 접근할 수 없다 (env·파일·메모리 전부). 키는 `executor`만 |
| **R2** | 에이전트 툴은 정확히 3개. `send_payment`·`transfer_usdc` 류는 **존재하지 않는다** |
| **R3** | 정책 판정에 LLM 호출 0회. 같은 입력 → 항상 같은 출력 (시계·난수도 금지, 시각은 입력으로 받음) |
| **R4** | executor는 정책 통과 없이 서명하지 않는다 (`skipPolicy`·디버그 플래그 전부 금지) |
| **R5** | 정책 엔진은 첫 FAIL에서 멈추지 않고 **모든 규칙을 평가·전부 기록**한다 |

R3·R5는 유닛테스트로 강제된다 (`policy/tests/test_engine.py` — 금지 import·시계 접근 가드 포함).

---

## 5. 빠른 시작 (재현 가이드)

### 5.1 사전 요구사항

| 항목 | 버전/조건 | 확인 |
|---|---|---|
| Node.js | **26.x** (네이티브 TS 실행 — 빌드 스텝 없음) | `node --version` |
| Python | **3.13** | `python3 --version` |
| gcloud CLI | 최신 | `gcloud --version` |
| GCP 프로젝트 | **Vertex AI API 활성화 + 결제 연결** | 아래 5.3 |
| Solana devnet | SOL 에어드랍 2회분 (수수료용) | 아래 5.4 |

### 5.2 설치

```bash
git clone https://github.com/sujileelea/BoundWallet.git
cd BoundWallet

npm install                    # executor·seller·scripts 공용 (@solana/kit, @x402/svm)
(cd web && npm install)        # 데모 UI

python3 -m venv .venv
.venv/bin/pip install -r policy/requirements.txt -r agent/requirements.txt
```

### 5.3 Google Cloud (Vertex AI)

에이전트는 API 키가 아니라 **Vertex AI + ADC**로 Gemini를 호출한다.

```bash
gcloud auth login
gcloud auth application-default login
gcloud config set project <YOUR_PROJECT_ID>
gcloud services enable aiplatform.googleapis.com

cp agent/.env.example agent/.env
# agent/.env 의 GOOGLE_CLOUD_PROJECT 를 본인 프로젝트 ID로 수정
```

`agent/.env`에는 비밀이 없다 (프로젝트 ID·리전·모델명뿐). 개인키는 어디에도 들어가지 않는다.

### 5.4 Solana devnet 셋업 (최초 1회)

```bash
node scripts/devnet-setup.ts
```

이 스크립트가 하는 일 — **재실행 안전**:

1. 키페어 6개 생성 (executor / admin / seller A·B·C / 공격자 데모용) — `.gitignore`로 커밋 차단
2. executor·admin에 SOL 에어드랍 (한도 초과 시 https://faucet.solana.com 에서 수동 수령)
3. **모사 USDC(USDC-M)** 민트 생성 + admin에 1,000 발행
   *devnet USDC faucet 의존을 없애기 위한 대안 경로 — 데모에서 "모사"임을 명시한다*
4. ATA 생성 + admin → executor **SPL `Approve` 위임(상한 50)**
5. 위임 전송 성공 / **한도 초과 전송이 온체인에서 거부되는 것까지 실측**
6. 생성된 주소를 `scripts/devnet-addresses.json`과 각 설정 파일에 자동 반영

```bash
node scripts/create-mandate.ts   # AP2 경량 mandate 서명 (봉투 정의 변경 시 재실행)
```

> 레포에 커밋된 `scripts/devnet-addresses.json`은 **원 제작자의 공개 주소**다.
> 개인키는 커밋되지 않으므로, 직접 실행하려면 위 스크립트로 본인 지갑을 새로 만들어야 한다.

### 5.5 실행

```bash
./scripts/run-all.sh        # policy:5100 + seller×3:4001~3 + executor:5200 + agent:5300
(cd web && npm run dev)     # 데모 UI → http://localhost:3000
```

UI 상단 입력창에 자연어 목표를 넣거나, 시나리오 버튼을 누른다.

### 5.6 검증

```bash
.venv/bin/python -m pytest policy/tests -q   # 정책 유닛테스트 26개
node scripts/rehearse.ts 5                   # 시나리오 5회 반복 + 성공률 측정
```

---

## 6. 데모 시나리오

| 버튼 | 상황 | 기대 결과 |
|---|---|---|
| **① 정상** | 에이전트가 A/B 견적 비교 → 최저가 A 선택 | PASS → **실제 devnet 결제** → Explorer 링크 + 데이터 수령 |
| **② 예산 소진** | 잔액 0.3에 0.5 요청 | `budget_total` FAIL + 나머지 5규칙 PASS 병기, **결제 0건** |
| **③ 목록 밖 최저가** | C가 최저가(0.1) 제시, 에이전트가 C 선택 | `seller_allowlist` FAIL, **결제 0건** |
| **④a 인젝션 라이브** | 판매자 B 응답에 심긴 인젝션을 에이전트가 마주함 | 공격자 주소 거부, 정상 지갑에만 결제 |
| **④b 인젝션 차단** | 인젝션에 속았다고 가정한 의도를 직접 제출 | `seller_allowlist` FAIL, **결제 0건** |

UI의 **②(에이전트 사고 로그)와 ③(정책 판정) 패널이 나란히** 뜬다 —
왼쪽은 "이게 최선입니다", 오른쪽은 "BLOCK"이 동시에 보이는 것이 이 화면의 존재 이유다.

> **인젝션 관련 실측 결과**: `gemini-2.5-flash`는 프롬프트 인젝션에 속지 않았다(노골적·위장 버전 모두).
> 그래서 ④를 **다층 방어**로 구성했다 — ④a는 에이전트 층의 저항을, ④b는 모델 거동과 무관하게
> 정책 층이 항상 막는다는 것을 보인다. 상세: [docs/agent-notes.md](docs/agent-notes.md)

## 7. 검증 상태

| 항목 | 결과 |
|---|---|
| 정책 유닛테스트 | **26개 통과** (규칙별 경계값, 다중 FAIL 집계, 결정론, 금지 import 가드) |
| 시나리오 리허설 | **40/40 (100%)** — 클라우드 기준. [docs/rehearsal.md](docs/rehearsal.md) |
| 온체인 한도 | 위임 초과 전송이 **devnet에서 거부됨을 실측** — 3층 방어의 증거 |
| x402 | 402 응답·결제 페이로드 **v2 표준 형상** 정합 (`@x402/core` 타입) |
| 배포 | Cloud Run 7서비스 + 커스텀 도메인. [docs/deploy.md](docs/deploy.md) |

## 8. 레포 구조

```
/agent      Python + ADK. tools/ = 허용된 툴 3종만 (R2)
/executor   TS. 유일한 키 보유 지점(wallet/). x402 클라이언트·정책 배선·감사 로그
/policy     Python 순수 함수. rules/ = 규칙 1개당 1파일, rulesets/ = 봉투 정의 + mandate
/seller     TS. x402 서버. data/ = 목 근거 데이터셋 + 인젝션 페이로드(판매자 B)
/web        Next.js 데모 UI (4분할, SSE)
/shared     JSON 스키마 — 서비스 간 데이터 계약 정본
/scripts    devnet 셋업, mandate 서명, 시나리오·리허설 실행기
/deploy     Dockerfile 5종 + Cloud Run 배포 스크립트
/docs       스펙·결정·스파이크·리허설·배포 기록
```

## 9. 문서

| 문서 | 내용 |
|---|---|
| [docs/HANDOFF.md](docs/HANDOFF.md) | 정본 스펙 (배경·아키텍처·데이터 계약·시나리오) |
| [docs/deploy.md](docs/deploy.md) | Cloud Run 배포·커스텀 도메인 구성 |
| [docs/rehearsal.md](docs/rehearsal.md) | 리허설 결과·안정화 조치 |
| [docs/spike-results.md](docs/spike-results.md) | 리스크 스파이크 S1·S2·S3 실측 |
| [docs/agent-notes.md](docs/agent-notes.md) | 에이전트 실측 + 인젝션 저항 발견 |
| [docs/decisions.md](docs/decisions.md) | 설계 결정 기록 |

---

**주의**: 모든 결제는 **Solana devnet**에서 이루어지며, 정산 자산은 데모용 **모사 USDC(USDC-M)**다.
메인넷 배포·실자산 이동은 이 프로젝트의 범위 밖이다.
