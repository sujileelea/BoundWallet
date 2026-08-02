// 결제 증빙 검증.
//
// dev 모드(기본): base64(JSON dev-proof)의 구조·금액·수취인만 검사한다.
//   M1 하드코딩 루프용 — 온체인 검증이 아니다.
// real 모드: 스파이크 S2 결과에 따라 @x402/svm facilitator verify/settle 또는
//   자체 트랜잭션 서명 검증으로 교체한다. M1 완료 조건(Explorer에서 트랜잭션
//   조회)은 real 모드에서만 성립한다.

export interface VerifyResult {
  ok: boolean;
  reason: string;
}

export interface Expected {
  microAmount: string; // USDC 6 decimals 문자열, 402 응답의 maxAmountRequired와 동일
  payTo: string;
}

const MODE = process.env.SELLER_VERIFY_MODE ?? "dev";

export function verifyPayment(paymentHeader: string, expected: Expected): VerifyResult {
  if (MODE !== "dev") {
    return { ok: false, reason: "real verification not implemented yet (spike S2 → M1)" };
  }

  let proof: { scheme?: string; amount?: string; payTo?: string };
  try {
    proof = JSON.parse(Buffer.from(paymentHeader, "base64").toString("utf8"));
  } catch {
    return { ok: false, reason: "malformed X-PAYMENT header" };
  }

  if (proof.scheme !== "dev-proof") return { ok: false, reason: `unsupported scheme: ${proof.scheme}` };
  if (proof.amount !== expected.microAmount) {
    return { ok: false, reason: `amount mismatch: got ${proof.amount}, expected ${expected.microAmount}` };
  }
  if (proof.payTo !== expected.payTo) {
    return { ok: false, reason: `payTo mismatch: got ${proof.payTo}` };
  }
  return { ok: true, reason: "dev-proof accepted (NOT an on-chain verification)" };
}
