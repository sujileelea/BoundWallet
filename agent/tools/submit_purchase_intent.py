"""툴 3/3: submit_purchase_intent (HANDOFF §5 R2).

에이전트가 할 수 있는 '최대치'. 결제가 아니라 '이걸 사고 싶다'는 의도를
executor에 제출할 뿐이다. 서명·송금 능력은 이 프로세스에 존재하지 않는다(R1).
executor가 정책 판정을 거쳐 통과할 때만 결제하며, 그 판정 결과를 그대로 돌려준다.
"""

import os
import time

import requests

EXECUTOR_URL = os.environ.get("EXECUTOR_URL", "http://localhost:5200")

_counter = 0


def submit_purchase_intent(
    envelope_id: str,
    seller_id: str,
    seller_wallet: str,
    quoted_price: float,
    scope: str,
    query: str,
    agent_rationale: str,
    quotes_considered: list[dict],
) -> dict:
    """구매 의도를 executor에 제출한다. 결제 명령이 아니다.

    Args:
        envelope_id: 사용할 봉투 ID (예: "env_001").
        seller_id: 선택한 판매자 ID.
        seller_wallet: 대금을 받을 지갑 주소 (견적에서 얻은 값).
        quoted_price: 견적 단가(USDC).
        scope: 구매 범위 (예: "clinical_evidence").
        query: 실제 질의문.
        agent_rationale: 이 판매자를 고른 이유 (UI에 그대로 노출됨).
        quotes_considered: 비교한 견적들 [{"seller_id","price"}].

    Returns:
        executor 응답: {"decision", "payment", "data", "attestation", "receipt"}.
        decision.verdict가 BLOCK이면 payment는 null이다.
    """
    global _counter
    _counter += 1
    intent = {
        "intent_id": f"int_agent_{int(time.time())}_{_counter}",
        "envelope_id": envelope_id,
        "seller_id": seller_id,
        "seller_wallet": seller_wallet,
        "quoted_price": quoted_price,
        "scope": scope,
        "query": query,
        "agent_rationale": agent_rationale,
        "quotes_considered": quotes_considered,
    }
    resp = requests.post(f"{EXECUTOR_URL}/purchase-intent", json=intent, timeout=60)
    resp.raise_for_status()
    return resp.json()
