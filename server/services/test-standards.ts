// Electrical safety test standards (Stage 6, decision of 15 Oct 2026).
//
//   • IEC 62353 is the default; AS/NZS 3551 is supported; organisations can
//     add others. No standard is assumed to be legally correct everywhere.
//   • Which standard applies is configurable by organisation (default rule),
//     country (jurisdiction), hospital (facility) and equipment category.
//     The most specific active rule wins.
//   • A standard must be VERIFIED by an Engineering Manager (qualified staff)
//     before a plan with electrical safety items can be approved, and before
//     PM work orders can be generated against it.
//   • Each PM job, and each electrical safety result, stores the standard's
//     code and version as text, so history never changes when settings do.
import { withTenant, type Tx } from "../db/tenant";
import { audit } from "../audit/audit";
import { requireHospitalAccess, requirePermission, type AccessContext } from "../authz/access";
import { NotFoundError, ValidationError } from "../authz/errors";
import { parseInput } from "../validation";
import { standardRuleSchema, standardSchema, verifyStandardSchema } from "@/lib/validation/pm";
import { peopleNames } from "./work-order-core";

const tenant = (ctx: AccessContext) => ({ userId: ctx.user.id, organizationId: ctx.organization.id });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type ResolvedStandard = { id: string; code: string; version: string; verified: boolean; ruleId: string };

/**
 * The standard that applies to equipment of `categoryId` at `hospitalId`.
 * Specificity: hospital (4) > country (2), plus category (1). Organisation
 * default = no hospital, country or category. Returns null when nothing applies.
 */
export async function resolveStandard(
  tx: Tx,
  where: { hospitalId: string; categoryId: string },
): Promise<ResolvedStandard | null> {
  const hospital = await tx.hospital.findUnique({
    where: { id: where.hospitalId },
    select: { country: true, organization: { select: { country: true } } },
  });
  if (!hospital) return null;
  const country = hospital.country ?? hospital.organization.country ?? null;
  const rules = await tx.testStandardRule.findMany({
    where: {
      archivedAt: null,
      standard: { status: "ACTIVE" },
      AND: [
        { OR: [{ hospitalId: where.hospitalId }, { hospitalId: null }] },
        { OR: [{ categoryId: where.categoryId }, { categoryId: null }] },
        { OR: [...(country ? [{ country }] : []), { country: null }] },
      ],
    },
    select: {
      id: true,
      hospitalId: true,
      country: true,
      categoryId: true,
      standard: { select: { id: true, code: true, version: true, verifiedAt: true } },
    },
  });
  if (!rules.length) return null;
  const score = (r: (typeof rules)[number]) => (r.hospitalId ? 4 : 0) + (r.country ? 2 : 0) + (r.categoryId ? 1 : 0);
  const best = rules.sort((a, b) => score(b) - score(a))[0];
  return {
    id: best.standard.id,
    code: best.standard.code,
    version: best.standard.version,
    verified: best.standard.verifiedAt !== null,
    ruleId: best.id,
  };
}

/** True when at least one verified, active standard is in use by a rule. */
export async function hasVerifiedStandard(tx: Tx): Promise<boolean> {
  const n = await tx.testStandardRule.count({
    where: { archivedAt: null, standard: { status: "ACTIVE", verifiedAt: { not: null } } },
  });
  return n > 0;
}

// ─── Settings screens ────────────────────────────────────────────────────────

export async function listStandards(ctx: AccessContext) {
  await requirePermission(ctx, "pm.view", { entityType: "test_standard" });
  return withTenant(tenant(ctx), async (tx) => {
    const [standards, rules, hospitals, categories] = await Promise.all([
      tx.testStandard.findMany({ orderBy: [{ status: "asc" }, { code: "asc" }, { version: "asc" }] }),
      tx.testStandardRule.findMany({
        where: { archivedAt: null },
        include: {
          standard: { select: { code: true, version: true, verifiedAt: true } },
          hospital: { select: { code: true, name: true } },
          category: { select: { name: true } },
        },
        orderBy: { createdAt: "asc" },
      }),
      tx.hospital.findMany({
        where: { status: "ACTIVE" },
        select: { id: true, code: true, name: true, country: true },
      }),
      tx.equipmentCategory.findMany({
        where: { status: "ACTIVE" },
        select: { id: true, name: true },
        orderBy: { name: "asc" },
      }),
    ]);
    const names = await peopleNames(
      tx,
      standards.map((s) => s.verifiedById),
    );
    return { standards, rules, hospitals, categories, names, organizationCountry: null as string | null };
  });
}

function auditStd(tx: Tx, ctx: AccessContext, action: string, entityId: string, metadata: Record<string, unknown>) {
  return audit(tx, {
    organizationId: ctx.organization.id,
    actorUserId: ctx.user.id,
    action,
    entityType: "test_standard",
    entityId,
    metadata,
    request: ctx.request,
  });
}

export async function addStandard(ctx: AccessContext, input: unknown) {
  await requirePermission(ctx, "standards.manage", { entityType: "test_standard" });
  const data = parseInput(standardSchema, input);
  return withTenant(tenant(ctx), async (tx) => {
    const dup = await tx.testStandard.findFirst({
      where: {
        code: { equals: data.code, mode: "insensitive" },
        version: { equals: data.version, mode: "insensitive" },
      },
      select: { id: true },
    });
    if (dup) throw new ValidationError("This standard and version already exist.", { version: ["Already listed"] });
    const row = await tx.testStandard.create({
      data: { organizationId: ctx.organization.id, ...data, createdById: ctx.user.id },
      select: { id: true },
    });
    await auditStd(tx, ctx, "standard.created", row.id, { code: data.code, version: data.version });
    return row;
  });
}

/** A qualified Engineering Manager confirms the test procedure and limits for local use. */
export async function verifyStandard(ctx: AccessContext, input: unknown) {
  await requirePermission(ctx, "standards.verify", { entityType: "test_standard" });
  const data = parseInput(verifyStandardSchema, input);
  return withTenant(tenant(ctx), async (tx) => {
    const r = await tx.testStandard.updateMany({
      where: { id: data.id, status: "ACTIVE" },
      data: { verifiedById: ctx.user.id, verifiedAt: new Date(), verificationNote: data.note },
    });
    if (r.count === 0) throw new NotFoundError("Test standard");
    await auditStd(tx, ctx, "standard.verified", data.id, {});
  });
}

export async function archiveStandard(ctx: AccessContext, input: unknown) {
  await requirePermission(ctx, "standards.manage", { entityType: "test_standard" });
  const id = String((input as { id?: unknown })?.id ?? "");
  if (!UUID.test(id)) throw new NotFoundError("Test standard");
  return withTenant(tenant(ctx), async (tx) => {
    const inUse = await tx.testStandardRule.count({ where: { standardId: id, archivedAt: null } });
    if (inUse) throw new ValidationError("Remove the rules that use this standard first.");
    const r = await tx.testStandard.updateMany({ where: { id, status: "ACTIVE" }, data: { status: "ARCHIVED" } });
    if (r.count === 0) throw new NotFoundError("Test standard");
    await auditStd(tx, ctx, "standard.archived", id, {});
  });
}

export async function addStandardRule(ctx: AccessContext, input: unknown) {
  await requirePermission(ctx, "standards.manage", { entityType: "test_standard_rule" });
  const data = parseInput(standardRuleSchema, input);
  if (data.hospitalId) await requireHospitalAccess(ctx, data.hospitalId);
  // Organisation-wide rules (default, country, category) are for org-wide staff only.
  if (!data.hospitalId && !ctx.orgWide) {
    throw new ValidationError(
      "Only organisation-wide staff can set organisation or country rules. Choose your hospital.",
      {
        hospitalId: ["Choose a hospital you manage"],
      },
    );
  }
  return withTenant(tenant(ctx), async (tx) => {
    const std = await tx.testStandard.findFirst({
      where: { id: data.standardId, status: "ACTIVE" },
      select: { id: true },
    });
    if (!std) throw new ValidationError("Choose an active standard.", { standardId: ["Unknown standard"] });
    if (data.categoryId) {
      const cat = await tx.equipmentCategory.findFirst({ where: { id: data.categoryId }, select: { id: true } });
      if (!cat) throw new ValidationError("Choose a category.", { categoryId: ["Unknown category"] });
    }
    const existing = await tx.testStandardRule.findFirst({
      where: { archivedAt: null, hospitalId: data.hospitalId, country: data.country, categoryId: data.categoryId },
      select: { id: true },
    });
    let id: string;
    if (existing) {
      await tx.testStandardRule.update({ where: { id: existing.id }, data: { standardId: data.standardId } });
      id = existing.id;
    } else {
      const row = await tx.testStandardRule.create({
        data: { organizationId: ctx.organization.id, ...data, createdById: ctx.user.id },
        select: { id: true },
      });
      id = row.id;
    }
    await audit(tx, {
      organizationId: ctx.organization.id,
      actorUserId: ctx.user.id,
      action: "standard.rule_set",
      entityType: "test_standard_rule",
      entityId: id,
      metadata: { ...data },
      request: ctx.request,
    });
    return { id };
  });
}

export async function removeStandardRule(ctx: AccessContext, input: unknown) {
  await requirePermission(ctx, "standards.manage", { entityType: "test_standard_rule" });
  const id = String((input as { id?: unknown })?.id ?? "");
  if (!UUID.test(id)) throw new NotFoundError("Rule");
  return withTenant(tenant(ctx), async (tx) => {
    const rule = await tx.testStandardRule.findFirst({ where: { id, archivedAt: null }, select: { hospitalId: true } });
    if (!rule) throw new NotFoundError("Rule");
    if (rule.hospitalId) await requireHospitalAccess(ctx, rule.hospitalId);
    else if (!ctx.orgWide) throw new NotFoundError("Rule");
    await tx.testStandardRule.update({ where: { id }, data: { archivedAt: new Date() } });
    await audit(tx, {
      organizationId: ctx.organization.id,
      actorUserId: ctx.user.id,
      action: "standard.rule_removed",
      entityType: "test_standard_rule",
      entityId: id,
      request: ctx.request,
    });
  });
}
