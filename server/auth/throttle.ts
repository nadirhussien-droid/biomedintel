// Per-account limit on failed sign-in attempts (Stage 10).
//
// Why: Better Auth's own rate limit is per IP address, and the IP address is
// read from a request header. A client can send a different made-up address
// on every request and so avoid that limit (verified in Stage 10). This limit
// is keyed on the ACCOUNT instead, so changing the IP address does not help.
//
//   • Sign-in: at most SIGN_IN_LIMIT failed passwords per email address per
//     window. The same reply is given whether or not the account exists.
//   • MFA codes are NOT counted here: Better Auth's two-factor plugin already
//     locks the account for 15 minutes after 10 wrong codes (any IP address).
//
// Keys are SHA-256 hashes, so the table holds no email addresses. A blocked
// account unblocks itself when the window ends; nothing is locked forever.
import "server-only";
import { createHash } from "node:crypto";
import { db } from "../db/client";

export const THROTTLE_WINDOW_MINUTES = 15;
export const SIGN_IN_LIMIT = 10;

export function throttleKey(kind: "signin", subject: string): string {
  return createHash("sha256").update(`${kind}:${subject.trim().toLowerCase()}`).digest("hex");
}

/** True when the key has reached `limit` failures inside the current window. */
export async function isThrottled(key: string, limit: number): Promise<boolean> {
  const rows = await db.$queryRaw<{ failures: number }[]>`
    SELECT failures FROM auth_throttles
    WHERE key = ${key}
      AND window_started_at > now() - make_interval(mins => ${THROTTLE_WINDOW_MINUTES})`;
  return (rows[0]?.failures ?? 0) >= limit;
}

/** Records one failure (atomically; a stale window starts again at 1). */
export async function recordFailure(key: string): Promise<number> {
  const rows = await db.$queryRaw<{ failures: number }[]>`
    INSERT INTO auth_throttles (key, failures, window_started_at, updated_at)
    VALUES (${key}, 1, now(), now())
    ON CONFLICT (key) DO UPDATE SET
      failures = CASE
        WHEN auth_throttles.window_started_at <= now() - make_interval(mins => ${THROTTLE_WINDOW_MINUTES}) THEN 1
        ELSE auth_throttles.failures + 1 END,
      window_started_at = CASE
        WHEN auth_throttles.window_started_at <= now() - make_interval(mins => ${THROTTLE_WINDOW_MINUTES}) THEN now()
        ELSE auth_throttles.window_started_at END,
      updated_at = now()
    RETURNING failures`;
  return rows[0]?.failures ?? 1;
}

/** Clears the counter after a successful sign-in or code. */
export async function clearFailures(key: string): Promise<void> {
  await db.$executeRaw`DELETE FROM auth_throttles WHERE key = ${key}`;
}
