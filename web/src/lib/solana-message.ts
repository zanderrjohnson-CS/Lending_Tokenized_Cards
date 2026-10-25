// Shared between the browser (builds the message the wallet signs) and the
// server (re-parses it before verifying the signature).

export type SolanaSignInMessage = {
  domain: string;
  address: string;
  nonce: string;
  issuedAt: string;
};

const STATEMENT = "Sign in to Card Credit. This does not cost anything or send a transaction.";

export function buildSolanaMessage(m: SolanaSignInMessage): string {
  return [
    `${m.domain} wants you to sign in with your Solana account:`,
    m.address,
    "",
    STATEMENT,
    "",
    `Nonce: ${m.nonce}`,
    `Issued At: ${m.issuedAt}`,
  ].join("\n");
}

export function parseSolanaMessage(text: string): SolanaSignInMessage | null {
  const lines = text.split("\n");
  const domain = lines[0]?.match(/^(.+) wants you to sign in with your Solana account:$/)?.[1];
  const address = lines[1];
  const nonce = text.match(/^Nonce: (.+)$/m)?.[1];
  const issuedAt = text.match(/^Issued At: (.+)$/m)?.[1];
  if (!domain || !address || !nonce || !issuedAt) return null;
  return { domain, address, nonce, issuedAt };
}
