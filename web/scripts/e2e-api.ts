// End-to-end test of the API routes + escrow against scripts/rpc-shim.ts.
// Usage: start the shim, start Next with RPC_URL_SERVER=http://localhost:8899, then:
//   npx tsx scripts/e2e-api.ts http://localhost:3100 http://localhost:8899 [repay|default|cancel]
import fs from "fs";
import path from "path";
import { Connection, Keypair, LAMPORTS_PER_SOL, Transaction } from "@solana/web3.js";
import nacl from "tweetnacl";
import bs58 from "bs58";

const [B, RPC, mode = "repay"] = process.argv.slice(2);
const conn = new Connection(RPC, "confirmed");
let pass = 0, fail = 0;
const check = (n: string, c: boolean, extra?: unknown) => { c ? pass++ : fail++; console.log(`${c ? "PASS" : "FAIL"}  ${n}`, c ? "" : extra ?? ""); };

async function login(kp: Keypair) {
  const w = kp.publicKey.toBase58();
  const n = await (await fetch(`${B}/api/auth/nonce?wallet=${w}`)).json();
  const signature = bs58.encode(nacl.sign.detached(new TextEncoder().encode(n.message), kp.secretKey));
  const r = await fetch(`${B}/api/auth/verify`, { method: "POST", body: JSON.stringify({ wallet: w, nonce: n.nonce, issuedAt: n.issuedAt, mac: n.mac, signature }) });
  const cookie = r.headers.get("set-cookie")!.split(";")[0];
  return async (p: string, body?: unknown) => {
    const res = await fetch(`${B}${p}`, { method: body ? "POST" : "GET", headers: { cookie }, body: body ? JSON.stringify(body) : undefined });
    return { status: res.status, json: await res.json() };
  };
}
async function signSend(kp: Keypair, b64: string) {
  const tx = Transaction.from(Buffer.from(b64, "base64"));
  tx.partialSign(kp); // what the wallet does
  return conn.sendRawTransaction(tx.serialize());
}

(async () => {
  const borrower = Keypair.generate(), lender = Keypair.generate();
  await conn.requestAirdrop(borrower.publicKey, 5 * LAMPORTS_PER_SOL);
  await conn.requestAirdrop(lender.publicKey, 50 * LAMPORTS_PER_SOL);
  const asB = await login(borrower), asL = await login(lender);

  // tokenize
  let r = await asB("/api/cards", { cardKey: "base-charizard", grade: "raw" });
  check("vault builds mint tx", r.status === 200, r.json);
  const mint = r.json.mint;
  let sig = await signSend(borrower, r.json.tx);
  r = await asB("/api/cards/confirm", { mint, signature: sig });
  check("server verifies 1-of-1 token on-chain", r.status === 200 && r.json.status === "minted", r.json);
  r = await asB("/api/cards");
  check("card shows with suggested price, max loan ~90% of it, APR from score",
    r.json.length === 1 && Math.abs(r.json[0].terms.maxLoanUsd / r.json[0].score.suggestedPriceUsd - 0.9) < 0.01 && r.json[0].terms.aprPct > 8, r.json);
  const maxLam = Math.floor((r.json[0].terms.maxLoanUsd / 150) * 1e9);

  // over-borrow is rejected server-side
  r = await asB("/api/loans", { mint, principalLamports: maxLam + 1e7, termSec: 300 });
  check("principal above max LTV rejected", r.status === 400, r.json);
  r = await asL("/api/loans", { mint, principalLamports: 1000, termSec: 300 });
  check("someone else can't pledge my card", r.status === 404, r.json);

  r = await asB("/api/loans", { mint, principalLamports: Math.floor(maxLam / 2), termSec: 300 });
  check("loan created, deposit tx returned", r.status === 200 && r.json.loan.status === "pending_deposit", r.json);
  const id = r.json.loan.id, repayLam = r.json.loan.repayLamports, principal = r.json.loan.principalLamports;
  r = await asB(`/api/loans/${id}`, { action: "deposit", phase: "confirm", signature: "fake" });
  check("deposit confirm refused before the tx lands", r.status === 409, r.json);
  sig = await signSend(borrower, (await asB(`/api/loans/${id}`, { action: "deposit", phase: "build" })).json.tx);
  r = await asB(`/api/loans/${id}`, { action: "deposit", phase: "confirm", signature: sig });
  check("collateral in escrow -> listed", r.json.status === "listed", r.json);
  r = await asL("/api/loans?scope=market");
  check("lender sees it in the marketplace", r.json.some((l: any) => l.id === id));

  if (mode === "cancel") {
    r = await asB(`/api/loans/${id}`, { action: "cancel", phase: "build" });
    sig = await signSend(borrower, r.json.tx);
    r = await asB(`/api/loans/${id}`, { action: "cancel", phase: "confirm", signature: sig });
    check("cancel returns card", r.json.status === "cancelled", r.json);
    return done();
  }

  r = await asB(`/api/loans/${id}`, { action: "fund", phase: "build" });
  check("borrower can't fund own loan", r.status === 403, r.json);
  r = await asL(`/api/loans/${id}`, { action: "fund", phase: "build" });
  const fundTx = r.json.tx;
  r = await asB(`/api/loans/${id}`, { action: "cancel", phase: "build" });
  check("borrower can't cancel while a lender is funding", r.status === 409, r.json);
  const bBefore = await conn.getBalance(borrower.publicKey);
  sig = await signSend(lender, fundTx);
  r = await asL(`/api/loans/${id}`, { action: "fund", phase: "confirm", signature: sig });
  check("fund verified -> active", r.json.status === "active" && r.json.lender === lender.publicKey.toBase58(), r.json);
  check("borrower received principal", (await conn.getBalance(borrower.publicKey)) - bBefore === principal);
  r = await asL(`/api/loans/${id}`, { action: "fund", phase: "confirm", signature: sig });
  check("same signature can't be replayed", r.status === 409, r.json);

  r = await asL(`/api/loans/${id}`, { action: "claim", phase: "build" });
  check("lender can't claim before due", r.status === 409, r.json);

  if (mode === "repay") {
    const lBefore = await conn.getBalance(lender.publicKey);
    r = await asB(`/api/loans/${id}`, { action: "repay", phase: "build" });
    sig = await signSend(borrower, r.json.tx);
    r = await asB(`/api/loans/${id}`, { action: "repay", phase: "confirm", signature: sig });
    check("repay -> repaid", r.json.status === "repaid", r.json);
    check("lender received principal + interest", (await conn.getBalance(lender.publicKey)) - lBefore === repayLam);
    r = await asB("/api/cards");
    check("card back with borrower, no open loan", r.json[0].openLoanId === null);
  } else {
    // fast-forward the due date in the store
    const f = path.join(process.env.DATA_DIR!, "db.json");
    const db = JSON.parse(fs.readFileSync(f, "utf8"));
    db.loans.find((l: any) => l.id === id).dueAt = new Date(Date.now() - 1000).toISOString();
    fs.writeFileSync(f, JSON.stringify(db));
    r = await asB(`/api/loans/${id}`, { action: "claim", phase: "build" });
    check("borrower can't claim", r.status === 403, r.json);
    r = await asL(`/api/loans/${id}`, { action: "claim", phase: "build" });
    sig = await signSend(lender, r.json.tx);
    r = await asL(`/api/loans/${id}`, { action: "claim", phase: "confirm", signature: sig });
    check("claim -> defaulted", r.json.status === "defaulted", r.json);
    r = await asL("/api/cards");
    check("card token now listed under the lender", r.json.length === 1 && r.json[0].mint === mint, r.json);
  }
  done();
})().catch((e) => { console.error(e); process.exit(1); });

function done() { console.log(`${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0); }
