import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import { DEMO_CARDS } from "@/lib/scoring";
import ScoreCard from "@/components/ScoreCard";

export default async function MyCollectionPage() {
  const session = await getServerSession(authOptions);
  if (!session) redirect("/signin");

  const { user } = session;

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold">My collection</h1>
        <p className="mt-1 text-sm text-zinc-500">
          Signed in with {user.provider === "solana" ? "Solana wallet" : "Google"}
          {user.walletAddress ? (
            <>
              {" "}
              · <span className="font-mono">{user.walletAddress}</span>
            </>
          ) : user.email ? (
            <> · {user.email}</>
          ) : null}
        </p>
      </div>

      <div className="rounded-lg border border-dashed border-zinc-300 p-3 text-sm text-zinc-500 dark:border-zinc-700">
        Showing demo cards. Tokenized cards from your wallet will appear here once on-chain lookup is wired up.
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {DEMO_CARDS.map((card) => (
          <ScoreCard key={card.card_id} card={card} />
        ))}
      </div>
    </div>
  );
}
