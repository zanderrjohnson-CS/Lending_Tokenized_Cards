// Stand-in "suggested price" until the ML thread's web_cards.json exists.
// For each card: recency-weighted median of ungraded sold prices (14-day half-life, so a sale a week
// ago counts ~70% and one three months ago ~1%), after dropping obvious damaged-copy / lot outliers,
// then nudged by half the market-wide 30-day trend (median across our cards, capped at +/-10%).
//   npx tsx scripts/build-prices.ts  ->  data/prices.json
import fs from "fs";
import path from "path";

const HALF_LIFE_DAYS = 14;
const raw = fs.readFileSync(path.join(__dirname, "../data/pricecharting_2026-10-26.txt"), "utf8");
const factors = JSON.parse(fs.readFileSync(path.join(__dirname, "../data/factors.json"), "utf8"));
const asof = Date.parse(factors.asof);

const sales: Record<string, { t: number; p: number }[]> = {};
let cur = "";
for (const line of raw.split("\n")) {
  if (line.startsWith("== ")) cur = line.slice(3).trim();
  else if (line.startsWith("SALE|") && cur) {
    const [, d, p] = line.split("|");
    (sales[cur] ??= []).push({ t: Date.parse(d), p: Number(p) });
  }
}

const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
function weightedMedian(xs: { p: number; w: number }[]) {
  const s = [...xs].sort((a, b) => a.p - b.p);
  const total = s.reduce((a, x) => a + x.w, 0);
  let acc = 0;
  for (const x of s) { acc += x.w; if (acc >= total / 2) return x.p; }
  return s[s.length - 1].p;
}

const momenta = factors.cards.map((c: any) => c.trend_momentum_30d_vs_prior).filter((x: any) => typeof x === "number");
const marketTrend = Math.max(-0.1, Math.min(0.1, median(momenta)));
const marketAdj = marketTrend / 2;

const out: Record<string, any> = {};
for (const [key, list] of Object.entries(sales)) {
  const med = median(list.map((s) => s.p));
  const clean = list.filter((s) => s.p >= 0.5 * med && s.p <= 2 * med);
  const weighted = clean.map((s) => ({ p: s.p, w: Math.pow(0.5, Math.max(0, (asof - s.t) / 86400000) / HALF_LIFE_DAYS) }));
  const wm = weightedMedian(weighted);
  const last = clean.reduce((a, b) => (b.t > a.t ? b : a));
  out[key] = {
    suggested_price_usd: Math.round(wm * (1 + marketAdj) * 100) / 100,
    price_basis: {
      method: `recency-weighted median, ${HALF_LIFE_DAYS}-day half-life, + half of market 30-day trend`,
      n_sales: clean.length,
      outliers_dropped: list.length - clean.length,
      half_life_days: HALF_LIFE_DAYS,
      weighted_median_usd: wm,
      plain_median_usd: Math.round(median(clean.map((s) => s.p)) * 100) / 100,
      last_sale_usd: last.p,
      last_sale_date: new Date(last.t).toISOString().slice(0, 10),
      market_adj_pct: Math.round(marketAdj * 1000) / 10,
    },
  };
}
fs.writeFileSync(path.join(__dirname, "../data/prices.json"), JSON.stringify({ asof: factors.asof, market_trend_30d_pct: Math.round(marketTrend * 1000) / 10, cards: out }, null, 2));
for (const [k, v] of Object.entries(out)) console.log(k.padEnd(24), v.suggested_price_usd, "(plain median", v.price_basis.plain_median_usd + ", n=" + v.price_basis.n_sales + ")");
console.log("market trend", marketTrend);
