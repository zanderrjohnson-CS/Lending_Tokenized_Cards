import fs from "node:fs";
import { Connection, PublicKey } from "@solana/web3.js";
import { BorshCoder, EventParser, type Idl } from "@coral-xyz/anchor";
import { EVENT_NAMES, type ChainEvent, type ChainSource, type Cursor, type FetchResult } from "../events.js";

const snake = (s: string) => s.replace(/[A-Z]/g, (c) => "_" + c.toLowerCase());

/** Anchor decodes to camelCase with BN/PublicKey; flatten to snake_case with strings. */
function normalize(v: any): any {
  if (v == null) return v;
  if (v instanceof PublicKey) return v.toBase58();
  if (typeof v === "object" && typeof v.toString === "function" && v.constructor?.name === "BN") return v.toString();
  if (typeof v === "bigint") return v.toString();
  if (Array.isArray(v)) return v.map(normalize);
  if (typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [snake(k), normalize(x)]));
  return v;
}

/**
 * Pulls the program's transaction history over plain JSON-RPC (free public devnet RPC is enough)
 * and decodes Anchor events from the logs. No webhook service needed; polling keeps cost at zero.
 * NOTE: not exercised against live devnet in this repo's tests (no validator or program yet).
 */
export class RpcChainSource implements ChainSource {
  private parser: EventParser;
  private programId: PublicKey;
  constructor(private conn: Connection, programId: string, idlPath: string) {
    if (!programId) throw new Error("PROGRAM_ID is not set (published by workstream A in devnet/addresses.json)");
    if (!fs.existsSync(idlPath)) throw new Error(`IDL not found at ${idlPath} (build the program in contracts/ first)`);
    this.programId = new PublicKey(programId);
    this.parser = new EventParser(this.programId, new BorshCoder(JSON.parse(fs.readFileSync(idlPath, "utf8")) as Idl));
  }

  async fetchSince(cursor: Cursor): Promise<FetchResult> {
    // Signatures come newest first; page back until we hit the cursor.
    const sigs: { signature: string; slot: number; err: unknown; blockTime?: number | null }[] = [];
    let before: string | undefined;
    for (;;) {
      const page = await this.conn.getSignaturesForAddress(
        this.programId, { before, until: cursor.signature ?? undefined, limit: 100 }, "confirmed");
      sigs.push(...page);
      if (page.length < 100) break;
      before = page[page.length - 1].signature;
    }
    if (!sigs.length) return { events: [], cursor };

    const ok = sigs.filter((s) => !s.err).reverse(); // oldest first
    const events: ChainEvent[] = [];
    for (let i = 0; i < ok.length; i += 5) {
      const chunk = ok.slice(i, i + 5);
      const txs = await Promise.all(chunk.map((s) =>
        this.conn.getTransaction(s.signature, { maxSupportedTransactionVersion: 0, commitment: "confirmed" })));
      txs.forEach((tx, j) => {
        if (!tx?.meta?.logMessages || tx.meta.err) return;
        let ix = 0;
        for (const ev of this.parser.parseLogs(tx.meta.logMessages)) {
          if ((EVENT_NAMES as readonly string[]).includes(ev.name)) {
            events.push({
              signature: chunk[j].signature, ix: ix++, slot: tx.slot,
              blockTime: tx.blockTime ?? chunk[j].blockTime ?? Math.floor(Date.now() / 1000),
              name: ev.name as ChainEvent["name"], data: normalize(ev.data),
            });
          }
        }
      });
    }
    return { events, cursor: { signature: sigs[0].signature, slot: sigs[0].slot } };
  }
}
