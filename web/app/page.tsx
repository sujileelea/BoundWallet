"use client";

// 4분할 데모 화면 (HANDOFF §8 M6).
// ②(사고 로그)와 ③(정책 판정)이 나란히 보이는 것이 이 UI의 존재 이유 —
// 시나리오 3·4에서 왼쪽은 "이게 최선입니다", 오른쪽은 "BLOCK"이 동시에 뜬다.
// 데이터 소스는 executor 하나: SSE(/events) + 폴링(/envelope-status).

import { useEffect, useRef, useState } from "react";

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

  return (
    <main>
      <header>
        <h1>ENVELOPE</h1>
        <span className="tagline">AI가 속아도 봉투 밖으로는 한 푼도 나가지 않는다</span>
        <span className={connected ? "pass" : "fail"} style={{ marginLeft: "auto", fontSize: 12 }}>
          {connected ? "● live" : "○ executor 연결 대기"}
        </span>
      </header>
      <div className="grid">
        <EnvelopePanel status={status} />
        <AgentPanel events={events} />
        <PolicyPanel events={events} />
        <TransactionPanel events={events} />
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
        </>
      )}
    </section>
  );
}

function AgentPanel({ events }: { events: AuditEvent[] }) {
  const intents = events.filter((e) => e.type === "intent_received");
  const endRef = useAutoScroll(intents.length);
  return (
    <section className="panel">
      <h2>② 에이전트 사고 로그</h2>
      {intents.length === 0 && <p className="muted">구매 의도 대기…</p>}
      {intents.map((e, i) => {
        const intent = e.intent as {
          seller_id: string; seller_wallet: string; quoted_price: number; query: string;
          agent_rationale: string; quotes_considered: Array<{ seller_id: string; price: number }>;
        };
        return (
          <div className="event" key={i}>
            <div className="ts">{e.ts} · {e.intent_id}</div>
            <div className="muted">질의: {intent.query}</div>
            <div>
              견적: {intent.quotes_considered.map((q) => `${q.seller_id} $${q.price}`).join(" · ")}
            </div>
            <div>
              선택: <span className="accent">{intent.seller_id}</span> ${intent.quoted_price} → {short(intent.seller_wallet)}
            </div>
            <div className="warn">“{intent.agent_rationale}”</div>
          </div>
        );
      })}
      <div ref={endRef} />
    </section>
  );
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

function useAutoScroll(dep: number) {
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [dep]);
  return endRef;
}

const short = (addr: string) => (addr.length > 12 ? `${addr.slice(0, 4)}…${addr.slice(-4)}` : addr);
