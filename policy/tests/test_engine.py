"""엔진 통합 테스트 — R5(전 규칙 평가·기록), 결정론, /shared 계약 준수."""

import copy
import json
from pathlib import Path

import jsonschema
import pytest

from policy.engine import evaluate
from policy.loader import load_envelope
from policy.tests.test_rules import CONTEXT, ENVELOPE, INTENT, _with

_SHARED = Path(__file__).resolve().parent.parent.parent / "shared"
DECISION_SCHEMA = json.loads((_SHARED / "policy_decision.schema.json").read_text())

ALL_RULE_NAMES = ["budget_total", "per_call_max", "seller_allowlist", "scope", "daily_call_limit", "expiry"]


def test_all_pass():
    decision = evaluate(INTENT, ENVELOPE, CONTEXT)
    assert decision["verdict"] == "PASS"
    assert decision["reasons"] == []
    assert [r["rule"] for r in decision["checked_rules"]] == ALL_RULE_NAMES


def test_scenario_2_budget_exhausted():
    # 잔액 0.3 USDC 상태에서 0.5 USDC 요청 (HANDOFF §9 시나리오 2)
    envelope = _with(ENVELOPE, budget__spent=49.7)
    intent = _with(INTENT, quoted_price=0.5)
    decision = evaluate(intent, envelope, CONTEXT)

    assert decision["verdict"] == "BLOCK"
    assert decision["reasons"] == ["budget_total_exceeded"]
    # R5: FAIL이 나와도 6개 규칙 전부 평가·기록
    assert len(decision["checked_rules"]) == 6
    by_rule = {r["rule"]: r["result"] for r in decision["checked_rules"]}
    assert by_rule["budget_total"] == "FAIL"
    assert all(v == "PASS" for k, v in by_rule.items() if k != "budget_total")


def test_scenario_3_4_seller_not_in_allowlist():
    # 시나리오 3(허용 목록 밖 최저가)·4(인젝션 공격자 주소) 공통 차단 경로
    intent = _with(INTENT, seller_id="seller_c", seller_wallet="ATTACKER_OR_C_WALLET", quoted_price=0.1)
    decision = evaluate(intent, ENVELOPE, CONTEXT)

    assert decision["verdict"] == "BLOCK"
    assert decision["reasons"] == ["seller_wallet_not_in_allowlist"]
    assert len(decision["checked_rules"]) == 6


def test_multiple_failures_all_reported():
    envelope = _with(ENVELOPE, budget__spent=49.9)
    intent = _with(INTENT, seller_wallet="ATTACKER_WALLET", quoted_price=5.0, scope="travel_booking")
    context = {"calls_today": 40, "now": "2026-08-11T00:00:00Z"}
    decision = evaluate(intent, envelope, context)

    assert decision["verdict"] == "BLOCK"
    assert set(decision["reasons"]) == {
        "budget_total_exceeded",
        "per_call_max_exceeded",
        "seller_wallet_not_in_allowlist",
        "scope_not_allowed",
        "daily_call_limit_reached",
        "envelope_expired",
    }
    assert len(decision["checked_rules"]) == 6


def test_deterministic_same_input_same_output():
    # R3: 같은 입력 → 항상 같은 출력
    a = evaluate(copy.deepcopy(INTENT), copy.deepcopy(ENVELOPE), copy.deepcopy(CONTEXT))
    b = evaluate(copy.deepcopy(INTENT), copy.deepcopy(ENVELOPE), copy.deepcopy(CONTEXT))
    assert a == b


def test_envelope_mismatch_raises():
    intent = _with(INTENT, envelope_id="env_999")
    with pytest.raises(ValueError):
        evaluate(intent, ENVELOPE, CONTEXT)


def test_output_matches_shared_contract():
    for decision in (
        evaluate(INTENT, ENVELOPE, CONTEXT),
        evaluate(_with(INTENT, seller_wallet="X"), ENVELOPE, CONTEXT),
    ):
        jsonschema.validate(decision, DECISION_SCHEMA)


def test_ruleset_env_001_loads_and_validates():
    envelope = load_envelope("env_001")
    assert envelope["envelope_id"] == "env_001"
    assert envelope["budget"]["per_call_max"] == 2.0


def test_engine_module_has_no_forbidden_imports():
    # R3 가드: 정책 코드에 LLM·네트워크·시계 접근 경로가 없어야 한다
    import policy.engine as engine_module
    src_dir = Path(engine_module.__file__).parent
    forbidden = ("requests", "httpx", "urllib", "socket", "google.genai", "vertexai", "openai", "anthropic", "random")
    for py in list(src_dir.glob("*.py")) + list((src_dir / "rules").glob("*.py")):
        text = py.read_text()
        for name in forbidden:
            assert f"import {name}" not in text, f"{py.name} imports {name}"
    # 시계 직접 읽기 금지 (fromisoformat 파싱만 허용)
    for py in list(src_dir.glob("*.py")) + list((src_dir / "rules").glob("*.py")):
        text = py.read_text()
        assert "datetime.now" not in text and "time.time" not in text, f"{py.name} reads the clock"
