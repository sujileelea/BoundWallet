// executor 서비스 — 유일한 키 보유자. 판단·추론·판매자 선택을 하지 않는다 (HANDOFF §6.2).
//
// POST /purchase-intent (shared/purchase_intent.schema.json 형상)
//   → 정책 서비스 판정 (R4: 이 호출을 우회하는 분기는 존재하지 않는다.
//      skipPolicy·디버그 플래그 금지 — HANDOFF §5)
//   → PASS일 때만 x402 결제 → 데이터+어테스테이션 반환
//   → 전 과정 감사 로그 기록 (R5: 판정의 checked_rules 전체 포함)
//
// 실행: node executor/server.ts  (선행: policy 서비스, seller 인스턴스)

import { existsSync, readFileSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { join } from "node:path";

import { createSolanaRpc, type Address } from "@solana/kit";
import { fetchToken } from "@solana-program/token";

import { JsonlSink } from "./audit-log.ts";
import { getState, recordPayment, setSpent } from "./envelope-state.ts";
import { verifyMandate, type MandateStatus } from "./mandate.ts";
import { loadExecutorSigner } from "./wallet.ts";
import { purchaseViaX402 } from "./x402-client.ts";

// 5000은 macOS AirPlay(ControlCenter)가 점유하므로 피한다
const PORT = Number(process.env.EXECUTOR_PORT ?? 5200);
const POLICY_URL = process.env.POLICY_URL ?? "http://localhost:5100";

const sellerCatalog: Array<{
  seller_id: string;
  port: number;
  wallet: string;
  price_usdc: number;
  coverage: string[];
  role: string;
}> = JSON.parse(
  readFileSync(join(import.meta.dirname, "..", "seller", "config", "sellers.json"), "utf8"),
).sellers;
const ADDRESSES = JSON.parse(
  readFileSync(join(import.meta.dirname, "..", "scripts", "devnet-addresses.json"), "utf8"),
);
const rpc = createSolanaRpc(process.env.SOLANA_RPC_URL ?? "https://api.devnet.solana.com");
const AUDIT_PATH = join(import.meta.dirname, "logs", "audit.jsonl");

const audit = new JsonlSink(join(import.meta.dirname, "logs", "audit.jsonl"));
const now = () => new Date().toISOString();
const todayUtc = () => now().slice(0, 10);

// AP2 mandate 검증 캐시 — 봉투 정의(원본)에 대한 관리자 서명 확인 (D4)
let mandateCache: MandateStatus | null = null;
async function getMandateStatus(envelopeId: string, rawEnvelope: Record<string, unknown>) {
  if (!mandateCache) {
    const executor = await loadExecutorSigner();
    mandateCache = await verifyMandate(envelopeId, rawEnvelope, executor.address);
    console.log(`[executor] mandate: ${mandateCache.verified ? "✓" : "✗"} ${mandateCache.reason}`);
  }
  return mandateCache;
}

// 봉투 정의(policy 정본)에 런타임 상태(spent/calls — executor 정본)를 얹어 판정 입력 구성
async function buildPolicyInput(envelopeId: string) {
  const res = await fetch(`${POLICY_URL}/envelope/${envelopeId}`);
  if (!res.ok) throw new Error(`봉투 조회 실패: ${res.status}`);
  const envelope = await res.json();
  // mandate는 서명 당시의 "정의"에 대한 것 — 런타임 spent 덮어쓰기 전에 검증
  const mandate = await getMandateStatus(envelopeId, structuredClone(envelope));
  const state = getState(envelopeId, todayUtc(), Math.round(envelope.budget.spent * 1_000_000));
  envelope.budget.spent = state.spentMicro / 1_000_000;
  const context = { calls_today: state.callsToday, now: now() };
  return { envelope, context, mandate };
}

// 영수증 (shared/receipt.schema.json). BLOCK이면 payment·attestation은 null
function buildReceipt(
  intent_id: string,
  decision: { verdict: string; ruleset_version: string },
  payment: { signature: string; explorer_url: string; amount: number; asset: string } | null,
  attestation: { query_hash: string; ruleset_version: string } | null,
  envelope: { budget: { total: number; spent: number } },
  mandate: MandateStatus,
) {
  return {
    intent_id,
    policy_decision: { verdict: decision.verdict, ruleset_version: decision.ruleset_version },
    payment,
    attestation: attestation
      ? { query_hash: attestation.query_hash, ruleset_version: attestation.ruleset_version }
      : null,
    envelope_after: {
      spent: envelope.budget.spent,
      remaining: Math.round((envelope.budget.total - envelope.budget.spent) * 1_000_000) / 1_000_000,
    },
    // AP2 경량 mandate 참조(D4) — 이 지출 범위를 사람이 서명 승인했다는 증빙
    mandate: mandate.verified && mandate.mandate
      ? { envelope_hash: mandate.mandate.envelope_hash, signed_by: mandate.mandate.signed_by }
      : null,
  };
}

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function send(res: ServerResponse, status: number, body: unknown) {
  const payload = JSON.stringify(body, null, 2);
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", ...CORS });
  res.end(payload);
}

// 감사 로그를 SSE로 스트리밍 — UI(M6)의 유일한 데이터 소스.
// 접속 시 기존 이벤트 재생 후, 파일 증분을 500ms 폴링으로 밀어준다.
function streamEvents(res: ServerResponse) {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    ...CORS,
  });
  let sentLines = 0;
  const push = () => {
    if (!existsSync(AUDIT_PATH)) return;
    const lines = readFileSync(AUDIT_PATH, "utf8").split("\n").filter(Boolean);
    for (const line of lines.slice(sentLines)) res.write(`data: ${line}\n\n`);
    sentLines = lines.length;
  };
  push();
  const timer = setInterval(push, 500);
  res.on("close", () => clearInterval(timer));
}

async function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

async function handlePurchaseIntent(intent: Record<string, unknown>) {
  const intent_id = String(intent.intent_id);
  audit.append({ ts: now(), type: "intent_received", intent_id, intent });

  // ── 정책 판정 — 결제로 가는 유일한 관문 (R4) ────────────────────────────────
  const { envelope, context, mandate } = await buildPolicyInput(String(intent.envelope_id));
  const policyRes = await fetch(`${POLICY_URL}/evaluate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ intent, envelope, context }),
  });
  if (!policyRes.ok) throw new Error(`정책 서비스 오류: ${policyRes.status} ${await policyRes.text()}`);
  const decision = await policyRes.json();
  audit.append({ ts: now(), type: "policy_decision", intent_id, decision });

  if (decision.verdict !== "PASS") {
    audit.append({ ts: now(), type: "payment_blocked", intent_id, reasons: decision.reasons });
    const receipt = buildReceipt(intent_id, decision, null, null, envelope, mandate);
    audit.append({ ts: now(), type: "receipt", intent_id, receipt });
    return { decision, payment: null, data: null, attestation: null, receipt };
  }

  // ── PASS: x402 결제. 정책이 심사한 지갑·금액과 다르면 클라이언트가 중단한다 ────
  const seller = sellerCatalog.find((s) => s.seller_id === intent.seller_id);
  if (!seller) throw new Error(`카탈로그에 없는 판매자: ${intent.seller_id}`);
  try {
    const result = await purchaseViaX402(`http://localhost:${seller.port}`, String(intent.query), {
      expectedPayTo: String(intent.seller_wallet),
      maxMicroAmount: BigInt(Math.round(Number(intent.quoted_price) * 1_000_000)),
    });
    recordPayment(String(intent.envelope_id), Number(result.offer.maxAmountRequired), todayUtc());
    audit.append({
      ts: now(),
      type: "payment_executed",
      intent_id,
      signature: result.signature,
      explorer_url: result.explorer_url,
      amount_usdc: result.amount_usdc,
      pay_to: result.offer.payTo,
    });
    audit.append({ ts: now(), type: "data_received", intent_id, attestation: result.response.attestation });
    const payment = {
      signature: result.signature,
      explorer_url: result.explorer_url,
      amount: result.amount_usdc,
      asset: "USDC-M",
    };
    // 결제 반영 후 잔액으로 영수증 작성 (§7.6)
    const fresh = getState(String(intent.envelope_id), todayUtc(), 0);
    envelope.budget.spent = fresh.spentMicro / 1_000_000;
    const receipt = buildReceipt(
      intent_id,
      decision,
      payment,
      result.response.attestation as { query_hash: string; ruleset_version: string } | null,
      envelope,
      mandate,
    );
    audit.append({ ts: now(), type: "receipt", intent_id, receipt });
    return { decision, payment, data: result.response.data, attestation: result.response.attestation, receipt };
  } catch (e) {
    audit.append({ ts: now(), type: "payment_failed", intent_id, error: (e as Error).message });
    throw e;
  }
}

createServer((req, res) => {
  (async () => {
    if (req.method === "OPTIONS") {
      res.writeHead(204, CORS);
      return res.end();
    }
    if (req.method === "GET" && req.url === "/health") {
      return send(res, 200, { service: "executor", policy_url: POLICY_URL });
    }
    if (req.method === "GET" && req.url === "/events") {
      return streamEvents(res);
    }
    if (req.method === "GET" && req.url === "/catalog") {
      return send(res, 200, {
        sellers: sellerCatalog.map(({ seller_id, port, wallet, price_usdc, coverage, role }) => ({
          seller_id, port, wallet, price_usdc, coverage, role,
        })),
        attacker: ADDRESSES.attacker,
        mint: ADDRESSES.mint,
        admin_ata: ADDRESSES.admin_ata,
      });
    }
    if (req.method === "GET" && req.url?.startsWith("/envelope-status")) {
      const envelopeId = new URL(req.url, "http://localhost").searchParams.get("id") ?? "env_001";
      const { envelope, context, mandate } = await buildPolicyInput(envelopeId);
      // 온체인 위임 잔량 — "봉투 밖은 물리적으로 못 나간다"의 실시간 증빙 (M6 패널 ①)
      let delegatedRemaining: number | null = null;
      try {
        const token = await fetchToken(rpc, ADDRESSES.admin_ata as Address);
        delegatedRemaining = Number(token.data.delegatedAmount) / 1_000_000;
      } catch {
        // RPC 일시 장애 시 null — UI는 "조회 실패"로 표시
      }
      return send(res, 200, {
        envelope,
        calls_today: context.calls_today,
        remaining: Math.round((envelope.budget.total - envelope.budget.spent) * 1_000_000) / 1_000_000,
        onchain: {
          delegated_remaining: delegatedRemaining,
          delegate: envelope.onchain.delegate_address,
          explorer_url: `https://explorer.solana.com/address/${ADDRESSES.admin_ata}?cluster=devnet`,
        },
        mandate: {
          present: mandate.present,
          verified: mandate.verified,
          reason: mandate.reason,
          signed_by: mandate.mandate?.signed_by ?? null,
        },
      });
    }
    if (req.method === "POST" && req.url === "/purchase-intent") {
      const intent = await readBody(req);
      const result = await handlePurchaseIntent(intent);
      return send(res, 200, result);
    }
    // 데모 전용: 관리자 행위 시뮬레이션(시나리오 2의 잔액 조작). 판정에는 관여하지 않음
    if (req.method === "POST" && req.url === "/admin/envelope-state") {
      const body = await readBody(req);
      setSpent(String(body.envelope_id), Math.round(Number(body.spent) * 1_000_000));
      return send(res, 200, { ok: true });
    }
    return send(res, 404, { error: "not found" });
  })().catch((e) => {
    console.error("[executor] error:", e);
    if (!res.headersSent) send(res, 500, { error: (e as Error).message });
  });
}).listen(PORT, () => {
  console.log(`[executor] listening on :${PORT} — 정책 경유 없이는 서명하지 않음 (R4)`);
});
