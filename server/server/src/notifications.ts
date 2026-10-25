import type { DB } from "./db.js";

/** Idempotent: the (wallet, type, loan_id) unique key makes repeats a no-op. */
export function notify(db: DB, wallet: string | null | undefined, type: string, loanId: string, message: string, at: string) {
  if (!wallet) return;
  db.prepare(
    "INSERT OR IGNORE INTO notifications (wallet, type, loan_id, message, created_at) VALUES (?,?,?,?,?)",
  ).run(wallet, type, loanId, message, at);
}

export function listNotifications(db: DB, wallet: string, limit = 100) {
  return db.prepare(
    "SELECT id, wallet, type, loan_id, message, created_at, read_at FROM notifications WHERE wallet = ? ORDER BY created_at DESC, id DESC LIMIT ?",
  ).all(wallet, limit);
}
