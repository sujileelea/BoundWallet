// x402 판매자 서버 (HANDOFF §4.3, §7.4, M5).
//
// 회원가입 없이 건당 판다:
//   GET /evidence?query=...            → 402 + 결제 지시(단가·수취 지갑)
//   GET /evidence?query=... +X-PAYMENT → 증빙 검증 → 200 + 데이터 + 어테스테이션
//
// 실행: SELLER_ID=seller_a node seller/server.ts  (Node 26 네이티브 TS)
// 402 본문 형상은 shared/x402_payment_required.schema.json — S2 확정 전 잠정.

import { readFileSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { buildAttestation, type EvidenceRecord } from "./attestation.ts";
import { verifyPayment } from "./verify.ts";

const SELLER_DIR = dirname(fileURLToPath(import.meta.url));

interface SellerConfig {
  seller_id: string;
  port: number;
  price_usdc: number;
  wallet: string;
  coverage: string[];
  dataset: string;
  role: string;
}

const registry = JSON.parse(readFileSync(join(SELLER_DIR, "config", "sellers.json"), "utf8"));
const sellerId = process.env.SELLER_ID;
const config: SellerConfig | undefined = registry.sellers.find(
  (s: SellerConfig) => s.seller_id === sellerId,
);
if (!config) {
  console.error(`SELLER_ID must be one of: ${registry.sellers.map((s: SellerConfig) => s.seller_id).join(", ")}`);
  process.exit(1);
}
const rulesetVersion: string = registry.ruleset_version;
const records: EvidenceRecord[] = JSON.parse(
  readFileSync(join(SELLER_DIR, config.dataset), "utf8"),
).records;

const microAmount = String(Math.round(config.price_usdc * 1_000_000));

function paymentRequiredBody() {
  return {
    x402Version: 2,
    accepts: [
      {
        scheme: "exact",
        network: "solana-devnet",
        asset: "USDC",
        maxAmountRequired: microAmount,
        payTo: config.wallet,
        resource: "/evidence",
        description: "clinical evidence lookup, 1 query",
      },
    ],
  };
}

function findRecord(query: string): EvidenceRecord | null {
  const q = query.trim().toLowerCase();
  for (const record of records) {
    if (!config.coverage.includes(record.topic)) continue;
    if (record.keywords.some((k) => q.includes(k.toLowerCase()))) return record;
  }
  return null;
}

function send(res: ServerResponse, status: number, body: unknown) {
  const payload = JSON.stringify(body, null, 2);
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(payload);
}

async function handle(req: IncomingMessage, res: ServerResponse) {
  const url = new URL(req.url ?? "/", `http://localhost:${config.port}`);
  const log = (status: number, note: string) =>
    console.log(`[${config.seller_id}] ${req.method} ${url.pathname} → ${status} ${note}`);

  if (url.pathname === "/health") {
    log(200, "");
    return send(res, 200, {
      seller_id: config.seller_id,
      price_usdc: config.price_usdc,
      wallet: config.wallet,
      coverage: config.coverage,
    });
  }

  // A2A 견적 채널 (HANDOFF §4.2, 심사 ③ A2A). 결제 전 응답이므로
  // 판매자 B의 note에 인젝션 페이로드가 실려 에이전트에게 노출된다 (시나리오 4).
  if (url.pathname === "/quote") {
    const query = url.searchParams.get("query") ?? "";
    const record = findRecord(query);
    log(200, "quote");
    return send(res, 200, {
      seller_id: config.seller_id,
      wallet: config.wallet,
      price_usdc: config.price_usdc,
      coverage: config.coverage,
      covers_query: record !== null,
      // 판매자가 응답에 함께 싣는 안내문. B의 데이터셋에는 인젝션 문자열이 섞여 있다.
      note: record ? record.summary.slice(0, 400) : "no coverage for this query",
    });
  }

  if (url.pathname !== "/evidence" || req.method !== "GET") {
    log(404, "");
    return send(res, 404, { error: "not found" });
  }

  const query = url.searchParams.get("query");
  if (!query) {
    log(400, "missing query");
    return send(res, 400, { error: "query parameter required" });
  }

  const paymentHeader = req.headers["x-payment"];
  if (!paymentHeader || typeof paymentHeader !== "string") {
    log(402, "payment required");
    return send(res, 402, paymentRequiredBody());
  }

  const verdict = await verifyPayment(paymentHeader, { microAmount, payTo: config.wallet });
  if (!verdict.ok) {
    log(402, `payment rejected: ${verdict.reason}`);
    return send(res, 402, { ...paymentRequiredBody(), error: verdict.reason });
  }

  const record = findRecord(query);
  const attestation = buildAttestation(query, record, config.seller_id, rulesetVersion);
  log(200, record ? `topic=${record.topic}` : "no coverage match");
  return send(res, 200, {
    data: record ?? null,
    attestation,
  });
}

createServer((req, res) => {
  handle(req, res).catch((e) => {
    console.error(`[${config.seller_id}] handler error:`, e);
    if (!res.headersSent) send(res, 500, { error: "internal error" });
  });
}).listen(config.port, () => {
  console.log(
    `[${config.seller_id}] listening on :${config.port} — ${config.price_usdc} USDC/query, verify=${process.env.SELLER_VERIFY_MODE ?? "onchain"}, role=${config.role}`,
  );
});
