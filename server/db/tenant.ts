// Tenant context for database work.
//
// Every read or write of tenant data goes through `withTenant()`. It opens a
// transaction and stores the signed-in user and organisation in PostgreSQL
// settings with `set_config(..., true)`. The `true` means "local to this
// transaction": the values vanish at COMMIT/ROLLBACK, so a pooled connection
// can never carry one request's organisation into the next request.
//
// The values come ONLY from the server-side session and access resolution,
// never from anything the browser sends.
import type { Prisma } from "./generated/client";
import { db } from "./client";

export type Tx = Prisma.TransactionClient;

export type TenantScope = {
  /** Authenticated user id from the server-side session. */
  userId: string;
  /** Organisation the user is acting in, or null for user-level lookups. */
  organizationId: string | null;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function withTenant<T>(scope: TenantScope, work: (tx: Tx) => Promise<T>): Promise<T> {
  if (!scope.userId) throw new Error("withTenant requires an authenticated user id");
  if (scope.organizationId !== null && !UUID.test(scope.organizationId)) {
    throw new Error("withTenant received an invalid organisation id");
  }
  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT
      set_config('app.user_id', ${scope.userId}, true),
      set_config('app.org_id', ${scope.organizationId ?? ""}, true)`;
    return work(tx);
  });
}
