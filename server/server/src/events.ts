/**
 * Normalized chain events. The indexer only ever sees this shape, whether the source is the
 * live RPC or a replay file, so tests do not need a validator.
 *
 * ASSUMED payloads (reconcile with contracts/README.md from workstream A; only this file and
 * rpcSource.ts should need to change):
 *   OfferCreated   { loan_id, lender, token_mint, principal_usdc, interest_bps, term_days, offer_expires_at }
 *   OfferCancelled { loan_id }
 *   LoanStarted    { loan_id, borrower, started_at, due_at }
 *   LoanRepaid     { loan_id }
 *   LoanDefaulted  { loan_id }
 *   BuybackSold    { loan_id }
 * Money is base units (6 decimals), times are unix seconds, ids/keys are strings.
 */
export const EVENT_NAMES = [
  "OfferCreated", "OfferCancelled", "LoanStarted", "LoanRepaid", "LoanDefaulted", "BuybackSold",
] as const;
export type EventName = (typeof EVENT_NAMES)[number];

export interface ChainEvent {
  signature: string;
  ix: number;          // position of the event within the transaction
  slot: number;
  blockTime: number;   // unix seconds
  name: EventName;
  data: Record<string, any>;
}

export interface Cursor { signature: string | null; slot: number | null }

export interface FetchResult {
  events: ChainEvent[];
  /** Newest signature seen (including txs with no events), to resume from next time. */
  cursor: Cursor;
}

export interface ChainSource {
  fetchSince(cursor: Cursor): Promise<FetchResult>;
}

export const USDC_DECIMALS = 6;
export const usdcToUsd = (v: string | number | bigint) => Number(v) / 10 ** USDC_DECIMALS;
