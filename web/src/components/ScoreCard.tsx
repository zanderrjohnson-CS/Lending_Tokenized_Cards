"use client";

import { useEffect, useState } from "react";
import { getScore, type CardScore, type OwnedCard } from "@/lib/scoring";

const usd = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

export default function ScoreCard({ card }: { card: OwnedCard }) {
  const [score, setScore] = useState<CardScore | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getScore(card).then(setScore, (e) => setError(String(e.message ?? e)));
  }, [card]);

  return (
    <div className="rounded-xl border border-zinc-200 p-5 dark:border-zinc-800">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="font-semibold">{card.name}</div>
          <div className="text-sm text-zinc-500">
            {card.set} · {card.grade_company} {card.grade}
          </div>
        </div>
        <div className="text-right">
          <div className="text-xs uppercase text-zinc-500">Loan score</div>
          <div className="text-2xl font-bold tabular-nums">
            {score ? score.loan_score : "…"}
            <span className="text-sm font-normal text-zinc-400">/1000</span>
          </div>
        </div>
      </div>

      {error && <p className="mt-4 text-sm text-red-500">{error}</p>}

      {score && !score.verified && (
        <p className="mt-4 text-sm text-amber-600">This token is not from a supported collection.</p>
      )}

      {score?.verified && (
        <>
          <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
            <Stat label="Fair value" value={usd(score.fair_value_usd)} />
            <Stat label="Range" value={`${usd(score.value_low_usd)} – ${usd(score.value_high_usd)}`} />
            <Stat label="Max loan" value={usd(score.recommended_terms.max_loan_usd)} />
            <Stat
              label="Terms"
              value={`${score.recommended_terms.term_days} days · ${score.recommended_terms.interest_bps / 100}% interest`}
            />
          </dl>
          <ul className="mt-4 space-y-1 text-xs text-zinc-500">
            {score.explanation.map((line) => (
              <li key={line}>• {line}</li>
            ))}
          </ul>
          <button
            disabled
            title="Escrow contract not connected yet"
            className="mt-4 w-full rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white opacity-50 dark:bg-white dark:text-zinc-900"
          >
            Borrow {usd(score.recommended_terms.max_loan_usd)} USDC (coming soon)
          </button>
        </>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-zinc-500">{label}</dt>
      <dd className="font-medium tabular-nums">{value}</dd>
    </div>
  );
}
