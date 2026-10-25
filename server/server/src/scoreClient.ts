import { z } from "zod";
import type { DB } from "./db.js";
import type { Config } from "./config.js";

const num = z.number().finite();

/** The shared score object from docs/02-architecture.md. Extra fields are kept, missing ones are rejected. */
export const ScoreSchema = z
  .object({
    token_mint: z.string(),
    card_id: z.string(),
    card: z.object({
      name: z.string(), set: z.string(), number: z.union([z.string(), z.number()]),
      year: z.number().optional().nullable(),
      grade_company: z.string(), grade: num, cert_number: z.union([z.string(), z.number()]),
    }).passthrough(),
    verified: z.boolean(),
    fair_value_usd: num, value_low_usd: num, value_high_usd: num,
    confidence: num, liquidity_score: num, est_days_to_sell: num,
    recovery_floor_usd: num,
    loan_score: num,
    recommended_terms: z.object({
      max_loan_usd: num, term_days: num, interest_bps: num, ltv_pct: num,
    }).passthrough(),
    explanation: z.array(z.string()),
    model_version: z.string(),
    as_of: z.string(),
  })
  .passthrough();

export type Score = z.infer<typeof ScoreSchema>;

export interface ScoreResult {
  /** null = no score available at all (never invented). */
  score: Score | null;
  /** True when served from cache after a refresh failed. */
  stale: boolean;
  /** Score's own as_of (when the model produced it). */
  as_of: string | null;
  /** When we last fetched it. */
  fetched_at: string | null;
}

export class ScoreClient {
  private inflight = new Map<string, Promise<ScoreResult>>();
  constructor(
    private db: DB,
    private cfg: Pick<Config, "scoreApiUrl" | "scoreCacheTtlSeconds">,
    private fetchImpl: typeof fetch = fetch,
    private now: () => number = () => Math.floor(Date.now() / 1000),
  ) {}

  private cached(mint: string): { score: Score; fetched: number } | null {
    const r = this.db.prepare("SELECT payload_json, fetched_at FROM scores WHERE token_mint = ?").get(mint) as
      | { payload_json: string; fetched_at: number } | undefined;
    if (!r) return null;
    try {
      return { score: JSON.parse(r.payload_json) as Score, fetched: r.fetched_at };
    } catch { return null; }
  }

  /** Fresh cache hit, else fetch, else stale cache, else null. Never throws. */
  getScore(mint: string, opts: { forceRefresh?: boolean } = {}): Promise<ScoreResult> {
    const hit = this.cached(mint);
    const age = hit ? this.now() - hit.fetched : Infinity;
    if (hit && age < this.cfg.scoreCacheTtlSeconds && !opts.forceRefresh) return Promise.resolve(this.wrap(hit, false));

    const running = this.inflight.get(mint);
    if (running) return running;
    const p = this.refresh(mint, hit).finally(() => this.inflight.delete(mint));
    this.inflight.set(mint, p);
    return p;
  }

  private async refresh(mint: string, hit: { score: Score; fetched: number } | null): Promise<ScoreResult> {
    try {
      const res = await this.fetchImpl(`${this.cfg.scoreApiUrl}/score/${encodeURIComponent(mint)}`, {
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) throw new Error(`score service HTTP ${res.status}`);
      const parsed = ScoreSchema.safeParse(await res.json());
      if (!parsed.success) throw new Error(`score response invalid: ${parsed.error.issues[0]?.path.join(".")}`);
      const s = parsed.data;
      this.db.prepare(
        `INSERT INTO scores (token_mint, loan_score, fair_value_usd, confidence, liquidity_score,
           recovery_floor_usd, payload_json, model_version, as_of, fetched_at)
         VALUES (?,?,?,?,?,?,?,?,?,?)
         ON CONFLICT(token_mint) DO UPDATE SET loan_score=excluded.loan_score, fair_value_usd=excluded.fair_value_usd,
           confidence=excluded.confidence, liquidity_score=excluded.liquidity_score,
           recovery_floor_usd=excluded.recovery_floor_usd, payload_json=excluded.payload_json,
           model_version=excluded.model_version, as_of=excluded.as_of, fetched_at=excluded.fetched_at`,
      ).run(mint, s.loan_score, s.fair_value_usd, s.confidence, s.liquidity_score, s.recovery_floor_usd,
        JSON.stringify(s), s.model_version, s.as_of, this.now());
      this.upsertCard(s);
      return this.wrap({ score: s, fetched: this.now() }, false);
    } catch (e) {
      console.warn(`[score] ${mint}: ${(e as Error).message}${hit ? " (serving stale cache)" : " (no cache)"}`);
      return hit ? this.wrap(hit, true) : { score: null, stale: true, as_of: null, fetched_at: null };
    }
  }

  private wrap(h: { score: Score; fetched: number }, stale: boolean): ScoreResult {
    return { score: h.score, stale, as_of: h.score.as_of, fetched_at: new Date(h.fetched * 1000).toISOString() };
  }

  private upsertCard(s: Score) {
    this.db.prepare(
      `INSERT INTO cards (token_mint, card_id, name, "set", grade_company, grade, cert_number, image_url, verified)
       VALUES (?,?,?,?,?,?,?,?,?)
       ON CONFLICT(token_mint) DO UPDATE SET card_id=excluded.card_id, name=excluded.name, "set"=excluded."set",
         grade_company=excluded.grade_company, grade=excluded.grade, cert_number=excluded.cert_number,
         image_url=COALESCE(excluded.image_url, cards.image_url), verified=excluded.verified`,
    ).run(s.token_mint, s.card_id, s.card.name, s.card.set, s.card.grade_company, s.card.grade,
      String(s.card.cert_number), (s.card as any).image_url ?? null, s.verified ? 1 : 0);
  }
}

/** What the API exposes about a score. Unverified cards never get terms. */
export function publicScore(r: ScoreResult, full: boolean) {
  const s = r.score;
  if (!s) return { available: false as const, stale: true, as_of: null };
  const base = {
    available: true as const,
    stale: r.stale,
    as_of: r.as_of,
    fetched_at: r.fetched_at,
    verified: s.verified,
    loan_score: s.loan_score,
    fair_value_usd: s.fair_value_usd,
    confidence: s.confidence,
    liquidity_score: s.liquidity_score,
    recovery_floor_usd: s.recovery_floor_usd,
    model_version: s.model_version,
    recommended_terms: s.verified ? s.recommended_terms : null,
    max_loan_usd: s.verified ? s.recommended_terms.max_loan_usd : null,
  };
  return full ? { ...base, full: s } : base;
}
