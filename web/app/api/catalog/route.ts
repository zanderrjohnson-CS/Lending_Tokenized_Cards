import { handle, ok } from "@/lib/server/api";
import { getScoreProvider } from "@/lib/score";
import { DEFAULT_POLICY } from "@/lib/terms";

export const dynamic = "force-dynamic";

export const GET = handle(async () => {
  const cards = await getScoreProvider().catalog();
  return ok(cards.map((c) => ({ ...c, terms: DEFAULT_POLICY.termsFor(c.score) })));
});
