// Platform administration (BiomedIntel.ai staff only).
//
// A Platform Super Administrator can create organisations and their first
// Organization Administrator. They do NOT get access to hospital data: by
// design (Stage 2, section 3) there is no default platform access to customer
// maintenance records.
import { withTenant } from "../db/tenant";
import { audit, auditStandalone } from "../audit/audit";
import type { AuthUser } from "../authz/access";
import { AuthorizationError, NotFoundError, ValidationError } from "../authz/errors";
import { parseInput, isUniqueViolation } from "../validation";
import { findOrCreateUserWithPassword, generateTemporaryPassword } from "../auth/users";
import { createOrganizationSchema, setOrganizationAiModelSchema } from "@/lib/validation/admin";
import type { RequestMeta } from "../audit/audit";

async function requirePlatform(user: AuthUser, action: string, request?: RequestMeta) {
  if (!user.isPlatformAdmin || !user.twoFactorEnabled) {
    await auditStandalone({
      organizationId: null,
      actorUserId: user.id,
      action: "authz.denied",
      outcome: "DENIED",
      metadata: { attemptedAction: action, reason: user.isPlatformAdmin ? "mfa_not_enrolled" : "not_platform_admin" },
      request,
    });
    throw new AuthorizationError(action);
  }
}

export async function listOrganizations(user: AuthUser, request?: RequestMeta) {
  await requirePlatform(user, "platform.organization.list", request);
  return withTenant({ userId: user.id, organizationId: null }, (tx) =>
    tx.organization.findMany({
      orderBy: { name: "asc" },
      select: { id: true, name: true, slug: true, country: true, status: true, aiModel: true, createdAt: true },
    }),
  );
}

export async function createOrganization(user: AuthUser, input: unknown, request?: RequestMeta) {
  await requirePlatform(user, "platform.organization.create", request);
  const data = parseInput(createOrganizationSchema, input);
  const temporaryPassword = generateTemporaryPassword();
  try {
    // One transaction: if any step fails, nothing is saved.
    return await withTenant({ userId: user.id, organizationId: null }, async (tx) => {
      // Step 1: create the organisation (RLS allows this only for platform administrators).
      const org = await tx.organization.create({
        data: { name: data.name, slug: data.slug, country: data.country },
        select: { id: true, name: true, slug: true },
      });
      // Step 2: switch this transaction's tenant context to the new organisation.
      await tx.$executeRaw`SELECT set_config('app.org_id', ${org.id}, true)`;
      // Step 3: add its first Organization Administrator.
      const adminUser = await findOrCreateUserWithPassword(tx, {
        email: data.adminEmail,
        name: data.adminName,
        password: temporaryPassword,
      });
      await tx.membership.create({
        data: { organizationId: org.id, userId: adminUser.id, role: "ORG_ADMIN", orgWide: true, createdById: user.id },
      });
      await audit(tx, {
        organizationId: org.id,
        actorUserId: user.id,
        action: "organization.created",
        entityType: "organization",
        entityId: org.id,
        metadata: { slug: org.slug, firstAdminUserId: adminUser.id },
        request,
      });
      return { organization: org, temporaryPassword: adminUser.created ? temporaryPassword : null };
    });
  } catch (error) {
    if (isUniqueViolation(error))
      throw new ValidationError("That organisation slug is already taken.", { slug: ["Already in use"] });
    throw error;
  }
}

/**
 * Choose the IntellAssist model for one hospital (platform staff only).
 * The database enforces the same rule, so a hospital administrator cannot do this.
 * Changing it does not touch any hospital data; it applies to the next AI request.
 */
export async function setOrganizationAiModel(user: AuthUser, input: unknown, request?: RequestMeta) {
  await requirePlatform(user, "platform.organization.ai_model", request);
  const data = parseInput(setOrganizationAiModelSchema, input);
  return withTenant({ userId: user.id, organizationId: null }, async (tx) => {
    const before = await tx.organization.findUnique({
      where: { id: data.organizationId },
      select: { id: true, aiModel: true },
    });
    if (!before) throw new NotFoundError("Organisation");
    if (before.aiModel === data.model) return { changed: false, model: data.model };
    await tx.organization.update({ where: { id: before.id }, data: { aiModel: data.model } });
    await tx.$executeRaw`SELECT set_config('app.org_id', ${before.id}, true)`;
    await audit(tx, {
      organizationId: before.id,
      actorUserId: user.id,
      action: "organization.ai_model_changed",
      entityType: "organization",
      entityId: before.id,
      metadata: { from: before.aiModel, to: data.model },
      request,
    });
    return { changed: true, model: data.model };
  });
}
