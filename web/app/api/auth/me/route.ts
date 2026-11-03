import { handle, ok } from "@/lib/server/api";
import { getWallet } from "@/lib/server/session";
import { load } from "@/lib/server/db";

export const dynamic = "force-dynamic";

export const GET = handle(async () => {
  const wallet = getWallet();
  if (!wallet) return ok({ wallet: null, role: null });
  return ok({ wallet, role: load().users[wallet]?.role ?? null });
});
