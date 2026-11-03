"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import dynamic from "next/dynamic";
import { useCallback, useEffect, useState } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { LAMPORTS_PER_SOL } from "@solana/web3.js";
import { useSession } from "@/app/providers";
import { CLUSTER } from "@/lib/config";
import { waitForSignature } from "@/lib/client";

// The wallet button reads window state, so render it client-side only.
const WalletMultiButton = dynamic(async () => (await import("@solana/wallet-adapter-react-ui")).WalletMultiButton, { ssr: false });

export default function Header() {
  const path = usePathname();
  const { wallet, role } = useSession();
  const { publicKey } = useWallet();
  const { connection } = useConnection();
  const [bal, setBal] = useState<number | null>(null);
  const [drop, setDrop] = useState<string | null>(null);

  const refresh = useCallback(() => {
    if (!publicKey) return setBal(null);
    connection.getBalance(publicKey).then((b) => setBal(b / LAMPORTS_PER_SOL)).catch(() => setBal(null));
  }, [publicKey, connection]);
  useEffect(() => { refresh(); const t = setInterval(refresh, 15000); return () => clearInterval(t); }, [refresh]);

  const airdrop = async () => {
    if (!publicKey) return;
    setDrop("Requesting…");
    try {
      const sig = await connection.requestAirdrop(publicKey, LAMPORTS_PER_SOL);
      await waitForSignature(connection, sig);
      setDrop("+1 SOL"); refresh();
    } catch {
      setDrop("faucet");
    }
    setTimeout(() => setDrop(null), 6000);
  };

  const nav = [
    { href: "/borrow", label: "Borrow", active: role === "borrower" },
    { href: "/lend", label: "Lend", active: role === "lender" },
  ];

  return (
    <header className="top">
      <Link href="/" className="logo"><span className="holo">◆</span> HoloLend</Link>
      <nav>
        {nav.map((n) => (
          <Link key={n.href} href={n.href} className={path?.startsWith(n.href) ? "on" : ""}>{n.label}</Link>
        ))}
      </nav>
      <div className="right">
        {CLUSTER !== "mainnet-beta" && <span className="net">{CLUSTER}</span>}
        {publicKey && bal !== null && (
          <span className="bal">
            {bal.toFixed(2)} SOL
            {CLUSTER === "devnet" && (drop === "faucet"
              ? <a href="https://faucet.solana.com" target="_blank" rel="noreferrer">faucet ↗</a>
              : <button onClick={airdrop} disabled={!!drop}>{drop ?? "+ airdrop"}</button>)}
          </span>
        )}
        {wallet && <span className="signed" title="Signed in">●</span>}
        <WalletMultiButton />
      </div>
    </header>
  );
}
