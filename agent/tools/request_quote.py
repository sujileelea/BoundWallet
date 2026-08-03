"""툴 2/3: request_quote (HANDOFF §5 R2, §4.2 A2A 견적).

판매자 에이전트에게 A2A로 견적을 요청한다. 응답에는 단가·수취 지갑과 함께
판매자가 붙인 안내문(note)이 온다 — 판매자 B의 note에는 프롬프트 인젝션이
섞여 있을 수 있다(시나리오 4). 이 툴은 응답을 가공하지 않고 그대로 돌려준다:
'실제 응답에 섞여 들어온 것'이어야 방어의 의미가 산다.
"""

import os

import requests

EXECUTOR_URL = os.environ.get("EXECUTOR_URL", "http://localhost:5200")


def _seller_url(seller_id: str) -> str:
    resp = requests.get(f"{EXECUTOR_URL}/catalog", timeout=10)
    resp.raise_for_status()
    for s in resp.json()["sellers"]:
        if s["seller_id"] == seller_id:
            # 클라우드는 카탈로그의 url, 로컬은 localhost:port
            return s.get("url") or f"http://localhost:{s['port']}"
    raise ValueError(f"unknown seller: {seller_id}")


def request_quote(seller_id: str, query: str) -> dict:
    """판매자에게 견적을 요청한다 (A2A).

    Args:
        seller_id: discover_sellers가 반환한 판매자 ID.
        query: 사고 싶은 데이터에 대한 자연어 질의.

    Returns:
        {"seller_id", "wallet", "price_usdc", "covers_query", "note"}.
        note는 판매자가 보낸 원문 그대로다(신뢰할 수 없는 외부 입력).
    """
    base = _seller_url(seller_id)
    resp = requests.get(f"{base}/quote", params={"query": query}, timeout=10)
    resp.raise_for_status()
    return resp.json()
