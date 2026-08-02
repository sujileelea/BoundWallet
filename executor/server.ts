// executor 서비스 — 유일한 키 보유자. 판단·추론·판매자 선택을 하지 않는다 (HANDOFF §6.2).
//
// POST /purchase-intent (shared/purchase_intent.schema.json 형상)
//   → 정책 서비스 판정 (R4: 이 호출을 우회하는 분기는 존재하지 않는다.
//      skipPolicy·디버그 플래그 금지 — HANDOFF §5)
//   → PASS일 때만 x402 결제 → 데이터+어테스테이션 반환
//   → 전 과정 감사 로그 기록 (R5: 판정의 checked_rules 전체 포함)
//
// 실행: node executor/server.ts  (선행: policy 서비스, seller 인스턴스)

import { readFileSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { join } from "node:path";

import { JsonlSink } from "./audit-log.ts";
import { purchaseViaX402 } from "./x402-client.ts";

// 5000은 macOS AirPlay(ControlCenter)가 점유하므로 피한다
const PORT = Number(process.env.EXECUTOR_PORT ?? 5200);
const POLICY_URL = process.env.POLICY_URL ?? "http://localhost:5100";

const sellerCatalog: Array<{ seller_id: string; port: number; wallet: string }> = JSON.parse(
  readFileSync(join(import.meta.dirname, "..", "seller", "config", "sellers.json"), "utf8"),
).sellers;

const audit = new JsonlSink(join(import.meta.dirname, "logs", "audit.jsonl"));
const now = () => new Date().toISOString();

// 커밋8에서 영속 상태(spent/calls_today 갱신)로 교체 예정 — 지금은 판정 입력만 구성
async function buildPolicyInput(intent: Record<string, unknown>) {
  const res = await fetch(`${POLICY_URL}/envelope/${intent.envelope_id}`);
  if (!res.ok) throw new Error(`봉투 조회 실패: ${res.status}`);
  const envelope = await res.json();
  const context = { calls_today: 0, now: now() };
  return { envelope, context };
}

function send(res: ServerResponse, status: number, body: unknown) {
  const payload = JSON.stringify(body, null, 2);
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(payload);
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
  const { envelope, context } = await buildPolicyInput(intent);
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
    return { decision, payment: null, data: null, attestation: null };
  }

  // ── PASS: x402 결제. 정책이 심사한 지갑·금액과 다르면 클라이언트가 중단한다 ────
  const seller = sellerCatalog.find((s) => s.seller_id === intent.seller_id);
  if (!seller) throw new Error(`카탈로그에 없는 판매자: ${intent.seller_id}`);
  try {
    const result = await purchaseViaX402(`http://localhost:${seller.port}`, String(intent.query), {
      expectedPayTo: String(intent.seller_wallet),
      maxMicroAmount: BigInt(Math.round(Number(intent.quoted_price) * 1_000_000)),
    });
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
    return {
      decision,
      payment: {
        signature: result.signature,
        explorer_url: result.explorer_url,
        amount: result.amount_usdc,
        asset: "USDC-M",
      },
      data: result.response.data,
      attestation: result.response.attestation,
    };
  } catch (e) {
    audit.append({ ts: now(), type: "payment_failed", intent_id, error: (e as Error).message });
    throw e;
  }
}

createServer((req, res) => {
  (async () => {
    if (req.method === "GET" && req.url === "/health") {
      return send(res, 200, { service: "executor", policy_url: POLICY_URL });
    }
    if (req.method === "POST" && req.url === "/purchase-intent") {
      const intent = await readBody(req);
      const result = await handlePurchaseIntent(intent);
      return send(res, 200, result);
    }
    return send(res, 404, { error: "not found" });
  })().catch((e) => {
    console.error("[executor] error:", e);
    if (!res.headersSent) send(res, 500, { error: (e as Error).message });
  });
}).listen(PORT, () => {
  console.log(`[executor] listening on :${PORT} — 정책 경유 없이는 서명하지 않음 (R4)`);
});
