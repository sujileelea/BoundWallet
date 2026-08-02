"""건당 한도 규칙: quoted_price <= budget.per_call_max"""

from decimal import Decimal

NAME = "per_call_max"
REASON = "per_call_max_exceeded"


def check(intent: dict, envelope: dict, context: dict) -> dict:
    per_call_max = Decimal(str(envelope["budget"]["per_call_max"]))
    price = Decimal(str(intent["quoted_price"]))

    if price <= per_call_max:
        return {"rule": NAME, "result": "PASS", "detail": f"{price} <= {per_call_max}"}
    return {"rule": NAME, "result": "FAIL", "detail": f"{price} > {per_call_max}"}
