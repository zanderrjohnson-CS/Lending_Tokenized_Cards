import { NextResponse } from "next/server";
import { getWallet } from "./session";

export const ok = (data: unknown) => NextResponse.json(data);
export const fail = (status: number, error: string) => NextResponse.json({ error }, { status });

export class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export function requireWallet(): string {
  const w = getWallet();
  if (!w) throw new HttpError(401, "Sign in with your wallet first.");
  return w;
}

export function handle(fn: (req: Request, ctx: any) => Promise<Response>) {
  return async (req: Request, ctx: any) => {
    try {
      return await fn(req, ctx);
    } catch (e: any) {
      if (e instanceof HttpError) return fail(e.status, e.message);
      console.error(e);
      const msg = String(e?.message || e);
      if (/fetch failed|ECONNREFUSED|ENOTFOUND|429/.test(msg))
        return fail(502, "Could not reach the Solana RPC. Check RPC_URL / network and try again.");
      return fail(500, msg);
    }
  };
}
