# 리스크 스파이크 결과 (HANDOFF §10)

측정 명령과 결과만 기록한다. 갱신 = 교체.

## S1 — Devnet USDC 확보

**상태: 미확인 (devnet 실측 대기)**

- 계획: Circle devnet faucet(faucet.circle.com)에서 executor 지갑으로 USDC 수령 시도. devnet USDC mint는 `4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU`.
- 실패 시 대안(확정): 자체 SPL 토큰 민트 후 데모에서 "USDC 모사"로 명시. `scripts/`에 민트 스크립트 추가.
- 선행 조건: executor 전용 devnet 키페어 생성(§15). SOL 에어드랍은 RPC `requestAirdrop`으로 가능.

## S2 — x402의 Solana devnet 지원

**상태: 부분 확인 — 패키지·RPC 실측 완료, facilitator 왕복 실측 대기**

실측 완료:
- `@x402/svm` npm 실존, latest **2.20.0** (Coinbase, Apache-2.0). `npm view` 기준.
- 의존성: `@x402/core ~2.20.0`, `@solana-program/token`, `@solana-program/token-2022`, `@solana-program/compute-budget`. **peer dep: `@solana/kit >= 5.1.0`.**
  - ⚠️ HANDOFF §6.3의 `@solana/web3.js`는 legacy — executor는 `@solana/kit`로 간다. §7.4 스키마도 실스펙 확인 후 확정할 것.
- Solana devnet RPC(`api.devnet.solana.com`) 응답 정상: `getVersion` → solana-core 4.1.2.

실측 대기:
- facilitator가 solana-devnet 네트워크의 verify/settle을 실제 지원하는지 (M1에서 왕복으로 확인).
- 실패 시 대안(확정): 자체 facilitator — 402 응답 + 트랜잭션 서명 검증만 직접 구현.

## S3 — 온체인 위임/한도

**상태: 미확인 (devnet 실측 대기)**

- 계획: SPL Token `Approve`(delegate + 금액 상한)를 1차 후보로 바로 실측. 네이티브 위임 프로그램 탐색에 시간을 쓰지 않는다 — `Approve`만으로 "공격자 주소로는 애초에 인출 권한이 없다"(시나리오 4-3) 서사가 성립한다.
- 확인 항목: devnet에서 `Approve` 후 Explorer/`getTokenAccountsByOwner`로 위임 잔량(delegated_amount) 조회 가능한지.
