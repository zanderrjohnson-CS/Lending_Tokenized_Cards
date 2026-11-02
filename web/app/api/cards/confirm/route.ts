import { PublicKey } from "@solana/web3.js";
import { handle, ok, requireWallet, HttpError } from "@/lib/server/api";
import { load, mutate } from "@/lib/server/db";
import { mintIsOneOfOne, tokenBalance } from "@/lib/server/chain";

export const POST = handle(async (req) => {
  const wallet = requireWallet();
  const { mint, signature } = await req.json();
  const card = load().cards.find((c) => c.mint === mint && c.owner === wallet);
  if (!card) throw new HttpError(404, "No pending card with that mint");
  const m = new PublicKey(mint);
  const [bal, one] = await Promise.all([tokenBalance(new PublicKey(wallet), m), mintIsOneOfOne(m)]);
  if (bal !== 1 || !one) throw new HttpError(409, "Mint not confirmed on-chain yet. Wait a few seconds and retry.");
  mutate((db) => {
    const c = db.cards.find((x) => x.mint === mint)!;
    c.status = "minted";
    c.mintTx = signature;
  });
  return ok({ mint, status: "minted" });
});
