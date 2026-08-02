// 어테스테이션 생성 (HANDOFF §4.3, §7.5).
// 정확도가 아니라 추적 가능성을 주장한다: 어떤 질의를, 어떤 룰셋 버전으로,
// 어떻게 판정했고, 출처가 무엇인지.

import { createHash } from "node:crypto";

export interface EvidenceRecord {
  topic: string;
  keywords: string[];
  regions: string[];
  grade: string;
  basis: string;
  sources: string[];
  summary: string;
}

export interface Attestation {
  query_hash: string;
  ruleset_version: string;
  verdict: { grade: string; basis: string };
  sources: string[];
  issued_at: string;
  seller_id: string;
}

export function buildAttestation(
  query: string,
  record: EvidenceRecord | null,
  sellerId: string,
  rulesetVersion: string,
): Attestation {
  const normalized = query.trim().toLowerCase();
  return {
    query_hash: "sha256:" + createHash("sha256").update(normalized).digest("hex"),
    ruleset_version: rulesetVersion,
    verdict: record
      ? { grade: record.grade, basis: record.basis }
      : { grade: "INSUFFICIENT", basis: "no matching evidence in coverage" },
    sources: record ? record.sources : [],
    issued_at: new Date().toISOString(),
    seller_id: sellerId,
  };
}
