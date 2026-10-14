// Runs once when the BiomedIntel.ai server starts.
// Refuses to start if configuration is invalid or if the database role could
// bypass Row-Level Security.
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.NEXT_PHASE === "phase-production-build") return;
  const { serverEnv } = await import("./server/env");
  const { assertRestrictedDatabaseRole } = await import("./server/db/client");
  serverEnv();
  await assertRestrictedDatabaseRole();
}
