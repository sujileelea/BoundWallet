// 유일한 키 보유 지점 (HANDOFF R1). agent 프로세스는 이 모듈을 절대 import하지 않는다
// — agent는 Python이며 이 레포의 /agent에는 지갑 접근 코드가 존재할 수 없다.
//
// 키 출처 우선순위:
//   1. 환경변수 EXECUTOR_KEYPAIR (64-int JSON 배열) — Cloud Run에서 Secret Manager로 주입.
//   2. executor/wallet/executor-keypair.json 파일 — 로컬 개발.
// 어느 경우에도 키는 이 서비스 밖으로 나가지 않는다.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { createKeyPairSignerFromBytes, type KeyPairSigner } from "@solana/kit";

const KEYPAIR_PATH = join(import.meta.dirname, "wallet", "executor-keypair.json");

function loadKeypairBytes(): Uint8Array {
  const fromEnv = process.env.EXECUTOR_KEYPAIR;
  if (fromEnv && fromEnv.trim().startsWith("[")) {
    return new Uint8Array(JSON.parse(fromEnv));
  }
  if (existsSync(KEYPAIR_PATH)) {
    return new Uint8Array(JSON.parse(readFileSync(KEYPAIR_PATH, "utf8")));
  }
  throw new Error(
    "executor 키페어 없음 — 로컬은 scripts/devnet-setup.ts 실행, 클라우드는 EXECUTOR_KEYPAIR 시크릿 주입",
  );
}

export async function loadExecutorSigner(): Promise<KeyPairSigner> {
  return await createKeyPairSignerFromBytes(loadKeypairBytes());
}
