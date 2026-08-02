"""봉투 만료 규칙: context.now < limits.expires_at.

R3: 시계를 읽지 않는다. 현재 시각은 context["now"](ISO 8601)로 입력받는다 —
같은 입력이면 언제 실행해도 같은 출력.
"""

from datetime import datetime

NAME = "expiry"
REASON = "envelope_expired"


def _parse(ts: str) -> datetime:
    return datetime.fromisoformat(ts.replace("Z", "+00:00"))


def check(intent: dict, envelope: dict, context: dict) -> dict:
    now = _parse(context["now"])
    expires_at = _parse(envelope["limits"]["expires_at"])

    if now < expires_at:
        return {"rule": NAME, "result": "PASS", "detail": f"valid until {envelope['limits']['expires_at']}"}
    return {"rule": NAME, "result": "FAIL", "detail": f"expired at {envelope['limits']['expires_at']}"}
