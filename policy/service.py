"""정책 서비스 — engine.evaluate의 얇은 HTTP 래퍼 (HANDOFF §6.2).

- 상태 없음, LLM 호출 없음(R3). 판정 로직은 전부 engine/rules에 있다.
- GET /envelope/{id}: 봉투 정의(정본은 rulesets/*.yaml) 서빙
- POST /evaluate: {intent, envelope, context} → 판정(§7.3)

실행: .venv/bin/python -m policy.service  (repo 루트에서)
"""

import json
import os
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from policy.engine import evaluate
from policy.loader import load_envelope

PORT = int(os.environ.get("PORT", "5100"))  # Cloud Run은 PORT 주입
HOST = os.environ.get("HOST", "127.0.0.1")  # Cloud Run은 0.0.0.0


class Handler(BaseHTTPRequestHandler):
    def _send(self, code: int, obj: dict) -> None:
        payload = json.dumps(obj, ensure_ascii=False).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def do_GET(self) -> None:
        if self.path == "/health":
            return self._send(200, {"service": "policy", "llm_calls": 0})
        if self.path.startswith("/envelope/"):
            envelope_id = self.path.rsplit("/", 1)[-1]
            try:
                return self._send(200, load_envelope(envelope_id))
            except FileNotFoundError:
                return self._send(404, {"error": f"unknown envelope: {envelope_id}"})
        return self._send(404, {"error": "not found"})

    def do_POST(self) -> None:
        if self.path != "/evaluate":
            return self._send(404, {"error": "not found"})
        try:
            body = json.loads(self.rfile.read(int(self.headers.get("Content-Length", 0))))
            decision = evaluate(body["intent"], body["envelope"], body["context"])
            return self._send(200, decision)
        except (KeyError, ValueError, json.JSONDecodeError) as e:
            return self._send(400, {"error": str(e)})

    def log_message(self, fmt: str, *args) -> None:
        print(f"[policy] {self.command} {self.path}")


if __name__ == "__main__":
    print(f"[policy] listening on :{PORT} — 결정론적 규칙 엔진, LLM 호출 0회")
    ThreadingHTTPServer((HOST, PORT), Handler).serve_forever()
