// One loan. POST {action, phase:"build"} returns a tx for the caller's wallet to sign;
// POST {action, phase:"confirm", signature} checks the chain and only then moves the status.
import { PublicKey } from "@solana/web3.js";
import { handle, ok, requireWallet, HttpError } from "@/lib/server/api";
import { load, mutate } from "@/lib/server/db";
import { escrowKeypair } from "@/lib/server/keys";
import { blockhash, tokenBalance, txHasTransfer } from "@/lib/server/chain";
import {
  buildCancelTx, buildClaimTx, buildDepositTx, buildFundTx, buildRepayTx, toB64,
} from "@/lib/server/txbuild";
import { LOCK_MS, lockedByOther, publicLoan, type LoanWithLock } from "@/lib/server/loans";

export const dynamic = "force-dynamic";

type Action = "deposit" | "fund" | "repay" | "claim" | "cancel";

export const GET = handle(async (_req, { params }) => {
  const loan = load().loans.find((l) => l.id === params.id);
  if (!loan) throw new HttpError(404, "Loan not found");
  return ok(publicLoan(loan as LoanWithLock));
});

export const POST = handle(async (req, { params }) => {
  const wallet = requireWallet();
  const { action, phase, signature } = (await req.json()) as { action: Action; phase: "build" | "confirm"; signature?: string };
  const loan = load().loans.find((l) => l.id === params.id) as LoanWithLock | undefined;
  if (!loan) throw new HttpError(404, "Loan not found");

  const me = new PublicKey(wallet);
  const mint = new PublicKey(loan.mint);
  const escrow = escrowKeypair();
  const borrower = new PublicKey(loan.borrower);
  const now = Date.now();
  const memoText = `hololend:${loan.id}:${action}`;

  // ---- permission + state checks shared by build and confirm ----
  const need = (cond: boolean, msg: string, status = 409) => { if (!cond) throw new HttpError(status, msg); };
  switch (action) {
    case "deposit":
      need(wallet === loan.borrower, "Only the borrower can deposit", 403);
      need(loan.status === "pending_deposit", `Loan is ${loan.status}`);
      break;
    case "fund":
      need(wallet !== loan.borrower, "You can't fund your own loan", 403);
      need(loan.status === "listed", `Loan is ${loan.status}`);
      need(!lockedByOther(loan, wallet, now), "Another wallet is funding or cancelling this loan right now. Try again in two minutes.");
      break;
    case "repay":
      need(wallet === loan.borrower, "Only the borrower can repay", 403);
      need(loan.status === "active", `Loan is ${loan.status}`);
      break;
    case "claim":
      need(wallet === loan.lender, "Only the lender can claim collateral", 403);
      need(loan.status === "active", `Loan is ${loan.status}`);
      need(now > Date.parse(loan.dueAt!), "The loan isn't past due yet");
      break;
    case "cancel":
      need(wallet === loan.borrower, "Only the borrower can cancel", 403);
      need(loan.status === "listed" || loan.status === "pending_deposit", `Loan is ${loan.status}`);
      need(!lockedByOther(loan, wallet, now), "A lender is funding this loan right now.");
      break;
    default:
      throw new HttpError(400, "Unknown action");
  }

  // ---- build ----
  if (phase === "build") {
    // Take the fund/cancel lock now, before any await, so two requests can't both pass the check above.
    // (Node runs this handler on one thread; nothing else can interleave until the first await.)
    if (action === "fund" || action === "cancel") update(loan.id, (l) => { l.lock = { by: wallet, action, until: now + LOCK_MS }; });
    try {
    // Cancelling before the deposit landed needs no transaction.
    if (action === "cancel" && loan.status === "pending_deposit" && (await tokenBalance(escrow.publicKey, mint)) === 0) {
      return ok({ done: true, loan: publicLoan(update(loan.id, (l) => close(l, "cancelled", "cancelled before deposit"))) });
    }
    const { blockhash: bh, lastValidBlockHeight } = await blockhash();
    const lender = loan.lender ? new PublicKey(loan.lender) : null;
    const tx =
      action === "deposit" ? buildDepositTx({ borrower, escrow: escrow.publicKey, mint, blockhash: bh, memoText })
      : action === "fund" ? buildFundTx({ lender: me, borrower, lamports: loan.principalLamports, blockhash: bh, memoText })
      : action === "repay" ? buildRepayTx({ borrower, lender: lender!, escrow, mint, lamports: loan.repayLamports, blockhash: bh, memoText })
      : action === "claim" ? buildClaimTx({ lender: me, borrower, escrow, mint, blockhash: bh, memoText })
      : buildCancelTx({ borrower, escrow, mint, blockhash: bh, memoText });
    return ok({ tx: toB64(tx), blockhash: bh, lastValidBlockHeight });
    } catch (e) {
      if (action === "fund" || action === "cancel") update(loan.id, (l) => { if (l.lock?.by === wallet) delete l.lock; });
      throw e;
    }
  }

  // ---- confirm: read the chain, never trust the client ----
  if (!signature) throw new HttpError(400, "signature required");
  if (load().usedSignatures.includes(signature)) throw new HttpError(409, "That transaction was already used");
  const retry = "Not confirmed on-chain yet. Wait a few seconds and retry.";

  if (action === "deposit") {
    need((await tokenBalance(escrow.publicKey, mint)) === 1, retry);
    return ok(publicLoan(update(loan.id, (l) => { l.status = "listed"; ev(l, "collateral_in_escrow", signature); }, signature, ["pending_deposit"])));
  }
  if (action === "fund") {
    need(await txHasTransfer(signature, wallet, loan.borrower, loan.principalLamports), "Couldn't find the principal transfer in that transaction.");
    return ok(publicLoan(update(loan.id, (l) => {
      l.status = "active"; l.lender = wallet; l.fundedAt = new Date().toISOString();
      l.dueAt = new Date(Date.now() + l.termSec * 1000).toISOString(); delete l.lock;
      ev(l, "funded", signature);
    }, signature, ["listed"])));
  }
  if (action === "repay") {
    need((await tokenBalance(borrower, mint)) === 1 && (await tokenBalance(escrow.publicKey, mint)) === 0, retry);
    return ok(publicLoan(update(loan.id, (l) => close(l, "repaid", "repaid; collateral returned", signature), signature, ["active"])));
  }
  if (action === "claim") {
    need((await tokenBalance(me, mint)) === 1, retry);
    return ok(publicLoan(update(loan.id, (l) => close(l, "defaulted", "defaulted; collateral to lender", signature), signature, ["active"])));
  }
  // cancel
  need((await tokenBalance(borrower, mint)) === 1 && (await tokenBalance(escrow.publicKey, mint)) === 0, retry);
  return ok(publicLoan(update(loan.id, (l) => close(l, "cancelled", "cancelled; collateral returned", signature), signature, ["listed", "pending_deposit"])));
});

function ev(l: LoanWithLock, kind: string, tx?: string, note?: string) {
  l.events.push({ at: new Date().toISOString(), kind, tx, note });
}
function close(l: LoanWithLock, status: LoanWithLock["status"], note: string, tx?: string) {
  l.status = status; l.closedAt = new Date().toISOString(); delete l.lock; ev(l, status, tx, note);
}
function update(id: string, fn: (l: LoanWithLock) => void, sig?: string, expect?: LoanWithLock["status"][]): LoanWithLock {
  return mutate((db) => {
    const l = db.loans.find((x) => x.id === id) as LoanWithLock;
    // Re-check inside the write: a concurrent request may have moved the loan or used this signature
    // while we were waiting on the RPC.
    if (sig && db.usedSignatures.includes(sig)) throw new HttpError(409, "That transaction was already used");
    if (expect && !expect.includes(l.status)) throw new HttpError(409, `Loan is ${l.status}`);
    fn(l);
    if (sig) db.usedSignatures.push(sig);
    if (l.status === "defaulted") {
      // The token now belongs to the lender, so it shows in their cards list.
      const c = db.cards.find((c) => c.mint === l.mint);
      if (c) c.owner = l.lender!;
    }
    return l;
  });
}
