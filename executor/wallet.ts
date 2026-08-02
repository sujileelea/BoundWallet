// 유일한 키 보유 지점 (HANDOFF R1). agent 프로세스는 이 모듈을 절대 import하지 않는다
// — agent는 Python이며 이 레포의 /agent에는 지갑 접근 코드가 존재할 수 없다.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { createKeyPairSignerFromBytes, type KeyPairSigner } from "@solana/kit";

const KEYPAIR_PATH = join(import.meta.dirname, "wallet", "executor-keypair.json");

export async function loadExecutorSigner(): Promise<KeyPairSigner> {
  if (!existsSync(KEYPAIR_PATH)) {
    throw new Error("executor 키페어 없음 — scripts/devnet-setup.ts를 먼저 실행하세요");
  }
  const bytes = new Uint8Array(JSON.parse(readFileSync(KEYPAIR_PATH, "utf8")));
  return await createKeyPairSignerFromBytes(bytes);
}
