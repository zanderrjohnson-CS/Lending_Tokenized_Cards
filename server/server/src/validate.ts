import bs58 from "bs58";

/** Cheap shape check for a Solana public key (32 bytes, base58). */
export function isPubkey(s: unknown): s is string {
  if (typeof s !== "string" || s.length < 32 || s.length > 44) return false;
  try { return bs58.decode(s).length === 32; } catch { return false; }
}
