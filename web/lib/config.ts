export const CLUSTER = (process.env.NEXT_PUBLIC_SOLANA_CLUSTER || "devnet") as "devnet" | "testnet" | "mainnet-beta";
export const RPC_URL = process.env.NEXT_PUBLIC_RPC_URL || "https://api.devnet.solana.com";
/** Fixed demo SOL price. A real deployment would read a price oracle (Pyth, Switchboard). */
export const SOL_USD = Number(process.env.NEXT_PUBLIC_SOL_USD || 150);
export const APP_NAME = "HoloLend";

export const explorerTx = (sig: string) => `https://explorer.solana.com/tx/${sig}?cluster=${CLUSTER}`;
export const explorerAddr = (a: string) => `https://explorer.solana.com/address/${a}?cluster=${CLUSTER}`;

export const LAMPORTS = 1_000_000_000;
export const usdToLamports = (usd: number, solUsd = SOL_USD) => Math.floor((usd / solUsd) * LAMPORTS);
export const lamportsToSol = (l: number) => l / LAMPORTS;
