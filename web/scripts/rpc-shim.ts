// Minimal Solana JSON-RPC server backed by LiteSVM, so the API routes can be tested end to end
// without devnet. Only the methods HoloLend's server uses are implemented.
//   npx tsx scripts/rpc-shim.ts 8899
import http from "http";
import bs58 from "bs58";
import { makeSvm } from "./svm";
import { PublicKey, SystemProgram, Transaction, SystemInstruction } from "@solana/web3.js";
import { AccountLayout, MintLayout, TOKEN_PROGRAM_ID } from "@solana/spl-token";

const svm = makeSvm();
const txs = new Map<string, { tx: Transaction; err: string | null }>();
const ctx = { slot: 1 };
const drops = new Set<string>();

function parsedIx(tx: Transaction, i: number) {
  const ix = tx.instructions[i];
  if (ix.programId.equals(SystemProgram.programId)) {
    try {
      if (SystemInstruction.decodeInstructionType(ix) === "Transfer") {
        const d = SystemInstruction.decodeTransfer(ix);
        return { program: "system", programId: ix.programId.toBase58(), stackHeight: null,
          parsed: { type: "transfer", info: { source: d.fromPubkey.toBase58(), destination: d.toPubkey.toBase58(), lamports: Number(d.lamports) } } };
      }
    } catch {}
  }
  return { programId: ix.programId.toBase58(), accounts: ix.keys.map((k) => k.pubkey.toBase58()), data: bs58.encode(ix.data), stackHeight: null };
}

const methods: Record<string, (p: any[]) => any> = {
  getLatestBlockhash: () => ({ context: ctx, value: { blockhash: svm.latestBlockhash(), lastValidBlockHeight: 1000 } }),
  getMinimumBalanceForRentExemption: ([n]) => svm.rent(n),
  getBlockHeight: () => 1,
  getBalance: ([a]) => ({ context: ctx, value: svm.balance(a) }),
  requestAirdrop: ([a, l]) => { svm.airdrop(a, l); const sig = bs58.encode(crypto.getRandomValues(new Uint8Array(64))); drops.add(sig); return sig; },
  getTokenAccountBalance: ([a]) => {
    const acc = svm.account(a);
    if (!acc) throw { code: -32602, message: "could not find account" };
    const amt = AccountLayout.decode(acc.data).amount.toString();
    return { context: ctx, value: { amount: amt, decimals: 0, uiAmount: Number(amt), uiAmountString: amt } };
  },
  getParsedAccountInfo: ([a]) => methods.getAccountInfo([a, { encoding: "jsonParsed" }]),
  getAccountInfo: ([a]) => {
    const acc = svm.account(a);
    if (!acc) return { context: ctx, value: null };
    let data: any = [acc.data.toString("base64"), "base64"];
    if (acc.owner.equals(TOKEN_PROGRAM_ID) && acc.data.length === 82) {
      const m = MintLayout.decode(acc.data);
      data = { program: "spl-token", space: 82, parsed: { type: "mint", info: {
        supply: m.supply.toString(), decimals: m.decimals, isInitialized: m.isInitialized,
        mintAuthority: m.mintAuthorityOption ? m.mintAuthority.toBase58() : null,
        freezeAuthority: m.freezeAuthorityOption ? m.freezeAuthority.toBase58() : null } } };
    }
    return { context: ctx, value: { data, executable: false, lamports: acc.lamports, owner: acc.owner.toBase58(), rentEpoch: 0, space: acc.data.length } };
  },
  sendTransaction: ([b64]) => {
    const tx = Transaction.from(Buffer.from(b64, "base64"));
    const sig = bs58.encode(tx.signature!);
    const err = svm.send(tx);
    if (err) throw { code: -32002, message: `Transaction simulation failed: ${err}` };
    txs.set(sig, { tx, err });
    ctx.slot++;
    return sig;
  },
  getSignatureStatuses: ([sigs]) => ({ context: ctx, value: sigs.map((s: string) => txs.has(s) || drops.has(s) ? { slot: ctx.slot, confirmations: null, err: null, confirmationStatus: "confirmed", status: { Ok: null } } : null) }),
  getParsedTransaction: ([sig]) => methods.getTransaction([sig]),
  getTransaction: ([sig]) => {
    const t = txs.get(sig);
    if (!t) return null;
    const msg = t.tx.compileMessage();
    return {
      slot: ctx.slot, blockTime: Math.floor(Date.now() / 1000), version: "legacy",
      meta: { err: null, fee: 5000, preBalances: [], postBalances: [], innerInstructions: [], logMessages: [], preTokenBalances: [], postTokenBalances: [], status: { Ok: null } },
      transaction: {
        signatures: t.tx.signatures.map((s) => bs58.encode(s.signature!)),
        message: {
          accountKeys: msg.accountKeys.map((k, i) => ({ pubkey: k.toBase58(), signer: msg.isAccountSigner(i), writable: msg.isAccountWritable(i), source: "transaction" })),
          instructions: t.tx.instructions.map((_, i) => parsedIx(t.tx, i)),
          recentBlockhash: t.tx.recentBlockhash,
        },
      },
    };
  },
};

http.createServer((req, res) => {
  res.setHeader("access-control-allow-origin", "*");
  res.setHeader("access-control-allow-headers", "*");
  if (req.method !== "POST") { res.statusCode = 204; return res.end(); }
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    const one = (q: any) => {
      try {
        const fn = methods[q.method];
        if (!fn) return { jsonrpc: "2.0", id: q.id, error: { code: -32601, message: `shim: ${q.method} not implemented` } };
        return { jsonrpc: "2.0", id: q.id, result: fn(q.params || []) };
      } catch (e: any) {
        return { jsonrpc: "2.0", id: q.id, error: { code: e.code ?? -32000, message: e.message ?? String(e) } };
      }
    };
    const q = JSON.parse(body);
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify(Array.isArray(q) ? q.map(one) : one(q)));
  });
}).listen(Number(process.argv[2] || 8899), () => console.log("rpc shim up"));
