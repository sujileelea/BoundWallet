"use client";

// 4분할 데모 화면 (HANDOFF §8 M6).
// ②(사고 로그)와 ③(정책 판정)이 나란히 보이는 것이 이 UI의 존재 이유 —
// 시나리오 3·4에서 왼쪽은 "이게 최선입니다", 오른쪽은 "BLOCK"이 동시에 뜬다.
// 데이터 소스는 executor 하나: SSE(/events) + 폴링(/envelope-status).
//
// 녹화 대응(submission/03-데모영상-대본.md):
//   - 실행 중 진행 단계·경과 초를 표시해 대기 구간이 멈춘 화면으로 보이지 않게 한다
//   - 이벤트는 최신이 위 (스크롤 없이 최신 상황이 보이도록)
//   - 잔액 변화·Explorer 링크·인젝션을 시각적으로 강조

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

// 실행 중 표시할 라벨 (배너용)
const RUNNING_LABEL: Record<string, string> = {
  goal: "자연어 목표 실행",
  "1": "① 정상 — 에이전트 자율 구매",
  "2": "② 예산 소진",
  "3": "③ 허용 목록 밖 최저가",
  "4live": "④a 인젝션 — 에이전트 라이브 저항",
  "4block": "④b 인젝션 — 정책 차단",
  reset: "봉투 리셋",
};

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
    const timer = setInterval(poll, 2000);
    return () => { alive = false; clearInterval(timer); };
  }, []);

  const [running, setRunning] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [goal, setGoal] = useState("레티놀의 주름 개선 임상 근거를 미국·EU 기준으로 찾아줘");
  const [demoMode, setDemoMode] = useState(false);
  const sessionStart = useRef(new Date().toISOString());
  const [showAll, setShowAll] = useState(false);
  const visible = showAll ? events : events.filter((e) => e.ts >= sessionStart.current);

  // 녹화용 데모 모드: 글꼴·여백 확대
  useEffect(() => {
    document.documentElement.classList.toggle("demo", demoMode);
  }, [demoMode]);

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
          {running === "goal" ? "실행 중…" : "▶ 에이전트 실행"}
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
          onClick={() => guard("4block", () => runInjectionScenario())}
          title="에이전트가 인젝션에 속았다고 가정 — 공격자 주소로의 의도를 직접 제출해 정책 차단을 보인다"
        >
          {running === "4block" ? "실행 중…" : "④b 인젝션 (정책 차단)"}
        </button>
        <button disabled={running !== null} onClick={() => guard("reset", () => resetEnvelope())} className="ghost">
          봉투 리셋
        </button>
        <button onClick={() => setShowAll((v) => !v)} className="ghost">
          {showAll ? "이번 세션만" : "전체 이력"}
        </button>
        <button onClick={() => setDemoMode((v) => !v)} className="ghost" title="녹화용 — 글꼴·여백 확대">
          {demoMode ? "🎥 데모 모드 ON" : "데모 모드"}
        </button>
        {error && <span className="fail">{error}</span>}
      </div>

      <RunBanner running={running} events={visible} />

      <div className="grid">
        <EnvelopePanel status={status} />
        <AgentPanel events={visible} running={running !== null} />
        <PolicyPanel events={visible} />
        <TransactionPanel events={visible} />
      </div>

      <footer className="defense">
        3겹 방어 —
        <span> ① 에이전트 툴 제한(결제 툴 부재)</span> ·
        <span> ② 결정론 정책 엔진(LLM 호출 0회)</span> ·
        <span> ③ 온체인 위임 한도(공격자 주소는 인출 권한 없음)</span>
      </footer>
    </main>
  );
}

// ── ①·⑤ 실행 중 시나리오 배너 + 진행 단계·경과 초 ──────────────────────────
function RunBanner({ running, events }: { running: string | null; events: AuditEvent[] }) {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (!running) { setElapsed(0); return; }
    const t0 = Date.now();
    const timer = setInterval(() => setElapsed(Math.floor((Date.now() - t0) / 1000)), 200);
    return () => clearInterval(timer);
  }, [running]);

  if (!running) return null;

  // 마지막 이벤트에서 현재 단계를 유추 — 대기 구간이 "멈춘 화면"으로 보이지 않게
  const last = [...events].reverse().find((e) =>
    ["agent_started", "agent_step", "intent_received", "policy_decision", "payment_executed", "payment_blocked"].includes(e.type),
  );
  let phase = "에이전트 기동 중…";
  if (last?.type === "agent_started") phase = "판매자 탐색 중…";
  else if (last?.type === "agent_step" && last.step === "discover") phase = "견적 요청 중…";
  else if (last?.type === "agent_step" && last.step === "quote") phase = `견적 비교 중… (${String(last.seller_id)} 수신)`;
  else if (last?.type === "intent_received") phase = "정책 판정 중…";
  else if (last?.type === "policy_decision") {
    phase = (last.decision as { verdict: string }).verdict === "PASS" ? "온체인 결제 실행 중…" : "차단됨 — 마무리 중…";
  } else if (last?.type === "payment_executed") phase = "데이터 수령 중…";

  return (
    <div className="run-banner">
      <span className="spinner" />
      <strong>{RUNNING_LABEL[running] ?? running}</strong>
      <span className="phase">{phase}</span>
      <span className="elapsed">{elapsed}s</span>
    </div>
  );
}

// ── ③ 값 변화 하이라이트 + 델타 ────────────────────────────────────────────
function useDelta(value: number | null | undefined) {
  const prev = useRef<number | null>(null);
  const [delta, setDelta] = useState<number | null>(null);

  useEffect(() => {
    if (value === null || value === undefined) return;
    if (prev.current !== null && prev.current !== value) {
      setDelta(Number((value - prev.current).toFixed(6)));
      const timer = setTimeout(() => setDelta(null), 4000);
      prev.current = value;
      return () => clearTimeout(timer);
    }
    prev.current = value;
  }, [value]);

  return delta;
}

function Stat({ label, value, unit, delta, accent }: {
  label: string; value: React.ReactNode; unit?: React.ReactNode; delta: number | null; accent?: boolean;
}) {
  return (
    <div className="stat">
      <div className="label">{label}</div>
      <div className={`value ${accent ? "accent" : ""} ${delta !== null ? "changed" : ""}`}>
        {value}
        {unit && <span className="unit">{unit}</span>}
        {delta !== null && (
          <span className={delta < 0 ? "delta down" : "delta up"}>
            {delta < 0 ? "▼" : "▲"}{Math.abs(delta)}
          </span>
        )}
      </div>
    </div>
  );
}

function EnvelopePanel({ status }: { status: EnvelopeStatus | null }) {
  const remainingDelta = useDelta(status?.remaining);
  const delegatedDelta = useDelta(status?.onchain.delegated_remaining);
  const callsDelta = useDelta(status?.calls_today);

  return (
    <section className="panel">
      <h2>① 봉투 상태</h2>
      {!status ? (
        <p className="muted">executor 응답 대기…</p>
      ) : (
        <>
          <div className="stat-row">
            <Stat
              label="예산 잔액"
              value={status.remaining}
              unit={`/ ${status.envelope.budget.total} USDC-M`}
              delta={remainingDelta}
            />
            <Stat
              label="온체인 위임 잔량"
              value={status.onchain.delegated_remaining ?? "—"}
              delta={delegatedDelta}
              accent
            />
            <Stat label="건당 한도" value={status.envelope.budget.per_call_max} delta={null} />
            <Stat
              label="오늘 호출"
              value={status.calls_today}
              unit={`/ ${status.envelope.limits.max_calls_per_day}`}
              delta={callsDelta}
            />
          </div>
          <p style={{ marginTop: 10 }} className="muted">
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

function AgentPanel({ events, running }: { events: AuditEvent[]; running: boolean }) {
  // 최신이 위 — 녹화 중 스크롤 없이 최신 상황이 보이도록
  const feed = events
    .filter((e) => ["agent_started", "agent_step", "agent_finished", "intent_received"].includes(e.type))
    .slice()
    .reverse();
  return (
    <section className="panel">
      <h2>② Gemini 사고 로그 (라이브)</h2>
      {feed.length === 0 && !running && (
        <p className="muted">에이전트 실행 대기… 위 입력창에 목표를 넣고 실행하세요.</p>
      )}
      {feed.length === 0 && running && <p className="muted">에이전트 기동 중…</p>}
      {feed.map((e, i) => (
        <AgentEvent key={`${e.ts}-${i}`} e={e} />
      ))}
    </section>
  );
}

function AgentEvent({ e }: { e: AuditEvent }) {
  if (e.type === "agent_started") {
    return (
      <div className="event">
        <div className="ts">{fmtTime(e.ts)} · {String(e.run_id ?? "")}</div>
        <div className="accent">🎯 목표: {String(e.goal)}</div>
      </div>
    );
  }
  if (e.type === "agent_step" && e.step === "discover") {
    return <div className="event"><span className="muted">🔍 {String(e.detail)}</span></div>;
  }
  if (e.type === "agent_step" && e.step === "quote") {
    const note = String(e.note ?? "");
    const injected = note.includes("[SYSTEM]") || note.includes("무시하");
    return (
      <div className="event">
        <div>
          💬 견적 <span className="accent">{String(e.seller_id)}</span> ${String(e.price_usdc)} →{" "}
          {short(String(e.wallet))}{" "}
          {e.covers_query ? <span className="pass">(커버)</span> : <span className="muted">(미커버)</span>}
        </div>
        {note && injected && (
          <div className="injection-box">
            <div className="injection-title">⚠️ 프롬프트 인젝션 감지 — 판매자 응답에 심긴 지시문</div>
            <div className="injection-body">{note.slice(0, 240)}{note.length > 240 ? "…" : ""}</div>
          </div>
        )}
        {note && !injected && (
          <div className="muted note">note: {note.slice(0, 140)}{note.length > 140 ? "…" : ""}</div>
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
      <div className="event highlight">
        <div>
          ✔ 선택: <span className="accent">{intent.seller_id}</span> ${intent.quoted_price} → {short(intent.seller_wallet)}
        </div>
        <div className="rationale">“{intent.agent_rationale}”</div>
      </div>
    );
  }
  if (e.type === "agent_finished") {
    return <div className="event"><span className="muted">■ 에이전트 종료</span></div>;
  }
  return null;
}

function PolicyPanel({ events }: { events: AuditEvent[] }) {
  const decisions = events.filter((e) => e.type === "policy_decision").slice().reverse();
  return (
    <section className="panel">
      <h2>③ 정책 판정 — 검사한 규칙 전부 <span className="sub">LLM 호출 0회</span></h2>
      {decisions.length === 0 && <p className="muted">판정 대기…</p>}
      {decisions.map((e, i) => {
        const decision = e.decision as {
          verdict: string; ruleset_version: string; reasons: string[];
          checked_rules: Array<{ rule: string; result: string; detail: string }>;
        };
        return (
          <div className={`event ${i === 0 ? "highlight" : ""}`} key={`${e.ts}-${i}`}>
            <div className="ts">{fmtTime(e.ts)} · ruleset {decision.ruleset_version}</div>
            <div className="verdict-row">
              <span className={`badge big ${decision.verdict}`}>{decision.verdict}</span>
              {decision.reasons.length > 0 && <span className="fail">{decision.reasons.join(", ")}</span>}
            </div>
            <table className="rules">
              <tbody>
                {decision.checked_rules.map((rule) => (
                  <tr key={rule.rule} className={rule.result === "FAIL" ? "row-fail" : ""}>
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
    </section>
  );
}

function TransactionPanel({ events }: { events: AuditEvent[] }) {
  const txEvents = events
    .filter((e) => ["payment_executed", "payment_blocked", "payment_failed"].includes(e.type))
    .slice()
    .reverse();
  return (
    <section className="panel">
      <h2>④ 트랜잭션 <span className="sub">Solana devnet</span></h2>
      {txEvents.length === 0 && <p className="muted">결제 대기…</p>}
      {txEvents.map((e, i) => (
        <div className={`event ${i === 0 ? "highlight" : ""}`} key={`${e.ts}-${i}`}>
          <div className="ts">{fmtTime(e.ts)}</div>
          {e.type === "payment_executed" ? (
            <>
              <div className="pay-line">
                <span className="pass">✓ 결제 완료</span>
                <span className="amount">{String(e.amount_usdc)} USDC-M</span>
                <span className="muted">→ {short(String(e.pay_to))}</span>
              </div>
              <a className="explorer-btn" href={String(e.explorer_url)} target="_blank" rel="noreferrer">
                🔗 Solana Explorer에서 트랜잭션 확인
              </a>
              <div className="sig">{String(e.signature).slice(0, 32)}…</div>
            </>
          ) : e.type === "payment_blocked" ? (
            <div className="blocked-box">
              <div className="blocked-title">✕ 결제 차단 — 결제 0건</div>
              <div className="fail">{(e.reasons as string[]).join(", ")}</div>
            </div>
          ) : (
            <span className="fail">! 결제 실패 — {String(e.error)}</span>
          )}
        </div>
      ))}
    </section>
  );
}

const short = (addr: string) => (addr.length > 12 ? `${addr.slice(0, 4)}…${addr.slice(-4)}` : addr);
const fmtTime = (ts: string) => ts.slice(11, 19);
