// Reads the ML model's output file (card-safety-score/output/ml/web_cards.json, copied to
// data/web_cards.json or pointed at by ML_CARDS_FILE). Re-read when the file changes.
import fs from "fs";
import type { CatalogCard, Grade, ScoreResult } from "../types";
import type { ScoreProvider } from "./provider";
import { META, imageFor } from "./meta";

interface MlCard {
  card_key: string; name: string; set: string; number?: string; image_url?: string; era?: string;
  score: number; factors?: Record<string, number>;
  suggested_price_usd: number; suggested_price_psa10_usd?: number | null;
  price_basis?: Record<string, unknown>;
  max_loan_usd?: number | null; apr_pct?: number | null; default_prob_90d?: number | null;
  suggested_ltv?: number | null; max_lendable_ltv?: number | null;
  negotiation?: { apr_curve?: { ltv: number; loan_usd: number; apr_pct: number; default_prob_90d?: number }[] };
}
interface MlFile { asof: string; model?: string; cards: MlCard[] }

let cache: { mtime: number; data: MlFile } | null = null;
function read(file: string): MlFile {
  const m = fs.statSync(file).mtimeMs;
  if (!cache || cache.mtime !== m) cache = { mtime: m, data: JSON.parse(fs.readFileSync(file, "utf8")) };
  return cache.data;
}

const num = (x: unknown) => (typeof x === "number" && isFinite(x) ? x : undefined);

function toScore(f: MlFile, c: MlCard, grade: Grade): ScoreResult | null {
  const price = grade === "psa10" ? num(c.suggested_price_psa10_usd) : num(c.suggested_price_usd);
  if (price === undefined) return null;
  const scale = grade === "psa10" && c.suggested_price_usd ? price / c.suggested_price_usd : 1;
  return {
    cardKey: c.card_key,
    score: c.score,
    factors: (c.factors ?? {}) as ScoreResult["factors"],
    suggestedPriceUsd: price,
    priceBasis: c.price_basis as ScoreResult["priceBasis"],
    aprPct: num(c.apr_pct),
    // max_loan_usd is the model's suggested (negotiable) loan; max_lendable_ltv is the hard cap.
    suggestedLoanUsd: num(c.max_loan_usd) !== undefined ? Math.round(c.max_loan_usd! * scale * 100) / 100 : undefined,
    maxLendableLtv: num(c.max_lendable_ltv),
    aprCurve: c.negotiation?.apr_curve?.map((p) => ({
      ltv: p.ltv, loanUsd: Math.round(p.loan_usd * scale * 100) / 100, aprPct: p.apr_pct, defaultProb90d: p.default_prob_90d,
    })),
    defaultProb90d: num(c.default_prob_90d),
    asOf: f.asof,
    source: f.model || "ml",
  };
}

export function mlFileProvider(file: string): ScoreProvider {
  return {
    name: "ml-file",
    async catalog() {
      const f = read(file);
      return f.cards.flatMap((c): CatalogCard[] => {
        const s = toScore(f, c, "raw");
        if (!s) return [];
        const psa = toScore(f, c, "psa10");
        return [{
          cardKey: c.card_key, name: c.name, set: c.set, number: c.number ?? META[c.card_key]?.number ?? "",
          era: c.era ?? "", image: imageFor(c.card_key) || c.image_url || "", psa10PriceUsd: psa?.suggestedPriceUsd ?? null, score: s,
        }];
      });
    },
    async score(cardKey, grade) {
      const f = read(file);
      const c = f.cards.find((x) => x.card_key === cardKey);
      return c ? toScore(f, c, grade) : null;
    },
  };
}
