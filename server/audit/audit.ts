// Audit logging foundation.
//
// Audit rows are append-only: the database refuses UPDATE, DELETE and TRUNCATE
// on audit_logs, and the app role is only granted SELECT and INSERT.
//
// Never pass passwords, tokens, secrets or patient information in `metadata`.
// `sanitizeMetadata` strips obviously sensitive keys as a second line of defence.
import type { Tx } from "../db/tenant";
import { withTenant } from "../db/tenant";
import { db } from "../db/client";

export type AuditOutcome = "SUCCESS" | "DENIED" | "FAILURE";

export type RequestMeta = {
  requestId?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
};

export type AuditEvent = {
  organizationId: string | null;
  actorUserId: string | null;
  action: string;
  outcome?: AuditOutcome;
  entityType?: string;
  entityId?: string;
  metadata?: Record<string, unknown>;
  request?: RequestMeta;
};

const SENSITIVE_KEY = /pass(word)?|secret|token|api[-_]?key|authorization|cookie|otp|totp|backup/i;

export function sanitizeMetadata(value: unknown, depth = 0): unknown {
  if (depth > 4) return "[truncated]";
  if (Array.isArray(value)) return value.slice(0, 50).map((v) => sanitizeMetadata(v, depth + 1));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = SENSITIVE_KEY.test(k) ? "[redacted]" : sanitizeMetadata(v, depth + 1);
    }
    return out;
  }
  if (typeof value === "string" && value.length > 500) return `${value.slice(0, 500)}…`;
  return value;
}

function toRow(event: AuditEvent) {
  return {
    organizationId: event.organizationId,
    actorUserId: event.actorUserId,
    action: event.action,
    outcome: event.outcome ?? "SUCCESS",
    entityType: event.entityType ?? null,
    entityId: event.entityId ?? null,
    metadata: event.metadata ? (sanitizeMetadata(event.metadata) as object) : undefined,
    requestId: event.request?.requestId?.slice(0, 100) ?? null,
    ipAddress: event.request?.ipAddress?.slice(0, 100) ?? null,
    userAgent: event.request?.userAgent?.slice(0, 300) ?? null,
  };
}

/**
 * Write an audit event inside the caller's transaction, so the record and the
 * change it describes are saved (or rolled back) together.
 * Uses createMany (no RETURNING) because audit rows are write-only for the app.
 */
export async function audit(tx: Tx, event: AuditEvent): Promise<void> {
  await tx.auditLog.createMany({ data: [toRow(event)] });
}

/**
 * Write an audit event in its OWN transaction. Used for events that must be
 * kept even though the action itself was refused (for example a denied
 * permission check, where the main transaction is rolled back).
 */
export async function auditStandalone(event: AuditEvent): Promise<void> {
  if (event.actorUserId) {
    await withTenant({ userId: event.actorUserId, organizationId: event.organizationId }, (tx) => audit(tx, event));
    return;
  }
  // Events without a signed-in user (for example a failed sign-in) are
  // platform-level and stored without an organisation.
  await db.auditLog.createMany({ data: [toRow({ ...event, organizationId: null })] });
}
