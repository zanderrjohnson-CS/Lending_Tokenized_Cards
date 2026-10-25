import type { NextAuthOptions } from "next-auth";
import GoogleProvider from "next-auth/providers/google";
import CredentialsProvider from "next-auth/providers/credentials";
import { PublicKey } from "@solana/web3.js";
import nacl from "tweetnacl";
import bs58 from "bs58";
import { parseSolanaMessage } from "./solana-message";

const MAX_MESSAGE_AGE_MS = 10 * 60 * 1000;

function verifySolanaSignIn(
  message: string,
  signature: string,
  csrfToken: string | undefined,
): string | null {
  const parsed = parseSolanaMessage(message);
  if (!parsed) return null;

  // The nonce is NextAuth's CSRF token, so a signature can't be replayed
  // from another browser session.
  if (!csrfToken || parsed.nonce !== csrfToken) return null;

  const expectedHost = new URL(process.env.NEXTAUTH_URL ?? "http://localhost:3000").host;
  if (parsed.domain !== expectedHost) return null;

  const age = Date.now() - new Date(parsed.issuedAt).getTime();
  if (!(age >= 0 && age < MAX_MESSAGE_AGE_MS)) return null;

  try {
    const publicKey = new PublicKey(parsed.address);
    const ok = nacl.sign.detached.verify(
      new TextEncoder().encode(message),
      bs58.decode(signature),
      publicKey.toBytes(),
    );
    return ok ? publicKey.toBase58() : null;
  } catch {
    return null;
  }
}

export const authOptions: NextAuthOptions = {
  session: { strategy: "jwt" },
  pages: { signIn: "/signin" },
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID ?? "",
      clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? "",
    }),
    CredentialsProvider({
      id: "solana",
      name: "Solana",
      credentials: {
        message: { label: "Message", type: "text" },
        signature: { label: "Signature", type: "text" },
      },
      async authorize(credentials, req) {
        if (!credentials?.message || !credentials?.signature) return null;
        const address = verifySolanaSignIn(
          credentials.message,
          credentials.signature,
          (req.body as Record<string, string> | undefined)?.csrfToken,
        );
        if (!address) return null;
        return { id: address, name: `${address.slice(0, 4)}…${address.slice(-4)}` };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, account }) {
      if (account) {
        token.provider = account.provider;
        if (account.provider === "solana") token.walletAddress = token.sub;
      }
      return token;
    },
    async session({ session, token }) {
      session.user.id = token.sub ?? "";
      session.user.provider = token.provider;
      session.user.walletAddress = token.walletAddress;
      return session;
    },
  },
};
