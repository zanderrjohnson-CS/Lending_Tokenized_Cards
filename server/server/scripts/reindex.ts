/** Drops everything derived from the chain and re-reads it. Profiles are kept (not chain data). */
import { Connection } from "@solana/web3.js";
import { loadConfig, readAddresses } from "../src/config.js";
import { openDb } from "../src/db.js";
import { ScoreClient } from "../src/scoreClient.js";
import { Indexer } from "../src/indexer.js";
import { RpcChainSource } from "../src/chain/rpcSource.js";

try { process.loadEnvFile(".env"); } catch { /* ok */ }
const cfg = loadConfig();
const db = openDb(cfg.databasePath);
db.exec("DELETE FROM loans; DELETE FROM reputation; DELETE FROM chain_events; DELETE FROM chain_cursor; DELETE FROM notifications");
const programId = cfg.programId || readAddresses(cfg.addressesPath).programId || "";
const idx = new Indexer(db, new RpcChainSource(new Connection(cfg.rpcUrl, "confirmed"), programId, cfg.idlPath), new ScoreClient(db, cfg));
console.log(await idx.run());
