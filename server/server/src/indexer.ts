import type { DB } from "./db.js";
import { tx, iso } from "./db.js";
import { usdcToUsd, type ChainEvent, type ChainSource, type Cursor } from "./events.js";
import type { ScoreClient } from "./scoreClient.js";
import { recordOutcome } from "./reputation.js";
import { notify } from "./notifications.js";

/**
 * Applies one event to the derived tables (loans, reputation, notifications).
 * Only ever called for an event that was newly stored, or during a rebuild.
 */
function applyToViews(db: DB, ev: ChainEvent, scoreAtOffer: unknown) {
  const d = ev.data;
  const at = iso(ev.blockTime)!;
  const loanId = String(d.loan_id);
  const get = () => db.prepare("SELECT * FROM loans WHERE loan_id = ?").get(loanId) as any;
  const addSig = () => db.prepare(
    "UPDATE loans SET tx_signatures = json_insert(tx_signatures, '$[#]', ?) WHERE loan_id = ?",
  ).run(ev.signature, loanId);

  if (ev.name === "OfferCreated") {
    db.prepare(
      `INSERT OR IGNORE INTO loans (loan_id, lender, borrower, token_mint, principal_usd, interest_bps, term_days,
         status, offer_expires_at, score_at_offer, tx_signatures)
       VALUES (?,?,NULL,?,?,?,?, 'open', ?, ?, '[]')`,
    ).run(loanId, d.lender, d.token_mint, usdcToUsd(d.principal_usdc), Number(d.interest_bps),
      Number(d.term_days), iso(Number(d.offer_expires_at)), scoreAtOffer ? JSON.stringify(scoreAtOffer) : null);
    addSig();
    return;
  }

  const loan = get();
  if (!loan) {
    console.warn(`[indexer] ${ev.name} for unknown loan ${loanId} (${ev.signature}); skipped`);
    return;
  }
  addSig();

  switch (ev.name) {
    case "OfferCancelled":
      db.prepare("UPDATE loans SET status='cancelled' WHERE loan_id=?").run(loanId);
      break;
    case "LoanStarted": {
      const started = Number(d.started_at ?? ev.blockTime);
      const due = d.due_at != null ? Number(d.due_at) : started + loan.term_days * 86400;
      db.prepare("UPDATE loans SET status='active', borrower=?, started_at=?, due_at=? WHERE loan_id=?")
        .run(d.borrower, iso(started), iso(due), loanId);
      notify(db, loan.lender, "loan_started", loanId, "Your offer was accepted and the loan is now active.", at);
      break;
    }
    case "LoanRepaid":
    case "BuybackSold": // the card was sold to the buyback and the loan settled: counted as repaid
      db.prepare("UPDATE loans SET status='repaid' WHERE loan_id=?").run(loanId);
      recordOutcome(db, loan, "repaid", at);
      notify(db, loan.lender, "loan_repaid", loanId, "A loan you funded was repaid.", at);
      break;
    case "LoanDefaulted":
      db.prepare("UPDATE loans SET status='defaulted' WHERE loan_id=?").run(loanId);
      recordOutcome(db, loan, "defaulted", at);
      notify(db, loan.lender, "loan_defaulted", loanId, "A loan you funded defaulted. You can claim the card.", at);
      notify(db, loan.borrower, "loan_defaulted", loanId, "Your loan defaulted and the card went to the lender.", at);
      break;
  }
}

const order = (a: ChainEvent, b: ChainEvent) =>
  a.slot - b.slot || a.signature.localeCompare(b.signature) || a.ix - b.ix;

export class Indexer {
  private running: Promise<{ stored: number; fetched: number }> | null = null;
  constructor(private db: DB, private source: ChainSource, private scores: ScoreClient) {}

  getCursor(): Cursor {
    const r = this.db.prepare("SELECT last_signature, last_slot FROM chain_cursor WHERE id = 1").get() as any;
    return { signature: r?.last_signature ?? null, slot: r?.last_slot ?? null };
  }

  /** One catch-up pass. Concurrent calls share the same run (the endpoint can be hit freely). */
  run() {
    return (this.running ??= this.pass().finally(() => { this.running = null; }));
  }

  private async pass() {
    const { events, cursor } = await this.source.fetchSince(this.getCursor());
    events.sort(order);

    // Snapshot the score for new offers BEFORE opening the DB transaction (network call).
    const snapshots = new Map<string, unknown>();
    for (const ev of events) {
      if (ev.name !== "OfferCreated" || this.seen(ev)) continue;
      const r = await this.scores.getScore(String(ev.data.token_mint));
      if (r.score) {
        snapshots.set(String(ev.data.loan_id), {
          loan_score: r.score.loan_score,
          max_loan_usd: r.score.recommended_terms.max_loan_usd,
          fair_value_usd: r.score.fair_value_usd,
          model_version: r.score.model_version,
          as_of: r.score.as_of,
          stale: r.stale,
        });
      }
    }

    let stored = 0;
    tx(this.db, () => {
      const ins = this.db.prepare(
        "INSERT OR IGNORE INTO chain_events (signature, ix, slot, block_time, name, data_json) VALUES (?,?,?,?,?,?)");
      for (const ev of events) {
        const r = ins.run(ev.signature, ev.ix, ev.slot, ev.blockTime, ev.name, JSON.stringify(ev.data));
        if (Number(r.changes) === 0) continue; // already applied
        stored++;
        applyToViews(this.db, ev, snapshots.get(String(ev.data.loan_id)));
      }
      if (cursor.signature) {
        this.db.prepare(
          `INSERT INTO chain_cursor (id, last_signature, last_slot) VALUES (1, ?, ?)
           ON CONFLICT(id) DO UPDATE SET last_signature=excluded.last_signature, last_slot=excluded.last_slot`,
        ).run(cursor.signature, cursor.slot);
      }
    });
    return { stored, fetched: events.length };
  }

  private seen(ev: ChainEvent) {
    return !!this.db.prepare("SELECT 1 FROM chain_events WHERE signature=? AND ix=?").get(ev.signature, ev.ix);
  }
}

/**
 * Rebuild loans, reputation and state notifications from the stored event copy (no RPC).
 * For a rebuild straight from the chain: delete the DB (or run `npm run reindex`) and run the indexer.
 */
export function rebuildFromStoredEvents(db: DB) {
  tx(db, () => {
    const snaps = new Map<string, string>();
    for (const r of db.prepare("SELECT loan_id, score_at_offer FROM loans WHERE score_at_offer IS NOT NULL").all() as any[]) {
      snaps.set(r.loan_id, r.score_at_offer);
    }
    db.exec("DELETE FROM loans; DELETE FROM reputation; DELETE FROM notifications WHERE type NOT LIKE 'due_%'");
    const rows = db.prepare(
      "SELECT signature, ix, slot, block_time, name, data_json FROM chain_events ORDER BY slot, signature, ix").all() as any[];
    for (const r of rows) {
      const data = JSON.parse(r.data_json);
      const snap = snaps.get(String(data.loan_id));
      applyToViews(db, { signature: r.signature, ix: r.ix, slot: r.slot, blockTime: r.block_time, name: r.name, data },
        snap ? JSON.parse(snap) : null);
    }
  });
}
