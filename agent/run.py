"""에이전트 러너 — 자연어 목표 하나로 M1~M3 루프를 끝까지 돈다 (HANDOFF M4 완료조건).

실행: .venv/bin/python -m agent.run "이 성분이 효과 있다는 임상 근거를 미국·EU 기준으로 찾아줘"
선행: agent/.env, 그리고 scripts/run-all.sh 로 policy·seller·executor 기동.
"""

import asyncio
import sys
from pathlib import Path

# agent/.env 로드 (python-dotenv 없이 최소 파서)
ENV_PATH = Path(__file__).parent / ".env"
if ENV_PATH.exists():
    import os
    for line in ENV_PATH.read_text().splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            key, _, value = line.partition("=")
            os.environ.setdefault(key.strip(), value.strip())

from google.adk.runners import Runner  # noqa: E402
from google.adk.sessions import InMemorySessionService  # noqa: E402
from google.genai import types  # noqa: E402

from agent.agent import root_agent  # noqa: E402

APP = "envelope"


async def run_goal(goal: str) -> None:
    session_service = InMemorySessionService()
    runner = Runner(agent=root_agent, app_name=APP, session_service=session_service)
    await session_service.create_session(app_name=APP, user_id="demo", session_id="s1")

    content = types.Content(role="user", parts=[types.Part(text=goal)])
    print(f"목표: {goal}\n{'─' * 60}")
    async for event in runner.run_async(user_id="demo", session_id="s1", new_message=content):
        for part in event.content.parts if event.content else []:
            if part.function_call:
                args = dict(part.function_call.args or {})
                if "quotes_considered" in args:
                    args["quotes_considered"] = f"[{len(args['quotes_considered'])} quotes]"
                print(f"  ▶ {part.function_call.name}({_brief(args)})")
            if part.function_response:
                print(f"  ◀ {part.function_response.name} → {_brief(part.function_response.response)}")
            if part.text and part.text.strip():
                print(f"\n{part.text.strip()}")


def _brief(obj: object, limit: int = 160) -> str:
    text = str(obj)
    return text if len(text) <= limit else text[:limit] + "…"


if __name__ == "__main__":
    goal = sys.argv[1] if len(sys.argv) > 1 else "이 성분이 진짜 효과 있다는 임상 근거를 미국·EU 기준으로 찾아줘: retinol wrinkle reduction"
    asyncio.run(run_goal(goal))
