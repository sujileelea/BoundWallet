// 봉투 런타임 상태 — spent(누적 지출)·calls(일자별 호출 수).
//
// 정본 분리: 봉투 "정의"(한도·allowlist)는 policy/rulesets가 정본이고,
// "상태"(spent/calls)는 이 파일이 정본이다. 정책 엔진은 상태를 갖지 않으므로
// executor가 상태를 입력값으로 공급한다(R3).
// 금액은 마이크로 단위 정수(USDC 6 decimals)로만 저장 — 부동소수점 누적 오차 차단.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

interface EnvelopeState {
  spent_micro: number;
  calls: Record<string, number>; // ISO 날짜(UTC) → 승인된 결제 건수
}

const STATE_PATH = join(import.meta.dirname, "state", "envelope-state.json");

function readAll(): Record<string, EnvelopeState> {
  if (!existsSync(STATE_PATH)) return {};
  return JSON.parse(readFileSync(STATE_PATH, "utf8"));
}

function writeAll(states: Record<string, EnvelopeState>): void {
  mkdirSync(dirname(STATE_PATH), { recursive: true });
  writeFileSync(STATE_PATH, JSON.stringify(states, null, 2) + "\n");
}

export function getState(
  envelopeId: string,
  dateUtc: string,
  initialSpentMicro: number,
): { spentMicro: number; callsToday: number } {
  const state = readAll()[envelopeId];
  if (!state) return { spentMicro: initialSpentMicro, callsToday: 0 };
  return { spentMicro: state.spent_micro, callsToday: state.calls[dateUtc] ?? 0 };
}

export function recordPayment(envelopeId: string, amountMicro: number, dateUtc: string): void {
  const states = readAll();
  const state = states[envelopeId] ?? { spent_micro: 0, calls: {} };
  state.spent_micro += amountMicro;
  state.calls[dateUtc] = (state.calls[dateUtc] ?? 0) + 1;
  states[envelopeId] = state;
  writeAll(states);
}

// 관리자 행위 시뮬레이션(시나리오 2의 "잔액을 0.3으로 만든 상태" 등).
// 정책 판정에는 관여하지 않는다 — 판정은 언제나 policy 서비스가 한다(R4).
export function setSpent(envelopeId: string, spentMicro: number): void {
  const states = readAll();
  const state = states[envelopeId] ?? { spent_micro: 0, calls: {} };
  state.spent_micro = spentMicro;
  states[envelopeId] = state;
  writeAll(states);
}
