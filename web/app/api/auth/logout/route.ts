import { handle, ok } from "@/lib/server/api";
import { clearSession } from "@/lib/server/session";

export const POST = handle(async () => { clearSession(); return ok({}); });
