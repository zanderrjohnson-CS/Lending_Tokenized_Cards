import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";

export type DB = DatabaseSync;

/** Forward-only migrations; index in the array + 1 = schema version (PRAGMA user_version). */
const MIGRATIONS: string[] = [
  `
  CREATE TABLE profiles (
    wallet TEXT PRIMARY KEY,
    username TEXT UNIQUE,
    avatar_url TEXT,
    last_signed_at INTEGER NOT NULL DEFAULT 0,  -- replay guard: signed timestamps must increase
    created_at TEXT NOT NULL
  );
  CREATE TABLE cards (
    token_mint TEXT PRIMARY KEY,
    card_id TEXT, name TEXT, "set" TEXT, grade_company TEXT, grade REAL,
    cert_number TEXT, image_url TEXT, verified INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE scores (
    token_mint TEXT PRIMARY KEY,                -- latest score only; history is not needed for the MVP
    loan_score REAL, fair_value_usd REAL, confidence REAL, liquidity_score REAL,
    recovery_floor_usd REAL, payload_json TEXT NOT NULL, model_version TEXT, as_of TEXT,
    fetched_at INTEGER NOT NULL                 -- unix seconds, drives the cache TTL
  );
  CREATE TABLE loans (
    loan_id TEXT PRIMARY KEY,
    lender TEXT, borrower TEXT, token_mint TEXT NOT NULL,
    principal_usd REAL NOT NULL, interest_bps INTEGER NOT NULL, term_days INTEGER NOT NULL,
    status TEXT NOT NULL, offer_expires_at TEXT, started_at TEXT, due_at TEXT,
    score_at_offer TEXT,                        -- JSON snapshot taken when the offer was indexed
    tx_signatures TEXT NOT NULL DEFAULT '[]'
  );
  CREATE INDEX loans_status ON loans(status);
  CREATE INDEX loans_token ON loans(token_mint);
  CREATE INDEX loans_due ON loans(status, due_at);
  CREATE TABLE reputation (
    wallet TEXT PRIMARY KEY,
    loans_repaid INTEGER NOT NULL DEFAULT 0, loans_defaulted INTEGER NOT NULL DEFAULT 0,
    volume_usd REAL NOT NULL DEFAULT 0, first_loan_at TEXT, updated_at TEXT
  );
  CREATE TABLE notifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    wallet TEXT NOT NULL, type TEXT NOT NULL, loan_id TEXT NOT NULL,
    message TEXT NOT NULL, created_at TEXT NOT NULL, read_at TEXT,
    UNIQUE (wallet, type, loan_id)              -- makes reminders and replays idempotent
  );
  CREATE INDEX notifications_wallet ON notifications(wallet, created_at);
  CREATE TABLE chain_cursor (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    last_signature TEXT, last_slot INTEGER
  );
  -- Raw normalized events: lets us rebuild loans/reputation without touching the RPC.
  -- Still a copy of the chain, not a source of truth. Safe to delete (re-run the indexer from scratch).
  CREATE TABLE chain_events (
    signature TEXT NOT NULL, ix INTEGER NOT NULL,   -- ix = event position inside the transaction
    slot INTEGER NOT NULL, block_time INTEGER NOT NULL,
    name TEXT NOT NULL, data_json TEXT NOT NULL,
    PRIMARY KEY (signature, ix)
  );
  CREATE INDEX chain_events_order ON chain_events(slot, signature, ix);
  `,
];

export function openDb(file: string): DB {
  if (file !== ":memory:") fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
  migrate(db);
  return db;
}

export function migrate(db: DB) {
  const row = db.prepare("PRAGMA user_version").get() as { user_version: number };
  for (let v = row.user_version; v < MIGRATIONS.length; v++) {
    db.exec("BEGIN");
    try {
      db.exec(MIGRATIONS[v]);
      db.exec(`PRAGMA user_version = ${v + 1}`);
      db.exec("COMMIT");
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
  }
}

export function tx<T>(db: DB, fn: () => T): T {
  db.exec("BEGIN IMMEDIATE");
  try {
    const r = fn();
    db.exec("COMMIT");
    return r;
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}

export const iso = (unixSeconds: number | null | undefined) =>
  unixSeconds == null ? null : new Date(unixSeconds * 1000).toISOString();
