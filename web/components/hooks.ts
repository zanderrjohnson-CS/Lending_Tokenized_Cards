"use client";
import { useCallback, useEffect, useState } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { api, confirmWithRetry, signAndSend } from "@/lib/client";
import type { CatalogCard, LoanTerms } from "@/lib/types";

export type CatalogEntry = CatalogCard & { terms: LoanTerms };

export function useFetch<T>(path: string | null, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const reload = useCallback(() => {
    if (!path) return;
    setLoading(true);
    api<T>(path).then((d) => { setData(d); setError(null); }).catch((e) => setError(e.message)).finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, ...deps]);
  useEffect(reload, [reload]);
  return { data, error, loading, reload };
}

export function useCatalog() {
  const { data } = useFetch<CatalogEntry[]>("/api/catalog");
  const byKey = new Map((data ?? []).map((c) => [c.cardKey, c]));
  return { catalog: data ?? [], byKey };
}

export function usePlatform() {
  return useFetch<{ cluster: string; escrow: string; vault: string; solUsd: number; policy: string; scoreSource: string }>("/api/platform").data;
}

export type Step = { label: string; state: "doing" | "done" | "error"; detail?: string; tx?: string };

/** Runs build -> wallet sign -> send -> server confirm for a loan action, reporting steps for the UI. */
export function useLoanAction(onDone?: () => void) {
  const wallet = useWallet();
  const { connection } = useConnection();
  const [steps, setSteps] = useState<Step[]>([]);
  const [busy, setBusy] = useState(false);

  const push = (s: Step) => setSteps((x) => [...x.filter((y) => y.label !== s.label), s]);

  const run = useCallback(async (loanId: string, action: string, labels: { sign: string; confirm: string }) => {
    setBusy(true); setSteps([]);
    try {
      push({ label: "Preparing transaction", state: "doing" });
      const built = await api(`/api/loans/${loanId}`, { action, phase: "build" });
      push({ label: "Preparing transaction", state: "done" });
      if (built.done) { onDone?.(); return true; }
      push({ label: labels.sign, state: "doing", detail: "Approve in your wallet (set to Devnet)" });
      const sig = await signAndSend(wallet, connection, built);
      push({ label: labels.sign, state: "done", tx: sig });
      push({ label: labels.confirm, state: "doing" });
      await confirmWithRetry(() => api(`/api/loans/${loanId}`, { action, phase: "confirm", signature: sig }));
      push({ label: labels.confirm, state: "done" });
      onDone?.();
      return true;
    } catch (e: any) {
      setSteps((x) => [...x.map((s) => (s.state === "doing" ? { ...s, state: "error" as const, detail: e.message } : s))]);
      return false;
    } finally {
      setBusy(false);
    }
  }, [wallet, connection, onDone]);

  return { run, steps, busy, setSteps, setBusy, push };
}

export function useNow(ms = 1000) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), ms); return () => clearInterval(t); }, [ms]);
  return now;
}
