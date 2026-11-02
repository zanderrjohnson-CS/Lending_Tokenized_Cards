import type { CatalogCard, Grade, ScoreResult } from "../types";

/**
 * The seam between the website and the scoring model.
 * Today: FactorsJsonProvider (output/factors.json from compute_factors.py).
 * Later: HttpScoreProvider pointing at the ML service (set SCORE_API_URL).
 */
export interface ScoreProvider {
  name: string;
  catalog(): Promise<CatalogCard[]>;
  score(cardKey: string, grade: Grade): Promise<ScoreResult | null>;
}
