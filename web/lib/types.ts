// Shared types used by both the browser and the API routes.

export type Grade = "raw" | "psa10";

export interface FactorScores {
  liquidity?: number;
  stability?: number;
  volatility?: number;
  spread?: number;
  trend?: number;
  authenticity?: number;
  concentration?: number;
}

/** How the suggested price was worked out, shown to borrowers and lenders. All optional. */
export interface PriceBasis {
  method?: string;
  n_sales?: number;
  half_life_days?: number;
  last_sale_usd?: number;
  last_sale_date?: string;
  plain_median_usd?: number;
  market_adj_pct?: number;
  [k: string]: unknown;
}

/**
 * What any score source (stand-in today, ML model next) must return.
 * Price and safety are separate: suggestedPriceUsd sizes the loan, score sets the rate.
 */
export interface ScoreResult {
  cardKey: string;
  score: number; // 0..100, higher = safer to lend against (trades often at a stable price)
  factors: FactorScores;
  /** What one copy at this grade should sell for now, in USD. */
  suggestedPriceUsd: number;
  priceBasis?: PriceBasis;
  /** Optional model outputs. When missing, the TermsPolicy fills them in. */
  aprPct?: number;
  maxLoanUsd?: number;
  defaultProb90d?: number;
  asOf: string;
  source: string; // e.g. "standin-v2", "ml-v2"
}

export interface CatalogCard {
  cardKey: string;
  name: string;
  set: string;
  number: string;
  era: string;
  image: string;
  /** PSA 10 suggested price, if we have one. */
  psa10PriceUsd: number | null;
  score: ScoreResult; // raw grade
}

export interface LoanTerms {
  suggestedPriceUsd: number;
  maxLoanUsd: number; // borrower can take anything up to this
  maxAdvance: number; // maxLoanUsd / suggestedPriceUsd
  aprPct: number; // set by the score only
  aprSource: "model" | "policy";
  termOptionsSec: number[];
  minInterestPct: number; // minimum finance charge, % of principal
  policy: string;
}

export type LoanStatus =
  | "pending_deposit" // created, collateral not yet in escrow
  | "listed"          // collateral in escrow, waiting for a lender
  | "active"          // funded; borrower owes repayment by dueAt
  | "repaid"          // borrower repaid, collateral returned
  | "defaulted"       // lender claimed collateral after dueAt
  | "cancelled";      // borrower withdrew before funding

export interface TokenizedCard {
  mint: string;
  owner: string; // wallet that received the NFT at mint time
  cardKey: string;
  grade: Grade;
  certNumber: string;
  status: "pending" | "minted";
  mintTx?: string;
  createdAt: string;
}

export interface LoanEvent {
  at: string;
  kind: string;
  tx?: string;
  note?: string;
}

export interface Loan {
  id: string;
  mint: string;
  cardKey: string;
  grade: Grade;
  borrower: string;
  lender?: string;
  status: LoanStatus;
  // frozen at listing time
  score: number;
  scoreSource: string;
  suggestedPriceUsd: number;
  priceBasis?: PriceBasis;
  defaultProb90d?: number;
  ltv: number; // principal / suggested price
  aprPct: number;
  termSec: number;
  principalLamports: number;
  repayLamports: number;
  solUsd: number;
  createdAt: string;
  fundedAt?: string;
  dueAt?: string;
  closedAt?: string;
  events: LoanEvent[];
}

export interface Session {
  wallet: string;
  role?: "borrower" | "lender";
}
