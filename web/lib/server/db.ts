// Tiny JSON-file store. Good enough for a hackathon demo on one server.
// Swap for Postgres/Supabase before anything real.
import fs from "fs";
import path from "path";
import type { Loan, TokenizedCard } from "../types";

export interface DB {
  users: Record<string, { role?: "borrower" | "lender"; createdAt: string }>;
  cards: TokenizedCard[];
  loans: Loan[];
  usedSignatures: string[];
}

const DIR = process.env.DATA_DIR || path.join(process.cwd(), ".data");
const FILE = path.join(DIR, "db.json");

export function load(): DB {
  try {
    return JSON.parse(fs.readFileSync(FILE, "utf8"));
  } catch {
    return { users: {}, cards: [], loans: [], usedSignatures: [] };
  }
}

export function save(db: DB) {
  fs.mkdirSync(DIR, { recursive: true });
  const tmp = FILE + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
  fs.renameSync(tmp, FILE);
}

/** Read-modify-write in one go. Node runs route handlers on one thread, so this is not interleaved. */
export function mutate<T>(fn: (db: DB) => T): T {
  const db = load();
  const out = fn(db);
  save(db);
  return out;
}

export const dataDir = DIR;
