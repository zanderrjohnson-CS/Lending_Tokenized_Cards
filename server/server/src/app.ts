import Fastify from "fastify";
import cors from "@fastify/cors";
import { timingSafeEqual } from "node:crypto";
import { z } from "zod";
import type { DB } from "./db.js";
import type { Config } from "./config.js";
import { ScoreClient, publicScore } from "./scoreClient.js";
import { Indexer, rebuildFromStoredEvents } from "./indexer.js";
import { listLoans, serializeLoan, STATUSES } from "./loans.js";
import { getProfile, updateProfile, ProfileError } from "./profiles.js";
import { listNotifications } from "./notifications.js";
import type { HoldingsReader } from "./cards.js";
import { isPubkey } from "./validate.js";

export interface Deps {
  db: DB; cfg: Config; scores: ScoreClient; indexer: Indexer | null; holdings: HoldingsReader | null;
}

const pubkey = z.string().refine(isPubkey, "invalid public key");

export function buildApp(d: Deps) {
  const app = Fastify({ logger: false });
  app.register(cors, { origin: true });

  app.setErrorHandler((err: any, _req, reply) => {
    if (err instanceof ProfileError) return reply.code(err.status).send({ error: err.message });
    if (err instanceof z.ZodError) return reply.code(400).send({ error: "bad request", issues: err.issues.map((i) => `${i.path.join(".")}: ${i.message}`) });
    console.error("[api]", err);
    return reply.code(err.statusCode ?? 500).send({ error: err.statusCode && err.statusCode < 500 ? err.message : "internal error" });
  });

  app.get("/health", async () => ({
    ok: true,
    cursor: d.indexer?.getCursor() ?? null,
    score_api: d.cfg.scoreApiUrl,
    time: new Date().toISOString(),
  }));

  // ---- cards ----
  app.get("/api/cards", async (req) => {
    const { owner } = z.object({ owner: pubkey }).parse(req.query);
    if (!d.holdings) throw Object.assign(new Error("card reader not configured"), { statusCode: 503 });
    let mints: string[];
    try { mints = await d.holdings.cardMintsOf(owner); }
    catch (e) {
      console.warn("[cards] RPC failed:", (e as Error).message);
      throw Object.assign(new Error("could not read wallet from chain, try again"), { statusCode: 502 });
    }
    const cards = await Promise.all(mints.map(async (m) => {
      const s = await d.scores.getScore(m); // also fills the cards table
      const c = d.db.prepare('SELECT token_mint, card_id, name, "set", grade_company, grade, cert_number, image_url, verified FROM cards WHERE token_mint = ?').get(m) as any;
      return { token_mint: m, card: c ? { ...c, verified: !!c.verified } : null, score: publicScore(s, false) };
    }));
    return { owner, cards };
  });

  app.get("/api/cards/:token_mint", async (req, reply) => {
    const { token_mint } = z.object({ token_mint: pubkey }).parse(req.params);
    const s = await d.scores.getScore(token_mint);
    const c = d.db.prepare('SELECT token_mint, card_id, name, "set", grade_company, grade, cert_number, image_url, verified FROM cards WHERE token_mint = ?').get(token_mint) as any;
    if (!c && !s.score) return reply.code(404).send({ error: "unknown card and score service unavailable" });
    return { token_mint, card: c ? { ...c, verified: !!c.verified } : null, score: publicScore(s, true) };
  });

  // ---- loans ----
  app.get("/api/loans", async (req) => {
    const q = z.object({
      status: z.enum(STATUSES).optional(),
      lender: pubkey.optional(), borrower: pubkey.optional(), token_mint: pubkey.optional(),
      limit: z.coerce.number().int().min(1).max(100).default(50),
      offset: z.coerce.number().int().min(0).default(0),
    }).parse(req.query);
    return { loans: await listLoans(d.db, d.scores, q) };
  });

  app.get("/api/loans/:loan_id", async (req, reply) => {
    const { loan_id } = z.object({ loan_id: z.string().min(1).max(64) }).parse(req.params);
    const row = d.db.prepare("SELECT * FROM loans WHERE loan_id = ?").get(loan_id);
    if (!row) return reply.code(404).send({ error: "loan not found" });
    return serializeLoan(d.db, d.scores, row, true);
  });

  // Public and safe to spam: it only reads the chain, and concurrent calls share one run.
  app.post("/api/loans/index", async (_req, reply) => {
    if (!d.indexer) return reply.code(503).send({ error: "indexer not configured" });
    try { return { ok: true, ...(await d.indexer.run()), cursor: d.indexer.getCursor() }; }
    catch (e) {
      console.warn("[indexer]", (e as Error).message);
      return reply.code(502).send({ error: "indexer failed, existing data is unchanged" });
    }
  });

  // Rebuild derived tables from the stored event copy. Disabled unless ADMIN_TOKEN is set.
  app.post("/api/admin/rebuild", async (req, reply) => {
    const given = String(req.headers["x-admin-token"] ?? "");
    const want = d.cfg.adminToken;
    const ok = want.length > 0 && given.length === want.length && timingSafeEqual(Buffer.from(given), Buffer.from(want));
    if (!ok) return reply.code(403).send({ error: "forbidden" });
    rebuildFromStoredEvents(d.db);
    return { ok: true };
  });

  // ---- profiles ----
  app.get("/api/profile/:wallet", async (req) => {
    const { wallet } = z.object({ wallet: pubkey }).parse(req.params);
    return getProfile(d.db, wallet);
  });

  app.put("/api/profile/:wallet", async (req) => {
    const { wallet } = z.object({ wallet: pubkey }).parse(req.params);
    const b = z.object({
      username: z.string().regex(/^[A-Za-z0-9_]{3,20}$/, "3-20 letters, numbers or _").nullable(),
      avatar_url: z.string().url().max(300).startsWith("https://").nullable(),
      timestamp: z.number().int(),
      signature: z.string().min(80).max(100),
    }).parse(req.body);
    return updateProfile(d.db, { wallet, ...b });
  });

  // ---- notifications ----
  app.get("/api/notifications", async (req) => {
    const { wallet } = z.object({ wallet: pubkey }).parse(req.query);
    return { notifications: listNotifications(d.db, wallet) };
  });

  return app;
}
