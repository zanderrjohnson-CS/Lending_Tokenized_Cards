"use client";
import { Connection, Transaction, VersionedTransaction } from "@solana/web3.js";
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
  // Dry-run on devnet before the wallet sees it, so the user gets the real reason instead of a
  // wallet's generic "failed to simulate" warning.
  await preflight(connection, tx);
  let signed: Transaction;
  try {
    signed = await wallet.signTransaction(tx);
  } catch (e: any) {
    if (/reject|cancel|denied|closed/i.test(String(e?.message ?? e))) throw new Error("You cancelled the request in your wallet.");
    throw e;
  }
  const sig = await connection.sendRawTransaction(signed.serialize(), { skipPreflight: false });
  await waitForSignature(connection, sig, built.lastValidBlockHeight);
  return sig;
}

export const NETWORK_HINT =
  "If your wallet warns that it failed to simulate, set it to Devnet (Phantom: Settings > Developer Settings > Testnet Mode > Solana Devnet).";

async function preflight(connection: Connection, tx: Transaction) {
  const payer = tx.feePayer!;
  const bal = await connection.getBalance(payer, "confirmed").catch(() => null);
  if (bal === 0) throw new Error(`Your wallet has no devnet SOL to pay the network fee. Use "+ airdrop" in the top bar or faucet.solana.com, then try again.`);
  const vtx = VersionedTransaction.deserialize(tx.serialize({ requireAllSignatures: false, verifySignatures: false }));
  const sim = await connection.simulateTransaction(vtx, { sigVerify: false, replaceRecentBlockhash: false, commitment: "confirmed" }).catch(() => null);
  if (!sim || !sim.value.err) return; // RPC hiccup: let the wallet's own check decide
  const logs = (sim.value.logs ?? []).join("\n");
  const err = JSON.stringify(sim.value.err);
  if (/insufficient (lamports|funds)/i.test(logs) || /InsufficientFunds|AccountNotFound/.test(err))
    throw new Error(`Not enough devnet SOL in your wallet for this step. Use "+ airdrop" or faucet.solana.com, then try again.`);
  if (/BlockhashNotFound/.test(err)) throw new Error("The transaction expired before you signed it. Please try again.");
  throw new Error(`This transaction would fail on devnet (${err}). ${NETWORK_HINT}`);
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
