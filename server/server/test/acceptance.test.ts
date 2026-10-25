import { test } from "node:test";
import assert from "node:assert/strict";
import nacl from "tweetnacl";
import bs58 from "bs58";
import { openDb } from "../src/db.js";
import { ScoreClient } from "../src/scoreClient.js";
import { Indexer, rebuildFromStoredEvents } from "../src/indexer.js";
import { ReplaySource } from "../src/chain/replaySource.js";
import { runReminders } from "../src/reminders.js";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { profileMessage } from "../src/profiles.js";
import { DEMO_CARDS, WALLETS, UNVERIFIED_MINT } from "../scripts/synth.js";
import type { ChainEvent } from "../src/events.js";

const cfg = { ...loadConfig(), scoreApiUrl: "http://score.test", adminToken: "secret" };
const [alice, bob, carol] = WALLETS.map((w) => w.wallet);
const now = Math.floor(Date.now() / 1000);

function fakeScore(mint: string) {
  const c = DEMO_CARDS.find((x) => x.mint === mint);
  if (!c) return null;
  return {
    token_mint: mint, card_id: c.id,
    card: { name: c.name, set: c.set, number: c.number, year: c.year, grade_company: c.company, grade: c.grade, cert_number: c.cert },
    verified: mint !== UNVERIFIED_MINT, fair_value_usd: c.value, value_low_usd: 1, value_high_usd: 2, confidence: 0.7,
    liquidity_score: 60, est_days_to_sell: 20, recovery_floor_usd: 100, loan_score: 600,
    recommended_terms: { max_loan_usd: 1000, term_days: 30, interest_bps: 500, ltv_pct: 45 },
    explanation: ["x"], model_version: "t", as_of: new Date().toISOString(),
  };
}
const okFetch = (async (url: string) => {
  const s = fakeScore(decodeURIComponent(String(url).split("/score/")[1]));
  return s ? new Response(JSON.stringify(s)) : new Response("{}", { status: 404 });
}) as unknown as typeof fetch;
const downFetch = (async () => { throw new Error("connection refused"); }) as unknown as typeof fetch;

let n = 0;
const ev = (name: ChainEvent["name"], at: number, data: Record<string, unknown>): ChainEvent =>
  ({ signature: `sig${n}`, ix: 0, slot: 100 + n++, blockTime: at, name, data });
const events: ChainEvent[] = [
  ev("OfferCreated", now - 5000, { loan_id: "1", lender: carol, token_mint: DEMO_CARDS[0].mint, principal_usdc: "500000000", interest_bps: 500, term_days: 30, offer_expires_at: now + 86400 }),
  ev("OfferCreated", now - 4000, { loan_id: "2", lender: carol, token_mint: DEMO_CARDS[1].mint, principal_usdc: "1500000000", interest_bps: 500, term_days: 30, offer_expires_at: now + 86400 }),
  ev("OfferCreated", now - 3000, { loan_id: "3", lender: carol, token_mint: UNVERIFIED_MINT, principal_usdc: "10000000", interest_bps: 500, term_days: 30, offer_expires_at: now + 86400 }),
  ev("OfferCreated", now - 2000, { loan_id: "4", lender: carol, token_mint: DEMO_CARDS[2].mint, principal_usdc: "300000000", interest_bps: 500, term_days: 30, offer_expires_at: now + 86400 }),
  ev("LoanStarted", now - 1900, { loan_id: "4", borrower: alice, started_at: now - 1900, due_at: now + 20 * 3600 }), // due in 20h
  ev("OfferCreated", now - 1800, { loan_id: "5", lender: carol, token_mint: DEMO_CARDS[3].mint, principal_usdc: "200000000", interest_bps: 500, term_days: 30, offer_expires_at: now + 86400 }),
  ev("LoanStarted", now - 1700, { loan_id: "5", borrower: bob, started_at: now - 1700, due_at: now + 30 * 86400 }),
  ev("LoanRepaid", now - 100, { loan_id: "5" }),
  ev("OfferCreated", now - 1600, { loan_id: "6", lender: carol, token_mint: DEMO_CARDS[4].mint, principal_usdc: "100000000", interest_bps: 500, term_days: 30, offer_expires_at: now + 86400 }),
  ev("OfferCancelled", now - 1500, { loan_id: "6" }),
];

const make = (fetchImpl = okFetch) => {
  const db = openDb(":memory:");
  const scores = new ScoreClient(db, cfg, fetchImpl);
  const indexer = new Indexer(db, new ReplaySource(events), scores);
  return { db, scores, indexer };
};
const loanList = (db: any) => db.prepare("SELECT loan_id, lender, borrower, token_mint, principal_usd, status, started_at, due_at FROM loans ORDER BY loan_id").all();

test("indexer is idempotent: running twice creates no duplicates", async () => {
  const { db, indexer } = make();
  await indexer.run();
  const first = { loans: loanList(db), rep: db.prepare("SELECT * FROM reputation ORDER BY wallet").all(), notes: db.prepare("SELECT COUNT(*) c FROM notifications").get() };
  const r2 = await indexer.run();
  assert.equal(r2.stored, 0);
  assert.deepEqual(loanList(db), first.loans);
  assert.deepEqual(db.prepare("SELECT * FROM reputation ORDER BY wallet").all(), first.rep);
  assert.deepEqual(db.prepare("SELECT COUNT(*) c FROM notifications").get(), first.notes);
  assert.equal(first.loans.length, 6);
  assert.deepEqual(first.loans.map((l: any) => l.status), ["open", "open", "open", "active", "repaid", "cancelled"]);
});

test("fresh database + re-run reproduces the same loans; rebuild from stored events too", async () => {
  const a = make(); await a.indexer.run();
  const b = make(); await b.indexer.run();
  assert.deepEqual(loanList(b.db), loanList(a.db));
  rebuildFromStoredEvents(a.db);
  assert.deepEqual(loanList(a.db), loanList(b.db));
  assert.equal((a.db.prepare("SELECT COUNT(*) c FROM reputation").get() as any).c, 2);
});

test("reputation credits both parties from chain history only", async () => {
  const { db, indexer } = make(); await indexer.run();
  const r = (w: string) => db.prepare("SELECT * FROM reputation WHERE wallet=?").get(w) as any;
  assert.equal(r(bob).loans_repaid, 1); assert.equal(r(carol).loans_repaid, 1);
  assert.equal(r(bob).volume_usd, 200); assert.equal(r(alice), undefined);
});

test("reminder appears for a loan due within 24 hours, only once", async () => {
  const { db, indexer } = make(); await indexer.run();
  assert.ok(runReminders(db) >= 2);
  const rows = db.prepare("SELECT wallet, type FROM notifications WHERE loan_id='4' AND type LIKE 'due_%'").all() as any[];
  assert.deepEqual(rows.map((r) => r.type).sort(), ["due_24h", "due_24h"]);
  assert.ok(rows.some((r) => r.wallet === alice));
  assert.equal(runReminders(db), 0);
});

test("API: score-limit flag, unverified gets no terms, score_at_offer stored", async () => {
  const { db, scores, indexer } = make(); await indexer.run();
  const app = buildApp({ db, cfg, scores, indexer, holdings: null });
  const res = await app.inject("/api/loans?status=open");
  assert.equal(res.statusCode, 200);
  const by = Object.fromEntries(res.json().loans.map((l: any) => [l.loan_id, l]));
  assert.equal(by["1"].within_score_limit, true);   // 500 <= 1000
  assert.equal(by["2"].within_score_limit, false);  // 1500 > 1000
  assert.equal(by["3"].within_score_limit, null);   // unverified
  assert.equal(by["3"].card.verified, false);
  assert.equal(by["3"].score.recommended_terms, null);
  assert.equal(by["1"].score_at_offer.loan_score, 600);
});

test("score service down: stale cache served, no cache gives null, pages never 500", async () => {
  const { db, indexer } = make(); await indexer.run(); // fills cache
  let t = now;
  const down = new ScoreClient(db, { ...cfg, scoreCacheTtlSeconds: 1 }, downFetch, () => (t += 1000));
  const app = buildApp({ db, cfg, scores: down, indexer, holdings: null });
  const r1 = await app.inject(`/api/cards/${DEMO_CARDS[0].mint}`);
  assert.equal(r1.statusCode, 200);
  assert.equal(r1.json().score.stale, true); assert.ok(r1.json().score.loan_score);

  const empty = openDb(":memory:");
  const app2 = buildApp({ db: empty, cfg, scores: new ScoreClient(empty, cfg, downFetch), indexer: null, holdings: null });
  assert.equal((await app2.inject(`/api/cards/${DEMO_CARDS[0].mint}`)).statusCode, 404);
  const l = await app.inject("/api/loans?status=open");
  assert.equal(l.statusCode, 200);
});

test("invalid score payload is rejected, never invented", async () => {
  const db = openDb(":memory:");
  const bad = (async () => new Response(JSON.stringify({ token_mint: "x" }))) as unknown as typeof fetch;
  const r = await new ScoreClient(db, cfg, bad).getScore(DEMO_CARDS[0].mint);
  assert.equal(r.score, null);
});

test("profile updates need a valid, fresh, non-replayed signature", async () => {
  const db = openDb(":memory:");
  const app = buildApp({ db, cfg, scores: new ScoreClient(db, cfg, okFetch), indexer: null, holdings: null });
  const kp = nacl.sign.keyPair(); const wallet = bs58.encode(kp.publicKey);
  const body = (o: { username: string | null; avatar_url: string | null; timestamp: number }, signer = kp) => ({
    ...o, signature: bs58.encode(nacl.sign.detached(new TextEncoder().encode(profileMessage({ wallet, ...o })), signer.secretKey)),
  });
  const put = (payload: object) => app.inject({ method: "PUT", url: `/api/profile/${wallet}`, payload });
  const ts = now;

  assert.equal((await put({ username: "will_uo", avatar_url: null, timestamp: ts, signature: bs58.encode(new Uint8Array(64).fill(7)) })).statusCode, 401);
  assert.equal((await put(body({ username: "will_uo", avatar_url: null, timestamp: ts }, nacl.sign.keyPair()))).statusCode, 401); // wrong key
  const good = body({ username: "will_uo", avatar_url: null, timestamp: ts });
  const ok = await put(good); assert.equal(ok.statusCode, 200); assert.equal(ok.json().username, "will_uo");
  assert.equal((await put(good)).statusCode, 401);                                                  // replay
  assert.equal((await put({ ...good, username: "hacker" })).statusCode, 401);                       // tampered
  assert.equal((await put(body({ username: "old", avatar_url: null, timestamp: ts - 1000 }))).statusCode, 401); // outside window
  const kp2 = nacl.sign.keyPair(); const w2 = bs58.encode(kp2.publicKey);
  const p2 = { username: "WILL_UO", avatar_url: null, timestamp: ts };
  const taken = await app.inject({ method: "PUT", url: `/api/profile/${w2}`, payload: { ...p2, signature: bs58.encode(nacl.sign.detached(new TextEncoder().encode(profileMessage({ wallet: w2, ...p2 })), kp2.secretKey)) } });
  assert.equal(taken.statusCode, 409);
});

test("admin rebuild is closed without the token", async () => {
  const { db, scores, indexer } = make();
  const app = buildApp({ db, cfg, scores, indexer, holdings: null });
  assert.equal((await app.inject({ method: "POST", url: "/api/admin/rebuild" })).statusCode, 403);
  assert.equal((await app.inject({ method: "POST", url: "/api/admin/rebuild", headers: { "x-admin-token": "secret" } })).statusCode, 200);
});
