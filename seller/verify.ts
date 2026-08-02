// 결제 증빙 검증.
//
// onchain 모드(기본): 증빙의 트랜잭션 서명을 devnet에서 조회해
//   (1) 성공한 tx인지 (2) transferChecked인지 (3) 민트 일치 (4) 수취가 내 ATA인지
//   (5) 금액 충족 (6) 재사용(replay) 아닌지 를 직접 검증한다.
//   스파이크 S2의 "자체 facilitator" 대안 경로 — @x402/svm 표준 스킴 정합은 후속.
// dev 모드(SELLER_VERIFY_MODE=dev): 오프라인 개발용. 구조·금액·수취인만 검사.

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { createSolanaRpc, signature as asSignature, type Address } from "@solana/kit";
import { TOKEN_PROGRAM_ADDRESS, findAssociatedTokenPda } from "@solana-program/token";

export interface VerifyResult {
  ok: boolean;
  reason: string;
}

export interface Expected {
  microAmount: string; // USDC 6 decimals 문자열, 402 응답의 maxAmountRequired와 동일
  payTo: string;
}

const MODE = process.env.SELLER_VERIFY_MODE ?? "onchain";
const RPC_URL = process.env.SOLANA_RPC_URL ?? "https://api.devnet.solana.com";

const ADDRESSES = JSON.parse(
  readFileSync(join(import.meta.dirname, "..", "scripts", "devnet-addresses.json"), "utf8"),
);
const rpc = createSolanaRpc(RPC_URL);

// replay 가드 — 데모 수명 동안 서명 재사용 차단 (프로덕션이라면 영속 저장소 필요)
const usedSignatures = new Set<string>();

function decodeProof(header: string): Record<string, string> | null {
  try {
    return JSON.parse(Buffer.from(header, "base64").toString("utf8"));
  } catch {
    return null;
  }
}

export async function verifyPayment(paymentHeader: string, expected: Expected): Promise<VerifyResult> {
  const proof = decodeProof(paymentHeader);
  if (!proof) return { ok: false, reason: "malformed X-PAYMENT header" };

  if (MODE === "dev") {
    if (proof.scheme !== "dev-proof") return { ok: false, reason: `unsupported scheme: ${proof.scheme}` };
    if (proof.amount !== expected.microAmount) {
      return { ok: false, reason: `amount mismatch: got ${proof.amount}, expected ${expected.microAmount}` };
    }
    if (proof.payTo !== expected.payTo) return { ok: false, reason: `payTo mismatch: got ${proof.payTo}` };
    return { ok: true, reason: "dev-proof accepted (NOT an on-chain verification)" };
  }

  // ── onchain 모드 ──────────────────────────────────────────────────────────
  if (proof.scheme !== "onchain-tx") return { ok: false, reason: `unsupported scheme: ${proof.scheme}` };
  if (!proof.signature) return { ok: false, reason: "missing signature" };
  if (usedSignatures.has(proof.signature)) {
    return { ok: false, reason: "replay rejected: signature already used" };
  }

  const tx = await rpc
    .getTransaction(asSignature(proof.signature), {
      encoding: "jsonParsed",
      maxSupportedTransactionVersion: 0,
      commitment: "confirmed",
    })
    .send();
  if (!tx) return { ok: false, reason: "transaction not found on devnet" };
  if (tx.meta?.err) return { ok: false, reason: `transaction failed on-chain: ${JSON.stringify(tx.meta.err)}` };

  const [myAta] = await findAssociatedTokenPda({
    mint: ADDRESSES.mint as Address,
    owner: expected.payTo as Address,
    tokenProgram: TOKEN_PROGRAM_ADDRESS,
  });

  const instructions = (tx.transaction.message as { instructions: unknown[] }).instructions as Array<{
    program?: string;
    parsed?: { type?: string; info?: { mint?: string; destination?: string; tokenAmount?: { amount?: string } } };
  }>;
  const match = instructions.find(
    (ix) =>
      ix.program === "spl-token" &&
      ix.parsed?.type === "transferChecked" &&
      ix.parsed.info?.mint === ADDRESSES.mint &&
      ix.parsed.info?.destination === myAta &&
      BigInt(ix.parsed.info?.tokenAmount?.amount ?? "0") >= BigInt(expected.microAmount),
  );
  if (!match) {
    return { ok: false, reason: "no matching transferChecked (mint/destination/amount) in transaction" };
  }

  usedSignatures.add(proof.signature);
  return { ok: true, reason: `on-chain verified: ${proof.signature.slice(0, 12)}…` };
}
