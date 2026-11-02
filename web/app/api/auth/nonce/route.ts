import { PublicKey } from "@solana/web3.js";
import { handle, ok, HttpError } from "@/lib/server/api";
import { newNonce, signInMessage } from "@/lib/server/session";

export const dynamic = "force-dynamic";

export const GET = handle(async (req) => {
  const url = new URL(req.url);
  const wallet = url.searchParams.get("wallet") || "";
  try { new PublicKey(wallet); } catch { throw new HttpError(400, "Bad wallet address"); }
  const n = newNonce();
  return ok({ ...n, message: signInMessage(wallet, n.nonce, n.issuedAt, url.host) });
});
