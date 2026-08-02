"""결정론적 정책 엔진 (HANDOFF §5 R3·R5, §7.3).

- R3: LLM 호출 0회. 시계·난수·네트워크 접근 없음. 같은 입력 → 항상 같은 출력.
- R5: 첫 FAIL에서 early return 하지 않는다. ALL_RULES 전체를 평가하고
      checked_rules에 전부 기록한다.

입력:
  intent   — shared/purchase_intent.schema.json 형상
  envelope — shared/envelope.schema.json 형상
  context  — {"calls_today": int, "now": ISO 8601 str}  (상태·시각은 호출자가 공급)

출력: shared/policy_decision.schema.json 형상
"""

from policy.rules import ALL_RULES


def evaluate(intent: dict, envelope: dict, context: dict) -> dict:
    if intent["envelope_id"] != envelope["envelope_id"]:
        raise ValueError(
            f"envelope mismatch: intent references {intent['envelope_id']}, "
            f"loaded {envelope['envelope_id']}"
        )

    checked_rules = [rule.check(intent, envelope, context) for rule in ALL_RULES]
    reasons = [
        rule.REASON
        for rule, result in zip(ALL_RULES, checked_rules)
        if result["result"] == "FAIL"
    ]

    return {
        "intent_id": intent["intent_id"],
        "verdict": "PASS" if not reasons else "BLOCK",
        "ruleset_version": envelope["ruleset_version"],
        "checked_rules": checked_rules,
        "reasons": reasons,
        "evaluated_at": context["now"],
    }
