# Envelope (BoundWallet)

**라이브 데모: https://boundwallet.sigongan.com** · 배포 상세: [docs/deploy.md](docs/deploy.md)


> AI에게 한도가 박힌 봉투를 쥐여주고, 그 안에서는 사람 없이 알아서 사게 하는 결제 에이전트.
> **AI가 속아도 봉투 밖으로는 한 푼도 나가지 않는다.**

Google Cloud AI(Gemini + ADK)가 두뇌, Solana devnet(USDC, x402)이 결제 레이어.
이 프로젝트는 "AI가 결제할 수 있다"가 아니라 **"AI가 결제하려 했지만 막혔다"**를 증명한다.

정본 스펙: [docs/HANDOFF.md](docs/HANDOFF.md) · 스파이크 기록: [docs/spike-results.md](docs/spike-results.md)

## 절대 규칙 (NON-NEGOTIABLE — 상세는 HANDOFF §5)

| # | 규칙 |
|---|---|
| R1 | 에이전트는 서명 키에 접근할 수 없다 (키는 executor만) |
| R2 | 에이전트 툴은 `discover_sellers`·`request_quote`·`submit_purchase_intent` 셋뿐 — 결제 툴은 존재하지 않는다 |
| R3 | 정책 판정에 LLM 호출 0회 (순수 결정론적 함수) |
| R4 | executor는 정책 통과 없이 서명하지 않는다 (`skipPolicy` 류 금지) |
| R5 | 정책 엔진은 첫 FAIL에서 멈추지 않고 모든 규칙을 평가·전부 기록한다 |

## 구조

```
agent (Python+ADK, 키 없음) ──구매 의도──▶ executor (TS, 유일한 키 보유)
      │                                        │
      │ A2A 견적 요청                           ├─▶ policy (Python, LLM 0회) : 판정
      ▼                                        └─▶ seller ×3 (x402) : 402 → 결제 → 데이터+어테스테이션
                                               Firestore 감사 로그 → web (데모 UI, SSE)
```

**agent에서 Solana로 가는 화살표가 없다는 것이 이 그림의 전부다.**

## 레포 구조

```
/agent      Python + ADK. tools/ = 허용된 툴 3종만
/executor   TS. @x402/svm + @solana/kit. wallet/ = 유일한 키 보유 지점(커밋 금지)
/policy     Python 순수 함수. rules/ = 규칙 1개당 1파일, rulesets/ = 봉투 정의
/seller     TS. x402 서버. data/ = 목 근거 데이터셋 + 인젝션 페이로드(판매자 B)
/web        데모 UI (4분할, SSE)
/shared     JSON 스키마 — 모든 서비스가 참조하는 데이터 계약
/scripts    devnet 셋업, 시나리오 실행기
/docs       HANDOFF.md(정본 스펙), spike-results.md
```

## 마일스톤 현황

| 마일스톤 | 상태 |
|---|---|
| 스파이크 S1·S2·S3 | S1·S3 devnet 실측 완료(모사 USDC-M·Approve 위임·한도 초과 온체인 거부), S2 부분 확인 — 왕복은 M1에서 |
| /shared 스키마 확정 | 완료 (x402 402 응답은 S2 정합 시 갱신) |
| M1 결제 최소 루프 | **완료** — 402→위임 전송→온체인 검증→200 왕복 실측, Explorer 확인 |
| M2 정책 엔진 | **완료** — 엔진(테스트 26개) + executor 배선(R4), PASS/BLOCK 실측 |
| M3 온체인 한도 | **완료** — Approve 위임 실측 + AP2 경량 mandate(관리자 서명·executor 검증·영수증 첨부) |
| M4 Gemini 에이전트 | **완료** — ADK+Vertex AI, 툴 3종, 자율 루프. 라이브 UI 연동 |
| M5 판매자 3인스턴스 | **완료** — 온체인 검증(replay 가드) + 3인스턴스 동시 기동 |
| M6 데모 UI | **완료** — Next.js 4분할 + SSE + 라이브 Gemini 사고 로그 + 자연어 입력 |
| M7 시나리오 리허설 | **완료** — 클라우드 5회×5시나리오 **25/25** ([docs/rehearsal.md](docs/rehearsal.md)). 녹화만 남음 |
| S2 x402 표준 스킴 | **완료** — 402·결제 페이로드를 x402 v2 표준 형상으로 정합 |
| 라이브 배포 | **완료** — Cloud Run 7서비스 + 커스텀 도메인 ([docs/deploy.md](docs/deploy.md)) |

## 실행

```bash
./scripts/run-all.sh              # policy(:5100) + seller×3(:4001~3) + executor(:5200) + agent(:5300)
(cd web && npm run dev)           # 데모 UI http://localhost:3000
node scripts/devnet-setup.ts      # 최초 1회 / 위임 잔량 소진 시 재실행
node scripts/create-mandate.ts    # AP2 mandate 재서명 (봉투 정의 변경 시)
```

UI에서 자연어 목표를 입력해 라이브 에이전트를 돌리거나, 시나리오 버튼(①②③=라이브, ④a=인젝션 라이브 저항, ④b=정책 차단)을 누른다. CLI 대안: `node scripts/scenario.ts all`, `.venv/bin/python -m agent.scenarios 1|2|3`.
