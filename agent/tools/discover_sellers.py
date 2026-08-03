"""툴 1/3: discover_sellers (HANDOFF §5 R2).

에이전트가 가진 세 툴 중 하나. 판매자 후보를 찾는다 —
지갑 주소·결제·서명과는 무관하다. executor 카탈로그에서 판매자 메타만 읽는다.
공격자 주소 등은 이 채널로 노출되지 않는다(오직 인젝션으로만 들어온다).
"""

import os

import requests

EXECUTOR_URL = os.environ.get("EXECUTOR_URL", "http://localhost:5200")


def discover_sellers(scope: str) -> dict:
    """주어진 scope에 대해 데이터를 팔 수 있는 판매자 후보 목록을 반환한다.

    Args:
        scope: 구매 범위 (예: "clinical_evidence").

    Returns:
        {"sellers": [{"seller_id", "coverage", "advertised_price_usdc"}]}
    """
    resp = requests.get(f"{EXECUTOR_URL}/catalog", timeout=10)
    resp.raise_for_status()
    catalog = resp.json()
    sellers = [
        {
            "seller_id": s["seller_id"],
            "coverage": s["coverage"],
            "advertised_price_usdc": s["price_usdc"],
        }
        for s in catalog["sellers"]
    ]
    return {"scope": scope, "sellers": sellers}
