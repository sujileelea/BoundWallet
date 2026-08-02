// AP2 경량 mandate 생성 (docs/decisions.md D4, shared/mandate.schema.json).
//
// 관리자(봉투 소유자) 키가 봉투 정의의 canonical JSON sha256에 ed25519 서명한다.
// "사람이 이 지출 범위를 승인했다"의 암호학적 증빙 — executor가 기동 시 검증하고
// 모든 영수증에 참조를 첨부한다.
//
// 선행: policy 서비스 기동(봉투 정의의 canonical 소스), scripts/keys/admin 키페어.
// 실행: node scripts/create-mandate.ts [envelope_id=env_001]

import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

import { signBytes } from "@solana/kit";

import { loadOrCreateKeypair } from "./solana-helpers.ts";

const POLICY_URL = process.env.POLICY_URL ?? "http://localhost:5100";
const ROOT = join(import.meta.dirname, "..");
const envelopeId = process.argv[2] ?? "env_001";

// 키 정렬 canonical JSON — 서명 검증측(executor)과 반드시 동일 규칙
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`);
    return `{${entries.join(",")}}`;
  }
  return JSON.stringify(value);
}

const res = await fetch(`${POLICY_URL}/envelope/${envelopeId}`);
if (!res.ok) throw new Error(`봉투 조회 실패(${res.status}) — policy 서비스가 떠 있어야 합니다`);
const envelope = await res.json();

const hashBytes = createHash("sha256").update(canonicalJson(envelope)).digest();
const admin = await loadOrCreateKeypair(join(ROOT, "scripts", "keys", "admin-keypair.json"));
const signature = await signBytes(admin.keyPair.privateKey, new Uint8Array(hashBytes));

const mandate = {
  mandate_version: "ap2-lite-v1",
  envelope_id: envelopeId,
  envelope_hash: `sha256:${hashBytes.toString("hex")}`,
  ruleset_version: envelope.ruleset_version,
  delegate: envelope.onchain.delegate_address,
  signed_by: admin.address,
  signature: Buffer.from(signature).toString("hex"),
  issued_at: new Date().toISOString(),
};

const outPath = join(ROOT, "policy", "rulesets", `${envelopeId}.mandate.json`);
writeFileSync(outPath, JSON.stringify(mandate, null, 2) + "\n");
console.log(`mandate 생성: ${outPath}`);
console.log(`  envelope_hash: ${mandate.envelope_hash}`);
console.log(`  signed_by(admin): ${mandate.signed_by}`);
