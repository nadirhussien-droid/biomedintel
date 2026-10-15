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

// ─── Equipment (Stage 4) ─────────────────────────────────────────────────────

export async function assetId(orgSlug: string, tag: string): Promise<string> {
  const org = await orgId(orgSlug);
  return (await owner.asset.findFirstOrThrow({ where: { organizationId: org, assetTag: tag } })).id;
}

export async function assetRow(orgSlug: string, tag: string) {
  const org = await orgId(orgSlug);
  return owner.asset.findFirstOrThrow({ where: { organizationId: org, assetTag: tag } });
}

export async function modelId(orgSlug: string, modelName: string): Promise<string> {
  const org = await orgId(orgSlug);
  return (await owner.equipmentModel.findFirstOrThrow({ where: { organizationId: org, modelName } })).id;
}

export async function locationId(orgSlug: string, name: string): Promise<string> {
  const org = await orgId(orgSlug);
  return (await owner.location.findFirstOrThrow({ where: { organizationId: org, name } })).id;
}

/** A valid "register asset" form for Coastal, Riverside General, ICU. */
export async function coastalAssetInput(overrides: Record<string, unknown> = {}) {
  return {
    name: "Test infusion pump",
    assetTag: uniqueCode("T-"),
    modelId: await modelId("coastal-health", "DM-Infuse 100"),
    hospitalId: await hospitalId("coastal-health", "RGH"),
    departmentId: await departmentId("coastal-health", "RGH", "ICU"),
    locationId: "",
    serialNumber: `TEST-${uniqueCode("SN")}`,
    inventoryNumber: "",
    supplier: "",
    description: "",
    status: "IN_SERVICE",
    riskClass: "HIGH",
    purchaseDate: "",
    commissionedAt: "",
    eolDate: "",
    purchaseCost: null,
    purchaseCurrency: null,
    confirmDuplicateSerial: false,
    ...overrides,
  };
}

/** Creates a fictional extra member (for tests that need, e.g., a second technician). */
export async function addTestMember(
  orgSlug: string,
  role: "TECHNICIAN" | "ENGINEERING_MANAGER" | "DEPARTMENT_HEAD" | "FAULT_REPORTER" | "AUDITOR",
  scopes: { hospital: string; department?: string }[],
): Promise<string> {
  const { randomUUID } = await import("node:crypto");
  const org = await orgId(orgSlug);
  const id = randomUUID();
  const email = `test-${role.toLowerCase()}-${id.slice(0, 8)}@${orgSlug.split("-")[0]}.example`;
  await owner.user.create({
    data: { id, name: `Test ${role.toLowerCase()} ${id.slice(0, 4)}`, email, emailVerified: true },
  });
  const m = await owner.membership.create({ data: { organizationId: org, userId: id, role } });
  for (const s of scopes) {
    await owner.membershipScope.create({
      data: {
        organizationId: org,
        membershipId: m.id,
        hospitalId: await hospitalId(orgSlug, s.hospital),
        departmentId: s.department ? await departmentId(orgSlug, s.hospital, s.department) : null,
      },
    });
  }
  return email;
}

/** The most recent work order on an asset. */
export async function latestWorkOrder(orgSlug: string, tag: string) {
  return owner.workOrder.findFirstOrThrow({
    where: { assetId: await assetId(orgSlug, tag) },
    orderBy: { createdAt: "desc" },
  });
}
