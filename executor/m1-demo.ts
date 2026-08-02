// M1 데모 실행기 — 하드코딩 x402 왕복 (Gemini·정책 엔진 없이, HANDOFF §8 M1).
// 완료 조건: 출력된 Explorer 링크에서 트랜잭션이 조회된다.
//
// 실행: node executor/m1-demo.ts [sellerUrl] [query]

import { purchaseViaX402 } from "./x402-client.ts";

const sellerUrl = process.argv[2] ?? "http://localhost:4001";
const query = process.argv[3] ?? "retinol wrinkle reduction clinical evidence, US/EU";

console.log(`M1 결제 루프 시작 — seller: ${sellerUrl}`);
console.log(`질의: ${query}\n`);

const result = await purchaseViaX402(sellerUrl, query);

console.log(`결제 완료: ${result.amount_usdc} USDC-M → ${result.offer.payTo}`);
console.log(`서명: ${result.signature}`);
console.log(`Explorer: ${result.explorer_url}\n`);
console.log("수신 데이터:");
console.log(JSON.stringify(result.response, null, 2));
