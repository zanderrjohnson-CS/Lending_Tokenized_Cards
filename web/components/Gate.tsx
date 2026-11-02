"use client";
import dynamic from "next/dynamic";
import type { ReactNode } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { useSession } from "@/app/providers";

const WalletMultiButton = dynamic(async () => (await import("@solana/wallet-adapter-react-ui")).WalletMultiButton, { ssr: false });

/** Shows children only once a wallet is connected AND has signed in. */
export default function Gate({ children, why }: { children: ReactNode; why: string }) {
  const { publicKey } = useWallet();
  const { wallet, ready, signIn, signingIn, error } = useSession();
  if (!ready) return <div className="gate"><p className="muted">Loading…</p></div>;
  if (wallet) return <>{children}</>;
  return (
    <div className="gate">
      <h2>{publicKey ? "Sign in with your wallet" : "Connect your Solana wallet"}</h2>
      <p className="muted">{why}</p>
      {publicKey ? (
        <>
          <button className="btn primary" onClick={signIn} disabled={signingIn}>{signingIn ? "Check your wallet…" : "Sign in"}</button>
          <p className="fine">You will sign a message, not a transaction. It costs nothing and proves you own this address.</p>
        </>
      ) : (
        <WalletMultiButton />
      )}
      {error && <p className="err">{error}</p>}
    </div>
  );
}
