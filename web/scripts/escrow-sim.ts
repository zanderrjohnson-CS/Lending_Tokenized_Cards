// Runs the real transaction builders from lib/server/txbuild.ts against LiteSVM, an in-process
// Solana runtime, so the escrow logic is tested without devnet. `npm run test:escrow`
import { makeSvm } from "./svm";
import { Keypair, LAMPORTS_PER_SOL, PublicKey, Transaction } from "@solana/web3.js";
import { AccountLayout, MINT_SIZE, MintLayout } from "@solana/spl-token";
import {
  ata, buildCancelTx, buildClaimTx, buildDepositTx, buildFundTx, buildMintTx, buildRepayTx,
} from "../lib/server/txbuild";

const svm = makeSvm();
const vault = Keypair.generate(), escrow = Keypair.generate();
const borrower = Keypair.generate(), lender = Keypair.generate(), mallory = Keypair.generate();
for (const k of [borrower, lender, mallory]) svm.airdrop(k.publicKey, 10 * LAMPORTS_PER_SOL);

let pass = 0, failN = 0;
const check = (name: string, cond: boolean) => { cond ? pass++ : failN++; console.log(`${cond ? "PASS" : "FAIL"}  ${name}`); };
const bh = () => svm.latestBlockhash();
const send = (tx: Transaction, ...signers: Keypair[]) => {
  tx.partialSign(...signers); // the user's wallet signature, added last like Phantom would
  const err = svm.send(tx);
  svm.expireBlockhash();
  return { ok: !err, err: err ?? "" };
};
const bal = (owner: PublicKey, mint: PublicKey) => {
  const a = svm.account(ata(owner, mint));
  return a ? Number(AccountLayout.decode(a.data).amount) : 0;
};
const sol = (k: PublicKey) => svm.balance(k);
const rent = svm.rent(MINT_SIZE);
const opts = { useMemo: true };

function mintCard(owner: Keypair) {
  const { tx, mint } = buildMintTx({ ...opts, owner: owner.publicKey, vault, mintRentLamports: rent, blockhash: bh(), memoText: "hololend:test" });
  const r = send(tx, owner);
  return { mint, r };
}

const which = process.argv[2];
let r: { ok: boolean; err: string };

if (which === "1") {
console.log("\n-- Scenario 1: mint, deposit, fund, repay --");
const { mint, r: m1 } = mintCard(borrower);
check("vault issues a card token to the borrower", m1.ok && bal(borrower.publicKey, mint) === 1);
const mi = MintLayout.decode(svm.account(mint)!.data);
check("token is 1-of-1 with mint authority burned", mi.supply === 1n && mi.decimals === 0 && mi.mintAuthorityOption === 0);

r = send(buildDepositTx({ ...opts, borrower: borrower.publicKey, escrow: escrow.publicKey, mint, blockhash: bh(), memoText: "hololend:test" }), borrower);
check("borrower deposits token into escrow", r.ok && bal(escrow.publicKey, mint) === 1 && bal(borrower.publicKey, mint) === 0);

const principal = 1 * LAMPORTS_PER_SOL, repay = 1.05 * LAMPORTS_PER_SOL;
const b0 = sol(borrower.publicKey);
r = send(buildFundTx({ ...opts, lender: lender.publicKey, borrower: borrower.publicKey, lamports: principal, blockhash: bh(), memoText: "hololend:test" }), lender);
check("lender funds: borrower receives principal", r.ok && sol(borrower.publicKey) - b0 === principal);

const l0 = sol(lender.publicKey);
const genuine = buildRepayTx({ ...opts, borrower: borrower.publicKey, lender: lender.publicKey, escrow, mint, lamports: repay, blockhash: bh(), memoText: "hololend:test" });
r = send(genuine, borrower);
if (!r.ok) console.log(r.err);
check("repay is atomic: lender paid AND token back to borrower", r.ok && sol(lender.publicKey) - l0 === repay && bal(borrower.publicKey, mint) === 1);
check("escrow token account closed after release", !svm.account(ata(escrow.publicKey, mint)));

}

if (which === "2") {
console.log("\n-- Scenario 2: repay with too little SOL leaves collateral in escrow --");
const poor = Keypair.generate(); svm.airdrop(poor.publicKey, 50_000_000);
const { mint: m2 } = mintCard(poor);
send(buildDepositTx({ ...opts, borrower: poor.publicKey, escrow: escrow.publicKey, mint: m2, blockhash: bh(), memoText: "hololend:test" }), poor);
r = send(buildRepayTx({ ...opts, borrower: poor.publicKey, lender: lender.publicKey, escrow, mint: m2, lamports: 5 * LAMPORTS_PER_SOL, blockhash: bh(), memoText: "hololend:test" }), poor);
check("underfunded repay fails and token stays in escrow", !r.ok && bal(escrow.publicKey, m2) === 1 && bal(poor.publicKey, m2) === 0);

console.log("\n-- Scenario 2b: borrower defaults, lender claims --");
r = send(buildClaimTx({ ...opts, lender: lender.publicKey, borrower: poor.publicKey, escrow, mint: m2, blockhash: bh(), memoText: "hololend:test" }), lender);
check("lender claims collateral after default", r.ok && bal(lender.publicKey, m2) === 1 && bal(escrow.publicKey, m2) === 0);

}

if (which === "3") {
console.log("\n-- Scenario 3: cancel before funding --");
const { mint: m3 } = mintCard(borrower);
send(buildDepositTx({ ...opts, borrower: borrower.publicKey, escrow: escrow.publicKey, mint: m3, blockhash: bh(), memoText: "hololend:test" }), borrower);
r = send(buildCancelTx({ ...opts, borrower: borrower.publicKey, escrow, mint: m3, blockhash: bh(), memoText: "hololend:test" }), borrower);
check("borrower cancels and gets token back", r.ok && bal(borrower.publicKey, m3) === 1);

}

if (which === "4") {
console.log("\n-- Scenario 4: release attempt without the escrow key --");
const { mint } = mintCard(borrower);
send(buildDepositTx({ ...opts, borrower: borrower.publicKey, escrow: escrow.publicKey, mint, blockhash: bh(), memoText: "hololend:test" }), borrower);
// Mallory tries to use an escrow-signed repay tx but with herself as recipient: impossible,
// the escrow signature covers the exact message. Simulate tampering by re-signing a modified copy.
const forged = buildRepayTx({ ...opts, borrower: mallory.publicKey, lender: lender.publicKey, escrow: Keypair.generate(), mint, lamports: 1, blockhash: bh(), memoText: "hololend:test" });
r = send(forged, mallory);
check("forged release without the escrow key fails", !r.ok && bal(escrow.publicKey, mint) === 1);

}

if (!which) {
  // parent: run every scenario in a child process
  const { spawnSync } = require("child_process");
  let bad = 0;
  for (const n of ["1", "2", "3", "4"]) {
    const r = spawnSync(process.execPath, [...process.execArgv, __filename, n], { stdio: "inherit" });
    if (r.status !== 0) bad++;
  }
  console.log(bad ? `\n${bad} scenario(s) failed` : "\nAll scenarios passed");
  process.exit(bad ? 1 : 0);
} else {
  process.exit(failN ? 1 : 0);
}
