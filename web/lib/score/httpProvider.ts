import type { ScoreProvider } from "./provider";
import type { CatalogCard, Grade, ScoreResult } from "../types";

/**
 * Adapter for the ML scoring service. Expected endpoints (adjust to the ML thread's API):
 *   GET {SCORE_API_URL}/catalog              -> CatalogCard[]
 *   GET {SCORE_API_URL}/score?card=&grade=   -> ScoreResult
 */
export function httpProvider(base: string): ScoreProvider {
  return {
    name: "http",
    async catalog() {
      const r = await fetch(`${base}/catalog`, { cache: "no-store" });
      return (await r.json()) as CatalogCard[];
    },
    async score(cardKey: string, grade: Grade) {
      const r = await fetch(`${base}/score?card=${encodeURIComponent(cardKey)}&grade=${grade}`, { cache: "no-store" });
      return r.ok ? ((await r.json()) as ScoreResult) : null;
    },
  };
}
