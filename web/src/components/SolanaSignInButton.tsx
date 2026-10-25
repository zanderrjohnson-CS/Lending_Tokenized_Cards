"use client";

import { useEffect, useRef, useState } from "react";
import { getCsrfToken, signIn } from "next-auth/react";
import { useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import bs58 from "bs58";
import { buildSolanaMessage } from "@/lib/solana-message";

export default function SolanaSignInButton({ label }: { label: string }) {
  const { publicKey, connected, signMessage } = useWallet();
  const { setVisible } = useWalletModal();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const pendingSignIn = useRef(false);

  async function signInWithWallet() {
    if (!publicKey || !signMessage) {
      setError("This wallet can't sign messages. Try Phantom or Solflare.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const nonce = await getCsrfToken();
      if (!nonce) throw new Error("Could not start sign-in. Refresh and try again.");
      const message = buildSolanaMessage({
        domain: window.location.host,
        address: publicKey.toBase58(),
        nonce,
        issuedAt: new Date().toISOString(),
      });
      const signature = await signMessage(new TextEncoder().encode(message));
      const res = await signIn("solana", {
        message,
        signature: bs58.encode(signature),
        redirect: false,
        callbackUrl: "/me",
      });
      if (res?.error) throw new Error("Signature could not be verified.");
      window.location.href = res?.url ?? "/me";
    } catch (e) {
      setError(e instanceof Error ? e.message : "Wallet sign-in failed.");
    } finally {
      setBusy(false);
    }
  }

  // After the wallet modal connects, continue straight into signing.
  useEffect(() => {
    if (connected && pendingSignIn.current) {
      pendingSignIn.current = false;
      void signInWithWallet();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connected]);

  function onClick() {
    if (connected) {
      void signInWithWallet();
    } else {
      pendingSignIn.current = true;
      setVisible(true);
    }
  }

  return (
    <div className="w-full">
      <button
        onClick={onClick}
        disabled={busy}
        className="flex w-full items-center justify-center gap-3 rounded-lg bg-gradient-to-r from-[#9945FF] to-[#14F195] px-4 py-3 font-medium text-white shadow-sm transition hover:opacity-90 disabled:opacity-60"
      >
        <SolanaLogo />
        {busy ? "Waiting for wallet…" : label}
      </button>
      {error && <p className="mt-2 text-sm text-red-500">{error}</p>}
    </div>
  );
}

function SolanaLogo() {
  return (
    <svg width="18" height="16" viewBox="0 0 397 311" aria-hidden fill="currentColor">
      <path d="M64.6 237.9a13 13 0 0 1 9.2-3.8h317.4c5.8 0 8.7 7 4.6 11.1l-62.7 62.7a13 13 0 0 1-9.2 3.8H6.5c-5.8 0-8.7-7-4.6-11.1z" />
      <path d="M64.6 3.8A13.4 13.4 0 0 1 73.8 0h317.4c5.8 0 8.7 7 4.6 11.1l-62.7 62.7a13 13 0 0 1-9.2 3.8H6.5c-5.8 0-8.7-7-4.6-11.1z" />
      <path d="M333.1 120.1a13 13 0 0 0-9.2-3.8H6.5c-5.8 0-8.7 7-4.6 11.1l62.7 62.7a13 13 0 0 0 9.2 3.8h317.4c5.8 0 8.7-7 4.6-11.1z" />
    </svg>
  );
}
