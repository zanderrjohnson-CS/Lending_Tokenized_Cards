import { Connection } from "@solana/web3.js";
import { loadConfig, readAddresses } from "./config.js";
import { openDb } from "./db.js";
import { ScoreClient } from "./scoreClient.js";
import { Indexer } from "./indexer.js";
import { RpcChainSource } from "./chain/rpcSource.js";
import { RpcHoldingsReader } from "./cards.js";
import { runReminders } from "./reminders.js";
import { buildApp } from "./app.js";

try { process.loadEnvFile(".env"); } catch { /* no .env: use process env */ }
const cfg = loadConfig();
const db = openDb(cfg.databasePath);
const scores = new ScoreClient(db, cfg);
const addrs = readAddresses(cfg.addressesPath);
const conn = new Connection(cfg.rpcUrl, "confirmed");

let indexer: Indexer | null = null;
const programId = cfg.programId || addrs.programId || "";
try {
  indexer = new Indexer(db, new RpcChainSource(conn, programId, cfg.idlPath), scores);
} catch (e) {
  console.warn(`[indexer] disabled: ${(e as Error).message}`); // API still serves existing data
}

const app = buildApp({ db, cfg, scores, indexer, holdings: new RpcHoldingsReader(conn, db, () => addrs.cardMints) });

if (indexer && cfg.indexerPollSeconds > 0) {
  const tick = () => indexer!.run().catch((e) => console.warn("[indexer]", e.message));
  tick();
  setInterval(tick, cfg.indexerPollSeconds * 1000).unref();
}
if (cfg.reminderPollSeconds > 0) {
  const tick = () => { try { const n = runReminders(db); if (n) console.log(`[reminders] ${n} new`); } catch (e) { console.warn("[reminders]", e); } };
  tick();
  setInterval(tick, cfg.reminderPollSeconds * 1000).unref();
}

await app.listen({ port: cfg.port, host: "0.0.0.0" });
console.log(`server on :${cfg.port}`);
