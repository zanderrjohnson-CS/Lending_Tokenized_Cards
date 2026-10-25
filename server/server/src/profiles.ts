import nacl from "tweetnacl";
import bs58 from "bs58";
import type { DB } from "./db.js";
import { getReputation } from "./reputation.js";

export const MAX_CLOCK_SKEW_S = 300;

export function profileMessage(p: { wallet: string; username: string | null; avatar_url: string | null; timestamp: number }) {
  return `CardCredit profile update\nwallet: ${p.wallet}\nusername: ${p.username ?? ""}\navatar_url: ${p.avatar_url ?? ""}\ntimestamp: ${p.timestamp}`;
}

function decodeSig(sig: string): Uint8Array | null {
  for (const dec of [() => bs58.decode(sig), () => Uint8Array.from(Buffer.from(sig, "base64"))]) {
    try { const b = dec(); if (b.length === 64) return b; } catch { /* try next */ }
  }
  return null;
}

export function verifyWalletSignature(wallet: string, message: string, signature: string): boolean {
  const sig = decodeSig(signature);
  if (!sig) return false;
  try {
    return nacl.sign.detached.verify(new TextEncoder().encode(message), sig, bs58.decode(wallet));
  } catch { return false; }
}

export class ProfileError extends Error {
  constructor(public status: number, msg: string) { super(msg); }
}

export function getProfile(db: DB, wallet: string) {
  const p = db.prepare("SELECT wallet, username, avatar_url, created_at FROM profiles WHERE wallet = ?").get(wallet) as any;
  return {
    wallet,
    username: p?.username ?? null,
    avatar_url: p?.avatar_url ?? null,
    created_at: p?.created_at ?? null,
    reputation: getReputation(db, wallet),
  };
}

export function updateProfile(
  db: DB,
  input: { wallet: string; username: string | null; avatar_url: string | null; timestamp: number; signature: string },
  nowMs = Date.now(),
) {
  const { wallet, username, avatar_url, timestamp, signature } = input;
  if (!verifyWalletSignature(wallet, profileMessage({ wallet, username, avatar_url, timestamp }), signature)) {
    throw new ProfileError(401, "invalid signature");
  }
  if (Math.abs(nowMs / 1000 - timestamp) > MAX_CLOCK_SKEW_S) throw new ProfileError(401, "timestamp outside allowed window");

  const cur = db.prepare("SELECT last_signed_at FROM profiles WHERE wallet = ?").get(wallet) as any;
  if (cur && timestamp <= cur.last_signed_at) throw new ProfileError(401, "stale or replayed message");

  if (username) {
    const taken = db.prepare("SELECT 1 FROM profiles WHERE lower(username) = lower(?) AND wallet != ?").get(username, wallet);
    if (taken) throw new ProfileError(409, "username already taken");
  }
  db.prepare(
    `INSERT INTO profiles (wallet, username, avatar_url, last_signed_at, created_at) VALUES (?,?,?,?,?)
     ON CONFLICT(wallet) DO UPDATE SET username=excluded.username, avatar_url=excluded.avatar_url, last_signed_at=excluded.last_signed_at`,
  ).run(wallet, username, avatar_url, timestamp, new Date(nowMs).toISOString());
  return getProfile(db, wallet);
}
