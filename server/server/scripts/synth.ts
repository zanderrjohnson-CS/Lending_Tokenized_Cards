import nacl from "tweetnacl";
import bs58 from "bs58";
import { createHash } from "node:crypto";

/** Deterministic fake keys so seed data and the mock score service agree. SYNTHETIC. */
export const fakeKey = (label: string) =>
  bs58.encode(nacl.sign.keyPair.fromSeed(createHash("sha256").update("cardcredit-synthetic:" + label).digest()).publicKey);

export const DEMO_CARDS = [
  { id: "base1-4-holo-en", name: "Charizard", set: "Base Set", number: "4", year: 1999, company: "PSA", grade: 9, cert: "90000001", value: 4200 },
  { id: "base1-2-holo-en", name: "Blastoise", set: "Base Set", number: "2", year: 1999, company: "PSA", grade: 8, cert: "90000002", value: 900 },
  { id: "base1-15-holo-en", name: "Venusaur", set: "Base Set", number: "15", year: 1999, company: "CGC", grade: 9, cert: "90000003", value: 700 },
  { id: "neo1-9-holo-en", name: "Lugia", set: "Neo Genesis", number: "9", year: 2000, company: "BGS", grade: 9, cert: "90000004", value: 1500 },
  { id: "base1-1-holo-en", name: "Alakazam", set: "Base Set", number: "1", year: 1999, company: "PSA", grade: 10, cert: "90000005", value: 650 },
  { id: "base1-10-holo-en", name: "Mewtwo", set: "Base Set", number: "10", year: 1999, company: "PSA", grade: 7, cert: "90000006", value: 300 },
].map((c, i) => ({ ...c, mint: fakeKey("card" + i) }));

/** The last demo card is deliberately unverified to exercise the "no terms" path. */
export const UNVERIFIED_MINT = DEMO_CARDS[5].mint;
export const WALLETS = ["alice", "bob", "carol", "dave"].map((n) => ({ name: n, wallet: fakeKey("wallet-" + n) }));
