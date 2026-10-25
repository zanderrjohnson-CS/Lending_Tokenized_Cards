import { Connection, PublicKey } from "@solana/web3.js";
import type { DB } from "./db.js";

export interface HoldingsReader {
  /** Mints of cards the wallet holds, limited to the supported demo collection. */
  cardMintsOf(wallet: string): Promise<string[]>;
}

const TOKEN_PROGRAM = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");

/**
 * Lists the wallet's token accounts and keeps NFT-like holdings (amount 1, 0 decimals) whose mint is
 * in the supported set. Supported set = card mints from devnet/addresses.json; if that file is
 * missing or empty we fall back to mints already in the cards table (seeded demo data).
 * Token-2022 / compressed NFTs are not handled in the MVP.
 */
export class RpcHoldingsReader implements HoldingsReader {
  constructor(private conn: Connection, private db: DB, private supported: () => string[]) {}

  async cardMintsOf(wallet: string): Promise<string[]> {
    const known = new Set(this.supported());
    if (!known.size) {
      for (const r of this.db.prepare("SELECT token_mint FROM cards").all() as any[]) known.add(r.token_mint);
    }
    const res = await this.conn.getParsedTokenAccountsByOwner(new PublicKey(wallet), { programId: TOKEN_PROGRAM });
    const out: string[] = [];
    for (const { account } of res.value) {
      const info = account.data.parsed?.info;
      if (info?.tokenAmount?.decimals === 0 && info.tokenAmount.amount === "1" && known.has(info.mint)) out.push(info.mint);
    }
    return out;
  }
}
