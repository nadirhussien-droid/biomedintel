// Runs once when the BiomedIntel.ai server starts.
// Refuses to start if configuration is invalid or if the database role could
// bypass Row-Level Security.
import type { Instrumentation } from "next";

export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.NEXT_PHASE === "phase-production-build") return;
  const { serverEnv } = await import("./server/env");
  const { assertRestrictedDatabaseRole } = await import("./server/db/client");
  const { log } = await import("./server/log");
  serverEnv();
  try {
    await assertRestrictedDatabaseRole();
  } catch (error) {
    // A wrong database role is fatal. An unreachable database is reported
    // loudly; /api/health/ready then answers 503 so the host can alert.
    log.error("startup.database_check_failed", {}, error);
    if (error instanceof Error && error.message.includes("Row-Level Security")) throw error;
  }
  log.info("startup.ready", { nodeEnv: process.env.NODE_ENV });
}

// Stage 10: every unhandled server error becomes one structured log line with
// the request id. Headers, cookies, bodies and query strings are NOT logged.
export const onRequestError: Instrumentation.onRequestError = async (error, request, context) => {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { log } = await import("./server/log");
  const header = request.headers["x-request-id"];
  // The browser left before the response finished (closed tab, navigated
  // away). Not a server fault, so it is a warning, not an error alert.
  const clientGone = error instanceof Error && error.message === "The destination stream closed early.";
  // A role without access opened a page: the section's layout already shows
  // "Your role does not include …", but Next.js renders the page in parallel
  // and its permission check throws. That is a refused access, recorded as an
  // authorization warning (useful for security review), not a server fault.
  const denied = error instanceof Error && error.name === "AuthorizationError";
  (clientGone || denied ? log.warn : log.error)(
    clientGone ? "request.client_disconnected" : denied ? "authz.page_denied" : "request.unhandled_error",
    {
      requestId: Array.isArray(header) ? header[0] : (header ?? null),
      method: request.method,
      path: request.path.split("?")[0],
      routePath: context.routePath,
      routeType: context.routeType,
    },
    error,
  );
};
