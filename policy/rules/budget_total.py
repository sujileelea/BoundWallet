"""잔여 예산 규칙: spent + quoted_price <= budget.total"""

from decimal import Decimal

NAME = "budget_total"
REASON = "budget_total_exceeded"


def check(intent: dict, envelope: dict, context: dict) -> dict:
    total = Decimal(str(envelope["budget"]["total"]))
    spent = Decimal(str(envelope["budget"]["spent"]))
    price = Decimal(str(intent["quoted_price"]))
    remaining = total - spent

    if price <= remaining:
        return {"rule": NAME, "result": "PASS", "detail": f"{remaining} remaining, {price} requested"}
    return {"rule": NAME, "result": "FAIL", "detail": f"{price} requested > {remaining} remaining"}
