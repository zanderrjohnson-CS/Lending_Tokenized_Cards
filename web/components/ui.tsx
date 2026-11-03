"use client";
import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { explorerAddr, explorerTx } from "@/lib/config";
import { short } from "@/lib/client";
import type { FactorScores, LoanStatus, PriceBasis } from "@/lib/types";
import { usd } from "@/lib/client";
import type { Step } from "./hooks";
import { useNow } from "./hooks";

/** Colour is only a visual cue; the score itself sets the rate, there are no tiers. */
export function ScoreRing({ score, size = 64 }: { score: number; size?: number }) {
  const r = size / 2 - 5, c = 2 * Math.PI * r;
  const band = score >= 75 ? "hi" : score >= 55 ? "mid" : "lo";
  return (
    <div className={`ring band-${band}`} style={{ width: size, height: size }} title={`Safety score ${score} / 100: how safely this card can be sold for the loan amount`}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle cx={size / 2} cy={size / 2} r={r} className="ring-bg" />
        <circle cx={size / 2} cy={size / 2} r={r} className="ring-fg" strokeDasharray={`${(score / 100) * c} ${c}`}
          transform={`rotate(-90 ${size / 2} ${size / 2})`} />
      </svg>
      <div className="ring-label"><b>{Math.round(score)}</b><span>score</span></div>
    </div>
  );
}

const FACTOR_LABELS: Record<keyof FactorScores, [string, string]> = {
  liquidity: ["Liquidity", "How often it sells"],
  stability: ["Stability", "How little the price is expected to fall"],
  volatility: ["Stability", "How little the price swings"],
  spread: ["Price agreement", "How tightly sale prices cluster"],
  trend: ["Trend", "Recent direction of price"],
  authenticity: ["Authenticity", "Share graded, grading premium"],
  concentration: ["Market breadth", "Spread across venues"],
};

export function FactorBars({ factors }: { factors: FactorScores }) {
  return (
    <div className="factors">
      {(Object.keys(FACTOR_LABELS) as (keyof FactorScores)[]).map((k) =>
        factors[k] === undefined ? null : (
          <div key={k} className="factor" title={FACTOR_LABELS[k][1]}>
            <span>{FACTOR_LABELS[k][0]}</span>
            <div className="bar"><i style={{ width: `${factors[k]}%` }} /></div>
            <b>{Math.round(factors[k]!)}</b>
          </div>
        ),
      )}
    </div>
  );
}

/** One-line explanation of where the suggested price came from. */
export function PriceBasisNote({ basis }: { basis?: PriceBasis }) {
  if (!basis) return null;
  const bits: string[] = [];
  if (basis.n_sales) bits.push(`${basis.half_life_days ? "recency-weighted median" : "median"} of ${basis.n_sales} sales${basis.half_life_days ? ` (recent sales count most)` : ""}`);
  if (basis.last_sale_usd) bits.push(`last sale ${usd(basis.last_sale_usd)}${basis.last_sale_date ? ` on ${basis.last_sale_date}` : ""}`);
  const adj = typeof basis.market_adj_pct === "number" ? basis.market_adj_pct : typeof basis.market_adj_pct_30d === "number" ? (basis.market_adj_pct_30d as number) : null;
  if (adj) bits.push(`market trend ${adj > 0 ? "+" : ""}${adj}%`);
  if (typeof basis.trading_days_last_90 === "number") bits.push(`traded on ${basis.trading_days_last_90} of the last 90 days`);
  if (!bits.length && basis.method) bits.push(basis.method);
  return <p className="fine basis">{bits.join(" · ")}</p>;
}

const STATUS: Record<LoanStatus, string> = {
  pending_deposit: "Awaiting deposit", listed: "Open for lenders", active: "Active",
  repaid: "Repaid", defaulted: "Defaulted", cancelled: "Cancelled",
};
export const StatusPill = ({ status }: { status: LoanStatus }) => <span className={`pill st-${status}`}>{STATUS[status]}</span>;

export const TxLink = ({ sig }: { sig: string }) => <a href={explorerTx(sig)} target="_blank" rel="noreferrer" className="mono">{short(sig, 6)} ↗</a>;
export const AddrLink = ({ addr }: { addr: string }) => <a href={explorerAddr(addr)} target="_blank" rel="noreferrer" className="mono">{short(addr)} ↗</a>;

export function Countdown({ to }: { to: string }) {
  const now = useNow();
  const ms = Date.parse(to) - now;
  if (ms <= 0) return <span className="overdue">Past due</span>;
  const s = Math.floor(ms / 1000), d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
  return <span>{d > 0 ? `${d}d ${h}h` : h > 0 ? `${h}h ${m}m` : `${m}m ${s % 60}s`} left</span>;
}

export function Steps({ steps }: { steps: Step[] }) {
  if (!steps.length) return null;
  return (
    <ol className="steps">
      {steps.map((s) => (
        <li key={s.label} className={s.state}>
          <span className="dot" />
          <div>
            <div>{s.label}</div>
            {s.detail && <small>{s.detail}</small>}
            {s.tx && <small><TxLink sig={s.tx} /></small>}
          </div>
        </li>
      ))}
    </ol>
  );
}

export function Modal({ open, onClose, title, children, wide }: { open: boolean; onClose: () => void; title: string; children: ReactNode; wide?: boolean }) {
  if (!open) return null;
  return (
    <div className="modal-back" onClick={onClose}>
      <div className={`modal ${wide ? "wide" : ""}`} onClick={(e) => e.stopPropagation()} role="dialog" aria-label={title}>
        <header><h3>{title}</h3><button className="x" onClick={onClose} aria-label="Close">×</button></header>
        {children}
      </div>
    </div>
  );
}

export function CardArt({ src, alt, small }: { src: string; alt: string; small?: boolean }) {
  const [broken, setBroken] = useState(false);
  const ref = useRef<HTMLImageElement>(null);
  // The image can fail before React attaches onError (e.g. a blocked host), so check once mounted.
  useEffect(() => { const i = ref.current; if (i && i.complete && i.naturalWidth === 0) setBroken(true); }, []);
  if (broken || !src) return <div className={`art art-fallback ${small ? "small" : ""}`} title={alt}><span>{small ? alt.slice(0, 1) : alt}</span></div>;
  // eslint-disable-next-line @next/next/no-img-element
  return <img className={`art ${small ? "small" : ""}`} ref={ref} src={src} alt={alt} onError={() => setBroken(true)} />;
}

export const Empty = ({ children, action }: { children: ReactNode; action?: ReactNode }) => (
  <div className="empty"><p>{children}</p>{action}</div>
);

export const BackLink = ({ href, children }: { href: string; children: ReactNode }) => <Link href={href} className="back">← {children}</Link>;
