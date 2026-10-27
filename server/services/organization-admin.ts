// Organisation administration: hospitals, departments and members.
//
// Pattern used by every service function in BiomedIntel.ai:
//   1. requirePermission  — is this role allowed? (denials are audited)
//   2. parseInput         — is the input valid? (never trust the browser)
//   3. scope check        — is the target inside the user's hospitals?
//   4. withTenant         — do the work with RLS set to this organisation
//   5. audit              — record what changed, in the same transaction
import { withTenant } from "../db/tenant";
import { audit } from "../audit/audit";
import { requirePermission, requireHospitalAccess, type AccessContext } from "../authz/access";
import { NotFoundError, ValidationError } from "../authz/errors";
import { parseInput, isUniqueViolation } from "../validation";
import { findOrCreateUserWithPassword, generateTemporaryPassword } from "../auth/users";
import {
  addMemberSchema,
  archiveSchema,
  changeMemberRoleSchema,
  removeMemberSchema,
  createDepartmentSchema,
  createHospitalSchema,
  resetMfaSchema,
} from "@/lib/validation/admin";
import type { MembershipRole } from "../authz/roles";

const tenant = (ctx: AccessContext) => ({ userId: ctx.user.id, organizationId: ctx.organization.id });

// ─── Hospitals ───────────────────────────────────────────────────────────────

export async function listHospitals(ctx: AccessContext) {
  await requirePermission(ctx, "hospital.view");
  const ids = ctx.hospitals.map((h) => h.id);
  return withTenant(tenant(ctx), (tx) =>
    tx.hospital.findMany({
      where: { id: { in: ids } },
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        code: true,
        timezone: true,
        status: true,
        departments: {
          where: { status: "ACTIVE" },
          orderBy: { name: "asc" },
          select: { id: true, name: true, code: true },
        },
      },
    }),
  );
}

/** Returns one hospital the user may see, or throws NotFoundError. */
export async function getHospital(ctx: AccessContext, hospitalId: string) {
  await requirePermission(ctx, "hospital.view");
  parseInput(archiveSchema, { id: hospitalId });
  await requireHospitalAccess(ctx, hospitalId);
  const hospital = await withTenant(tenant(ctx), (tx) =>
    tx.hospital.findUnique({ where: { id: hospitalId }, select: { id: true, name: true, code: true, status: true } }),
  );
  if (!hospital) throw new NotFoundError("Hospital");
  return hospital;
}

export async function createHospital(ctx: AccessContext, input: unknown) {
  await requirePermission(ctx, "hospital.create", { entityType: "hospital" });
  const data = parseInput(createHospitalSchema, input);
  try {
    return await withTenant(tenant(ctx), async (tx) => {
      const hospital = await tx.hospital.create({
        data: { organizationId: ctx.organization.id, name: data.name, code: data.code, timezone: data.timezone },
        select: { id: true, name: true, code: true },
      });
      await audit(tx, {
        organizationId: ctx.organization.id,
        actorUserId: ctx.user.id,
        action: "hospital.created",
        entityType: "hospital",
        entityId: hospital.id,
        metadata: { name: hospital.name, code: hospital.code },
        request: ctx.request,
      });
      return hospital;
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new ValidationError("That hospital code is already used in this organisation.", {
        code: ["Already in use"],
      });
    }
    throw error;
  }
}

/** Archives a hospital and its departments. Nothing is deleted. */
export async function archiveHospital(ctx: AccessContext, input: unknown) {
  await requirePermission(ctx, "hospital.archive", { entityType: "hospital" });
  const { id } = parseInput(archiveSchema, input);
  await requireHospitalAccess(ctx, id);
  return withTenant(tenant(ctx), async (tx) => {
    const now = new Date();
    const updated = await tx.hospital.updateMany({
      where: { id, status: "ACTIVE" },
      data: { status: "ARCHIVED", archivedAt: now },
    });
    if (updated.count === 0) throw new NotFoundError("Hospital");
    const departments = await tx.department.updateMany({
      where: { hospitalId: id, status: "ACTIVE" },
      data: { status: "ARCHIVED", archivedAt: now },
    });
    await audit(tx, {
      organizationId: ctx.organization.id,
      actorUserId: ctx.user.id,
      action: "hospital.archived",
      entityType: "hospital",
      entityId: id,
      metadata: { departmentsArchived: departments.count },
      request: ctx.request,
    });
  });
}

// ─── Departments ─────────────────────────────────────────────────────────────

export async function createDepartment(ctx: AccessContext, input: unknown) {
  await requirePermission(ctx, "department.create", { entityType: "department" });
  const data = parseInput(createDepartmentSchema, input);
  await requireHospitalAccess(ctx, data.hospitalId);
  try {
    return await withTenant(tenant(ctx), async (tx) => {
      const department = await tx.department.create({
        data: { organizationId: ctx.organization.id, hospitalId: data.hospitalId, name: data.name, code: data.code },
        select: { id: true, name: true, code: true, hospitalId: true },
      });
      await audit(tx, {
        organizationId: ctx.organization.id,
        actorUserId: ctx.user.id,
        action: "department.created",
        entityType: "department",
        entityId: department.id,
        metadata: { name: department.name, code: department.code, hospitalId: department.hospitalId },
        request: ctx.request,
      });
      return department;
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new ValidationError("That department code is already used in this hospital.", { code: ["Already in use"] });
    }
    throw error;
  }
}

export async function archiveDepartment(ctx: AccessContext, input: unknown) {
  await requirePermission(ctx, "department.archive", { entityType: "department" });
  const { id } = parseInput(archiveSchema, input);
  return withTenant(tenant(ctx), async (tx) => {
    const department = await tx.department.findUnique({ where: { id }, select: { hospitalId: true, status: true } });
    if (!department || department.status !== "ACTIVE") throw new NotFoundError("Department");
    await requireHospitalAccess(ctx, department.hospitalId, id);
    await tx.department.update({ where: { id }, data: { status: "ARCHIVED", archivedAt: new Date() } });
    await audit(tx, {
      organizationId: ctx.organization.id,
      actorUserId: ctx.user.id,
      action: "department.archived",
      entityType: "department",
      entityId: id,
      request: ctx.request,
    });
  });
}

/** Archived hospitals, and archived departments of hospitals that are still active (for the Restore buttons). */
export async function listArchived(ctx: AccessContext) {
  await requirePermission(ctx, "hospital.archive");
  return withTenant(tenant(ctx), async (tx) => {
    const hospitals = await tx.hospital.findMany({
      where: { status: "ARCHIVED" },
      orderBy: { name: "asc" },
      select: { id: true, name: true, code: true, archivedAt: true },
    });
    const departments = await tx.department.findMany({
      where: { status: "ARCHIVED", hospital: { status: "ACTIVE" } },
      orderBy: [{ hospital: { name: "asc" } }, { name: "asc" }],
      select: { id: true, name: true, code: true, archivedAt: true, hospital: { select: { name: true } } },
    });
    return { hospitals, departments };
  });
}

/**
 * Undoes an archive. The hospital comes back together with the departments that were archived at
 * the same moment as it; a department archived on its own earlier stays archived.
 */
export async function restoreHospital(ctx: AccessContext, input: unknown) {
  await requirePermission(ctx, "hospital.archive", { entityType: "hospital" });
  const { id } = parseInput(archiveSchema, input);
  return withTenant(tenant(ctx), async (tx) => {
    const hospital = await tx.hospital.findUnique({ where: { id }, select: { status: true, archivedAt: true } });
    if (!hospital || hospital.status !== "ARCHIVED") throw new NotFoundError("Hospital");
    await tx.hospital.update({ where: { id }, data: { status: "ACTIVE", archivedAt: null } });
    const departments = hospital.archivedAt
      ? await tx.department.updateMany({
          where: { hospitalId: id, status: "ARCHIVED", archivedAt: hospital.archivedAt },
          data: { status: "ACTIVE", archivedAt: null },
        })
      : { count: 0 };
    await audit(tx, {
      organizationId: ctx.organization.id,
      actorUserId: ctx.user.id,
      action: "hospital.restored",
      entityType: "hospital",
      entityId: id,
      metadata: { departmentsRestored: departments.count },
      request: ctx.request,
    });
  });
}

export async function restoreDepartment(ctx: AccessContext, input: unknown) {
  await requirePermission(ctx, "department.archive", { entityType: "department" });
  const { id } = parseInput(archiveSchema, input);
  return withTenant(tenant(ctx), async (tx) => {
    const department = await tx.department.findUnique({
      where: { id },
      select: { status: true, hospital: { select: { status: true } } },
    });
    if (!department || department.status !== "ARCHIVED") throw new NotFoundError("Department");
    if (department.hospital.status !== "ACTIVE") {
      throw new ValidationError("Restore the hospital first, then its departments.");
    }
    await tx.department.update({ where: { id }, data: { status: "ACTIVE", archivedAt: null } });
    await audit(tx, {
      organizationId: ctx.organization.id,
      actorUserId: ctx.user.id,
      action: "department.restored",
      entityType: "department",
      entityId: id,
      request: ctx.request,
    });
  });
}

// ─── Members ─────────────────────────────────────────────────────────────────

export async function listMembers(ctx: AccessContext) {
  await requirePermission(ctx, "member.view");
  return withTenant(tenant(ctx), (tx) =>
    tx.membership.findMany({
      where: { organizationId: ctx.organization.id },
      orderBy: [{ status: "asc" }, { user: { name: "asc" } }],
      select: {
        id: true,
        role: true,
        orgWide: true,
        status: true,
        user: { select: { id: true, name: true, email: true, twoFactorEnabled: true } },
        scopes: {
          select: {
            hospital: { select: { id: true, name: true, code: true } },
            department: { select: { id: true, name: true, code: true } },
          },
        },
      },
    }),
  );
}

/**
 * Changes a member's role. Rules:
 *  • only Organization Administrators may do it (permission check);
 *  • nobody can change their OWN role (prevents self-escalation and lock-out);
 *  • the last active Organization Administrator cannot be demoted;
 *  • Organization Administrators always cover the whole organisation.
 */
export async function changeMemberRole(ctx: AccessContext, input: unknown) {
  await requirePermission(ctx, "member.changeRole", { entityType: "membership" });
  const data = parseInput(changeMemberRoleSchema, input);
  if (data.membershipId === ctx.membershipId) {
    throw new ValidationError("You cannot change your own role. Ask another Organization Administrator.");
  }
  return withTenant(tenant(ctx), async (tx) => {
    const target = await tx.membership.findUnique({
      where: { id: data.membershipId },
      select: { id: true, role: true, status: true, orgWide: true, userId: true },
    });
    if (!target || target.status !== "ACTIVE") throw new NotFoundError("Member");
    if (target.role === data.role) return target;

    if (target.role === "ORG_ADMIN") {
      const admins = await tx.membership.count({ where: { role: "ORG_ADMIN", status: "ACTIVE" } });
      if (admins <= 1) throw new ValidationError("The organisation must keep at least one Organization Administrator.");
    }

    const orgWide = data.role === "ORG_ADMIN" ? true : target.orgWide;
    const updated = await tx.membership.update({
      where: { id: target.id },
      data: { role: data.role as MembershipRole, orgWide },
      select: { id: true, role: true, orgWide: true },
    });
    await audit(tx, {
      organizationId: ctx.organization.id,
      actorUserId: ctx.user.id,
      action: "membership.role_changed",
      entityType: "membership",
      entityId: target.id,
      metadata: { userId: target.userId, from: target.role, to: updated.role, orgWide: updated.orgWide },
      request: ctx.request,
    });
    return updated;
  });
}

/**
 * Takes a member's role away. The membership is marked REVOKED, never deleted, so every
 * job, test and record they signed stays attached to their name. Rules:
 *  • only Organization Administrators may do it;
 *  • nobody can remove themselves;
 *  • the last active Organization Administrator cannot be removed;
 *  • adding the same person again restores their access.
 */
export async function removeMember(ctx: AccessContext, input: unknown) {
  await requirePermission(ctx, "member.remove", { entityType: "membership" });
  const data = parseInput(removeMemberSchema, input);
  if (data.membershipId === ctx.membershipId) {
    throw new ValidationError("You cannot remove your own role. Ask another Organization Administrator.");
  }
  return withTenant(tenant(ctx), async (tx) => {
    const target = await tx.membership.findUnique({
      where: { id: data.membershipId },
      select: { id: true, role: true, status: true, userId: true },
    });
    if (!target || target.status !== "ACTIVE") throw new NotFoundError("Member");
    if (target.role === "ORG_ADMIN") {
      const admins = await tx.membership.count({ where: { role: "ORG_ADMIN", status: "ACTIVE" } });
      if (admins <= 1) throw new ValidationError("The organisation must keep at least one Organization Administrator.");
    }
    await tx.membership.update({ where: { id: target.id }, data: { status: "REVOKED" } });
    await audit(tx, {
      organizationId: ctx.organization.id,
      actorUserId: ctx.user.id,
      action: "membership.revoked",
      entityType: "membership",
      entityId: target.id,
      metadata: { userId: target.userId, role: target.role },
      request: ctx.request,
    });
    return { id: target.id };
  });
}

/**
 * MFA recovery (Stage 6, decision of 15 Oct 2026). For a member who has lost
 * BOTH their authenticator and their backup codes. An Organization
 * Administrator — never the person themselves — removes their authenticator
 * after checking who they are (outside the app, e.g. in person). This:
 *   • deletes the encrypted authenticator secret and backup codes;
 *   • signs the person out everywhere;
 *   • audits who did it, for whom and why.
 * At their next sign-in the person must set up a new authenticator before
 * they can do anything (privileged roles), or is encouraged to (other roles).
 */
export async function resetMemberMfa(ctx: AccessContext, input: unknown) {
  await requirePermission(ctx, "member.resetMfa", { entityType: "membership" });
  const data = parseInput(resetMfaSchema, input);
  if (data.membershipId === ctx.membershipId) {
    throw new ValidationError(
      "You cannot reset your own two-step verification. Ask another Organization Administrator.",
    );
  }
  const result = await withTenant(tenant(ctx), async (tx) => {
    const target = await tx.membership.findUnique({
      where: { id: data.membershipId },
      select: {
        id: true,
        status: true,
        userId: true,
        user: { select: { twoFactorEnabled: true, platformRole: true } },
      },
    });
    if (!target || target.status !== "ACTIVE") throw new NotFoundError("Member");
    if (target.user.platformRole)
      throw new ValidationError("Platform administrators are recovered by the platform team.");
    if (!target.user.twoFactorEnabled) throw new ValidationError("This person has not set up two-step verification.");
    // Stage 10: the reset removes the person's authenticator for EVERY
    // organisation they belong to, so it is refused when they also belong to
    // another one. The platform team handles those recoveries.
    const [{ other }] = await tx.$queryRaw<
      { other: boolean }[]
    >`SELECT app_user_in_other_org(${target.userId}) AS other`;
    if (other) return { refused: true as const, userId: target.userId, membershipId: target.id };
    await tx.twoFactor.deleteMany({ where: { userId: target.userId } });
    await tx.user.update({ where: { id: target.userId }, data: { twoFactorEnabled: false } });
    const sessions = await tx.session.deleteMany({ where: { userId: target.userId } });
    await audit(tx, {
      organizationId: ctx.organization.id,
      actorUserId: ctx.user.id,
      action: "auth.mfa_reset_by_admin",
      entityType: "user",
      entityId: target.userId,
      metadata: { membershipId: target.id, reason: data.reason, sessionsEnded: sessions.count },
      request: ctx.request,
    });
    return { refused: false as const, sessionsEnded: sessions.count };
  });
  if (result.refused) {
    // Recorded in its own transaction, so the refusal is kept.
    await withTenant(tenant(ctx), (tx) =>
      audit(tx, {
        organizationId: ctx.organization.id,
        actorUserId: ctx.user.id,
        action: "auth.mfa_reset_refused",
        outcome: "DENIED",
        entityType: "user",
        entityId: result.userId,
        metadata: { membershipId: result.membershipId, reason: "member_of_another_organisation" },
        request: ctx.request,
      }),
    );
    throw new ValidationError(
      "This person also uses BiomedIntel.ai in another organisation, so their two-step verification can only be reset by the BiomedIntel.ai platform team.",
    );
  }
  return { sessionsEnded: result.sessionsEnded };
}

/**
 * Adds a person to the organisation. If they have no BiomedIntel.ai login yet,
 * one is created with a temporary password that is returned ONCE so the
 * administrator can pass it on securely. (Email invitations replace this in a
 * later stage.)
 */
export async function addMember(ctx: AccessContext, input: unknown) {
  await requirePermission(ctx, "member.add", { entityType: "membership" });
  const data = parseInput(addMemberSchema, input);
  if (!data.orgWide && data.hospitalId) {
    await requireHospitalAccess(ctx, data.hospitalId, data.departmentId);
  }
  const temporaryPassword = generateTemporaryPassword();
  try {
    return await withTenant(tenant(ctx), async (tx) => {
      const user = await findOrCreateUserWithPassword(tx, {
        email: data.email,
        name: data.name,
        password: temporaryPassword,
      });
      // Someone whose role was removed earlier is restored, not duplicated.
      const earlier = await tx.membership.findFirst({
        where: { userId: user.id },
        select: { id: true, status: true },
      });
      const restored = earlier && earlier.status !== "ACTIVE";
      const membership = restored
        ? await tx.membership.update({
            where: { id: earlier.id },
            data: { status: "ACTIVE", role: data.role, orgWide: data.orgWide },
            select: { id: true },
          })
        : await tx.membership.create({
            data: {
              organizationId: ctx.organization.id,
              userId: user.id,
              role: data.role,
              orgWide: data.orgWide,
              createdById: ctx.user.id,
            },
            select: { id: true },
          });
      if (restored) await tx.membershipScope.deleteMany({ where: { membershipId: membership.id } });
      if (!data.orgWide && data.hospitalId) {
        await tx.membershipScope.create({
          data: {
            organizationId: ctx.organization.id,
            membershipId: membership.id,
            hospitalId: data.hospitalId,
            departmentId: data.departmentId,
          },
        });
      }
      await audit(tx, {
        organizationId: ctx.organization.id,
        actorUserId: ctx.user.id,
        action: restored ? "membership.restored" : "membership.created",
        entityType: "membership",
        entityId: membership.id,
        metadata: {
          userId: user.id,
          newLogin: user.created,
          role: data.role,
          orgWide: data.orgWide,
          hospitalId: data.hospitalId,
          departmentId: data.departmentId,
        },
        request: ctx.request,
      });
      return { membershipId: membership.id, temporaryPassword: user.created ? temporaryPassword : null };
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new ValidationError("This person is already a member of the organisation.", {
        email: ["Already a member"],
      });
    }
    throw error;
  }
}

// ─── Audit log ───────────────────────────────────────────────────────────────

export async function listAuditLogs(ctx: AccessContext, limit = 50) {
  await requirePermission(ctx, "audit.view");
  return withTenant(tenant(ctx), (tx) =>
    tx.auditLog.findMany({
      where: { organizationId: ctx.organization.id },
      orderBy: { createdAt: "desc" },
      take: Math.min(Math.max(limit, 1), 200),
      select: {
        id: true,
        action: true,
        outcome: true,
        entityType: true,
        entityId: true,
        actorUserId: true,
        createdAt: true,
        requestId: true,
        ipAddress: true, // Stage 10: lets administrators spot sign-ins from unexpected places
      },
    }),
  );
}
