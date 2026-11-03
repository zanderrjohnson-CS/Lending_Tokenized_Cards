// Suggested price + score -> loan terms. Pure functions, used by the UI (live quotes) and the API (authoritative).
//
// Price and safety are separate:
//   * Loan size comes from the suggested price: up to MAX_ADVANCE of it, for every card.
//   * The score only sets the interest rate. A card that trades often at a steady price gets a low
//     rate; a valuable card that rarely trades still gets a big loan, but at a rate high enough to
//     cover the lender's risk of not being able to sell it for the loan amount after a default.
// If the model supplies apr_pct / max_loan_usd, those win.
import type { LoanTerms, ScoreResult } from "./types";

export interface TermsPolicy {
  name: string;
  termsFor(score: ScoreResult): LoanTerms;
}

const DAY = 86_400;
export const TERM_CHOICES_SEC = [300, 7 * DAY, 14 * DAY, 30 * DAY, 60 * DAY, 90 * DAY];
export const MAX_ADVANCE = 0.9; // $15 suggested price -> up to $13.50 loan

/** APR from score: 8% floor, rising with the square of risk. 90 -> 9.2%, 75 -> 15.5%, 50 -> 38%, 25 -> 75.5%. */
export const aprFromScore = (score: number) => Math.round((8 + 0.012 * (100 - Math.max(0, Math.min(100, score))) ** 2) * 10) / 10;

export const priceBasedV2: TermsPolicy = {
  name: "price-based-v2",
  termsFor(s) {
    const price = s.suggestedPriceUsd;
    const maxLoanUsd = Math.round((s.maxLoanUsd ?? price * MAX_ADVANCE) * 100) / 100;
    return {
      suggestedPriceUsd: price,
      maxLoanUsd,
      maxAdvance: price > 0 ? Math.round((maxLoanUsd / price) * 1000) / 1000 : 0,
      aprPct: s.aprPct ?? aprFromScore(s.score),
      aprSource: s.aprPct != null ? "model" : "policy",
      termOptionsSec: TERM_CHOICES_SEC,
      minInterestPct: 1,
      policy: this.name,
    };
  },
};

export const DEFAULT_POLICY: TermsPolicy = priceBasedV2;

/** Interest owed for a fixed-term loan: simple interest, with a minimum finance charge. */
export function repayAmount(principal: number, aprPct: number, termSec: number, minInterestPct: number) {
  const interest = principal * (aprPct / 100) * (termSec / (365 * DAY));
  const floor = principal * (minInterestPct / 100);
  return Math.ceil(principal + Math.max(interest, floor));
}

export function fmtTerm(sec: number) {
  if (sec < 3600) return `${Math.round(sec / 60)} min (demo)`;
  return `${Math.round(sec / DAY)} days`;
}
