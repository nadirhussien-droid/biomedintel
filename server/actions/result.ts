// Turns service errors into a safe result for forms. Unexpected errors are
// logged on the server with the request id and shown to the user generically.
import { AuthorizationError, NotFoundError, ValidationError } from "../authz/errors";
import { log } from "../log";

export type ActionResult<T = undefined> =
  | { ok: true; message?: string; data?: T }
  | { ok: false; message: string; fieldErrors?: Record<string, string[]> };

export async function runAction<T>(work: () => Promise<T>, success: string): Promise<ActionResult<T>> {
  try {
    const data = await work();
    return { ok: true, message: success, data };
  } catch (error) {
    if (error instanceof ValidationError) return { ok: false, message: error.message, fieldErrors: error.fieldErrors };
    if (error instanceof AuthorizationError) return { ok: false, message: error.message };
    if (error instanceof NotFoundError) return { ok: false, message: error.message };
    // Re-throw Next.js redirect/notFound signals untouched.
    if (error && typeof error === "object" && "digest" in error) throw error;
    log.error("action.failed", {}, error);
    return { ok: false, message: "Something went wrong. Please try again." };
  }
}
