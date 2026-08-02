"""규칙 레지스트리. 규칙 1개당 1파일 (HANDOFF §6.3).

각 규칙 모듈의 계약:
  NAME: str            — policy_decision.schema.json의 rule enum과 일치
  REASON: str          — FAIL 시 reasons에 들어갈 사유 코드
  check(intent, envelope, context) -> {"rule", "result", "detail"}

R3: 어떤 규칙도 LLM·네트워크·시계·난수에 접근하지 않는다.
    현재 시각조차 context["now"]로 입력받는다.
"""

from policy.rules import (
    budget_total,
    per_call_max,
    seller_allowlist,
    scope,
    daily_call_limit,
    expiry,
)

# 평가 순서 = §7.3 예시 순서. R5: 엔진은 이 목록 전체를 항상 평가한다.
ALL_RULES = [
    budget_total,
    per_call_max,
    seller_allowlist,
    scope,
    daily_call_limit,
    expiry,
]
