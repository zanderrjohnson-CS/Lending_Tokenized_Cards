import type { DB } from "./db.js";

/**
 * Reputation is derived only from chain events (called once per newly stored event, or during a
 * rebuild). Both parties are credited. It is a record, not a score.
 */
export function recordOutcome(
  db: DB,
  loan: { lender: string | null; borrower: string | null; principal_usd: number; started_at: string | null },
  outcome: "repaid" | "defaulted",
  at: string,
) {
  for (const wallet of [loan.lender, loan.borrower]) {
    if (!wallet) continue;
    db.prepare(
      `INSERT INTO reputation (wallet, loans_repaid, loans_defaulted, volume_usd, first_loan_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(wallet) DO UPDATE SET
         loans_repaid = loans_repaid + excluded.loans_repaid,
         loans_defaulted = loans_defaulted + excluded.loans_defaulted,
         volume_usd = volume_usd + excluded.volume_usd,
         first_loan_at = CASE WHEN first_loan_at IS NULL OR excluded.first_loan_at < first_loan_at
                              THEN excluded.first_loan_at ELSE first_loan_at END,
         updated_at = excluded.updated_at`,
    ).run(wallet, outcome === "repaid" ? 1 : 0, outcome === "defaulted" ? 1 : 0,
      loan.principal_usd, loan.started_at ?? at, at);
  }
}

export function getReputation(db: DB, wallet: string) {
  const r = db.prepare("SELECT * FROM reputation WHERE wallet = ?").get(wallet) as any;
  return {
    loans_repaid: r?.loans_repaid ?? 0,
    loans_defaulted: r?.loans_defaulted ?? 0,
    volume_usd: r?.volume_usd ?? 0,
    first_loan_at: r?.first_loan_at ?? null,
    updated_at: r?.updated_at ?? null,
  };
}
