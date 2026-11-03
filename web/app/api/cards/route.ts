// GET: my card tokens. POST: ask the vault to issue a card token (returns a tx to sign).
import { PublicKey } from "@solana/web3.js";
import { handle, ok, requireWallet, HttpError } from "@/lib/server/api";
import { load, mutate } from "@/lib/server/db";
import { getScoreProvider } from "@/lib/score";
import { DEFAULT_POLICY } from "@/lib/terms";
import { vaultKeypair } from "@/lib/server/keys";
import { blockhash, mintRent } from "@/lib/server/chain";
import { buildMintTx, toB64 } from "@/lib/server/txbuild";
import type { Grade } from "@/lib/types";

export const dynamic = "force-dynamic";

export const GET = handle(async () => {
  const wallet = requireWallet();
  const db = load();
  const provider = getScoreProvider();
  const open = new Set(["pending_deposit", "listed", "active"]);
  const mine = db.cards.filter((c) => c.owner === wallet && c.status === "minted");
  const out = await Promise.all(
    mine.map(async (c) => {
      const score = await provider.score(c.cardKey, c.grade);
      const loan = db.loans.find((l) => l.mint === c.mint && open.has(l.status));
      return { ...c, score, terms: score ? DEFAULT_POLICY.termsFor(score) : null, openLoanId: loan?.id ?? null, openLoanStatus: loan?.status ?? null };
    }),
  );
  return ok(out);
});

export const POST = handle(async (req) => {
  const wallet = requireWallet();
  const { cardKey, grade, certNumber } = await req.json();
  if (grade !== "raw" && grade !== "psa10") throw new HttpError(400, "grade must be raw or psa10");
  if (!(await getScoreProvider().score(cardKey, grade))) throw new HttpError(400, "Unknown card");
  if (grade === "psa10" && !/^\d{6,10}$/.test(String(certNumber || "")))
    throw new HttpError(400, "Enter the PSA cert number (6 to 10 digits).");

  const { blockhash: bh, lastValidBlockHeight } = await blockhash();
  const { tx, mint } = buildMintTx({
    owner: new PublicKey(wallet), vault: vaultKeypair(), mintRentLamports: await mintRent(),
    blockhash: bh, memoText: `hololend:mint:${cardKey}:${grade}`,
  });
  mutate((db) => {
    db.cards.push({
      mint: mint.toBase58(), owner: wallet, cardKey, grade: grade as Grade,
      certNumber: String(certNumber || ""), status: "pending", createdAt: new Date().toISOString(),
    });
  });
  return ok({ tx: toB64(tx), mint: mint.toBase58(), blockhash: bh, lastValidBlockHeight });
});
