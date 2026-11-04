"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useWallet } from "@solana/wallet-adapter-react";
import { useSession } from "./providers";
import { useCatalog } from "@/components/hooks";
import { CardArt, ScoreRing } from "@/components/ui";
import Gate from "@/components/Gate";
import { usd } from "@/lib/client";
import { META } from "@/lib/score/meta";

const STARTER = new Set(Object.keys(META));

export default function Home() {
  const { wallet, role, setRole } = useSession();
  const { publicKey } = useWallet();
  const router = useRouter();
  const { catalog } = useCatalog();
  const pick = async (r: "borrower" | "lender") => { await setRole(r); router.push(r === "borrower" ? "/borrow" : "/lend"); };

  return (
    <div className="home">
      <section className="hero">
        <div>
          <h1>Borrow against your cards.<br /><span className="holo-text">Lend against the safest ones.</span></h1>
          <p className="lead">
            Every card gets a suggested price from its recent sales, and a safety score from how often it sells
            and how steady that price is. The price sets how much you can borrow. The score sets the interest rate.
            Your card token sits in escrow until the loan is repaid or defaults.
          </p>
          {!wallet && <p className="muted">Sign in with a Solana wallet (Phantom, Solflare, Backpack) to start.</p>}
        </div>
        <ol className="how">
          <li><b>1</b><div><h4>Sign in with your wallet</h4><p>No password. You sign a message to prove the address is yours.</p></div></li>
          <li><b>2</b><div><h4>Borrower: pledge a card</h4><p>We suggest a price from recent sales and a loan size with its rate. Borrow less for a lower rate, or more for a higher one.</p></div></li>
          <li><b>3</b><div><h4>Lender: pick a loan</h4><p>Browse by card, score, rate and term, then fund it.</p></div></li>
          <li><b>4</b><div><h4>Escrow runs the terms</h4><p>Repay and the card comes back in the same transaction. Miss the due date and the lender can claim it.</p></div></li>
        </ol>
      </section>

      <section className="choose">
        {wallet ? (
          <>
            <h2>How do you want to use HoloLend?</h2>
            <p className="muted">You can switch any time from the top bar.</p>
            <div className="roles">
              <button className={`role ${role === "borrower" ? "on" : ""}`} onClick={() => pick("borrower")}>
                <span className="emoji">🃏</span><h3>I want to borrow</h3>
                <p>Get SOL against a card you own. Keep the card if you repay on time.</p>
              </button>
              <button className={`role ${role === "lender" ? "on" : ""}`} onClick={() => pick("lender")}>
                <span className="emoji">💰</span><h3>I want to lend</h3>
                <p>Earn interest. If the borrower defaults, the card token is yours.</p>
              </button>
            </div>
          </>
        ) : (
          <Gate why="Your wallet is your account. Borrowers pledge card tokens from it; lenders fund loans from it.">{null}</Gate>
        )}
      </section>

      <section>
        <div className="section-head">
          <h2>Today&apos;s card scores</h2>
          <span className="muted">Raw (ungraded) cards. Price sets the loan size; how safely the card resells sets the rate.</span>
        </div>
        <div className="scoreboard">
          {catalog.filter((c) => STARTER.has(c.cardKey)).sort((a, b) => b.score.score - a.score.score).map((c) => (
            <div key={c.cardKey} className="sb-row">
              <CardArt src={c.image} alt={c.name} small />
              <div className="sb-name"><b>{c.name}</b><span>{c.set} · {c.number}</span></div>
              <ScoreRing score={c.score.score} size={48} />
              <div className="sb-terms">
                <span>suggested price <b>{usd(c.terms.suggestedPriceUsd)}</b></span>
                <span>suggested loan <b>{usd(c.terms.suggestedLoanUsd)}</b> at <b>{c.terms.aprPct}%</b></span>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="trust">
        <h2>What the blockchain protects, and what it doesn&apos;t</h2>
        <div className="grid2">
          <div className="box good">
            <h4>On-chain</h4>
            <ul>
              <li>Who owns each card token, and that only one exists per card</li>
              <li>Collateral can&apos;t leave escrow except by repay, default claim, or cancel</li>
              <li>Repayment and the card&apos;s return happen in one atomic transaction</li>
              <li>Every step has a public transaction you can check</li>
            </ul>
          </div>
          <div className="box warn">
            <h4>Still off-chain (real fraud risk)</h4>
            <ul>
              <li><b>Authenticity:</b> a token is only as good as the check on the physical card behind it</li>
              <li><b>Custody:</b> the vault holding the card must be insured and audited</li>
              <li><b>Redemption:</b> a defaulted lender needs a way to get the physical card shipped</li>
              <li><b>Prices:</b> scores and values come from an off-chain price feed that can be wrong or gamed</li>
            </ul>
          </div>
        </div>
        <p className="muted">See <Link href="/borrow">Borrow</Link> or <Link href="/lend">Lend</Link> to try the flow on devnet.</p>
      </section>
    </div>
  );
}
