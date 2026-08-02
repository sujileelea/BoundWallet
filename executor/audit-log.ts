// 감사 로그 (HANDOFF §6.1 Firestore 자리, docs/decisions.md D7).
// 지금은 append-only JSONL. GCP 준비 후 FirestoreSink를 추가해 교체한다.
// UI(M6)는 이 로그를 SSE로 스트리밍한다.

import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

export interface AuditEntry {
  ts: string;
  type:
    | "intent_received"
    | "policy_decision"
    | "payment_executed"
    | "payment_blocked"
    | "payment_failed"
    | "data_received";
  intent_id: string;
  [key: string]: unknown;
}

export interface AuditSink {
  append(entry: AuditEntry): void;
}

export class JsonlSink implements AuditSink {
  private path: string;

  constructor(path: string) {
    this.path = path;
    mkdirSync(dirname(path), { recursive: true });
  }

  append(entry: AuditEntry): void {
    appendFileSync(this.path, JSON.stringify(entry) + "\n");
    console.log(`[audit] ${entry.type} ${entry.intent_id}`);
  }
}
