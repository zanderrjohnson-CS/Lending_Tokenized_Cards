// GET: loans (market = listed by others, mine = as borrower, lending = as lender).
// POST: create a loan request on one of my card tokens; returns the escrow deposit tx.
import { PublicKey } from "@solana/web3.js";
import { handle, ok, requireWallet, HttpError } from "@/lib/server/api";
import { load, mutate } from "@/lib/server/db";
import { getScoreProvider } from "@/lib/score";
import { DEFAULT_POLICY, aprAt, defaultProbAt, repayAmount } from "@/lib/terms";
import { escrowKeypair } from "@/lib/server/keys";
import { blockhash, tokenBalance } from "@/lib/server/chain";
import { buildDepositTx, toB64 } from "@/lib/server/txbuild";
import { OPEN, publicLoan } from "@/lib/server/loans";
import { SOL_USD, usdToLamports } from "@/lib/config";
import { getWallet } from "@/lib/server/session";
import type { Loan } from "@/lib/types";
import crypto from "crypto";

export const dynamic = "force-dynamic";

export const GET = handle(async (req) => {
  const scope = new URL(req.url).searchParams.get("scope") || "market";
  const wallet = getWallet();
  const loans = load().loans;
  let out: Loan[];
  if (scope === "market") out = loans.filter((l) => l.status === "listed");
  else if (!wallet) throw new HttpError(401, "Sign in first");
  else if (scope === "mine") out = loans.filter((l) => l.borrower === wallet);
  else if (scope === "lending") out = loans.filter((l) => l.lender === wallet);
  else throw new HttpError(400, "scope must be market, mine or lending");
  return ok(out.map(publicLoan).sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
});

export const POST = handle(async (req) => {
  const wallet = requireWallet();
  const { mint, principalLamports, termSec } = await req.json();
  const db = load();
  const card = db.cards.find((c) => c.mint === mint && c.status === "minted");
  if (!card || card.owner !== wallet) throw new HttpError(404, "That card token isn't yours.");
  if (db.loans.some((l) => l.mint === mint && OPEN.has(l.status))) throw new HttpError(409, "This card already backs an open loan.");
  if ((await tokenBalance(new PublicKey(wallet), new PublicKey(mint))) !== 1)
    throw new HttpError(409, "Your wallet doesn't hold this card token right now.");

  // Server-side quote is authoritative: the browser's numbers are only a preview.
  const score = await getScoreProvider().score(card.cardKey, card.grade);
  if (!score) throw new HttpError(400, "No score for this card");
  const terms = DEFAULT_POLICY.termsFor(score);
  if (!(terms.maxLoanUsd > 0)) throw new HttpError(400, "No suggested price for this card yet");
  if (!terms.termOptionsSec.includes(Number(termSec))) throw new HttpError(400, "Term not offered");
  const maxLamports = usdToLamports(terms.maxLoanUsd);
  const p = Math.floor(Number(principalLamports));
  if (!(p > 0) || p > maxLamports) throw new HttpError(400, `Principal must be between 0 and ${maxLamports} lamports`);
  // The rate depends on how much of the price is borrowed (the model's curve), so compute it here.
  const principalUsd = (p / 1e9) * SOL_USD;
  const apr = aprAt(terms, principalUsd);

  const loan: Loan = {
    id: crypto.randomBytes(5).toString("hex"),
    mint, cardKey: card.cardKey, grade: card.grade, borrower: wallet, status: "pending_deposit",
    score: score.score, scoreSource: score.source, suggestedPriceUsd: score.suggestedPriceUsd,
    priceBasis: score.priceBasis, defaultProb90d: defaultProbAt(terms, principalUsd) ?? score.defaultProb90d,
    ltv: Math.round((p / usdToLamports(score.suggestedPriceUsd)) * 1000) / 1000,
    aprPct: apr, termSec: Number(termSec), principalLamports: p,
    repayLamports: repayAmount(p, apr, Number(termSec), terms.minInterestPct),
    solUsd: SOL_USD, createdAt: new Date().toISOString(),
    events: [{ at: new Date().toISOString(), kind: "created", note: `Score ${score.score}, suggested price $${score.suggestedPriceUsd}, ${terms.policy}` }],
  };
  mutate((d) => { d.loans.push(loan); });

  const { blockhash: bh, lastValidBlockHeight } = await blockhash();
  const tx = buildDepositTx({
    borrower: new PublicKey(wallet), escrow: escrowKeypair().publicKey, mint: new PublicKey(mint),
    blockhash: bh, memoText: `hololend:${loan.id}:deposit`,
  });
  return ok({ loan: publicLoan(loan), tx: toB64(tx), blockhash: bh, lastValidBlockHeight });
});
