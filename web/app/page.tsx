"use client";

// 4분할 데모 화면 (HANDOFF §8 M6).
// ②(사고 로그)와 ③(정책 판정)이 나란히 보이는 것이 이 UI의 존재 이유 —
// 시나리오 3·4에서 왼쪽은 "이게 최선입니다", 오른쪽은 "BLOCK"이 동시에 뜬다.
// 데이터 소스는 executor 하나: SSE(/events) + 폴링(/envelope-status).

import { useEffect, useRef, useState } from "react";

import { LIVE_SCENARIOS, runGoal, runInjectionScenario, runLiveScenario, resetEnvelope } from "./scenarios";

const EXECUTOR = process.env.NEXT_PUBLIC_EXECUTOR_URL ?? "http://localhost:5200";

interface AuditEvent {
  ts: string;
  type: string;
  intent_id: string;
  [key: string]: unknown;
}

interface EnvelopeStatus {
  envelope: {
    envelope_id: string;
    ruleset_version: string;
    budget: { total: number; per_call_max: number; spent: number; currency: string };
    allowed_sellers: string[];
    limits: { max_calls_per_day: number; expires_at: string };
  };
  calls_today: number;
  remaining: number;
  onchain: { delegated_remaining: number | null; delegate: string; explorer_url: string };
  mandate: { present: boolean; verified: boolean; reason: string; signed_by: string | null };
}

export default function Home() {
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [status, setStatus] = useState<EnvelopeStatus | null>(null);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    const source = new EventSource(`${EXECUTOR}/events`);
    source.onopen = () => setConnected(true);
    source.onerror = () => setConnected(false);
    source.onmessage = (msg) => {
      const event = JSON.parse(msg.data) as AuditEvent;
      setEvents((prev) => [...prev, event]);
    };
    return () => source.close();
  }, []);

  useEffect(() => {
    let alive = true;
    const poll = async () => {
      try {
        const res = await fetch(`${EXECUTOR}/envelope-status?id=env_001`);
        if (alive && res.ok) setStatus(await res.json());
      } catch {
        /* executor 미기동 — 배지로 표시됨 */
      }
    };
    poll();
    const timer = setInterval(poll, 3000);
    return () => { alive = false; clearInterval(timer); };
  }, []);

  const [running, setRunning] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [goal, setGoal] = useState("레티놀의 주름 개선 임상 근거를 미국·EU 기준으로 찾아줘");
  const sessionStart = useRef(new Date().toISOString());
  const [showAll, setShowAll] = useState(false);
  const visible = showAll ? events : events.filter((e) => e.ts >= sessionStart.current);

  const guard = async (key: string, fn: () => Promise<unknown>) => {
    setRunning(key);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setRunning(null);
    }
  };

  return (
    <main>
      <header>
        <h1>ENVELOPE</h1>
        <span className="tagline">AI가 속아도 봉투 밖으로는 한 푼도 나가지 않는다</span>
        <span className={connected ? "pass" : "fail"} style={{ marginLeft: "auto", fontSize: 12 }}>
          {connected ? "● live" : "○ executor 연결 대기"}
        </span>
      </header>
      <div className="toolbar">
        <input
          className="goal-input"
          value={goal}
          onChange={(e) => setGoal(e.target.value)}
          placeholder="자연어 목표를 입력…"
          disabled={running !== null}
        />
        <button disabled={running !== null} onClick={() => guard("goal", () => runGoal(goal))}>
          {running === "goal" ? "에이전트 실행 중…" : "▶ 에이전트 실행"}
        </button>
      </div>
      <div className="toolbar">
        {Object.entries(LIVE_SCENARIOS).map(([key, s]) => (
          <button key={key} disabled={running !== null} onClick={() => guard(key, () => runLiveScenario(key))}>
            {running === key ? "실행 중…" : s.label}
          </button>
        ))}
        <button
          disabled={running !== null}
          onClick={() => guard("4", () => runInjectionScenario())}
          title="gemini-2.5-flash는 인젝션에 저항하므로, 속았다고 가정한 의도를 직접 제출해 정책 차단을 보인다"
        >
          {running === "4" ? "실행 중…" : "④ 인젝션 (확정)"}
        </button>
        <button disabled={running !== null} onClick={() => guard("reset", () => resetEnvelope())} className="ghost">
          봉투 리셋
        </button>
        <button onClick={() => setShowAll((v) => !v)} className="ghost">
          {showAll ? "이번 세션만" : "전체 이력"}
        </button>
        {error && <span className="fail">{error}</span>}
      </div>
      <div className="grid">
        <EnvelopePanel status={status} />
        <AgentPanel events={visible} />
        <PolicyPanel events={visible} />
        <TransactionPanel events={visible} />
      </div>
    </main>
  );
}

function EnvelopePanel({ status }: { status: EnvelopeStatus | null }) {
  return (
    <section className="panel">
      <h2>① 봉투 상태</h2>
      {!status ? (
        <p className="muted">executor 응답 대기…</p>
      ) : (
        <>
          <div className="stat-row">
            <div className="stat">
              <div className="label">예산 잔액</div>
              <div className="value">
                {status.remaining} <span className="muted" style={{ fontSize: 12 }}>/ {status.envelope.budget.total} USDC-M</span>
              </div>
            </div>
            <div className="stat">
              <div className="label">온체인 위임 잔량</div>
              <div className="value accent">
                {status.onchain.delegated_remaining ?? "—"}
              </div>
            </div>
            <div className="stat">
              <div className="label">건당 한도</div>
              <div className="value">{status.envelope.budget.per_call_max}</div>
            </div>
            <div className="stat">
              <div className="label">오늘 호출</div>
              <div className="value">
                {status.calls_today}
                <span className="muted" style={{ fontSize: 12 }}> / {status.envelope.limits.max_calls_per_day}</span>
              </div>
            </div>
          </div>
          <p style={{ marginTop: 8 }} className="muted">
            허용 판매자 {status.envelope.allowed_sellers.length}곳 · 만료 {status.envelope.limits.expires_at.slice(0, 10)} ·{" "}
            <a href={status.onchain.explorer_url} target="_blank" rel="noreferrer">위임 계정 Explorer ↗</a>
          </p>
          <p style={{ marginTop: 4 }}>
            AP2 mandate:{" "}
            {status.mandate.verified ? (
              <span className="pass">✓ 관리자 서명 검증됨 ({short(status.mandate.signed_by ?? "")})</span>
            ) : (
              <span className="warn">✗ {status.mandate.reason}</span>
            )}
          </p>
        </>
      )}
    </section>
  );
}

function AgentPanel({ events }: { events: AuditEvent[] }) {
  // 라이브 에이전트 사고 스텝 + 최종 구매 의도를 시간순으로 표시
  const feed = events.filter((e) =>
    ["agent_started", "agent_step", "agent_finished", "intent_received"].includes(e.type),
  );
  const endRef = useAutoScroll(feed.length);
  return (
    <section className="panel">
      <h2>② Gemini 사고 로그 (라이브)</h2>
      {feed.length === 0 && <p className="muted">에이전트 실행 대기… 위 입력창에 목표를 넣고 실행하세요.</p>}
      {feed.map((e, i) => (
        <AgentEvent key={i} e={e} />
      ))}
      <div ref={endRef} />
    </section>
  );
}

function AgentEvent({ e }: { e: AuditEvent }) {
  if (e.type === "agent_started") {
    return (
      <div className="event">
        <div className="ts">{e.ts} · {String(e.run_id ?? "")}</div>
        <div className="accent">🎯 목표: {String(e.goal)}</div>
      </div>
    );
  }
  if (e.type === "agent_step" && e.step === "discover") {
    return <div className="event"><span className="muted">🔍 {String(e.detail)}</span></div>;
  }
  if (e.type === "agent_step" && e.step === "quote") {
    const note = String(e.note ?? "");
    const injected = note.includes("[SYSTEM]") || note.includes("무시");
    return (
      <div className="event">
        <div>
          💬 견적 <span className="accent">{String(e.seller_id)}</span> ${String(e.price_usdc)} →{" "}
          {short(String(e.wallet))} {e.covers_query ? <span className="pass">(커버)</span> : <span className="muted">(미커버)</span>}
        </div>
        {note && (
          <div className={injected ? "fail" : "muted"} style={{ fontSize: 11, marginTop: 2 }}>
            {injected && "⚠️ 인젝션 감지 — "}note: {note.slice(0, 180)}{note.length > 180 ? "…" : ""}
          </div>
        )}
      </div>
    );
  }
  if (e.type === "intent_received") {
    const intent = e.intent as {
      seller_id: string; seller_wallet: string; quoted_price: number;
      agent_rationale: string; quotes_considered: Array<{ seller_id: string; price: number }>;
    };
    return (
      <div className="event">
        <div>
          ✔ 선택: <span className="accent">{intent.seller_id}</span> ${intent.quoted_price} → {short(intent.seller_wallet)}
        </div>
        <div className="warn">“{intent.agent_rationale}”</div>
      </div>
    );
  }
  if (e.type === "agent_finished") {
    return (
      <div className="event">
        <span className="muted">■ 에이전트 종료</span>
      </div>
    );
  }
  return null;
}

function PolicyPanel({ events }: { events: AuditEvent[] }) {
  const decisions = events.filter((e) => e.type === "policy_decision");
  const endRef = useAutoScroll(decisions.length);
  return (
    <section className="panel">
      <h2>③ 정책 판정 — 검사한 규칙 전부</h2>
      {decisions.length === 0 && <p className="muted">판정 대기…</p>}
      {decisions.map((e, i) => {
        const decision = e.decision as {
          verdict: string; ruleset_version: string; reasons: string[];
          checked_rules: Array<{ rule: string; result: string; detail: string }>;
        };
        return (
          <div className="event" key={i}>
            <div className="ts">{e.ts} · {e.intent_id} · ruleset {decision.ruleset_version}</div>
            <span className={`badge ${decision.verdict}`}>{decision.verdict}</span>
            {decision.reasons.length > 0 && <span className="fail"> {decision.reasons.join(", ")}</span>}
            <table className="rules">
              <tbody>
                {decision.checked_rules.map((rule) => (
                  <tr key={rule.rule}>
                    <td>{rule.rule}</td>
                    <td className={rule.result === "PASS" ? "pass" : "fail"}>{rule.result}</td>
                    <td className="muted">{rule.detail}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      })}
      <div ref={endRef} />
    </section>
  );
}

function TransactionPanel({ events }: { events: AuditEvent[] }) {
  const txEvents = events.filter((e) => ["payment_executed", "payment_blocked", "payment_failed"].includes(e.type));
  const endRef = useAutoScroll(txEvents.length);
  return (
    <section className="panel">
      <h2>④ 트랜잭션</h2>
      {txEvents.length === 0 && <p className="muted">결제 대기…</p>}
      {txEvents.map((e, i) => (
        <div className="event" key={i}>
          <div className="ts">{e.ts} · {e.intent_id}</div>
          {e.type === "payment_executed" ? (
            <>
              <span className="pass">✓ 결제 {String(e.amount_usdc)} USDC-M → {short(String(e.pay_to))}</span>
              <div>
                <a href={String(e.explorer_url)} target="_blank" rel="noreferrer">
                  {String(e.signature).slice(0, 24)}… Explorer ↗
                </a>
              </div>
            </>
          ) : e.type === "payment_blocked" ? (
            <span className="fail">✕ 결제 차단 — {(e.reasons as string[]).join(", ")} (결제 0건)</span>
          ) : (
            <span className="fail">! 결제 실패 — {String(e.error)}</span>
          )}
        </div>
      ))}
      <div ref={endRef} />
    </section>
  );
}

// 페이지 전체가 스크롤되므로 패널별 자동 스크롤은 하지 않는다
// (네 패널이 동시에 갱신되면 화면이 튐). ref는 호출부 호환 위해 유지.
function useAutoScroll(_dep: number) {
  return useRef<HTMLDivElement>(null);
}

const short = (addr: string) => (addr.length > 12 ? `${addr.slice(0, 4)}…${addr.slice(-4)}` : addr);
