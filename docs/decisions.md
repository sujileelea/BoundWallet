# Owner 결정 기록

HANDOFF §14 열린 질문에 대한 확정. 갱신 = 교체.

## D1. devnet 스파이크·M1 진행 주체

에이전트가 직접 진행한다. executor 전용 키페어는 `executor/wallet/`에 생성(git 차단됨), SOL 에어드랍·USDC 확보 포함.

## D2. S3 온체인 한도 = SPL Token `Approve` 직행

네이티브 위임 프로그램 탐색을 생략하고 `Approve`(delegate + 금액 상한)로 간다.
근거: 시나리오 4의 "공격자 주소는 인출 권한 자체가 없음" 서사가 동일하게 성립하고 구현이 단순하다. 위임 잔량은 `getTokenAccountsByOwner`/Explorer로 표시.

## D3. web = Next.js (HANDOFF 기본값 단일 HTML에서 변경)

M6는 Next.js로 구현한다. 4분할 화면(봉투 상태 / Gemini 사고 로그 / 정책 판정 / 트랜잭션) + SSE 스트리밍 구조는 동일.

## D4. AP2 mandate = 경량 실구현

봉투 생성 시 관리자 키가 봉투 정의(스키마 §7.1)에 서명한 mandate JSON을 만들고, executor가 모든 영수증에 mandate 참조를 첨부한다.
"사람이 이 지출 범위를 승인했다"의 암호학적 증빙 — 심사 ③ AP2 연동 구조 어필.
구현 시점: M3(온체인 한도)와 함께. `/shared`에 mandate 스키마 추가 필요.

## D5. 커밋 7~9 = executor 서비스화 트랙

커밋7 executor 서비스(POST /purchase-intent) + 정책 배선(R4) + 감사 로그 → 커밋8 봉투 상태 관리 + 시나리오 2·3 실측 → 커밋9 영수증 + 3판매자 동시 기동 + 시나리오 실행기. M4(Gemini)는 그 다음.

## D6. LLM 접근 경로 미확보 — M4 착수 전 owner가 준비

Vertex AI(권장, 심사 ② 정합) 또는 Gemini API 키. 준비될 때까지 LLM 무관 작업 진행.

## D7. 감사 로그 = AuditSink 인터페이스 + JSONL 우선

로컬은 append-only JSONL(executor/logs/). GCP 준비 후 FirestoreSink 추가 교체. x402 표준 스킴(@x402/svm ExactSvmScheme) 정합은 코어(M4·M6) 완성 후 여유 시.
