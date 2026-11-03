"use client";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import Gate from "@/components/Gate";
import { useCatalog, useFetch, useLoanAction, usePlatform, type CatalogEntry } from "@/components/hooks";
import { AddrLink, CardArt, Countdown, Empty, FactorBars, Modal, PriceBasisNote, ScoreRing, StatusPill, Steps } from "@/components/ui";
import { api, confirmWithRetry, signAndSend, sol, usd } from "@/lib/client";
import { fmtTerm, repayAmount } from "@/lib/terms";
import { SOL_USD, usdToLamports } from "@/lib/config";
import type { Grade, Loan, LoanTerms, ScoreResult, TokenizedCard } from "@/lib/types";
import { useSession } from "../providers";
import { META } from "@/lib/score/meta";

const STARTER = new Set(Object.keys(META));

type MyCard = TokenizedCard & { score: ScoreResult | null; terms: LoanTerms | null; openLoanId: string | null; openLoanStatus: string | null };
type PubLoan = Loan & { busy: boolean };

export default function BorrowPage() {
  return (
    <Gate why="Sign in to tokenize a card and borrow against it.">
      <Borrow />
    </Gate>
  );
}

function Borrow() {
  const { role, setRole } = useSession();
  useEffect(() => { if (role !== "borrower") setRole("borrower").catch(() => {}); }, [role, setRole]);
  const { byKey } = useCatalog();
  const cards = useFetch<MyCard[]>("/api/cards");
  const loans = useFetch<PubLoan[]>("/api/loans?scope=mine");
  const [tokenizing, setTokenizing] = useState(false);
  const [quoting, setQuoting] = useState<MyCard | null>(null);
  const reload = () => { cards.reload(); loans.reload(); };
  const open = (loans.data ?? []).filter((l) => ["pending_deposit", "listed", "active"].includes(l.status));
  const closed = (loans.data ?? []).filter((l) => !["pending_deposit", "listed", "active"].includes(l.status));

  return (
    <div className="page">
      <div className="page-head">
        <div><h1>Borrow</h1><p className="muted">Pledge a card token, get SOL. Repay by the due date and the card comes back.</p></div>
        <button className="btn primary" onClick={() => setTokenizing(true)}>+ Tokenize a card</button>
      </div>

      <h2>Your loans</h2>
      {open.length === 0 ? <Empty>No open loans.</Empty> : (
        <div className="loan-list">{open.map((l) => <BorrowerLoan key={l.id} loan={l} card={byKey.get(l.cardKey)} onChange={reload} />)}</div>
      )}

      <h2>Your card tokens</h2>
      {cards.error && <p className="err">{cards.error}</p>}
      {cards.data && cards.data.length === 0 ? (
        <Empty action={<button className="btn" onClick={() => setTokenizing(true)}>Tokenize your first card</button>}>
          You don&apos;t have any card tokens yet.
        </Empty>
      ) : (
        <div className="card-grid">
          {(cards.data ?? []).map((c) => {
            const cat = byKey.get(c.cardKey);
            return (
              <div key={c.mint} className="tcard">
                {cat && <CardArt src={cat.image} alt={cat.name} />}
                <div className="tcard-body">
                  <div className="row-between">
                    <div><b>{cat?.name}</b><div className="muted small">{cat?.set} · {c.grade === "psa10" ? `PSA 10 #${c.certNumber}` : "Raw"}</div></div>
                    {c.score && <ScoreRing score={c.score.score} size={48} />}
                  </div>
                  <div className="kv"><span>Suggested price</span><b>{c.score ? usd(c.score.suggestedPriceUsd) : "—"}</b></div>
                  {c.terms && <div className="kv"><span>Borrow up to</span><b>{usd(c.terms.maxLoanUsd)} at {c.terms.aprPct}%</b></div>}
                  <div className="kv"><span>Token</span><AddrLink addr={c.mint} /></div>
                  {c.openLoanId ? (
                    <Link className="btn ghost full" href={`/loans/${c.openLoanId}`}>{c.openLoanStatus === "active" ? "Pledged on an active loan" : "In a loan request"} →</Link>
                  ) : c.terms && c.terms.maxLoanUsd > 0 ? (
                    <button className="btn primary full" onClick={() => setQuoting(c)}>Get a loan quote</button>
                  ) : (
                    <button className="btn full" disabled>No price data yet</button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {closed.length > 0 && (<>
        <h2>History</h2>
        <div className="loan-list">{closed.map((l) => <BorrowerLoan key={l.id} loan={l} card={byKey.get(l.cardKey)} onChange={reload} />)}</div>
      </>)}

      <TokenizeModal open={tokenizing} onClose={() => setTokenizing(false)} onDone={() => { setTokenizing(false); reload(); }} />
      {quoting && <QuoteModal card={quoting} cat={byKey.get(quoting.cardKey)} onClose={() => setQuoting(null)} onDone={() => { setQuoting(null); reload(); }} />}
    </div>
  );
}

function BorrowerLoan({ loan, card, onChange }: { loan: PubLoan; card?: CatalogEntry; onChange: () => void }) {
  const { run, steps, busy } = useLoanAction(onChange);
  return (
    <div className="loan">
      {card && <CardArt src={card.image} alt={card.name} small />}
      <div className="loan-main">
        <div className="row-between">
          <Link href={`/loans/${loan.id}`}><b>{card?.name ?? loan.cardKey}</b></Link>
          <StatusPill status={loan.status} />
        </div>
        <div className="loan-nums">
          <span><b>{sol(loan.principalLamports)}</b> SOL borrowed</span>
          <span><b>{loan.aprPct}%</b> APR</span>
          <span>{fmtTerm(loan.termSec)}</span>
          <span>repay <b>{sol(loan.repayLamports, 4)}</b> SOL</span>
          {loan.status === "active" && loan.dueAt && <span><Countdown to={loan.dueAt} /></span>}
        </div>
        <Steps steps={steps} />
      </div>
      <div className="loan-actions">
        {loan.status === "pending_deposit" && <button className="btn primary" disabled={busy} onClick={() => run(loan.id, "deposit", { sign: "Move card token to escrow", confirm: "Escrow confirms receipt" })}>Deposit to escrow</button>}
        {loan.status === "active" && <button className="btn primary" disabled={busy} onClick={() => run(loan.id, "repay", { sign: "Repay lender and get card back (one transaction)", confirm: "Escrow confirms release" })}>Repay {sol(loan.repayLamports, 4)} SOL</button>}
        {(loan.status === "listed" || loan.status === "pending_deposit") && <button className="btn ghost" disabled={busy || loan.busy} onClick={() => run(loan.id, "cancel", { sign: "Take card back from escrow", confirm: "Escrow confirms release" })}>Cancel</button>}
      </div>
    </div>
  );
}

function TokenizeModal({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: () => void }) {
  const { catalog } = useCatalog();
  const platform = usePlatform();
  const wallet = useWallet();
  const { connection } = useConnection();
  const [key, setKey] = useState<string | null>(null);
  const [grade, setGrade] = useState<Grade>("raw");
  const [cert, setCert] = useState("");
  const [q, setQ] = useState("");
  const { steps, busy, setBusy, setSteps, push } = useLoanAction();
  // Starter cards by default; search reaches every card the model prices.
  const shown = q.trim()
    ? catalog.filter((x) => `${x.name} ${x.set} ${x.number}`.toLowerCase().includes(q.trim().toLowerCase())).slice(0, 40)
    : catalog.filter((x) => STARTER.has(x.cardKey));
  const c = catalog.find((x) => x.cardKey === key);
  const value = c ? (grade === "psa10" && c.psa10PriceUsd ? c.psa10PriceUsd : c.score.suggestedPriceUsd) : 0;

  const mint = async () => {
    setBusy(true); setSteps([]);
    try {
      push({ label: "Vault prepares the card token", state: "doing" });
      const built = await api("/api/cards", { cardKey: key, grade, certNumber: cert });
      push({ label: "Vault prepares the card token", state: "done" });
      push({ label: "Approve the mint in your wallet", state: "doing", detail: "Approve in your wallet (set to Devnet). You pay ~0.004 devnet SOL in fees and rent" });
      const sig = await signAndSend(wallet, connection, built);
      push({ label: "Approve the mint in your wallet", state: "done", tx: sig });
      push({ label: "Checking the token on-chain", state: "doing" });
      await confirmWithRetry(() => api("/api/cards/confirm", { mint: built.mint, signature: sig }));
      push({ label: "Checking the token on-chain", state: "done" });
      setTimeout(onDone, 900);
    } catch (e: any) {
      setSteps((x) => x.map((s) => (s.state === "doing" ? { ...s, state: "error", detail: e.message } : s)));
    } finally { setBusy(false); }
  };

  return (
    <Modal open={open} onClose={onClose} title="Tokenize a card" wide>
      <div className="callout">
        <b>How this works for real:</b> you ship the card to an insured vault, it gets authenticated (or the PSA slab is verified),
        and only then does the vault issue a 1-of-1 token to your wallet. In this demo the vault {platform && <AddrLink addr={platform.vault} />} signs immediately.
      </div>
      <input className="picker-search" placeholder={`Search ${catalog.length} cards by name, set or number`} value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="picker">
        {shown.length === 0 && <p className="muted">No cards match.</p>}
        {shown.map((x) => (
          <button key={x.cardKey} className={`pick ${key === x.cardKey ? "on" : ""}`} onClick={() => setKey(x.cardKey)}>
            <CardArt src={x.image} alt={x.name} small />
            <span>{x.name}</span><small>{x.set}</small>
          </button>
        ))}
      </div>
      {c && (
        <div className="tok-form">
          <div className="seg">
            <button className={grade === "raw" ? "on" : ""} onClick={() => setGrade("raw")}>Raw</button>
            <button className={grade === "psa10" ? "on" : ""} onClick={() => setGrade("psa10")} disabled={!c.psa10PriceUsd}>PSA 10</button>
          </div>
          {grade === "psa10" && <input placeholder="PSA cert number" value={cert} onChange={(e) => setCert(e.target.value.replace(/\D/g, ""))} />}
          <div className="kv"><span>Suggested price</span><b>{usd(value)}</b></div>
          {grade === "raw" && <PriceBasisNote basis={c.score.priceBasis} />}
          <div className="kv"><span>Safety score</span><b>{c.score.score} / 100</b></div>
          <button className="btn primary" disabled={busy || (grade === "psa10" && cert.length < 6)} onClick={mint}>Issue card token</button>
        </div>
      )}
      <Steps steps={steps} />
    </Modal>
  );
}

function QuoteModal({ card, cat, onClose, onDone }: { card: MyCard; cat?: CatalogEntry; onClose: () => void; onDone: () => void }) {
  const terms = card.terms!, score = card.score!;
  const wallet = useWallet();
  const { connection } = useConnection();
  const platform = usePlatform();
  const maxLamports = usdToLamports(terms.maxLoanUsd);
  const priceLamports = usdToLamports(score.suggestedPriceUsd);
  const [pct, setPct] = useState(100); // % of max
  const [term, setTerm] = useState(30 * 86400);
  const principal = Math.floor((maxLamports * pct) / 100);
  const repay = useMemo(() => repayAmount(principal, terms.aprPct, term, terms.minInterestPct), [principal, term, terms]);
  const { steps, busy, setBusy, setSteps, push } = useLoanAction();
  const [created, setCreated] = useState<string | null>(null);

  const list = async () => {
    setBusy(true); setSteps([]);
    try {
      push({ label: "Locking in terms", state: "doing" });
      const r = await api("/api/loans", { mint: card.mint, principalLamports: principal, termSec: term });
      setCreated(r.loan.id);
      push({ label: "Locking in terms", state: "done" });
      push({ label: "Move card token into escrow", state: "doing", detail: "Approve in your wallet (set to Devnet)" });
      const sig = await signAndSend(wallet, connection, r);
      push({ label: "Move card token into escrow", state: "done", tx: sig });
      push({ label: "Escrow confirms receipt", state: "doing" });
      await confirmWithRetry(() => api(`/api/loans/${r.loan.id}`, { action: "deposit", phase: "confirm", signature: sig }));
      push({ label: "Escrow confirms receipt", state: "done", detail: "Your loan is now visible to lenders" });
      setTimeout(onDone, 1200);
    } catch (e: any) {
      setSteps((x) => x.map((s) => (s.state === "doing" ? { ...s, state: "error", detail: e.message } : s)));
    } finally { setBusy(false); }
  };

  return (
    <Modal open onClose={created && !busy ? onDone : onClose} title="Your loan quote" wide>
      <div className="quote">
        <div className="quote-left">
          {cat && <CardArt src={cat.image} alt={cat.name} />}
          <div className="row-between"><b>{cat?.name}</b><ScoreRing score={score.score} /></div>
          <FactorBars factors={score.factors} />
          <p className="fine">Safety score from {score.source}, data as of {score.asOf}. It sets your rate, not your loan size.</p>
        </div>
        <div className="quote-right">
          <div className="price-hero">
            <span>Suggested price</span>
            <b>{usd(score.suggestedPriceUsd)} <small className="muted">≈ {sol(priceLamports)} SOL</small></b>
            <PriceBasisNote basis={score.priceBasis} />
          </div>
          <div className="terms-strip">
            <div><span>Borrow up to</span><b>{usd(terms.maxLoanUsd)}</b></div>
            <div><span>APR (from score)</span><b>{terms.aprPct}%</b></div>
          </div>
          <label>Borrow amount</label>
          <div className="big">{sol(principal)} SOL <small>≈ {usd((principal / 1e9) * SOL_USD)}</small></div>
          <input type="range" min={5} max={100} value={pct} onChange={(e) => setPct(Number(e.target.value))} />
          <div className="muted small">{Math.round((principal / priceLamports) * 100)}% of the suggested price (max {Math.round(terms.maxAdvance * 100)}%, {sol(maxLamports)} SOL)</div>
          <label>Term</label>
          <div className="seg wrap">
            {terms.termOptionsSec.map((t) => <button key={t} className={term === t ? "on" : ""} onClick={() => setTerm(t)}>{fmtTerm(t)}</button>)}
          </div>
          <div className="kv"><span>You repay</span><b>{sol(repay, 4)} SOL</b></div>
          <div className="kv"><span>Interest</span><b>{sol(repay - principal, 4)} SOL</b></div>
          <div className="callout small">
            Your card token moves to the escrow account {platform && <AddrLink addr={platform.escrow} />} now.
            You can cancel and take it back until a lender funds. If you don&apos;t repay by the due date, the lender can claim it.
          </div>
          <button className="btn primary full" disabled={busy || !!created || principal <= 0} onClick={list}>List loan and deposit card</button>
          <Steps steps={steps} />
        </div>
      </div>
    </Modal>
  );
}
