// Stand-in provider until the ML model's web_cards.json is available.
// Score: the factor composite from compute_factors.py (liquidity is its biggest weight).
// Suggested price: data/prices.json from scripts/build-prices.ts (recency-weighted, market-adjusted).
import factors from "@/data/factors.json";
import prices from "@/data/prices.json";
import type { CatalogCard, Grade, ScoreResult } from "../types";
import type { ScoreProvider } from "./provider";
import { META, imageFor } from "./meta";

type Row = (typeof factors.cards)[number];
const priceMap = prices.cards as Record<string, { suggested_price_usd: number; price_basis: Record<string, any> }>;

function toScore(r: Row, grade: Grade): ScoreResult {
  const p = priceMap[r.card_key];
  const raw = p?.suggested_price_usd ?? r.spr_median_sold_30d;
  const mult = r.auth_psa10_over_raw ?? null;
  return {
    cardKey: r.card_key,
    score: r.safety_score,
    factors: {
      liquidity: r.score_liquidity,
      volatility: r.score_volatility,
      spread: r.score_spread,
      trend: r.score_trend,
      authenticity: r.score_authenticity,
      concentration: r.score_concentration,
    },
    suggestedPriceUsd: grade === "psa10" && mult ? Math.round(raw * mult * 100) / 100 : raw,
    priceBasis: grade === "psa10" && mult ? { ...p?.price_basis, method: `raw suggested price x ${mult} PSA 10 multiple` } : p?.price_basis,
    asOf: factors.asof,
    source: "standin-v2",
  };
}

export const factorsProvider: ScoreProvider = {
  name: "standin-v2",
  async catalog() {
    return factors.cards.map((r): CatalogCard => ({
      cardKey: r.card_key, name: r.name, set: r.set, number: META[r.card_key]?.number ?? "", era: r.era,
      image: imageFor(r.card_key),
      psa10PriceUsd: r.auth_psa10_over_raw ? toScore(r, "psa10").suggestedPriceUsd : null,
      score: toScore(r, "raw"),
    }));
  },
  async score(cardKey, grade) {
    const r = factors.cards.find((c) => c.card_key === cardKey);
    return r ? toScore(r, grade) : null;
  },
};
