"use client";
import { Connection, Transaction } from "@solana/web3.js";
import type { WalletContextState } from "@solana/wallet-adapter-react";

export async function api<T = any>(path: string, body?: unknown): Promise<T> {
  const r = await fetch(path, {
    method: body === undefined ? "GET" : "POST",
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: "no-store",
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `Request failed (${r.status})`);
  return j as T;
}

const b64ToBytes = (b64: string) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));

/** Sign a server-built (possibly escrow/vault co-signed) tx with the wallet, send it, wait for confirmation. */
export async function signAndSend(
  wallet: WalletContextState, connection: Connection,
  built: { tx: string; blockhash: string; lastValidBlockHeight: number },
): Promise<string> {
  if (!wallet.signTransaction) throw new Error("This wallet can't sign transactions");
  const tx = Transaction.from(b64ToBytes(built.tx));
  const signed = await wallet.signTransaction(tx);
  const sig = await connection.sendRawTransaction(signed.serialize(), { skipPreflight: false });
  await waitForSignature(connection, sig, built.lastValidBlockHeight);
  return sig;
}

/** Poll for confirmation over HTTP (more reliable than websockets on public devnet RPCs). */
export async function waitForSignature(connection: Connection, sig: string, lastValidBlockHeight?: number, timeoutMs = 90_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const { value } = await connection.getSignatureStatuses([sig]);
    const st = value[0];
    if (st?.err) throw new Error(`Transaction failed: ${JSON.stringify(st.err)}`);
    if (st && (st.confirmationStatus === "confirmed" || st.confirmationStatus === "finalized")) return;
    if (lastValidBlockHeight && (await connection.getBlockHeight("confirmed")) > lastValidBlockHeight)
      throw new Error("Transaction expired before it confirmed. Please try again.");
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error("Timed out waiting for confirmation");
}

/** Confirm endpoints can lag the RPC by a moment; retry a few times. */
export async function confirmWithRetry<T>(fn: () => Promise<T>, tries = 6): Promise<T> {
  let last: any;
  for (let i = 0; i < tries; i++) {
    try { return await fn(); } catch (e: any) {
      last = e;
      if (!/not confirmed/i.test(e.message)) throw e;
      await new Promise((r) => setTimeout(r, 1500));
    }
  }
  throw last;
}

export const short = (a?: string | null, n = 4) => (a ? `${a.slice(0, n)}…${a.slice(-n)}` : "");
export const sol = (lamports: number, d = 3) => (lamports / 1e9).toLocaleString(undefined, { maximumFractionDigits: d });
export const usd = (v: number) => v.toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: v < 100 ? 2 : 0 });
