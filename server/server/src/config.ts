import fs from "node:fs";

const env = (k: string, d = "") => process.env[k] ?? d;
const int = (k: string, d: number) => {
  const v = Number(env(k));
  return Number.isFinite(v) && env(k) !== "" ? v : d;
};

export interface Config {
  port: number;
  databasePath: string;
  scoreApiUrl: string;
  scoreCacheTtlSeconds: number;
  rpcUrl: string;
  addressesPath: string;
  programId: string;
  idlPath: string;
  indexerPollSeconds: number;
  reminderPollSeconds: number;
  adminToken: string;
}

export function loadConfig(): Config {
  return {
    port: int("PORT", 8787),
    databasePath: env("DATABASE_PATH", "./data/server.db"),
    scoreApiUrl: env("SCORE_API_URL", "http://localhost:8000").replace(/\/$/, ""),
    scoreCacheTtlSeconds: int("SCORE_CACHE_TTL_SECONDS", 600),
    rpcUrl: env("SOLANA_RPC_URL", "https://api.devnet.solana.com"),
    addressesPath: env("ADDRESSES_PATH", "../devnet/addresses.json"),
    programId: env("PROGRAM_ID"),
    idlPath: env("IDL_PATH", "../contracts/target/idl/loan_escrow.json"),
    indexerPollSeconds: int("INDEXER_POLL_SECONDS", 20),
    reminderPollSeconds: int("REMINDER_POLL_SECONDS", 600),
    adminToken: env("ADMIN_TOKEN"),
  };
}

/** Shape of devnet/addresses.json is owned by workstream E; we read it leniently. */
export function readAddresses(path: string): { programId?: string; cardMints: string[] } {
  try {
    const j = JSON.parse(fs.readFileSync(path, "utf8"));
    const mints: string[] = [];
    const raw = j.card_mints ?? j.cardMints ?? j.cards ?? [];
    for (const m of Array.isArray(raw) ? raw : Object.values(raw)) {
      if (typeof m === "string") mints.push(m);
      else if (m && typeof m === "object") {
        const v = (m as any).token_mint ?? (m as any).mint;
        if (typeof v === "string") mints.push(v);
      }
    }
    return { programId: j.program_id ?? j.programId, cardMints: mints };
  } catch {
    return { cardMints: [] };
  }
}
