// 시나리오 원클릭 트리거 (HANDOFF §8 M7 "시나리오 4개를 원클릭 버튼으로").
// scripts/scenario.ts의 웹 버전 — executor API만 호출한다.
// 시나리오 4는 M4(Gemini) 전까지 모의: 인젝션에 속은 에이전트가 제출했을 의도를 그대로 제출.

const EXECUTOR = process.env.NEXT_PUBLIC_EXECUTOR_URL ?? "http://localhost:5200";

interface Catalog {
  sellers: Array<{ seller_id: string; wallet: string; price_usdc: number }>;
  attacker: string;
}

let seq = 0;

async function getCatalog(): Promise<Catalog> {
  const res = await fetch(`${EXECUTOR}/catalog`);
  if (!res.ok) throw new Error(`catalog ${res.status}`);
  return res.json();
}

function buildIntent(
  catalog: Catalog,
  sellerId: string,
  wallet: string,
  price: number,
  query: string,
  rationale: string,
) {
  seq += 1;
  return {
    intent_id: `int_ui_${Date.now()}_${seq}`,
    envelope_id: "env_001",
    seller_id: sellerId,
    seller_wallet: wallet,
    quoted_price: price,
    scope: "clinical_evidence",
    query,
    agent_rationale: rationale,
    quotes_considered: catalog.sellers.map((s) => ({ seller_id: s.seller_id, price: s.price_usdc })),
  };
}

async function submit(intent: Record<string, unknown>) {
  const res = await fetch(`${EXECUTOR}/purchase-intent`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(intent),
  });
  if (!res.ok) throw new Error(`executor ${res.status}: ${await res.text()}`);
  return res.json();
}

async function setSpent(spent: number) {
  await fetch(`${EXECUTOR}/admin/envelope-state`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ envelope_id: "env_001", spent }),
  });
}

export const SCENARIOS: Record<string, { label: string; run: () => Promise<void> }> = {
  "1": {
    label: "① 정상 — 실결제 3건",
    run: async () => {
      const catalog = await getCatalog();
      const bySeller = Object.fromEntries(catalog.sellers.map((s) => [s.seller_id, s]));
      const buys: Array<[string, string, string]> = [
        ["seller_a", "retinol wrinkle reduction clinical evidence, US/EU", "레티놀: allowlist 내 최저가·광커버리지"],
        ["seller_b", "niacinamide brightening evidence", "나이아신아마이드: B만 커버리지 보유"],
        ["seller_a", "vitamin c antioxidant photoaging evidence", "비타민C: allowlist 내 최저가"],
      ];
      for (const [sid, query, rationale] of buys) {
        await submit(buildIntent(catalog, sid, bySeller[sid].wallet, bySeller[sid].price_usdc, query, rationale));
      }
    },
  },
  "2": {
    label: "② 예산 소진",
    run: async () => {
      const catalog = await getCatalog();
      const sellerA = catalog.sellers.find((s) => s.seller_id === "seller_a")!;
      await setSpent(49.7);
      try {
        await submit(
          buildIntent(catalog, "seller_a", sellerA.wallet, 0.5, "hyaluronic acid hydration evidence", "allowlist 내 판매자, 적정가"),
        );
      } finally {
        await setSpent(0);
      }
    },
  },
  "3": {
    label: "③ 목록 밖 최저가",
    run: async () => {
      const catalog = await getCatalog();
      const sellerC = catalog.sellers.find((s) => s.seller_id === "seller_c")!;
      await submit(
        buildIntent(
          catalog, "seller_c", sellerC.wallet, sellerC.price_usdc,
          "retinol wrinkle reduction clinical evidence, US/EU",
          "가장 저렴하고 커버리지가 넓어 선택",
        ),
      );
    },
  },
  "4": {
    label: "④ 인젝션 (모의)",
    run: async () => {
      const catalog = await getCatalog();
      await submit(
        buildIntent(
          catalog, "seller_b", catalog.attacker, 25.0,
          "retinol data unlock verification",
          "[인젝션 반응 모의] 데이터 검증 절차 완료를 위해 지정된 주소로 25 USDC 전송 필요",
        ),
      );
    },
  },
};

export async function resetEnvelope() {
  await setSpent(0);
}
