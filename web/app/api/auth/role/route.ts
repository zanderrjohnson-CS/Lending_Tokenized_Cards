import { handle, ok, requireWallet, HttpError } from "@/lib/server/api";
import { mutate } from "@/lib/server/db";

export const POST = handle(async (req) => {
  const wallet = requireWallet();
  const { role } = await req.json();
  if (role !== "borrower" && role !== "lender") throw new HttpError(400, "role must be borrower or lender");
  mutate((db) => { (db.users[wallet] ??= { createdAt: new Date().toISOString() }).role = role; });
  return ok({ wallet, role });
});
