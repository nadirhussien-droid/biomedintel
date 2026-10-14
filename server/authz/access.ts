// Resolves what a signed-in user may access — always on the server, always from
// the database. Nothing here trusts an organisation, hospital, department or
// role sent by the browser: a preferred organisation or hospital (from a
// cookie) is only used if the database confirms the user may access it.
import { withTenant } from "../db/tenant";
import { auditStandalone, type RequestMeta } from "../audit/audit";
import { AuthorizationError, NotFoundError } from "./errors";
import { roleCan, type Action } from "./permissions";
import { roleRequiresMfa, type MembershipRole } from "./roles";

export type AuthUser = {
  id: string;
  name: string;
  email: string;
  twoFactorEnabled: boolean;
  isPlatformAdmin: boolean;
};

export type HospitalAccess = {
  id: string;
  name: string;
  code: string;
  /** "ALL" = every department in this hospital; otherwise the allowed ids. */
  departments: "ALL" | string[];
};

export type OrganizationSummary = { id: string; name: string; slug: string; role: MembershipRole };

export type AccessContext = {
  user: AuthUser;
  organization: { id: string; name: string; slug: string };
  membershipId: string;
  role: MembershipRole;
  orgWide: boolean;
  hospitals: HospitalAccess[];
  organizations: OrganizationSummary[];
  mfaRequired: boolean;
  request?: RequestMeta;
};

/** Organisations the user has an ACTIVE membership in (for the switcher). */
export async function listUserOrganizations(userId: string): Promise<OrganizationSummary[]> {
  return withTenant({ userId, organizationId: null }, async (tx) => {
    const memberships = await tx.membership.findMany({
      where: { userId, status: "ACTIVE", organization: { status: "ACTIVE" } },
      select: { role: true, organization: { select: { id: true, name: true, slug: true } } },
      orderBy: { organization: { name: "asc" } },
    });
    return memberships.map((m) => ({ ...m.organization, role: m.role }));
  });
}

/**
 * Builds the access context for one organisation.
 * Returns null when the user has no active membership anywhere.
 */
export async function resolveAccess(
  user: AuthUser,
  preferredOrganizationId?: string | null,
  request?: RequestMeta,
): Promise<AccessContext | null> {
  const organizations = await listUserOrganizations(user.id);
  if (organizations.length === 0) return null;

  // A cookie can only CHOOSE between organisations the database already allows.
  const chosen = organizations.find((o) => o.id === preferredOrganizationId) ?? organizations[0];

  return withTenant({ userId: user.id, organizationId: chosen.id }, async (tx) => {
    const membership = await tx.membership.findFirst({
      where: { organizationId: chosen.id, userId: user.id, status: "ACTIVE" },
      select: {
        id: true,
        role: true,
        orgWide: true,
        scopes: { select: { hospitalId: true, departmentId: true } },
      },
    });
    if (!membership) return null;

    const hospitalWhere = membership.orgWide
      ? { status: "ACTIVE" as const }
      : { status: "ACTIVE" as const, id: { in: membership.scopes.map((s) => s.hospitalId) } };

    const hospitals = await tx.hospital.findMany({
      where: hospitalWhere,
      select: { id: true, name: true, code: true },
      orderBy: { name: "asc" },
    });

    const access: HospitalAccess[] = hospitals.map((h) => {
      if (membership.orgWide) return { ...h, departments: "ALL" };
      const scopes = membership.scopes.filter((s) => s.hospitalId === h.id);
      if (scopes.some((s) => s.departmentId === null)) return { ...h, departments: "ALL" };
      return { ...h, departments: scopes.map((s) => s.departmentId as string) };
    });

    return {
      user,
      organization: { id: chosen.id, name: chosen.name, slug: chosen.slug },
      membershipId: membership.id,
      role: membership.role,
      orgWide: membership.orgWide,
      hospitals: access,
      organizations,
      mfaRequired: roleRequiresMfa(membership.role, user.isPlatformAdmin),
      request,
    };
  });
}

export function can(ctx: AccessContext, action: Action): boolean {
  return roleCan(ctx.role, action);
}

/**
 * Throws AuthorizationError (and records a DENIED audit event) unless the
 * user's role allows the action. Call this FIRST in every service function.
 */
export async function requirePermission(
  ctx: AccessContext,
  action: Action,
  target?: { entityType: string; entityId?: string },
): Promise<void> {
  if (ctx.mfaRequired && !ctx.user.twoFactorEnabled) {
    await auditDenied(ctx, action, target, "mfa_not_enrolled");
    throw new AuthorizationError(action);
  }
  if (!roleCan(ctx.role, action)) {
    await auditDenied(ctx, action, target, "role_not_permitted");
    throw new AuthorizationError(action);
  }
}

async function auditDenied(
  ctx: AccessContext,
  action: string,
  target: { entityType: string; entityId?: string } | undefined,
  reason: string,
): Promise<void> {
  await auditStandalone({
    organizationId: ctx.organization.id,
    actorUserId: ctx.user.id,
    action: "authz.denied",
    outcome: "DENIED",
    entityType: target?.entityType,
    entityId: target?.entityId,
    metadata: { attemptedAction: action, role: ctx.role, reason },
    request: ctx.request,
  });
}

export function findHospital(ctx: AccessContext, hospitalId: string): HospitalAccess | undefined {
  return ctx.hospitals.find((h) => h.id === hospitalId);
}

export function canAccessDepartment(ctx: AccessContext, hospitalId: string, departmentId: string): boolean {
  const hospital = findHospital(ctx, hospitalId);
  if (!hospital) return false;
  return hospital.departments === "ALL" || hospital.departments.includes(departmentId);
}

/**
 * Throws NotFoundError unless the hospital (and department, if given) is in the
 * user's scope. "Not found" is used on purpose so a guessed id reveals nothing.
 */
export async function requireHospitalAccess(
  ctx: AccessContext,
  hospitalId: string,
  departmentId?: string | null,
): Promise<HospitalAccess> {
  const hospital = findHospital(ctx, hospitalId);
  const ok = hospital && (!departmentId || canAccessDepartment(ctx, hospitalId, departmentId));
  if (!ok) {
    await auditStandalone({
      organizationId: ctx.organization.id,
      actorUserId: ctx.user.id,
      action: "authz.denied",
      outcome: "DENIED",
      entityType: departmentId ? "department" : "hospital",
      entityId: departmentId ?? hospitalId,
      metadata: { reason: "outside_scope", role: ctx.role },
      request: ctx.request,
    });
    throw new NotFoundError(departmentId ? "Department" : "Hospital");
  }
  return hospital;
}
