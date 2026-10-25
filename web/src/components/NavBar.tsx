"use client";

import Link from "next/link";
import { signOut, useSession } from "next-auth/react";
import { useWallet } from "@solana/wallet-adapter-react";

export default function NavBar() {
  const { data: session, status } = useSession();
  const { disconnect } = useWallet();

  return (
    <header className="border-b border-zinc-200 dark:border-zinc-800">
      <nav className="mx-auto flex max-w-5xl items-center justify-between px-4 py-4">
        <Link href="/" className="text-lg font-semibold tracking-tight">
          Card Credit
        </Link>
        <div className="flex items-center gap-3 text-sm">
          {status === "authenticated" ? (
            <>
              <Link href="/me" className="hover:underline">
                My collection
              </Link>
              <span className="hidden text-zinc-500 sm:inline">{session.user.name ?? session.user.email}</span>
              <button
                onClick={async () => {
                  await disconnect().catch(() => {});
                  await signOut({ callbackUrl: "/" });
                }}
                className="rounded-md border border-zinc-300 px-3 py-1.5 hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
              >
                Sign out
              </button>
            </>
          ) : status === "unauthenticated" ? (
            <>
              <Link href="/signin" className="hover:underline">
                Sign in
              </Link>
              <Link
                href="/signin?mode=signup"
                className="rounded-md bg-zinc-900 px-3 py-1.5 text-white hover:bg-zinc-700 dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-200"
              >
                Sign up
              </Link>
            </>
          ) : null}
        </div>
      </nav>
    </header>
  );
}
