"""에이전트 HTTP 서비스 (M6 UI 연동). 웹 버튼/입력창이 라이브 Gemini 에이전트를 트리거한다.

POST /run {goal, scenario?}  → 시나리오 세팅(시장 상태·잔액) 후 에이전트 실행.
   에이전트 사고 스텝은 executor /agent-event로 스트리밍되어 UI SSE에 흐른다(run.py).
   응답: {run_id, final_text}.

R1/R2 불변: 이 서비스도 Solana 키를 갖지 않으며, 결제는 executor만 한다.
실행: .venv/bin/python -m agent.service  (선행: scripts/run-all.sh)
"""

import asyncio
import json
import os
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
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
PORT = int(os.environ.get("PORT", os.environ.get("AGENT_PORT", "5300")))  # Cloud Run은 PORT 주입
HOST = os.environ.get("HOST", "127.0.0.1")  # Cloud Run은 0.0.0.0

from agent.run import new_run_id, run_goal  # noqa: E402

# 시나리오별 시장 상태·잔액 (docs/agent-notes.md).
# "4"는 B만 노출 — 라이브 에이전트가 B의 인젝션을 만나고도 저항하는지 보인다
# (에이전트 계층). 인젝션에 속았을 때의 정책 차단은 web 확정 경로(직접 제출)로 별도 시연.
SCENARIO_SETUP = {
    "1": {"sellers": ["seller_a", "seller_b"], "spent": 0.0},
    "2": {"sellers": ["seller_a", "seller_b"], "spent": 49.7},
    "3": {"sellers": ["seller_a", "seller_b", "seller_c"], "spent": 0.0},
    "4": {"sellers": ["seller_b"], "spent": 0.0},
}


def _post(path: str, body: dict) -> None:
    try:
        requests.post(f"{EXECUTOR_URL}{path}", json=body, timeout=10)
    except requests.RequestException:
        pass


def _apply_scenario(scenario: str | None) -> None:
    if scenario in SCENARIO_SETUP:
        setup = SCENARIO_SETUP[scenario]
        _post("/admin/envelope-state", {"envelope_id": "env_001", "spent": setup["spent"]})
        _post("/demo/advertise", {"seller_ids": setup["sellers"]})


class Handler(BaseHTTPRequestHandler):
    def _send(self, code: int, obj: dict) -> None:
        payload = json.dumps(obj, ensure_ascii=False).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def do_OPTIONS(self) -> None:
        self._send(204, {})

    def do_GET(self) -> None:
        if self.path == "/health":
            return self._send(200, {"service": "agent", "model": os.environ.get("GEMINI_MODEL")})
        return self._send(404, {"error": "not found"})

    def do_POST(self) -> None:
        if self.path != "/run":
            return self._send(404, {"error": "not found"})
        try:
            body = json.loads(self.rfile.read(int(self.headers.get("Content-Length", 0))))
            goal = body.get("goal") or "레티놀의 주름 개선 임상 근거를 미국·EU 기준으로 찾아줘"
            _apply_scenario(body.get("scenario"))
            run_id = new_run_id()
            final_text = asyncio.run(run_goal(goal, run_id=run_id, emit=True))
            return self._send(200, {"run_id": run_id, "final_text": final_text})
        except Exception as e:  # 데모 서비스 — 오류를 UI로 그대로 전달
            return self._send(500, {"error": str(e)})

    def log_message(self, fmt: str, *args) -> None:
        print(f"[agent] {self.command} {self.path}")


if __name__ == "__main__":
    print(f"[agent] listening on :{PORT} — Vertex {os.environ.get('GEMINI_MODEL')}, 키 없음(R1)")
    ThreadingHTTPServer((HOST, PORT), Handler).serve_forever()
