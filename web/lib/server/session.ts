// Sign-in with Solana (lite): the wallet signs a timestamped message, we verify the
// ed25519 signature and set an HMAC-signed, HttpOnly session cookie.
import crypto from "crypto";
import bs58 from "bs58";
import nacl from "tweetnacl";
import { PublicKey } from "@solana/web3.js";
import { cookies } from "next/headers";
import { APP_NAME } from "../config";

const COOKIE = "hl_session";
const MAX_AGE = 60 * 60 * 24; // 1 day
const SECRET = process.env.SESSION_SECRET || "dev-only-secret-change-me";

export function signInMessage(wallet: string, nonce: string, issuedAt: string, host: string) {
  return `${host} wants you to sign in to ${APP_NAME} with your Solana account:\n${wallet}\n\nThis request will not trigger a transaction or cost any fees.\n\nNonce: ${nonce}\nIssued At: ${issuedAt}`;
}

export function newNonce() {
  const nonce = crypto.randomBytes(12).toString("hex");
  const issuedAt = new Date().toISOString();
  const mac = hmac(`${nonce}.${issuedAt}`);
  return { nonce, issuedAt, mac };
}

function hmac(s: string) {
  return crypto.createHmac("sha256", SECRET).update(s).digest("base64url");
}

export function verifySignIn(p: {
  wallet: string; nonce: string; issuedAt: string; mac: string; signature: string; host: string;
}): boolean {
  if (hmac(`${p.nonce}.${p.issuedAt}`) !== p.mac) return false; // nonce was issued by us
  if (Date.now() - Date.parse(p.issuedAt) > 5 * 60_000) return false; // and is fresh
  let pk: PublicKey;
  try { pk = new PublicKey(p.wallet); } catch { return false; }
  const msg = new TextEncoder().encode(signInMessage(p.wallet, p.nonce, p.issuedAt, p.host));
  return nacl.sign.detached.verify(msg, bs58.decode(p.signature), pk.toBytes());
}

export function setSession(wallet: string) {
  const body = Buffer.from(JSON.stringify({ wallet, exp: Date.now() + MAX_AGE * 1000 })).toString("base64url");
  cookies().set(COOKIE, `${body}.${hmac(body)}`, {
    httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: MAX_AGE,
  });
}

export function clearSession() {
  cookies().delete(COOKIE);
}

export function getWallet(): string | null {
  const v = cookies().get(COOKIE)?.value;
  if (!v) return null;
  const [body, mac] = v.split(".");
  if (!body || !mac || hmac(body) !== mac) return null;
  const { wallet, exp } = JSON.parse(Buffer.from(body, "base64url").toString());
  return exp > Date.now() ? wallet : null;
}
