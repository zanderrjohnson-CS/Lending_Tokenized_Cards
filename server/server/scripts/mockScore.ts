/** Stand-in for workstream B's mock mode, so D can run alone. All values are SYNTHETIC. */
import http from "node:http";
import { DEMO_CARDS } from "./synth.js";

const port = Number(process.env.MOCK_SCORE_PORT ?? 8000);
const byMint = new Map(DEMO_CARDS.map((c) => [c.mint, c]));

function score(mint: string) {
  const c = byMint.get(mint);
  if (!c) return null;
  const verified = c !== DEMO_CARDS[5];
  const fair = c.value;
  return {
    token_mint: mint, card_id: c.id,
    card: { name: c.name, set: c.set, number: c.number, year: c.year, grade_company: c.company, grade: c.grade, cert_number: c.cert },
    verified,
    fair_value_usd: fair, value_low_usd: fair * 0.85, value_high_usd: fair * 1.15,
    confidence: 0.72, liquidity_score: 64, est_days_to_sell: 21, recovery_floor_usd: fair * 0.6,
    loan_score: 640,
    recommended_terms: { max_loan_usd: Math.round(fair * 0.45), term_days: 30, interest_bps: 500, ltv_pct: 45 },
    explanation: ["SYNTHETIC mock score for local development; not a real valuation."],
    model_version: "mock-0", as_of: new Date().toISOString(),
  };
}

http.createServer((req, res) => {
  const send = (code: number, body: unknown) => { res.writeHead(code, { "content-type": "application/json" }); res.end(JSON.stringify(body)); };
  const m = /^\/score\/([^/]+)$/.exec(req.url ?? "");
  if (req.url === "/health") return send(200, { model_version: "mock-0", data_as_of: new Date().toISOString() });
  if (m) { const s = score(decodeURIComponent(m[1])); return s ? send(200, s) : send(404, { error: "unknown mint" }); }
  send(404, { error: "not found" });
}).listen(port, () => console.log(`mock score service (synthetic) on :${port}`));
