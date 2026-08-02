"""일일 호출 한도 규칙: 이번 건 포함 calls_today + 1 <= max_calls_per_day.

calls_today(오늘 이미 승인된 결제 건수)는 executor가 감사 로그에서 세어
context로 넘긴다. 정책 엔진은 상태를 갖지 않는다.
"""

NAME = "daily_call_limit"
REASON = "daily_call_limit_reached"


def check(intent: dict, envelope: dict, context: dict) -> dict:
    calls_today = context["calls_today"]
    max_calls = envelope["limits"]["max_calls_per_day"]

    if calls_today + 1 <= max_calls:
        return {"rule": NAME, "result": "PASS", "detail": f"{calls_today + 1}/{max_calls}"}
    return {"rule": NAME, "result": "FAIL", "detail": f"{calls_today}/{max_calls} already used"}
