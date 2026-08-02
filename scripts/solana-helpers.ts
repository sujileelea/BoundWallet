// devnet 스크립트 공용 헬퍼 — 키페어 영속화(solana CLI 호환 64바이트 JSON) + 트랜잭션 전송.

import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import {
  appendTransactionMessageInstructions,
  createKeyPairSignerFromBytes,
  createKeyPairSignerFromPrivateKeyBytes,
  createTransactionMessage,
  getAddressEncoder,
  getSignatureFromTransaction,
  pipe,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  signTransactionMessageWithSigners,
  type Instruction,
  type KeyPairSigner,
  type Rpc,
  type RpcSubscriptions,
  type SolanaRpcApi,
  type SolanaRpcSubscriptionsApi,
  sendAndConfirmTransactionFactory,
} from "@solana/kit";

export async function loadOrCreateKeypair(path: string): Promise<KeyPairSigner> {
  if (existsSync(path)) {
    const bytes = new Uint8Array(JSON.parse(readFileSync(path, "utf8")));
    return await createKeyPairSignerFromBytes(bytes);
  }
  const seed = new Uint8Array(randomBytes(32));
  const signer = await createKeyPairSignerFromPrivateKeyBytes(seed, true);
  const pubkeyBytes = new Uint8Array(getAddressEncoder().encode(signer.address));
  const full = new Uint8Array(64);
  full.set(seed, 0);
  full.set(pubkeyBytes, 32);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(Array.from(full)));
  console.log(`  키페어 생성: ${path} → ${signer.address}`);
  return signer;
}

export type Clients = {
  rpc: Rpc<SolanaRpcApi>;
  rpcSubscriptions: RpcSubscriptions<SolanaRpcSubscriptionsApi>;
};

export async function sendTx(
  clients: Clients,
  feePayer: KeyPairSigner,
  instructions: Instruction[],
): Promise<string> {
  const { value: latestBlockhash } = await clients.rpc.getLatestBlockhash().send();
  const message = pipe(
    createTransactionMessage({ version: 0 }),
    (m) => setTransactionMessageFeePayerSigner(feePayer, m),
    (m) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, m),
    (m) => appendTransactionMessageInstructions(instructions, m),
  );
  const signed = await signTransactionMessageWithSigners(message);
  await sendAndConfirmTransactionFactory(clients)(signed, { commitment: "confirmed" });
  return getSignatureFromTransaction(signed);
}

export const explorerTx = (sig: string) => `https://explorer.solana.com/tx/${sig}?cluster=devnet`;
export const explorerAddr = (addr: string) => `https://explorer.solana.com/address/${addr}?cluster=devnet`;
