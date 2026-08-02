// devnet 셋업 + 스파이크 S1·S3 실측 (HANDOFF §10, docs/decisions.md D1·D2).
//
// 하는 일 (재실행 안전):
//   1. 키페어 6개 생성/로드 — executor(executor/wallet/), admin·seller×3·attacker(scripts/keys/)
//   2. executor·admin SOL 에어드랍
//   3. 모사 USDC 민트 생성 (decimals 6, "USDC-M"으로 데모에서 명시 — S1 대안 경로)
//   4. ATA 생성(admin·seller×3·attacker) + admin에 1000 USDC-M 민트
//   5. S3: admin ATA → executor 주소로 ApproveChecked(50 USDC-M 한도 위임)
//   6. 위임 실측: executor가 delegate 권한으로 admin ATA → seller_a 0.05 전송
//   7. 한도 초과 실측: 위임 잔량 초과 전송이 온체인에서 거부되는지
//   8. scripts/devnet-addresses.json 기록 + 설정 파일 PLACEHOLDER 교체
//
// 실행: node scripts/devnet-setup.ts

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import {
  airdropFactory,
  createSolanaRpc,
  createSolanaRpcSubscriptions,
  generateKeyPairSigner,
  lamports,
  type KeyPairSigner,
} from "@solana/kit";
import { getCreateAccountInstruction } from "@solana-program/system";
import {
  TOKEN_PROGRAM_ADDRESS,
  fetchToken,
  findAssociatedTokenPda,
  getApproveCheckedInstruction,
  getCreateAssociatedTokenIdempotentInstructionAsync,
  getInitializeMintInstruction,
  getMintSize,
  getMintToInstruction,
  getTransferCheckedInstruction,
} from "@solana-program/token";

import { explorerAddr, explorerTx, loadOrCreateKeypair, sendTx, type Clients } from "./solana-helpers.ts";

const ROOT = join(import.meta.dirname, "..");
const ADDRESSES_PATH = join(ROOT, "scripts", "devnet-addresses.json");

const DECIMALS = 6;
const usdc = (n: number) => BigInt(Math.round(n * 1_000_000));

const clients: Clients = {
  rpc: createSolanaRpc("https://api.devnet.solana.com"),
  rpcSubscriptions: createSolanaRpcSubscriptions("wss://api.devnet.solana.com"),
};

// ── 1. 키페어 ────────────────────────────────────────────────────────────────
console.log("1. 키페어 준비");
const executor = await loadOrCreateKeypair(join(ROOT, "executor", "wallet", "executor-keypair.json"));
const admin = await loadOrCreateKeypair(join(ROOT, "scripts", "keys", "admin-keypair.json"));
const sellers: Record<string, KeyPairSigner> = {};
for (const id of ["seller_a", "seller_b", "seller_c"]) {
  sellers[id] = await loadOrCreateKeypair(join(ROOT, "scripts", "keys", `${id}-keypair.json`));
}
const attacker = await loadOrCreateKeypair(join(ROOT, "scripts", "keys", "attacker-keypair.json"));
console.log(`  executor=${executor.address}\n  admin=${admin.address}`);

// ── 2. SOL 에어드랍 ──────────────────────────────────────────────────────────
console.log("2. SOL 에어드랍 (잔액 0.5 SOL 미만일 때만)");
const airdrop = airdropFactory(clients);
for (const [label, signer] of [["executor", executor], ["admin", admin]] as const) {
  const { value: balance } = await clients.rpc.getBalance(signer.address).send();
  if (balance >= 500_000_000n) {
    console.log(`  ${label}: ${Number(balance) / 1e9} SOL 보유 — 스킵`);
    continue;
  }
  await airdrop({ recipientAddress: signer.address, lamports: lamports(1_000_000_000n), commitment: "confirmed" });
  console.log(`  ${label}: 1 SOL 에어드랍 완료`);
}

// ── 3. 모사 USDC 민트 ────────────────────────────────────────────────────────
console.log("3. 모사 USDC(USDC-M) 민트");
let saved: Record<string, string> = {};
try { saved = JSON.parse(readFileSync(ADDRESSES_PATH, "utf8")); } catch {}

let mintAddress = saved.mint;
if (!mintAddress) {
  const mint = await generateKeyPairSigner();
  const space = BigInt(getMintSize());
  const rent = await clients.rpc.getMinimumBalanceForRentExemption(space).send();
  const sig = await sendTx(clients, admin, [
    getCreateAccountInstruction({
      payer: admin,
      newAccount: mint,
      lamports: rent,
      space,
      programAddress: TOKEN_PROGRAM_ADDRESS,
    }),
    getInitializeMintInstruction({
      mint: mint.address,
      decimals: DECIMALS,
      mintAuthority: admin.address,
      freezeAuthority: null,
    }),
  ]);
  mintAddress = mint.address;
  console.log(`  민트 생성: ${mintAddress}\n  tx: ${explorerTx(sig)}`);
} else {
  console.log(`  기존 민트 재사용: ${mintAddress}`);
}

// ── 4. ATA + 초기 자금 ───────────────────────────────────────────────────────
console.log("4. ATA 생성 + admin 1000 USDC-M");
const mintAddr = mintAddress as Parameters<typeof findAssociatedTokenPda>[0]["mint"];
async function ata(owner: string) {
  const [addr] = await findAssociatedTokenPda({
    mint: mintAddr,
    owner: owner as Parameters<typeof findAssociatedTokenPda>[0]["owner"],
    tokenProgram: TOKEN_PROGRAM_ADDRESS,
  });
  return addr;
}
const ataIxs = [];
for (const owner of [admin.address, sellers.seller_a.address, sellers.seller_b.address, sellers.seller_c.address, attacker.address]) {
  ataIxs.push(await getCreateAssociatedTokenIdempotentInstructionAsync({ payer: admin, mint: mintAddr, owner }));
}
const adminAta = await ata(admin.address);
const adminToken = await clients.rpc.getAccountInfo(adminAta, { encoding: "base64" }).send();
const needsFunding = adminToken.value === null;
if (needsFunding) {
  ataIxs.push(getMintToInstruction({ mint: mintAddr, token: adminAta, mintAuthority: admin, amount: usdc(1000) }));
}
const sigAta = await sendTx(clients, admin, ataIxs);
console.log(`  완료 tx: ${explorerTx(sigAta)}`);

// ── 5. S3: ApproveChecked — executor를 delegate로, 한도 50 USDC-M ─────────────
console.log("5. S3 위임: admin ATA → executor, 한도 50 USDC-M");
const sigApprove = await sendTx(clients, admin, [
  getApproveCheckedInstruction({
    source: adminAta,
    mint: mintAddr,
    delegate: executor.address,
    owner: admin,
    amount: usdc(50),
    decimals: DECIMALS,
  }),
]);
console.log(`  tx: ${explorerTx(sigApprove)}`);

const after = await fetchToken(clients.rpc, adminAta);
const delegateInfo = after.data.delegate;
console.log(`  실측 — delegate: ${JSON.stringify(delegateInfo)}, delegatedAmount: ${after.data.delegatedAmount}`);

// ── 6. 위임 전송 실측: executor(delegate)가 admin ATA에서 seller_a로 0.05 ──────
console.log("6. 위임 전송 실측: executor가 admin 자금 0.05 USDC-M → seller_a");
const sellerAAta = await ata(sellers.seller_a.address);
const sigTransfer = await sendTx(clients, executor, [
  getTransferCheckedInstruction({
    source: adminAta,
    mint: mintAddr,
    destination: sellerAAta,
    authority: executor,
    amount: usdc(0.05),
    decimals: DECIMALS,
  }),
]);
console.log(`  tx: ${explorerTx(sigTransfer)}`);

// ── 7. 한도 초과 실측: 위임 잔량 초과 전송은 온체인에서 거부되어야 한다 ─────────
console.log("7. 한도 초과 전송 실측 (60 USDC-M > 위임 잔량 — 실패해야 정상)");
try {
  await sendTx(clients, executor, [
    getTransferCheckedInstruction({
      source: adminAta,
      mint: mintAddr,
      destination: sellerAAta,
      authority: executor,
      amount: usdc(60),
      decimals: DECIMALS,
    }),
  ]);
  console.error("  ❌ 초과 전송이 성공해버림 — S3 전제 붕괴, 원인 조사 필요");
  process.exit(1);
} catch (e) {
  console.log(`  ✅ 온체인 거부 확인: ${(e as Error).message.slice(0, 120)}`);
}

// ── 8. 주소 기록 + 설정 파일 PLACEHOLDER 교체 ─────────────────────────────────
console.log("8. 주소 기록 + 설정 파일 교체");
const addresses = {
  network: "solana-devnet",
  mint: mintAddress,
  mint_note: "모사 USDC(USDC-M) — 데모에서 명시 (S1 대안 경로)",
  executor: executor.address,
  admin: admin.address,
  admin_ata: adminAta,
  seller_a: sellers.seller_a.address,
  seller_b: sellers.seller_b.address,
  seller_c: sellers.seller_c.address,
  attacker: attacker.address,
  explorer: { admin_ata: explorerAddr(adminAta), mint: explorerAddr(mintAddress) },
};
writeFileSync(ADDRESSES_PATH, JSON.stringify(addresses, null, 2) + "\n");

const replacements: Record<string, string> = {
  PLACEHOLDER_SELLER_A_WALLET: sellers.seller_a.address,
  PLACEHOLDER_SELLER_B_WALLET: sellers.seller_b.address,
  PLACEHOLDER_SELLER_C_WALLET: sellers.seller_c.address,
  PLACEHOLDER_EXECUTOR_WALLET: executor.address,
  ATTACKER_WALLET_PLACEHOLDER: attacker.address,
};
for (const rel of ["policy/rulesets/env_001.yaml", "seller/config/sellers.json", "seller/data/evidence.seller_b.json"]) {
  const path = join(ROOT, rel);
  let text = readFileSync(path, "utf8");
  for (const [from, to] of Object.entries(replacements)) text = text.replaceAll(from, to);
  writeFileSync(path, text);
  console.log(`  교체: ${rel}`);
}

console.log("\n셋업 완료. scripts/devnet-addresses.json 참조.");
