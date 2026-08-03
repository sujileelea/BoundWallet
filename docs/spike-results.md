# 리스크 스파이크 결과 (HANDOFF §10)

측정 명령과 결과만 기록한다. 갱신 = 교체. 주소·tx 전체 목록은 `scripts/devnet-addresses.json`.

## S1 — Devnet USDC 확보: **확정 (모사 USDC 경로)**

- Circle faucet 대신 대안 경로로 확정: 자체 SPL 토큰 **USDC-M(모사 USDC, decimals 6)** 을 민트하고 데모에서 "USDC 모사"로 명시한다.
- 실측: 민트 `3jSgNquvLmqbsBHA1BpoYidpuppZBcGzrVqUMgCjwDJN` 생성, admin ATA에 1,000 USDC-M 민트 완료.
  - tx: https://explorer.solana.com/tx/38KzpTYqAiSBNcVmPHtZubiM7rFQ3tcDjYDznz4jHgMoRx5CjcywVTpiwm8NQ84LW9qMX8zey4XYiQJqMuA6VdMa?cluster=devnet
- 실 devnet USDC(`4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU`)로 교체하려면 mint 주소만 바꾸면 된다 (Circle faucet에서 admin 주소로 수령 후 `devnet-addresses.json`의 mint 교체).
- SOL 확보 주의: 공용 RPC 에어드랍은 IP당 일일 한도(429)가 있다. faucet.solana.com(GitHub 인증) 수동 수령으로 해결.

## S2 — x402의 Solana devnet 지원: **확인 완료 (표준 형상 정합 + 자체 정산 검증)**

결론: 402 응답·결제 페이로드는 **x402 v2 표준 형상**(`@x402/core`의 `PaymentRequired`/
`PaymentPayload`)을 그대로 따르고, 네트워크 식별자는 `@x402/svm`의 `SOLANA_DEVNET_CAIP2`를
쓴다. 정산 검증만 facilitator 대신 자체 온체인 확인으로 한다(아래 대안 경로).
판매자는 페이로드의 `accepted`를 자신이 제시한 요구사항과 대조해 금액·수취인 바꿔치기를
차단한다(실측: `amount too low: 1 < 500000` 거부).


- `@x402/svm` npm 실존, latest **2.20.0** (Coinbase, Apache-2.0).
- 의존성: `@x402/core ~2.20.0`, `@solana-program/token`, `@solana-program/token-2022`, `@solana-program/compute-budget`. **peer dep: `@solana/kit >= 5.1.0`** — HANDOFF §6.3의 `@solana/web3.js`는 legacy, executor는 `@solana/kit`로 간다.
- 패키지 exports 실측 — devnet 지원이 명시적이고 자체 facilitator 구성 재료가 있다:
  `USDC_DEVNET_ADDRESS`, `DEVNET_RPC_URL`, `SOLANA_DEVNET_CAIP2`, `ExactSvmScheme`, `toClientSvmSigner`, `toFacilitatorSvmSigner`, `verifyPostSettlement`
- Solana devnet RPC 응답 정상: `getVersion` → solana-core 4.1.2.
- M1 진행 방식: 결제 증빙은 **자체 검증**(seller가 `getTransaction`으로 온체인 확인 — S2 대안 경로)으로 먼저 돌리고, `@x402/svm` 표준 `exact` 스킴 정합은 후속 정제로 한다.

## S3 — 온체인 위임/한도: **확인 완료 (SPL `ApproveChecked`, D2 결정)**

- admin ATA → executor를 delegate로 50 USDC-M 한도 위임 성공.
  - tx: https://explorer.solana.com/tx/4pT6Ez1QHHubVnpvK6SCtU4xkZW9rXa8gNpSQK1hWbMTZ2sVfQtd29aAE9VykkBCHhCL1vv7uZgQq8K7AhfgbA8q?cluster=devnet
  - `fetchToken` 실측: `delegate = D32wBnPc8CN6ErmMiisCHeLSdJC2vVeKMHSKw8VpqH5j`, `delegatedAmount = 50000000`
- executor가 delegate 권한으로 admin 자금 0.05 USDC-M을 seller_a로 실전송 성공.
  - tx: https://explorer.solana.com/tx/aN9E92mbSq6hcbZureg1ZCVD9LupYstD6sv4t7pBy2vfS3xyn97E2irDUJEArj5LkYh7rf1LyqVVdnAieAK34kK?cluster=devnet
- **한도 초과(60 USDC-M > 위임 잔량) 전송은 온체인 시뮬레이션에서 거부됨** — "정책 코드에 버그가 있어도 봉투 밖 자금은 못 건드린다"의 온체인 증빙. 시나리오 4-3의 근거.
- 위임 잔량 표시: `fetchToken(rpc, adminAta)`의 `delegatedAmount` 또는 Explorer 토큰 계정 화면.
