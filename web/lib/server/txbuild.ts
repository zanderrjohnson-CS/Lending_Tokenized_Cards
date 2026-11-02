// Transaction builders. Pure: they take the blockhash and rent as inputs, so the same code
// runs in the API routes (against devnet) and in scripts/escrow-sim.ts (against LiteSVM).
//
// Escrow model (demo-grade, custodial): the platform's ESCROW keypair owns the token account
// holding the pledged NFT. The escrow only ever co-signs transactions the server builds, and
// every release is ATOMIC with its condition:
//   repay  = [borrower pays lender principal+interest] + [escrow -> borrower NFT]   (one tx)
//   claim  = [escrow -> lender NFT]  (server only builds this after dueAt)
//   cancel = [escrow -> borrower NFT] (only while no lender has funded)
import {
  Keypair, PublicKey, SystemProgram, Transaction, TransactionInstruction,
} from "@solana/web3.js";
import {
  AuthorityType, MINT_SIZE, TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction, createCloseAccountInstruction,
  createInitializeMint2Instruction, createMintToInstruction, createSetAuthorityInstruction,
  createTransferCheckedInstruction, getAssociatedTokenAddressSync,
} from "@solana/spl-token";

export const MEMO_PROGRAM_ID = new PublicKey("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr");

export const memo = (text: string, signer?: PublicKey) =>
  new TransactionInstruction({
    programId: MEMO_PROGRAM_ID,
    keys: signer ? [{ pubkey: signer, isSigner: true, isWritable: false }] : [],
    data: Buffer.from(text, "utf8"),
  });

export const ata = (owner: PublicKey, mint: PublicKey) => getAssociatedTokenAddressSync(mint, owner, true);

interface Base { blockhash: string; useMemo?: boolean }

function finish(tx: Transaction, feePayer: PublicKey, blockhash: string) {
  tx.feePayer = feePayer;
  tx.recentBlockhash = blockhash;
  return tx;
}

/** Vault issues a 1-of-1 card token to `owner`. Owner pays fees; vault + new mint co-sign. */
export function buildMintTx(p: Base & { owner: PublicKey; vault: Keypair; mintRentLamports: number; memoText: string }) {
  const mint = Keypair.generate();
  const ownerAta = ata(p.owner, mint.publicKey);
  const tx = new Transaction().add(
    SystemProgram.createAccount({
      fromPubkey: p.owner, newAccountPubkey: mint.publicKey,
      lamports: p.mintRentLamports, space: MINT_SIZE, programId: TOKEN_PROGRAM_ID,
    }),
    createInitializeMint2Instruction(mint.publicKey, 0, p.vault.publicKey, null),
    createAssociatedTokenAccountIdempotentInstruction(p.owner, ownerAta, p.owner, mint.publicKey),
    createMintToInstruction(mint.publicKey, ownerAta, p.vault.publicKey, 1),
    // Lock supply at exactly 1: nobody (not even the vault) can mint a second copy.
    createSetAuthorityInstruction(mint.publicKey, p.vault.publicKey, AuthorityType.MintTokens, null),
  );
  if (p.useMemo !== false) tx.add(memo(p.memoText));
  finish(tx, p.owner, p.blockhash);
  tx.partialSign(mint, p.vault);
  return { tx, mint: mint.publicKey };
}

/** Borrower moves the card token into the escrow's token account. */
export function buildDepositTx(p: Base & { borrower: PublicKey; escrow: PublicKey; mint: PublicKey; memoText: string }) {
  const escrowAta = ata(p.escrow, p.mint);
  const tx = new Transaction().add(
    createAssociatedTokenAccountIdempotentInstruction(p.borrower, escrowAta, p.escrow, p.mint),
    createTransferCheckedInstruction(ata(p.borrower, p.mint), p.mint, escrowAta, p.borrower, 1, 0),
  );
  if (p.useMemo !== false) tx.add(memo(p.memoText));
  return finish(tx, p.borrower, p.blockhash);
}

/** Lender sends the principal straight to the borrower. */
export function buildFundTx(p: Base & { lender: PublicKey; borrower: PublicKey; lamports: number; memoText: string }) {
  const tx = new Transaction().add(
    SystemProgram.transfer({ fromPubkey: p.lender, toPubkey: p.borrower, lamports: p.lamports }),
  );
  if (p.useMemo !== false) tx.add(memo(p.memoText));
  return finish(tx, p.lender, p.blockhash);
}

function releaseIxs(escrow: PublicKey, mint: PublicKey, to: PublicKey, payer: PublicKey, rentRefund: PublicKey) {
  const escrowAta = ata(escrow, mint);
  const toAta = ata(to, mint);
  return [
    createAssociatedTokenAccountIdempotentInstruction(payer, toAta, to, mint),
    createTransferCheckedInstruction(escrowAta, mint, toAta, escrow, 1, 0),
    // Close the now-empty escrow account; rent goes back to the borrower who paid it.
    createCloseAccountInstruction(escrowAta, rentRefund, escrow),
  ];
}

/** Atomic repay: payment to lender and NFT back to borrower succeed or fail together. */
export function buildRepayTx(p: Base & {
  borrower: PublicKey; lender: PublicKey; escrow: Keypair; mint: PublicKey; lamports: number; memoText: string;
}) {
  const tx = new Transaction().add(
    SystemProgram.transfer({ fromPubkey: p.borrower, toPubkey: p.lender, lamports: p.lamports }),
    ...releaseIxs(p.escrow.publicKey, p.mint, p.borrower, p.borrower, p.borrower),
  );
  if (p.useMemo !== false) tx.add(memo(p.memoText));
  finish(tx, p.borrower, p.blockhash);
  tx.partialSign(p.escrow);
  return tx;
}

/** After default: collateral goes to the lender. Lender pays the fee. */
export function buildClaimTx(p: Base & { lender: PublicKey; borrower: PublicKey; escrow: Keypair; mint: PublicKey; memoText: string }) {
  const tx = new Transaction().add(...releaseIxs(p.escrow.publicKey, p.mint, p.lender, p.lender, p.borrower));
  if (p.useMemo !== false) tx.add(memo(p.memoText));
  finish(tx, p.lender, p.blockhash);
  tx.partialSign(p.escrow);
  return tx;
}

/** Borrower withdraws an unfunded listing. */
export function buildCancelTx(p: Base & { borrower: PublicKey; escrow: Keypair; mint: PublicKey; memoText: string }) {
  const tx = new Transaction().add(...releaseIxs(p.escrow.publicKey, p.mint, p.borrower, p.borrower, p.borrower));
  if (p.useMemo !== false) tx.add(memo(p.memoText));
  finish(tx, p.borrower, p.blockhash);
  tx.partialSign(p.escrow);
  return tx;
}

export const toB64 = (tx: Transaction) =>
  tx.serialize({ requireAllSignatures: false, verifySignatures: false }).toString("base64");
