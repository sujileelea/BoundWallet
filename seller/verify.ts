// 결제 증빙 검증 — x402 v2 PaymentPayload 형상.
//
// X-PAYMENT 헤더 = base64(JSON):
//   { x402Version, accepted: PaymentRequirements, payload: { scheme, network, signature } }
//
// onchain 모드(기본): `accepted`가 우리가 제시한 요구사항과 일치하는지 확인한 뒤,
//   payload.signature를 devnet에서 조회해 (1) 성공한 tx (2) transferChecked
//   (3) 민트 일치 (4) 수취가 내 ATA (5) 금액 충족 (6) 재사용 아님 을 직접 검증한다.
//   @x402/svm facilitator 대신 자체 검증 — 스파이크 S2의 대안 경로.
// dev 모드(SELLER_VERIFY_MODE=dev): 오프라인 개발용. 온체인 조회 없이 형상만 확인.

import { createSolanaRpc, signature as asSignature, type Address } from "@solana/kit";
import { TOKEN_PROGRAM_ADDRESS, findAssociatedTokenPda } from "@solana-program/token";

export interface VerifyResult {
  ok: boolean;
  reason: string;
}

// x402 v2 PaymentRequirements (@x402/core types)
export interface PaymentRequirements {
  scheme: string;
  network: string;
  asset: string;
  amount: string;
  payTo: string;
  maxTimeoutSeconds: number;
  extra?: Record<string, unknown>;
}

const MODE = process.env.SELLER_VERIFY_MODE ?? "onchain";
const RPC_URL = process.env.SOLANA_RPC_URL ?? "https://api.devnet.solana.com";
const rpc = createSolanaRpc(RPC_URL);

// replay 가드 — 데모 수명 동안 서명 재사용 차단 (프로덕션이라면 영속 저장소 필요)
const usedSignatures = new Set<string>();

interface PaymentPayload {
  x402Version?: number;
  accepted?: PaymentRequirements;
  payload?: { scheme?: string; network?: string; signature?: string };
}

function decodePayload(header: string): PaymentPayload | null {
  try {
    return JSON.parse(Buffer.from(header, "base64").toString("utf8"));
  } catch {
    return null;
  }
}

// 클라이언트가 동의한 조건이 우리가 제시한 것과 같은지 — 금액·수취인 바꿔치기 차단
function matchesRequirements(
  accepted: PaymentRequirements | undefined,
  want: PaymentRequirements,
): string | null {
  if (!accepted) return "missing `accepted` in payment payload";
  if (accepted.scheme !== want.scheme) return `scheme mismatch: ${accepted.scheme}`;
  if (accepted.network !== want.network) return `network mismatch: ${accepted.network}`;
  if (accepted.asset !== want.asset) return `asset mismatch: ${accepted.asset}`;
  if (accepted.payTo !== want.payTo) return `payTo mismatch: ${accepted.payTo}`;
  if (BigInt(accepted.amount ?? "0") < BigInt(want.amount)) {
    return `amount too low: ${accepted.amount} < ${want.amount}`;
  }
  return null;
}

export async function verifyPayment(
  paymentHeader: string,
  want: PaymentRequirements,
): Promise<VerifyResult> {
  const body = decodePayload(paymentHeader);
  if (!body) return { ok: false, reason: "malformed X-PAYMENT header" };

  const mismatch = matchesRequirements(body.accepted, want);
  if (mismatch) return { ok: false, reason: mismatch };

  const payload = body.payload ?? {};
  if (!payload.signature) return { ok: false, reason: "missing payload.signature" };

  if (MODE === "dev") {
    return { ok: true, reason: "dev mode accepted (NOT an on-chain verification)" };
  }

  // ── onchain 모드 ──────────────────────────────────────────────────────────
  if (usedSignatures.has(payload.signature)) {
    return { ok: false, reason: "replay rejected: signature already used" };
  }

  const tx = await rpc
    .getTransaction(asSignature(payload.signature), {
      encoding: "jsonParsed",
      maxSupportedTransactionVersion: 0,
      commitment: "confirmed",
    })
    .send();
  if (!tx) return { ok: false, reason: "transaction not found on devnet" };
  if (tx.meta?.err) {
    return { ok: false, reason: `transaction failed on-chain: ${JSON.stringify(tx.meta.err)}` };
  }

  const [myAta] = await findAssociatedTokenPda({
    mint: want.asset as Address,
    owner: want.payTo as Address,
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
      ix.parsed.info?.mint === want.asset &&
      ix.parsed.info?.destination === myAta &&
      BigInt(ix.parsed.info?.tokenAmount?.amount ?? "0") >= BigInt(want.amount),
  );
  if (!match) {
    return { ok: false, reason: "no matching transferChecked (mint/destination/amount) in transaction" };
  }

  usedSignatures.add(payload.signature);
  return { ok: true, reason: `on-chain verified: ${payload.signature.slice(0, 12)}…` };
}
