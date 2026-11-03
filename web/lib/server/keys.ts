// Platform keypairs. ESCROW holds pledged card NFTs; VAULT is the mint authority that
// issues a card NFT only after the physical card is authenticated and stored.
// Set ESCROW_SECRET_KEY / VAULT_SECRET_KEY (base58) in production; otherwise one is
// generated and kept in .data/ so restarts reuse it.
import fs from "fs";
import path from "path";
import bs58 from "bs58";
import { Keypair } from "@solana/web3.js";
import { dataDir } from "./db";

function loadOrCreate(name: string, envVar: string): Keypair {
  const env = process.env[envVar];
  if (env) return Keypair.fromSecretKey(bs58.decode(env));
  const file = path.join(dataDir, `${name}.json`);
  try {
    return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(file, "utf8"))));
  } catch {
    const kp = Keypair.generate();
    fs.mkdirSync(dataDir, { recursive: true });
    fs.writeFileSync(file, JSON.stringify(Array.from(kp.secretKey)));
    return kp;
  }
}

let escrow: Keypair | null = null;
let vault: Keypair | null = null;
export const escrowKeypair = () => (escrow ??= loadOrCreate("escrow-keypair", "ESCROW_SECRET_KEY"));
export const vaultKeypair = () => (vault ??= loadOrCreate("vault-keypair", "VAULT_SECRET_KEY"));
