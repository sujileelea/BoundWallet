"""에이전트 러너 — 자연어 목표 하나로 M1~M3 루프를 끝까지 돈다 (HANDOFF M4 완료조건).

CLI: .venv/bin/python -m agent.run "레티놀 임상 근거를 미국·EU 기준으로 찾아줘"
서비스: run_goal(goal, run_id, emit=True) — 각 스텝을 executor /agent-event로 스트리밍(M6 ②번 패널).
선행: agent/.env, scripts/run-all.sh.
"""

import asyncio
import os
import sys
import time
from pathlib import Path

import requests

ENV_PATH = Path(__file__).parent / ".env"
if ENV_PATH.exists():
    for line in ENV_PATH.read_text().splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            k, _, v = line.partition("=")
            os.environ.setdefault(k.strip(), v.strip())

EXECUTOR_URL = os.environ.get("EXECUTOR_URL", "http://localhost:5200")

from google.adk.runners import Runner  # noqa: E402
from google.adk.sessions import InMemorySessionService  # noqa: E402
from google.genai import types  # noqa: E402

from agent.agent import root_agent  # noqa: E402

APP = "envelope"


def new_run_id() -> str:
    return f"run_{int(time.time() * 1000)}"


def _emit(run_id: str, event_type: str, **fields) -> None:
    try:
        requests.post(
            f"{EXECUTOR_URL}/agent-event",
            json={"type": event_type, "run_id": run_id, **fields},
            timeout=5,
        )
    except requests.RequestException:
        pass  # 로그 스트림 실패가 에이전트 동작을 막지 않는다


def _emit_tool_result(run_id: str, name: str, response: dict) -> None:
    """툴 응답을 UI 친화적 스텝 이벤트로 변환. request_quote는 note(인젝션 포함)를 그대로 싣는다."""
    if name == "discover_sellers":
        sellers = [s["seller_id"] for s in response.get("sellers", [])]
        _emit(run_id, "agent_step", step="discover", detail=f"판매자 후보 {len(sellers)}곳: {', '.join(sellers)}")
    elif name == "request_quote":
        _emit(
            run_id, "agent_step", step="quote",
            seller_id=response.get("seller_id"),
            price_usdc=response.get("price_usdc"),
            wallet=response.get("wallet"),
            covers_query=response.get("covers_query"),
            note=response.get("note", ""),
        )


async def run_goal(goal: str, run_id: str | None = None, emit: bool = False) -> str:
    run_id = run_id or new_run_id()
    session_service = InMemorySessionService()
    runner = Runner(agent=root_agent, app_name=APP, session_service=session_service)
    await session_service.create_session(app_name=APP, user_id="demo", session_id=run_id)

    if emit:
        _emit(run_id, "agent_started", goal=goal)
    print(f"목표: {goal}\n{'─' * 60}")

    final_text = ""
    content = types.Content(role="user", parts=[types.Part(text=goal)])
    async for event in runner.run_async(user_id="demo", session_id=run_id, new_message=content):
        for part in event.content.parts if event.content else []:
            if part.function_call:
                args = dict(part.function_call.args or {})
                if "quotes_considered" in args:
                    args["quotes_considered"] = f"[{len(args['quotes_considered'])} quotes]"
                print(f"  ▶ {part.function_call.name}({_brief(args)})")
            if part.function_response:
                print(f"  ◀ {part.function_response.name} → {_brief(part.function_response.response)}")
                if emit and isinstance(part.function_response.response, dict):
                    _emit_tool_result(run_id, part.function_response.name, part.function_response.response)
            if part.text and part.text.strip():
                final_text = part.text.strip()
                print(f"\n{final_text}")

    if emit:
        _emit(run_id, "agent_finished", text=final_text)
    return final_text


def _brief(obj: object, limit: int = 160) -> str:
    text = str(obj)
    return text if len(text) <= limit else text[:limit] + "…"


if __name__ == "__main__":
    goal = sys.argv[1] if len(sys.argv) > 1 else "이 성분이 진짜 효과 있다는 임상 근거를 미국·EU 기준으로 찾아줘: retinol wrinkle reduction"
    asyncio.run(run_goal(goal, emit=True))
