import fs from "fs";
import path from "path";
import { factorsProvider } from "./factorsProvider";
import { httpProvider } from "./httpProvider";
import { mlFileProvider } from "./mlFileProvider";
import type { ScoreProvider } from "./provider";

/** SCORE_API_URL (ML service) > ML_CARDS_FILE or data/web_cards.json (ML output file) > stand-in. */
export function getScoreProvider(): ScoreProvider {
  if (process.env.SCORE_API_URL) return httpProvider(process.env.SCORE_API_URL);
  const file = process.env.ML_CARDS_FILE || path.join(process.cwd(), "data", "web_cards.json");
  if (fs.existsSync(file)) return mlFileProvider(file);
  return factorsProvider;
}
export type { ScoreProvider };
