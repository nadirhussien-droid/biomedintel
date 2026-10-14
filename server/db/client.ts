// The ONE database client the web application uses.
//
// It connects as the restricted `biomedintel_app` role (DATABASE_URL), which has
// no BYPASSRLS. Queries on tenant tables only return rows when they run inside
// `withTenant()` (server/db/tenant.ts), which sets the organisation for that
// transaction. A query outside `withTenant()` sees no tenant rows at all.
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "./generated/client";
import { serverEnv } from "../env";

const globalForPrisma = globalThis as unknown as { biomedintelDb?: PrismaClient };

function createClient(): PrismaClient {
  const adapter = new PrismaPg({ connectionString: serverEnv().DATABASE_URL });
  return new PrismaClient({ adapter });
}

export const db: PrismaClient = globalForPrisma.biomedintelDb ?? createClient();

// Reuse one client across hot reloads in development (avoids exhausting connections).
if (process.env.NODE_ENV !== "production") globalForPrisma.biomedintelDb = db;

/**
 * Refuses to run if the app is connected with a role that can bypass
 * Row-Level Security (for example the owner role or a superuser).
 * Called once at server start (instrumentation.ts) and by the test suite.
 */
export async function assertRestrictedDatabaseRole(client: PrismaClient = db): Promise<void> {
  const rows = await client.$queryRaw<{ rolname: string; bypass: boolean; superuser: boolean }[]>`
    SELECT rolname, rolbypassrls AS bypass, rolsuper AS superuser
    FROM pg_roles WHERE rolname = current_user`;
  const role = rows[0];
  if (!role || role.bypass || role.superuser) {
    throw new Error(
      `DATABASE_URL connects as "${role?.rolname ?? "unknown"}", which can bypass Row-Level Security. ` +
        "The web application must use the restricted biomedintel_app role.",
    );
  }
}
