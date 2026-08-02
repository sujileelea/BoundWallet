// AP2 경량 mandate 검증 (D4). executor는 기동 후 첫 요청 시 mandate를 로드하고
// (1) 봉투 정의 해시 일치 (2) 관리자 서명 유효 (3) delegate가 자신인지 검증한다.
// 검증 결과는 영수증·/envelope-status에 노출된다.

import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { getAddressEncoder, verifySignature, type Address, type SignatureBytes } from "@solana/kit";

export interface Mandate {
  mandate_version: string;
  envelope_id: string;
  envelope_hash: string;
  ruleset_version: string;
  delegate: string;
  signed_by: string;
  signature: string;
  issued_at: string;
}

export interface MandateStatus {
  present: boolean;
  verified: boolean;
  reason: string;
  mandate: Mandate | null;
}

// scripts/create-mandate.ts의 canonicalJson과 동일 규칙 — 변경 시 양쪽 동시 수정
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`);
    return `{${entries.join(",")}}`;
  }
  return JSON.stringify(value);
}

export async function verifyMandate(
  envelopeId: string,
  envelope: Record<string, unknown>,
  executorAddress: string,
): Promise<MandateStatus> {
  const path = join(import.meta.dirname, "..", "policy", "rulesets", `${envelopeId}.mandate.json`);
  if (!existsSync(path)) {
    return { present: false, verified: false, reason: "mandate 없음 — scripts/create-mandate.ts 실행", mandate: null };
  }
  const mandate: Mandate = JSON.parse(readFileSync(path, "utf8"));

  const hash = createHash("sha256").update(canonicalJson(envelope)).digest();
  if (`sha256:${hash.toString("hex")}` !== mandate.envelope_hash) {
    return { present: true, verified: false, reason: "봉투 정의가 서명 이후 변경됨 (해시 불일치)", mandate };
  }
  if (mandate.delegate !== executorAddress) {
    return { present: true, verified: false, reason: "mandate의 delegate가 executor가 아님", mandate };
  }

  const publicKeyBytes = new Uint8Array(getAddressEncoder().encode(mandate.signed_by as Address));
  const publicKey = await crypto.subtle.importKey("raw", publicKeyBytes, "Ed25519", true, ["verify"]);
  const ok = await verifySignature(
    publicKey,
    Uint8Array.from(Buffer.from(mandate.signature, "hex")) as SignatureBytes,
    new Uint8Array(hash),
  );
  if (!ok) return { present: true, verified: false, reason: "관리자 서명 검증 실패", mandate };

  return { present: true, verified: true, reason: "관리자 서명 유효 — 봉투 정의 승인 증빙 확인", mandate };
}
