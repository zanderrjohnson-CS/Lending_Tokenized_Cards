"use client";
import { useParams } from "next/navigation";
import { useCatalog, useFetch, usePlatform } from "@/components/hooks";
import { AddrLink, BackLink, CardArt, Countdown, FactorBars, PriceBasisNote, ScoreRing, StatusPill, TxLink } from "@/components/ui";
import { sol, usd } from "@/lib/client";
import { fmtTerm } from "@/lib/terms";
import type { Loan } from "@/lib/types";
import { useSession } from "@/app/providers";

const EVENT_LABEL: Record<string, string> = {
  created: "Loan request created", collateral_in_escrow: "Card token deposited in escrow", funded: "Lender funded; loan started",
  repaid: "Repaid; card token returned to borrower", defaulted: "Past due; lender claimed card token", cancelled: "Cancelled; card token returned",
};

export default function LoanPage() {
  const { id } = useParams<{ id: string }>();
  const { data: loan, error } = useFetch<Loan & { busy: boolean }>(`/api/loans/${id}`);
  const { byKey } = useCatalog();
  const platform = usePlatform();
  const { wallet } = useSession();
  if (error) return <div className="page"><p className="err">{error}</p></div>;
  if (!loan) return <div className="page"><p className="muted">Loading…</p></div>;
  const c = byKey.get(loan.cardKey);
  const back = wallet === loan.borrower ? "/borrow" : "/lend";
  return (
    <div className="page">
      <BackLink href={back}>Back</BackLink>
      <div className="detail">
        <div>{c && <CardArt src={c.image} alt={c.name} />}</div>
        <div>
          <div className="row-between">
            <div><h1>{c?.name}</h1><p className="muted">{c?.set} · {loan.grade === "psa10" ? "PSA 10" : "Raw"} · loan {loan.id}</p></div>
            <StatusPill status={loan.status} />
          </div>
          <div className="terms-strip">
            <div><span>Principal</span><b>{sol(loan.principalLamports)} SOL</b></div>
            <div><span>Repay</span><b>{sol(loan.repayLamports, 4)} SOL</b></div>
            <div><span>APR</span><b>{loan.aprPct}%</b></div>
            <div><span>Term</span><b>{fmtTerm(loan.termSec)}</b></div>
            <div><span>Suggested price</span><b>{usd(loan.suggestedPriceUsd)}</b></div>
            <div><span>Of price</span><b>{Math.round(loan.ltv * 100)}%</b></div>
          </div>
          {loan.status === "active" && loan.dueAt && <p>Due {new Date(loan.dueAt).toLocaleString()} · <Countdown to={loan.dueAt} /></p>}
          <div className="grid2">
            <div className="box">
              <h4>Score at listing</h4>
              <div className="row-between"><span className="muted small">{loan.scoreSource}</span><ScoreRing score={loan.score} size={52} /></div>
              <PriceBasisNote basis={loan.priceBasis} />
              {c && <FactorBars factors={c.score.factors} />}
            </div>
            <div className="box">
              <h4>Parties</h4>
              <div className="kv"><span>Borrower</span><AddrLink addr={loan.borrower} /></div>
              <div className="kv"><span>Lender</span>{loan.lender ? <AddrLink addr={loan.lender} /> : <span className="muted">not funded</span>}</div>
              <div className="kv"><span>Escrow</span>{platform && <AddrLink addr={platform.escrow} />}</div>
              <div className="kv"><span>Card token</span><AddrLink addr={loan.mint} /></div>
            </div>
          </div>
          <h3>Timeline</h3>
          <ol className="timeline">
            {loan.events.map((e, i) => (
              <li key={i}>
                <time>{new Date(e.at).toLocaleString()}</time>
                <div>{EVENT_LABEL[e.kind] ?? e.kind}{e.note && e.kind === "created" ? <span className="muted small"> · {e.note}</span> : null}</div>
                {e.tx && <TxLink sig={e.tx} />}
              </li>
            ))}
          </ol>
        </div>
      </div>
    </div>
  );
}
