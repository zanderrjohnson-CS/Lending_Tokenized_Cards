"use client";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import Gate from "@/components/Gate";
import { useCatalog, useFetch, useLoanAction, useNow, type CatalogEntry } from "@/components/hooks";
import { CardArt, Countdown, Empty, Modal, PriceBasisNote, ScoreRing, StatusPill, Steps } from "@/components/ui";
import { short, sol, usd } from "@/lib/client";
import { fmtTerm } from "@/lib/terms";
import type { Loan } from "@/lib/types";
import { useSession } from "../providers";

type PubLoan = Loan & { busy: boolean };
type Sort = "score" | "apr" | "amount" | "term";

export default function LendPage() {
  return (
    <Gate why="Sign in to fund loans from your wallet.">
      <Lend />
    </Gate>
  );
}

function Lend() {
  const { role, setRole, wallet } = useSession();
  useEffect(() => { if (role !== "lender") setRole("lender").catch(() => {}); }, [role, setRole]);
  const { byKey } = useCatalog();
  const market = useFetch<PubLoan[]>("/api/loans?scope=market");
  const mine = useFetch<PubLoan[]>("/api/loans?scope=lending");
  const reload = () => { market.reload(); mine.reload(); };
  useEffect(() => { const t = setInterval(market.reload, 20000); return () => clearInterval(t); }, [market.reload]);

  const [q, setQ] = useState("");
  const [minScore, setMinScore] = useState(0);
  const [minApr, setMinApr] = useState(0);
  const [maxTermDays, setMaxTermDays] = useState(90);
  const [sort, setSort] = useState<Sort>("score");
  const [funding, setFunding] = useState<PubLoan | null>(null);

  const rows = useMemo(() => {
    const list = (market.data ?? []).filter((l) => {
      const c = byKey.get(l.cardKey);
      const text = `${c?.name} ${c?.set}`.toLowerCase();
      return text.includes(q.toLowerCase()) && l.score >= minScore && l.aprPct >= minApr && l.termSec <= maxTermDays * 86400;
    });
    const key: Record<Sort, (l: PubLoan) => number> = {
      score: (l) => -l.score, apr: (l) => -l.aprPct, amount: (l) => -l.principalLamports, term: (l) => l.termSec,
    };
    return list.sort((a, b) => key[sort](a) - key[sort](b));
  }, [market.data, byKey, q, minScore, minApr, maxTermDays, sort]);


  return (
    <div className="page">
      <div className="page-head">
        <div><h1>Lend</h1><p className="muted">Every loan below is already backed by a card token sitting in escrow.</p></div>
      </div>

      {(mine.data ?? []).length > 0 && (<>
        <h2>Loans you funded</h2>
        <div className="loan-list">{mine.data!.map((l) => <LenderLoan key={l.id} loan={l} card={byKey.get(l.cardKey)} onChange={reload} />)}</div>
      </>)}

      <h2>Marketplace</h2>
      <div className="filters">
        <input placeholder="Search card or set" value={q} onChange={(e) => setQ(e.target.value)} />
        <label className="inline">Min APR <b>{minApr}%</b><input type="range" min={0} max={80} step={2} value={minApr} onChange={(e) => setMinApr(+e.target.value)} /></label>
        <label className="inline">Min score <b>{minScore}</b><input type="range" min={0} max={90} step={5} value={minScore} onChange={(e) => setMinScore(+e.target.value)} /></label>
        <label className="inline">Max term <b>{maxTermDays}d</b><input type="range" min={7} max={90} step={1} value={maxTermDays} onChange={(e) => setMaxTermDays(+e.target.value)} /></label>
        <select value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
          <option value="score">Safest first</option>
          <option value="apr">Highest APR</option>
          <option value="amount">Largest</option>
          <option value="term">Shortest term</option>
        </select>
      </div>

      {market.data && rows.length === 0 ? (
        <Empty>{market.data.length === 0 ? "No open loan requests yet. Switch to Borrow in another wallet to create one." : "No loans match these filters."}</Empty>
      ) : (
        <div className="market">
          {rows.map((l) => {
            const c = byKey.get(l.cardKey);
            const own = l.borrower === wallet;
            return (
              <div key={l.id} className="mcard">
                {c && <CardArt src={c.image} alt={c.name} />}
                <div className="mcard-body">
                  <div className="row-between">
                    <div><b>{c?.name}</b><div className="muted small">{c?.set} · {l.grade === "psa10" ? "PSA 10" : "Raw"}</div></div>
                    <ScoreRing score={l.score} size={52} />
                  </div>
                  <div className="mgrid">
                    <div><span>Lend</span><b>{sol(l.principalLamports)} SOL</b></div>
                    <div><span>APR</span><b>{l.aprPct}%</b></div>
                    <div><span>Term</span><b>{fmtTerm(l.termSec)}</b></div>
                    <div><span>Of price</span><b>{Math.round(l.ltv * 100)}%</b></div>
                    <div><span>Suggested price</span><b>{usd(l.suggestedPriceUsd)}</b></div>
                    <div><span>You get back</span><b>{sol(l.repayLamports, 4)}</b></div>
                  </div>
                  <div className="row-between">
                    <Link href={`/loans/${l.id}`} className="small">Details</Link>
                    <button className="btn primary" disabled={own || l.busy} onClick={() => setFunding(l)}
                      title={own ? "This is your own loan" : l.busy ? "Someone is funding this right now" : ""}>
                      {own ? "Your loan" : l.busy ? "Being funded…" : "Fund loan"}
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
      {funding && <FundModal loan={funding} card={byKey.get(funding.cardKey)} onClose={() => { setFunding(null); reload(); }} />}
    </div>
  );
}

function FundModal({ loan, card, onClose }: { loan: PubLoan; card?: CatalogEntry; onClose: () => void }) {
  const { run, steps, busy } = useLoanAction();
  const [done, setDone] = useState(false);
  const fund = async () => {
    const okk = await run(loan.id, "fund", { sign: `Send ${sol(loan.principalLamports)} SOL to the borrower`, confirm: "Loan starts; due date set" });
    if (okk) setDone(true);
  };
  return (
    <Modal open onClose={onClose} title="Fund this loan">
      <div className="kv"><span>Card</span><b>{card?.name} ({loan.grade === "psa10" ? "PSA 10" : "Raw"})</b></div>
      <div className="kv"><span>Safety score</span><b>{loan.score} / 100</b></div>
      <div className="kv"><span>Suggested price</span><b>{usd(loan.suggestedPriceUsd)}</b></div>
      <PriceBasisNote basis={loan.priceBasis} />
      {loan.defaultProb90d != null && <div className="kv"><span>Model default risk (90d)</span><b>{(loan.defaultProb90d * 100).toFixed(1)}%</b></div>}
      <div className="kv"><span>Borrower</span><b className="mono">{short(loan.borrower)}</b></div>
      <div className="kv"><span>You send now</span><b>{sol(loan.principalLamports)} SOL</b></div>
      <div className="kv"><span>You get back</span><b>{sol(loan.repayLamports, 4)} SOL</b></div>
      <div className="kv"><span>Term</span><b>{fmtTerm(loan.termSec)}</b></div>
      <div className="callout small">
        The card token is already in escrow. If the borrower doesn&apos;t repay by the due date, you can claim it and sell
        the card: you&apos;re lending {Math.round(loan.ltv * 100)}% of its suggested price. A lower score means it may take longer
        or a lower price to sell, which is what the higher rate pays for. A claimed token is a claim on the physical card
        in the vault, so redemption depends on the vault, not the chain.
      </div>
      {!done ? <button className="btn primary full" disabled={busy} onClick={fund}>Fund {sol(loan.principalLamports)} SOL</button>
        : <button className="btn full" onClick={onClose}>Done</button>}
      <Steps steps={steps} />
    </Modal>
  );
}

function LenderLoan({ loan, card, onChange }: { loan: PubLoan; card?: CatalogEntry; onChange: () => void }) {
  const { run, steps, busy } = useLoanAction(onChange);
  const now = useNow();
  const overdue = loan.status === "active" && loan.dueAt && Date.parse(loan.dueAt) < now;
  return (
    <div className="loan">
      {card && <CardArt src={card.image} alt={card.name} small />}
      <div className="loan-main">
        <div className="row-between"><Link href={`/loans/${loan.id}`}><b>{card?.name ?? loan.cardKey}</b></Link><StatusPill status={loan.status} /></div>
        <div className="loan-nums">
          <span><b>{sol(loan.principalLamports)}</b> SOL lent</span>
          <span>owed <b>{sol(loan.repayLamports, 4)}</b> SOL</span>
          <span><b>{loan.aprPct}%</b> APR</span>
          {loan.status === "active" && loan.dueAt && <span><Countdown to={loan.dueAt} /></span>}
        </div>
        <Steps steps={steps} />
      </div>
      <div className="loan-actions">
        {overdue && <button className="btn danger" disabled={busy} onClick={() => run(loan.id, "claim", { sign: "Claim the card token from escrow", confirm: "Escrow confirms release to you" })}>Claim collateral</button>}
      </div>
    </div>
  );
}
