// Thin adapter so the test scripts can drive LiteSVM (kit-based API) with web3.js v1 objects.
import { LiteSVM, FailedTransactionMetadata } from "litesvm";
import { address, lamports, getTransactionDecoder } from "@solana/kit";
import { PublicKey, Transaction } from "@solana/web3.js";

export function makeSvm() {
  const svm = new LiteSVM();
  if (process.env.SVM_NO_SIGVERIFY) svm.withSigverify(false); // rpc-shim: lets simulate run on unsigned txs
  const dec = getTransactionDecoder();
  const A = (pk: PublicKey | string) => address(typeof pk === "string" ? pk : pk.toBase58());
  return {
    latestBlockhash: () => svm.latestBlockhash() as string,
    expireBlockhash: () => svm.expireBlockhash(),
    airdrop: (pk: PublicKey | string, l: number | bigint) => { svm.airdrop(A(pk), lamports(BigInt(l))); },
    rent: (n: number) => Number(svm.minimumBalanceForRentExemption(BigInt(n))),
    balance: (pk: PublicKey | string) => Number(svm.getBalance(A(pk)) ?? 0n),
    account: (pk: PublicKey | string) => {
      const a = svm.getAccount(A(pk));
      return a.exists ? { data: Buffer.from(a.data), lamports: Number(a.lamports), owner: new PublicKey(a.programAddress) } : null;
    },
    simulateRaw: (bytes: Uint8Array): { err: string | null; logs: string[] } => {
      const r: any = svm.simulateTransaction(dec.decode(bytes) as any);
      if (r instanceof FailedTransactionMetadata) return { err: String(r.err()), logs: r.meta().logs() };
      return { err: null, logs: r.meta().logs() };
    },
    /** Returns null on success, or the error string. */
    send: (tx: Transaction): string | null => {
      const r = svm.sendTransaction(dec.decode(tx.serialize()) as any);
      return r instanceof FailedTransactionMetadata ? String(r.err()) : null;
    },
  };
}
