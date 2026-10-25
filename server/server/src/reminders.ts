import type { DB } from "./db.js";
import { iso } from "./db.js";
import { notify } from "./notifications.js";

const BUCKETS_H = [1, 24, 72] as const; // smallest first: a loan 20h out gets "24h", not "72h"

/**
 * Finds active loans due within 72/24/1 hours (or already overdue) and writes notifications.
 * Safe to run as often as you like: the unique key (wallet, type, loan_id) prevents repeats, and
 * only the tightest applicable bucket is written, so earlier buckets are not back-filled.
 */
export function runReminders(db: DB, nowMs = Date.now()): number {
  const now = iso(Math.floor(nowMs / 1000))!;
  const horizon = iso(Math.floor(nowMs / 1000) + 72 * 3600)!;
  const loans = db.prepare(
    "SELECT loan_id, lender, borrower, due_at FROM loans WHERE status='active' AND due_at IS NOT NULL AND due_at <= ?",
  ).all(horizon) as { loan_id: string; lender: string; borrower: string; due_at: string }[];

  let before = Number((db.prepare("SELECT COUNT(*) c FROM notifications").get() as any).c);
  for (const l of loans) {
    const hoursLeft = (Date.parse(l.due_at) - nowMs) / 3600_000;
    if (hoursLeft <= 0) {
      notify(db, l.borrower, "overdue", l.loan_id, "Your loan is past its due date. Repay now or the lender can claim the card.", now);
      notify(db, l.lender, "overdue", l.loan_id, "A loan you funded is past due. You can claim the card.", now);
      continue;
    }
    const h = BUCKETS_H.find((b) => hoursLeft <= b);
    if (!h) continue;
    const when = h === 1 ? "1 hour" : `${h} hours`;
    notify(db, l.borrower, `due_${h}h`, l.loan_id, `Your loan is due in under ${when}. Repay to get your card back.`, now);
    notify(db, l.lender, `due_${h}h`, l.loan_id, `A loan you funded is due in under ${when}.`, now);
  }
  const after = Number((db.prepare("SELECT COUNT(*) c FROM notifications").get() as any).c);
  return after - before;
}
