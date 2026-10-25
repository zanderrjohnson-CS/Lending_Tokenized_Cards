/**
 * Seeds a demo database with realistic SYNTHETIC loans by replaying fake events through the real
 * indexer. Run the mock score service (or the real one) first so score snapshots are filled in.
 * Workstream E seeds real devnet loans; this is the offline/backup path for demos.
 */
import { loadConfig } from "../src/config.js";
import { openDb } from "../src/db.js";
import { ScoreClient } from "../src/scoreClient.js";
import { Indexer } from "../src/indexer.js";
import { ReplaySource } from "../src/chain/replaySource.js";
import type { ChainEvent } from "../src/events.js";
import { runReminders } from "../src/reminders.js";
import { DEMO_CARDS, WALLETS, fakeKey } from "./synth.js";

try { process.loadEnvFile(".env"); } catch { /* ok */ }
const cfg = loadConfig();
const db = openDb(cfg.databasePath);
const now = Math.floor(Date.now() / 1000);
const D = 86400, H = 3600;
const [alice, bob, carol, dave] = WALLETS.map((w) => w.wallet);
const usdc = (n: number) => String(Math.round(n * 1e6));

let slot = 1000, n = 0;
const events: ChainEvent[] = [];
const ev = (name: ChainEvent["name"], at: number, data: Record<string, unknown>): void => {
  events.push({ signature: "SEED" + fakeKey("sig" + n).slice(0, 40) + n, ix: 0, slot: slot++, blockTime: at, name, data }); n++;
};
const offer = (id: string, lender: string, card: number, usd: number, at: number, expiresIn = 7 * D) =>
  ev("OfferCreated", at, { loan_id: id, lender, token_mint: DEMO_CARDS[card].mint, principal_usdc: usdc(usd), interest_bps: 500, term_days: 30, offer_expires_at: now + expiresIn });
const start = (id: string, borrower: string, at: number, term = 30) =>
  ev("LoanStarted", at, { loan_id: id, borrower, started_at: at, due_at: at + term * D });

// open offers (one deliberately above the score limit: Charizard max is 1890)
offer("1", carol, 0, 1500, now - 2 * D);
offer("2", dave, 1, 350, now - 1 * D);
offer("3", carol, 2, 900, now - 3 * H);           // above Venusaur's 315 limit -> flagged
offer("4", dave, 3, 600, now - 5 * H);
offer("5", carol, 4, 250, now - 6 * H);
offer("6", dave, 5, 100, now - 7 * H);            // unverified card: never gets terms
// active: one due in ~20h (reminder demo), one due in ~12 days
offer("7", carol, 0, 1200, now - 40 * D); start("7", alice, now - 40 * D + 600, 30);
ev("LoanRepaid", now - 12 * D, { loan_id: "7" });  // history: repaid
offer("8", dave, 1, 400, now - 29 * D - 4 * H); start("8", bob, now - 29 * D - 4 * H + 600, 30);
offer("9", carol, 3, 500, now - 18 * D); start("9", alice, now - 18 * D + 600, 30);
// defaulted and cancelled history
offer("10", dave, 2, 280, now - 70 * D); start("10", bob, now - 70 * D + 600, 30);
ev("LoanDefaulted", now - 38 * D, { loan_id: "10" });
offer("11", carol, 4, 200, now - 9 * D); ev("OfferCancelled", now - 8 * D, { loan_id: "11" });

const indexer = new Indexer(db, new ReplaySource(events), new ScoreClient(db, cfg));
const res = await indexer.run();

const prof = db.prepare("INSERT OR IGNORE INTO profiles (wallet, username, avatar_url, last_signed_at, created_at) VALUES (?,?,NULL,0,?)");
for (const w of WALLETS) prof.run(w.wallet, `${w.name}_demo`, new Date().toISOString());
const made = runReminders(db);
console.log(`seeded (synthetic): ${res.stored} events, ${made} reminders`);
console.log(WALLETS.map((w) => `${w.name}: ${w.wallet}`).join("\n"));
