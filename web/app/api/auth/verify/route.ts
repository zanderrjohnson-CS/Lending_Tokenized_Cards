import { handle, ok, HttpError } from "@/lib/server/api";
import { setSession, verifySignIn } from "@/lib/server/session";
import { mutate } from "@/lib/server/db";

export const POST = handle(async (req) => {
  const body = await req.json();
  const host = new URL(req.url).host;
  if (!verifySignIn({ ...body, host })) throw new HttpError(401, "Signature did not verify. Try signing in again.");
  const user = mutate((db) => (db.users[body.wallet] ??= { createdAt: new Date().toISOString() }));
  setSession(body.wallet);
  return ok({ wallet: body.wallet, role: user.role ?? null });
});
