"""허용 질의 범위 규칙: intent.scope ∈ allowed_scopes"""

NAME = "scope"
REASON = "scope_not_allowed"


def check(intent: dict, envelope: dict, context: dict) -> dict:
    requested = intent["scope"]
    if requested in envelope["allowed_scopes"]:
        return {"rule": NAME, "result": "PASS", "detail": f"{requested} allowed"}
    return {"rule": NAME, "result": "FAIL", "detail": f"{requested} not in allowed scopes"}
