import Link from "next/link";

const STEPS = [
  { title: "Connect", body: "Sign in with Google or your Solana wallet." },
  { title: "Get scored", body: "Each tokenized card gets a value range, liquidity estimate and loan score." },
  { title: "Borrow", body: "Lock the card in escrow and borrow USDC against it. Repay to get it back." },
];

export default function Home() {
  return (
    <div className="space-y-16">
      <section className="space-y-6 pt-8 text-center">
        <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">
          Borrow against your graded cards
          <br />
          <span className="bg-gradient-to-r from-[#9945FF] to-[#14F195] bg-clip-text text-transparent">
            without selling them
          </span>
        </h1>
        <p className="mx-auto max-w-xl text-zinc-600 dark:text-zinc-400">
          Card Credit scores tokenized PSA, CGC and BGS cards so you can unlock USDC liquidity while
          keeping your collection.
        </p>
        <div className="flex justify-center gap-3">
          <Link
            href="/signin?mode=signup"
            className="rounded-lg bg-zinc-900 px-5 py-3 font-medium text-white hover:bg-zinc-700 dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-200"
          >
            Get started
          </Link>
          <Link
            href="/signin"
            className="rounded-lg border border-zinc-300 px-5 py-3 font-medium hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
          >
            Sign in
          </Link>
        </div>
      </section>

      <section className="grid gap-4 sm:grid-cols-3">
        {STEPS.map((s, i) => (
          <div key={s.title} className="rounded-xl border border-zinc-200 p-5 dark:border-zinc-800">
            <div className="text-sm text-zinc-500">Step {i + 1}</div>
            <div className="mt-1 font-semibold">{s.title}</div>
            <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">{s.body}</p>
          </div>
        ))}
      </section>
    </div>
  );
}
