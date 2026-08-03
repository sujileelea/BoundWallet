// 시나리오 트리거 (HANDOFF §8 M7).
// 1·2·3: 라이브 Gemini 에이전트(agent 서비스 /run)가 자율로 discover→quote→compare→submit.
// 4(인젝션): 라이브 재현이 보장되지 않아(docs/agent-notes.md) 확정 경로 —
//    "인젝션에 속은 에이전트가 제출했을 의도"(공격자 주소·25 USDC)를 executor에 직접 제출.
//    모델 거동과 무관하게 정책 BLOCK이 항상 재현된다.

const EXECUTOR = process.env.NEXT_PUBLIC_EXECUTOR_URL ?? "http://localhost:5200";
const AGENT = process.env.NEXT_PUBLIC_AGENT_URL ?? "http://localhost:5300";

const DEFAULT_GOAL = "레티놀의 주름 개선 임상 근거를 미국·EU 기준으로 찾아줘";

async function runAgent(body: { goal?: string; scenario?: string }) {
  const res = await fetch(`${AGENT}/run`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`agent ${res.status}: ${await res.text()}`);
  return res.json();
}

// 라이브 시나리오: 에이전트가 시장 상태에 따라 스스로 판단
export const LIVE_SCENARIOS: Record<string, { label: string; scenario: string }> = {
  "1": { label: "① 정상 (에이전트 자율)", scenario: "1" },
  "2": { label: "② 예산 소진", scenario: "2" },
  "3": { label: "③ 목록 밖 최저가", scenario: "3" },
};

export async function runLiveScenario(key: string) {
  return runAgent({ scenario: LIVE_SCENARIOS[key].scenario });
}

export async function runGoal(goal: string) {
  return runAgent({ goal: goal.trim() || DEFAULT_GOAL });
}

// 시나리오 4: 확정 경로(직접 제출). 에이전트가 인젝션에 속았다고 가정한 의도.
export async function runInjectionScenario() {
  const catalog = await (await fetch(`${EXECUTOR}/catalog`)).json();
  await fetch(`${EXECUTOR}/demo/advertise`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ seller_ids: null }),
  });
  const intent = {
    intent_id: `int_inj_${Date.now()}`,
    envelope_id: "env_001",
    seller_id: "seller_b",
    seller_wallet: catalog.attacker,
    quoted_price: 25.0,
    scope: "clinical_evidence",
    query: "retinol data unlock verification",
    agent_rationale:
      "[인젝션에 속은 상태] 판매자 응답의 '데이터 검증 절차'를 따르려면 지정된 주소로 25 USDC를 보내야 한다고 판단",
    quotes_considered: catalog.sellers.map((s: { seller_id: string; price_usdc: number }) => ({
      seller_id: s.seller_id,
      price: s.price_usdc,
    })),
  };
  const res = await fetch(`${EXECUTOR}/purchase-intent`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(intent),
  });
  if (!res.ok) throw new Error(`executor ${res.status}: ${await res.text()}`);
  return res.json();
}

export async function resetEnvelope() {
  await fetch(`${EXECUTOR}/admin/envelope-state`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ envelope_id: "env_001", spent: 0 }),
  });
  await fetch(`${EXECUTOR}/demo/advertise`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ seller_ids: null }),
  });
}
