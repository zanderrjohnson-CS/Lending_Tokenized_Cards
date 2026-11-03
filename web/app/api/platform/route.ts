import { handle, ok } from "@/lib/server/api";
import { escrowKeypair, vaultKeypair } from "@/lib/server/keys";
import { CLUSTER, SOL_USD } from "@/lib/config";
import { DEFAULT_POLICY } from "@/lib/terms";
import { getScoreProvider } from "@/lib/score";

export const dynamic = "force-dynamic";

export const GET = handle(async () =>
  ok({
    cluster: CLUSTER,
    escrow: escrowKeypair().publicKey.toBase58(),
    vault: vaultKeypair().publicKey.toBase58(),
    solUsd: SOL_USD,
    policy: DEFAULT_POLICY.name,
    scoreSource: getScoreProvider().name,
  }),
);
