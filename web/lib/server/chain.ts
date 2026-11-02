// On-chain reads the server uses to check that each step really happened before it
// changes a loan's status. The browser never gets to just "say" a step is done.
import { Connection, PublicKey, type ParsedInstruction } from "@solana/web3.js";
import { getMinimumBalanceForRentExemptMint } from "@solana/spl-token";
import { RPC_URL } from "../config";
import { ata } from "./txbuild";

let conn: Connection | null = null;
export const connection = () => (conn ??= new Connection(process.env.RPC_URL_SERVER || RPC_URL, "confirmed"));

export async function blockhash() {
  return connection().getLatestBlockhash("confirmed");
}

export async function mintRent() {
  return getMinimumBalanceForRentExemptMint(connection());
}

/** Card-token balance of `owner` (0 if the token account does not exist). */
export async function tokenBalance(owner: PublicKey, mint: PublicKey): Promise<number> {
  try {
    const b = await connection().getTokenAccountBalance(ata(owner, mint), "confirmed");
    return Number(b.value.amount);
  } catch {
    return 0;
  }
}

export async function mintIsOneOfOne(mint: PublicKey): Promise<boolean> {
  const info = await connection().getParsedAccountInfo(mint, "confirmed");
  const data = info.value?.data as { parsed?: { info?: { supply: string; decimals: number; mintAuthority: string | null } } };
  const i = data?.parsed?.info;
  return !!i && i.supply === "1" && i.decimals === 0 && i.mintAuthority === null;
}

/** True if `sig` is a successful tx containing a SOL transfer from -> to of at least `lamports`. */
export async function txHasTransfer(sig: string, from: string, to: string, lamports: number): Promise<boolean> {
  const tx = await connection().getParsedTransaction(sig, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });
  if (!tx || tx.meta?.err) return false;
  return tx.transaction.message.instructions.some((ix) => {
    const p = (ix as ParsedInstruction).parsed;
    return (ix as ParsedInstruction).program === "system" && p?.type === "transfer" &&
      p.info.source === from && p.info.destination === to && Number(p.info.lamports) >= lamports;
  });
}
