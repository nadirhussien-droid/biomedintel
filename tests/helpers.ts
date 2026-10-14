// Shared helpers for the integration tests.
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/server/db/generated/client";
import { resolveAccess, type AccessContext, type AuthUser } from "@/server/authz/access";

/** Owner-role client (bypasses RLS) for arranging and inspecting test data. */
export function ownerDb(): PrismaClient {
  return new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL_ADMIN! }) });
}

/** A separate app-role client with exactly ONE pooled connection. */
export function singleConnectionAppDb(): PrismaClient {
  return new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL!, max: 1 }) });
}

export const owner = ownerDb();

export async function userByEmail(email: string, opts: { mfa?: boolean } = {}): Promise<AuthUser> {
  const u = await owner.user.findUniqueOrThrow({ where: { email } });
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    twoFactorEnabled: opts.mfa ?? Boolean(u.twoFactorEnabled),
    isPlatformAdmin: u.platformRole === "SUPER_ADMIN",
  };
}

export async function orgId(slug: string): Promise<string> {
  return (await owner.organization.findUniqueOrThrow({ where: { slug } })).id;
}

export async function hospitalId(orgSlug: string, code: string): Promise<string> {
  const org = await orgId(orgSlug);
  return (await owner.hospital.findFirstOrThrow({ where: { organizationId: org, code } })).id;
}

export async function departmentId(orgSlug: string, hospitalCode: string, code: string): Promise<string> {
  const hid = await hospitalId(orgSlug, hospitalCode);
  return (await owner.department.findFirstOrThrow({ where: { hospitalId: hid, code } })).id;
}

/** Access context exactly as the app builds it, optionally with MFA treated as enrolled. */
export async function contextFor(
  email: string,
  orgSlug?: string,
  opts: { mfa?: boolean } = { mfa: true },
): Promise<AccessContext> {
  const user = await userByEmail(email, opts);
  const ctx = await resolveAccess(user, orgSlug ? await orgId(orgSlug) : null);
  if (!ctx) throw new Error(`${email} has no access`);
  return ctx;
}

export async function auditCount(where: {
  action: string;
  actorUserId?: string;
  outcome?: "SUCCESS" | "DENIED" | "FAILURE";
}) {
  return owner.auditLog.count({ where });
}

export function uniqueCode(prefix: string): string {
  return `${prefix}${Math.floor(Math.random() * 1e6)}`.toUpperCase().slice(0, 16);
}
