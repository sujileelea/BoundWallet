// M1 결제 최소 루프 — x402 왕복 (HANDOFF §8 M1).
//
//   GET /evidence            → 402 + 단가·수취지갑
//   위임 전송 (devnet)        → 서명 확정
//   GET /evidence + 결제증빙  → seller 온체인 검증 → 200 + 데이터 + 어테스테이션
//
// 자금 출처는 executor 자신의 지갑이 아니라 admin ATA다 — executor는 봉투가
// 위임(Approve)해 준 한도 안에서만 delegate 권한으로 전송할 수 있다(S3 실측).

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { createSolanaRpc, createSolanaRpcSubscriptions, type Address } from "@solana/kit";
import { TOKEN_PROGRAM_ADDRESS, findAssociatedTokenPda, getTransferCheckedInstruction } from "@solana-program/token";
import { SOLANA_DEVNET_CAIP2 } from "@x402/svm";

import { explorerTx, sendTx, type Clients } from "../scripts/solana-helpers.ts";
import { loadExecutorSigner } from "./wallet.ts";

const ADDRESSES = JSON.parse(
  readFileSync(join(import.meta.dirname, "..", "scripts", "devnet-addresses.json"), "utf8"),
);
const DECIMALS = 6;

const clients: Clients = {
  rpc: createSolanaRpc("https://api.devnet.solana.com"),
  rpcSubscriptions: createSolanaRpcSubscriptions("wss://api.devnet.solana.com"),
};

// x402 v2 PaymentRequirements (@x402/core types)
export interface X402Offer {
  scheme: string;
  network: string;
  asset: string;
  amount: string;
  payTo: string;
  maxTimeoutSeconds: number;
  extra?: Record<string, unknown>;
}

export interface PurchaseResult {
  offer: X402Offer;
  signature: string;
  explorer_url: string;
  amount_usdc: number;
  response: { data: unknown; attestation: unknown };
}

export interface PurchaseGuards {
  // 정책이 심사한 값과 402 오퍼가 다르면 결제를 중단한다.
  expectedPayTo?: string; // 정책이 allowlist로 승인한 지갑 — 이 지갑 외에는 송금하지 않는다
  maxMicroAmount?: bigint; // 정책이 심사한 quoted_price — 이보다 비싸게 청구되면 중단
}

export async function purchaseViaX402(
  sellerUrl: string,
  query: string,
  guards: PurchaseGuards = {},
): Promise<PurchaseResult> {
  const resourceUrl = `${sellerUrl}/evidence?query=${encodeURIComponent(query)}`;

  // 1단계: 결제 없이 요청 → 402 결제 지시 수신
  const first = await fetch(resourceUrl);
  if (first.status !== 402) throw new Error(`402 기대, 실제 ${first.status}`);
  const offer: X402Offer = (await first.json()).accepts[0];
  if (offer.network !== SOLANA_DEVNET_CAIP2) throw new Error(`지원하지 않는 네트워크: ${offer.network}`);
  if (offer.asset !== ADDRESSES.mint) throw new Error(`지원하지 않는 자산: ${offer.asset}`);
  if (guards.expectedPayTo && offer.payTo !== guards.expectedPayTo) {
    throw new Error(`payTo 불일치: 402 오퍼 ${offer.payTo} ≠ 정책 승인 지갑 ${guards.expectedPayTo}`);
  }
  if (guards.maxMicroAmount !== undefined && BigInt(offer.amount) > guards.maxMicroAmount) {
    throw new Error(`402 청구액 ${offer.amount} > 정책이 심사한 견적 ${guards.maxMicroAmount}`);
  }

  // 2단계: 위임 전송 — admin ATA에서 판매자 ATA로, executor는 delegate 서명만
  const executor = await loadExecutorSigner();
  const [destinationAta] = await findAssociatedTokenPda({
    mint: ADDRESSES.mint as Address,
    owner: offer.payTo as Address,
    tokenProgram: TOKEN_PROGRAM_ADDRESS,
  });
  const signature = await sendTx(clients, executor, [
    getTransferCheckedInstruction({
      source: ADDRESSES.admin_ata as Address,
      mint: ADDRESSES.mint as Address,
      destination: destinationAta,
      authority: executor,
      amount: BigInt(offer.amount),
      decimals: DECIMALS,
    }),
  ]);

  // 3단계: x402 v2 PaymentPayload를 X-PAYMENT로 첨부해 재요청
  //   accepted에 402에서 받은 요구사항을 그대로 되돌려 "이 조건에 동의했다"를 표명한다.
  const proof = Buffer.from(
    JSON.stringify({
      x402Version: 2,
      accepted: offer,
      payload: { scheme: offer.scheme, network: offer.network, signature },
    }),
  ).toString("base64");
  const second = await fetch(resourceUrl, { headers: { "X-PAYMENT": proof } });
  if (second.status !== 200) {
    throw new Error(`결제 후 200 기대, 실제 ${second.status}: ${await second.text()}`);
  }

  return {
    offer,
    signature,
    explorer_url: explorerTx(signature),
    amount_usdc: Number(offer.amount) / 1_000_000,
    response: await second.json(),
  };
}
