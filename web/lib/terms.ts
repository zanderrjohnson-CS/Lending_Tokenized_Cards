// Suggested price + score -> loan terms. Pure functions, used by the UI (live quotes) and the API (authoritative).
//
// Price and safety are separate:
//   * Loan size comes from the suggested price. The model suggests a loan per card and an APR curve:
//     borrow less and the rate drops, borrow more (up to max_lendable_ltv) and it rises. The borrower
//     picks a point on that curve; that's the negotiation.
//   * Without a model curve (stand-in data), the loan is up to FALLBACK_ADVANCE of price and the APR
//     comes from the score alone.
import type { AprPoint, LoanTerms, ScoreResult } from "./types";

export interface TermsPolicy {
  name: string;
  termsFor(score: ScoreResult): LoanTerms;
}

const DAY = 86_400;
export const TERM_CHOICES_SEC = [300, 7 * DAY, 14 * DAY, 30 * DAY, 60 * DAY, 90 * DAY];
export const FALLBACK_ADVANCE = 0.9; // stand-in only: $15 suggested price -> up to $13.50 loan

/** APR from score: 8% floor, rising with the square of risk. 90 -> 9.2%, 75 -> 15.5%, 50 -> 38%, 25 -> 75.5%. */
export const aprFromScore = (score: number) => Math.round((8 + 0.012 * (100 - Math.max(0, Math.min(100, score))) ** 2) * 10) / 10;

export const priceBasedV2: TermsPolicy = {
  name: "price-curve-v3",
  termsFor(s) {
    const price = s.suggestedPriceUsd;
    const r2 = (x: number) => Math.round(x * 100) / 100;
    const curve = s.aprCurve?.length ? [...s.aprCurve].sort((a, b) => a.ltv - b.ltv) : undefined;
    const capLtv = s.maxLendableLtv ?? (curve ? curve[curve.length - 1].ltv : FALLBACK_ADVANCE);
    const maxLoanUsd = r2(price * capLtv);
    const suggestedLoanUsd = r2(Math.min(s.suggestedLoanUsd ?? price * FALLBACK_ADVANCE, maxLoanUsd));
    // Pin the curve to the model's own quote at the suggested loan, so the slider shows exactly that APR there
    // (the model's curve is on a 5% grid and would otherwise interpolate slightly differently).
    if (curve && s.aprPct != null && price > 0) {
      const ltv = suggestedLoanUsd / price;
      const i = curve.findIndex((p) => Math.abs(p.ltv - ltv) < 1e-6);
      const pt = { ltv, loanUsd: suggestedLoanUsd, aprPct: s.aprPct, defaultProb90d: s.defaultProb90d };
      if (i >= 0) curve[i] = pt; else { curve.push(pt); curve.sort((a, b) => a.ltv - b.ltv); }
    }
    const t: LoanTerms = {
      suggestedPriceUsd: price,
      suggestedLoanUsd,
      maxLoanUsd,
      maxAdvance: price > 0 ? Math.round((maxLoanUsd / price) * 1000) / 1000 : 0,
      aprPct: 0,
      aprCurve: curve,
      aprSource: s.aprPct != null || curve ? "model" : "policy",
      termOptionsSec: TERM_CHOICES_SEC,
      minInterestPct: 1,
      policy: this.name,
    };
    t.aprPct = s.aprPct ?? (curve ? aprAt(t, suggestedLoanUsd) : aprFromScore(s.score));
    return t;
  },
};

/** Linear interpolation on the model's curve by loan-to-price; clamps at the ends. */
function interp(curve: AprPoint[], ltv: number, key: "aprPct" | "defaultProb90d") {
  const v = (p: AprPoint) => (p[key] ?? 0) as number;
  if (ltv <= curve[0].ltv) return v(curve[0]);
  for (let i = 1; i < curve.length; i++) {
    const a = curve[i - 1], b = curve[i];
    if (ltv <= b.ltv) return v(a) + ((ltv - a.ltv) / (b.ltv - a.ltv)) * (v(b) - v(a));
  }
  return v(curve[curve.length - 1]);
}

/** APR for a specific loan size: the borrower moves along the curve. */
export function aprAt(t: LoanTerms, loanUsd: number) {
  if (!t.aprCurve?.length || !(t.suggestedPriceUsd > 0)) return t.aprPct;
  return Math.round(interp(t.aprCurve, loanUsd / t.suggestedPriceUsd, "aprPct") * 10) / 10;
}

/** Model's 90-day default probability at this loan size, if it has one. */
export function defaultProbAt(t: LoanTerms, loanUsd: number): number | undefined {
  if (!t.aprCurve?.length || t.aprCurve[0].defaultProb90d == null) return undefined;
  return Math.round(interp(t.aprCurve, loanUsd / t.suggestedPriceUsd, "defaultProb90d") * 10000) / 10000;
}

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
