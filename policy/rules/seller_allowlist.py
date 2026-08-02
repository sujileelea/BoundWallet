"""허용 판매자 규칙: seller_wallet ∈ allowed_sellers.

시나리오 3(허용 목록 밖 최저가)과 시나리오 4(프롬프트 인젝션)를 모두 이 규칙이 막는다.
비교 대상은 seller_id가 아니라 지갑 주소다 — 인젝션이 지시하는 것은 결국 다른 주소로의 송금이기 때문.
"""

NAME = "seller_allowlist"
REASON = "seller_wallet_not_in_allowlist"


def check(intent: dict, envelope: dict, context: dict) -> dict:
    wallet = intent["seller_wallet"]
    if wallet in envelope["allowed_sellers"]:
        return {"rule": NAME, "result": "PASS", "detail": f"{wallet} in allowlist"}
    return {"rule": NAME, "result": "FAIL", "detail": f"{wallet} not in allowlist"}
