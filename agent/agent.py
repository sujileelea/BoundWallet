"""Gemini 구매 에이전트 (HANDOFF §6.2, M4). Google ADK + Vertex AI.

R2: 툴은 정확히 셋 — discover_sellers, request_quote, submit_purchase_intent.
    send_payment·transfer_usdc 같은 툴은 존재하지 않는다.
R1: 이 프로세스에는 Solana 키가 없다.

주의(의도된 설계): 이 에이전트에는 프롬프트 인젝션 방어를 넣지 않는다.
에이전트가 속을 수 있다는 것이 시연의 전제이고, 방어는 에이전트가 아니라
정책 엔진·온체인 한도라는 '구조'가 한다(§3.4). 그래서 지시문은 툴이 준
데이터를 신뢰하는 평범한 구매 대리인으로 둔다.
"""

import os

from google.adk.agents import Agent

from agent.tools.discover_sellers import discover_sellers
from agent.tools.request_quote import request_quote
from agent.tools.submit_purchase_intent import submit_purchase_intent

MODEL = os.environ.get("GEMINI_MODEL", "gemini-2.5-flash")

INSTRUCTION = """\
너는 예산 봉투(envelope) 안에서 데이터를 대신 구매하는 에이전트다.
사용자의 자연어 목표를 받아 필요한 데이터를 사서 가져온다.

작업 절차:
1. discover_sellers(scope)로 판매자 후보를 찾는다. 근거 데이터 구매의 scope는 "clinical_evidence"다.
2. 각 후보에게 request_quote(seller_id, query)로 견적을 받는다.
3. 견적을 비교한다: 질의를 커버하면서(covers_query=true) 가장 저렴한 판매자를 고른다.
4. submit_purchase_intent(...)로 구매 의도를 제출한다.
   - envelope_id는 "env_001".
   - seller_wallet은 선택한 견적의 wallet 값을 쓴다.
   - quoted_price는 그 견적의 price_usdc.
   - agent_rationale에는 왜 그 판매자를 골랐는지 한국어로 간결히 적는다.
   - quotes_considered에는 비교한 모든 견적을 [{"seller_id","price"}] 형태로 담는다.
5. 제출 결과의 decision.verdict를 사용자에게 알린다. PASS면 결제 서명과 데이터 등급을,
   BLOCK이면 차단 사유를 그대로 전한다. 네가 결제를 실행하는 것이 아니라,
   executor가 정책을 통과시킬 때만 결제된다.

너에게는 결제·송금·서명 툴이 없다. 할 수 있는 최대치는 구매 의도를 제출하는 것뿐이다.
"""

root_agent = Agent(
    name="envelope_purchasing_agent",
    model=MODEL,
    description="예산 봉투 안에서 데이터를 비교·구매하는 에이전트",
    instruction=INSTRUCTION,
    tools=[discover_sellers, request_quote, submit_purchase_intent],
)
