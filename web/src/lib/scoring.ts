// Client for the score API. Field names follow docs/02-architecture.md
// (Interface 1) so the real service can be swapped in by setting
// NEXT_PUBLIC_SCORING_API_URL. Without it, mock scores are returned.

export type CardScore = {
  token_mint: string;
  card_id: string;
  card: {
    name: string;
    set: string;
    number: string;
    year: number;
    grade_company: string;
    grade: number;
    cert_number: string;
  };
  verified: boolean;
  fair_value_usd: number;
  value_low_usd: number;
  value_high_usd: number;
  confidence: number;
  liquidity_score: number;
  est_days_to_sell: number;
  recovery_floor_usd: number;
  loan_score: number; // 0 to 1000
  recommended_terms: {
    max_loan_usd: number;
    term_days: number;
    interest_bps: number; // charged over the whole term, 5% = 500
    ltv_pct: number;
  };
  explanation: string[];
  model_version: string;
  as_of: string;
};

export type OwnedCard = {
  token_mint: string;
  card_id: string;
  name: string;
  set: string;
  grade_company: string;
  grade: number;
};

// Placeholder until the wallet's cards come from GET /api/cards?owner={wallet}.
export const DEMO_CARDS: OwnedCard[] = [
  { token_mint: "DemoCardMint11111111111111111111111111111111", card_id: "base1-4-holo-en", name: "Charizard", set: "Base Set", grade_company: "PSA", grade: 10 },
  { token_mint: "DemoCardMint22222222222222222222222222222222", card_id: "base1-58-en", name: "Pikachu", set: "Base Set", grade_company: "PSA", grade: 9 },
  { token_mint: "DemoCardMint33333333333333333333333333333333", card_id: "op01-120-alt-en", name: "Shanks (Alt Art)", set: "Romance Dawn", grade_company: "CGC", grade: 9.5 },
];

const API_URL = process.env.NEXT_PUBLIC_SCORING_API_URL;

export async function getScore(card: OwnedCard): Promise<CardScore> {
  if (!API_URL) return mockScore(card);
  const res = await fetch(`${API_URL}/score/${encodeURIComponent(card.token_mint)}`);
  if (!res.ok) throw new Error(`Scoring API returned ${res.status}`);
  return res.json();
}

function mockScore(card: OwnedCard): CardScore {
  const seed = [...card.card_id].reduce((a, c) => a + c.charCodeAt(0), 0);
  const fair = 150 + (seed % 20) * 60;
  const confidence = 0.6 + (seed % 7) * 0.05;
  const loanScore = 560 + (seed % 9) * 30;
  const ltv = loanScore >= 700 ? 50 : 40;
  return {
    token_mint: card.token_mint,
    card_id: card.card_id,
    card: {
      name: card.name,
      set: card.set,
      number: "",
      year: 1999,
      grade_company: card.grade_company,
      grade: card.grade,
      cert_number: "",
    },
    verified: true,
    fair_value_usd: fair,
    value_low_usd: Math.round(fair * 0.88),
    value_high_usd: Math.round(fair * 1.15),
    confidence: Math.min(confidence, 0.95),
    liquidity_score: 0.5 + (seed % 5) * 0.1,
    est_days_to_sell: 5 + (seed % 20),
    recovery_floor_usd: Math.round(fair * 0.65),
    loan_score: loanScore,
    recommended_terms: {
      max_loan_usd: Math.round((fair * ltv) / 100),
      term_days: 30,
      interest_bps: loanScore >= 700 ? 500 : 800,
      ltv_pct: ltv,
    },
    explanation: ["Mock score: the scoring engine is not connected yet."],
    model_version: "web-mock",
    as_of: new Date().toISOString(),
  };
}
