"use client";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { ConnectionProvider, WalletProvider, useWallet } from "@solana/wallet-adapter-react";
import { WalletModalProvider } from "@solana/wallet-adapter-react-ui";
import bs58 from "bs58";
import { RPC_URL } from "@/lib/config";
import { api } from "@/lib/client";
import "@solana/wallet-adapter-react-ui/styles.css";

type Role = "borrower" | "lender";
interface SessionCtx {
  wallet: string | null; // signed-in wallet (server session), may differ from the connected one
  role: Role | null;
  ready: boolean;
  signingIn: boolean;
  error: string | null;
  signIn: () => Promise<void>;
  signOut: () => Promise<void>;
  setRole: (r: Role) => Promise<void>;
}
const Ctx = createContext<SessionCtx | null>(null);
export const useSession = () => useContext(Ctx)!;

function SessionProvider({ children }: { children: ReactNode }) {
  const w = useWallet();
  const [wallet, setWallet] = useState<string | null>(null);
  const [role, setRoleState] = useState<Role | null>(null);
  const [ready, setReady] = useState(false);
  const [signingIn, setSigningIn] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api("/api/auth/me").then((m) => { setWallet(m.wallet); setRoleState(m.role); }).finally(() => setReady(true));
  }, []);

  const signIn = useCallback(async () => {
    setError(null);
    if (!w.publicKey) { setError("Connect a wallet first"); return; }
    if (!w.signMessage) { setError("This wallet can't sign messages. Try Phantom or Solflare."); return; }
    setSigningIn(true);
    try {
      const addr = w.publicKey.toBase58();
      const n = await api(`/api/auth/nonce?wallet=${addr}`);
      const sig = await w.signMessage(new TextEncoder().encode(n.message));
      const me = await api("/api/auth/verify", { wallet: addr, nonce: n.nonce, issuedAt: n.issuedAt, mac: n.mac, signature: bs58.encode(sig) });
      setWallet(me.wallet); setRoleState(me.role);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSigningIn(false);
    }
  }, [w]);

  const signOut = useCallback(async () => {
    await api("/api/auth/logout", {});
    setWallet(null); setRoleState(null);
    await w.disconnect().catch(() => {});
  }, [w]);

  const setRole = useCallback(async (r: Role) => {
    await api("/api/auth/role", { role: r });
    setRoleState(r);
  }, []);

  // If the user switches accounts in their wallet, the old session no longer matches.
  const connected = w.publicKey?.toBase58() ?? null;
  const effectiveWallet = wallet && connected && wallet !== connected ? null : wallet;

  return (
    <Ctx.Provider value={{ wallet: effectiveWallet, role, ready, signingIn, error, signIn, signOut, setRole }}>
      {children}
    </Ctx.Provider>
  );
}

export default function Providers({ children }: { children: ReactNode }) {
  // Phantom, Solflare, Backpack etc. register themselves via the Wallet Standard, so no adapters needed.
  const wallets = useMemo(() => [], []);
  return (
    <ConnectionProvider endpoint={RPC_URL}>
      <WalletProvider wallets={wallets} autoConnect>
        <WalletModalProvider>
          <SessionProvider>{children}</SessionProvider>
        </WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
}
