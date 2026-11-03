import type { Loan } from "../types";

export const OPEN = new Set(["pending_deposit", "listed", "active"]);
export const LOCK_MS = 120_000; // longer than a blockhash lives, so a built tx can't land after the lock

export type LoanWithLock = Loan & { lock?: { by: string; action: string; until: number } };

export function lockedByOther(l: LoanWithLock, wallet: string, now = Date.now()) {
  return l.lock && l.lock.until > now && l.lock.by !== wallet ? l.lock : null;
}

/** What the API returns: hide the internal lock but say whether someone else is mid-action. */
export function publicLoan(l: LoanWithLock) {
  const { lock, ...rest } = l;
  return { ...rest, busy: !!(lock && lock.until > Date.now()) };
}
