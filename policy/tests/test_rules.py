"""규칙별 PASS/FAIL/경계값 테스트."""

import copy

import pytest

from policy.rules import (
    budget_total,
    daily_call_limit,
    expiry,
    per_call_max,
    scope,
    seller_allowlist,
)

ENVELOPE = {
    "envelope_id": "env_001",
    "ruleset_version": "v1.2",
    "budget": {"total": 50.0, "per_call_max": 2.0, "spent": 12.5, "currency": "USDC"},
    "allowed_sellers": ["WALLET_A", "WALLET_B"],
    "allowed_scopes": ["clinical_evidence", "ingredient_lookup"],
    "limits": {"max_calls_per_day": 40, "expires_at": "2026-08-10T00:00:00Z"},
    "onchain": {"delegate_address": "WALLET_EXEC", "delegated_amount": 50.0},
}

INTENT = {
    "intent_id": "int_test_001",
    "envelope_id": "env_001",
    "seller_id": "seller_a",
    "seller_wallet": "WALLET_A",
    "quoted_price": 0.5,
    "scope": "clinical_evidence",
    "query": "retinol wrinkle reduction clinical evidence",
    "agent_rationale": "test",
    "quotes_considered": [{"seller_id": "seller_a", "price": 0.5}],
}

CONTEXT = {"calls_today": 4, "now": "2026-08-02T11:04:22Z"}


def _with(base: dict, **overrides) -> dict:
    out = copy.deepcopy(base)
    for path, value in overrides.items():
        keys = path.split("__")
        node = out
        for k in keys[:-1]:
            node = node[k]
        node[keys[-1]] = value
    return out


# --- budget_total -----------------------------------------------------------

def test_budget_total_pass():
    assert budget_total.check(INTENT, ENVELOPE, CONTEXT)["result"] == "PASS"


def test_budget_total_exact_boundary_pass():
    # 잔액 37.5에 정확히 37.5 요청 → 허용
    intent = _with(INTENT, quoted_price=37.5)
    assert budget_total.check(intent, ENVELOPE, CONTEXT)["result"] == "PASS"


def test_budget_total_over_fail():
    intent = _with(INTENT, quoted_price=37.51)
    assert budget_total.check(intent, ENVELOPE, CONTEXT)["result"] == "FAIL"


def test_budget_total_decimal_not_float():
    # 시나리오 2: 잔액 0.3에 0.5 요청. 0.1+0.2 부동소수점 함정이 없어야 한다
    envelope = _with(ENVELOPE, budget__total=0.3, budget__spent=0.0)
    intent = _with(INTENT, quoted_price=0.5)
    result = budget_total.check(intent, envelope, CONTEXT)
    assert result["result"] == "FAIL"
    envelope2 = _with(ENVELOPE, budget__total=0.3, budget__spent=0.0)
    intent2 = _with(INTENT, quoted_price=0.3)
    assert budget_total.check(intent2, envelope2, CONTEXT)["result"] == "PASS"


# --- per_call_max ------------------------------------------------------------

def test_per_call_max_pass():
    assert per_call_max.check(INTENT, ENVELOPE, CONTEXT)["result"] == "PASS"


def test_per_call_max_exact_boundary_pass():
    intent = _with(INTENT, quoted_price=2.0)
    assert per_call_max.check(intent, ENVELOPE, CONTEXT)["result"] == "PASS"


def test_per_call_max_over_fail():
    intent = _with(INTENT, quoted_price=2.01)
    assert per_call_max.check(intent, ENVELOPE, CONTEXT)["result"] == "FAIL"


# --- seller_allowlist ---------------------------------------------------------

def test_seller_allowlist_pass():
    assert seller_allowlist.check(INTENT, ENVELOPE, CONTEXT)["result"] == "PASS"


def test_seller_allowlist_fail():
    # 시나리오 3·4: C의 지갑 / 인젝션이 지시한 공격자 주소 — 둘 다 같은 규칙으로 차단
    intent = _with(INTENT, seller_wallet="ATTACKER_WALLET")
    result = seller_allowlist.check(intent, ENVELOPE, CONTEXT)
    assert result["result"] == "FAIL"
    assert "ATTACKER_WALLET" in result["detail"]


# --- scope --------------------------------------------------------------------

def test_scope_pass():
    assert scope.check(INTENT, ENVELOPE, CONTEXT)["result"] == "PASS"


def test_scope_fail():
    intent = _with(INTENT, scope="travel_booking")
    assert scope.check(intent, ENVELOPE, CONTEXT)["result"] == "FAIL"


# --- daily_call_limit -----------------------------------------------------------

def test_daily_call_limit_pass():
    assert daily_call_limit.check(INTENT, ENVELOPE, CONTEXT)["result"] == "PASS"


def test_daily_call_limit_last_slot_pass():
    context = {**CONTEXT, "calls_today": 39}
    assert daily_call_limit.check(INTENT, ENVELOPE, context)["result"] == "PASS"


def test_daily_call_limit_exhausted_fail():
    context = {**CONTEXT, "calls_today": 40}
    assert daily_call_limit.check(INTENT, ENVELOPE, context)["result"] == "FAIL"


# --- expiry ---------------------------------------------------------------------

def test_expiry_pass():
    assert expiry.check(INTENT, ENVELOPE, CONTEXT)["result"] == "PASS"


def test_expiry_exact_moment_fail():
    context = {**CONTEXT, "now": "2026-08-10T00:00:00Z"}
    assert expiry.check(INTENT, ENVELOPE, context)["result"] == "FAIL"


def test_expiry_after_fail():
    context = {**CONTEXT, "now": "2026-08-11T09:00:00Z"}
    assert expiry.check(INTENT, ENVELOPE, context)["result"] == "FAIL"
