import type { DB } from "./db.js";
import type { ScoreClient } from "./scoreClient.js";
import { publicScore } from "./scoreClient.js";

export const STATUSES = ["open", "active", "repaid", "defaulted", "cancelled"] as const;

function cardRecord(db: DB, mint: string) {
  const c = db.prepare('SELECT token_mint, card_id, name, "set", grade_company, grade, cert_number, image_url, verified FROM cards WHERE token_mint = ?').get(mint) as any;
  return c ? { ...c, verified: !!c.verified } : null;
}

export async function serializeLoan(db: DB, scores: ScoreClient, row: any, full = false) {
  const sr = await scores.getScore(row.token_mint);
  const score = publicScore(sr, false);
  const max = score.available ? score.max_loan_usd : null; // null for unverified cards: no terms
  return {
    loan_id: row.loan_id,
    lender: row.lender,
    borrower: row.borrower,
    token_mint: row.token_mint,
    principal_usd: row.principal_usd,
    interest_bps: row.interest_bps,
    term_days: row.term_days,
    status: row.status,
    offer_expires_at: row.offer_expires_at,
    started_at: row.started_at,
    due_at: row.due_at,
    score_at_offer: row.score_at_offer ? JSON.parse(row.score_at_offer) : null,
    tx_signatures: JSON.parse(row.tx_signatures),
    // Flag only; the contract does not block above-limit offers in the MVP.
    within_score_limit: max == null ? null : row.principal_usd <= max,
    max_loan_usd: max,
    card: cardRecord(db, row.token_mint),
    score,
    ...(full ? {} : {}),
  };
}

export async function listLoans(
  db: DB, scores: ScoreClient,
  q: { status?: string; lender?: string; borrower?: string; token_mint?: string; limit: number; offset: number },
  nowMs = Date.now(),
) {
  const where: string[] = []; const args: any[] = [];
  if (q.status) {
    where.push("status = ?"); args.push(q.status);
    if (q.status === "open") { where.push("(offer_expires_at IS NULL OR offer_expires_at > ?)"); args.push(new Date(nowMs).toISOString()); }
  }
  for (const k of ["lender", "borrower", "token_mint"] as const) if (q[k]) { where.push(`${k} = ?`); args.push(q[k]); }
  const rows = db.prepare(
    `SELECT * FROM loans ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY COALESCE(started_at, offer_expires_at) DESC, loan_id LIMIT ? OFFSET ?`,
  ).all(...args, q.limit, q.offset) as any[];
  return Promise.all(rows.map((r) => serializeLoan(db, scores, r)));
}
