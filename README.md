# Envelope

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
| 스파이크 S1·S2·S3 | S2 부분 확인(패키지·RPC), S1·S3 devnet 실측 대기 |
| /shared 스키마 확정 | 진행 |
| M1 결제 최소 루프 | 대기 |
| M2 정책 엔진 | 대기 |
| M3 온체인 한도 | 대기 |
| M4 Gemini 에이전트 | 대기 |
| M5 판매자 3인스턴스 | 대기 |
| M6 데모 UI | 대기 |
| M7 시나리오 리허설 | 대기 |
