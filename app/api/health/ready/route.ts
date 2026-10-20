// Readiness check (Stage 10): "can BiomedIntel.ai serve requests right now?"
// Checks the database answers within 3 seconds, using the restricted app
// role. Public, so it reveals nothing beyond ok / unavailable.
import { db } from "@/server/db/client";
import { log } from "@/server/log";

export const dynamic = "force-dynamic";
const TIMEOUT_MS = 3000;

export async function GET() {
  const started = Date.now();
  try {
    await Promise.race([
      db.$queryRaw`SELECT 1`,
      new Promise((_, reject) => setTimeout(() => reject(new Error("database check timed out")), TIMEOUT_MS)),
    ]);
    return Response.json(
      { status: "ok", database: "ok", ms: Date.now() - started },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    log.error("health.database_unavailable", { ms: Date.now() - started }, error);
    return Response.json(
      { status: "unavailable", database: "unavailable" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
