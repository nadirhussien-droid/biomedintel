// Checklist templates (27 Oct 2026): the built-in starters plus the organisation's own saved
// templates. Reading needs pm.view; creating, editing and archiving needs pm.manage (Engineering
// Managers and Organization Administrators). Templates are starting points: copying one into a plan
// does not approve anything, the plan still needs an Engineering Manager's approval.
import { withTenant } from "../db/tenant";
import { audit } from "../audit/audit";
import { requirePermission, type AccessContext } from "../authz/access";
import { NotFoundError, ValidationError } from "../authz/errors";
import { isUniqueViolation, parseInput } from "../validation";
import { TEST_TEMPLATES } from "@/lib/pm/test-templates";
import { checklistTemplateSchema } from "@/lib/validation/checklist-templates";
import type { ChecklistItem } from "@/lib/validation/pm";

const tenant = (ctx: AccessContext) => ({ userId: ctx.user.id, organizationId: ctx.organization.id });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type TemplateOption = {
  id: string;
  name: string;
  description: string;
  deviceType: string | null;
  items: ChecklistItem[];
  builtIn: boolean;
};

const builtIns = (): TemplateOption[] =>
  TEST_TEMPLATES.map((t) => ({
    id: t.id,
    name: t.name,
    description: t.description,
    deviceType: null,
    items: t.items,
    builtIn: true,
  }));

/** The organisation's saved templates (active first, then archived). */
export async function listOwnTemplates(ctx: AccessContext) {
  await requirePermission(ctx, "pm.view");
  return withTenant(tenant(ctx), (tx) =>
    tx.checklistTemplate.findMany({
      orderBy: [{ status: "asc" }, { name: "asc" }],
      select: {
        id: true,
        name: true,
        deviceType: true,
        description: true,
        checklist: true,
        status: true,
        updatedAt: true,
      },
    }),
  );
}

/** Built-in starters and the organisation's active templates, for the plan form picker. */
export async function templateOptions(
  ctx: AccessContext,
): Promise<{ builtIn: TemplateOption[]; own: TemplateOption[] }> {
  const rows = (await listOwnTemplates(ctx)).filter((r) => r.status === "ACTIVE");
  return {
    builtIn: builtIns(),
    own: rows.map((r) => ({
      id: r.id,
      name: r.name,
      description: r.description ?? (r.deviceType ? `Saved template for ${r.deviceType}.` : "Saved template."),
      deviceType: r.deviceType,
      items: r.checklist as unknown as ChecklistItem[],
      builtIn: false,
    })),
  };
}

export async function getOwnTemplate(ctx: AccessContext, id: string) {
  await requirePermission(ctx, "pm.view");
  if (!UUID.test(id)) throw new NotFoundError("Template");
  const row = await withTenant(tenant(ctx), (tx) => tx.checklistTemplate.findUnique({ where: { id } }));
  if (!row) throw new NotFoundError("Template");
  return { ...row, items: row.checklist as unknown as ChecklistItem[] };
}

const NAME_TAKEN = "You already have a template with this name. Choose a different name.";

export async function createTemplate(ctx: AccessContext, input: unknown) {
  await requirePermission(ctx, "pm.manage", { entityType: "checklist_template" });
  const d = parseInput(checklistTemplateSchema, input);
  try {
    return await withTenant(tenant(ctx), async (tx) => {
      const row = await tx.checklistTemplate.create({
        data: {
          organizationId: ctx.organization.id,
          name: d.name,
          deviceType: d.deviceType,
          description: d.description,
          checklist: d.checklist as never,
          createdById: ctx.user.id,
          updatedById: ctx.user.id,
        },
        select: { id: true },
      });
      await audit(tx, {
        organizationId: ctx.organization.id,
        actorUserId: ctx.user.id,
        action: "pm.template_created",
        entityType: "checklist_template",
        entityId: row.id,
        metadata: { name: d.name, deviceType: d.deviceType, items: d.checklist.length },
        request: ctx.request,
      });
      return row;
    });
  } catch (error) {
    if (isUniqueViolation(error)) throw new ValidationError(NAME_TAKEN, { name: ["Already in use"] });
    throw error;
  }
}

export async function updateTemplate(ctx: AccessContext, id: string, input: unknown) {
  await requirePermission(ctx, "pm.manage", { entityType: "checklist_template" });
  if (!UUID.test(id)) throw new NotFoundError("Template");
  const d = parseInput(checklistTemplateSchema, input);
  try {
    return await withTenant(tenant(ctx), async (tx) => {
      const before = await tx.checklistTemplate.findUnique({ where: { id }, select: { status: true, name: true } });
      if (!before) throw new NotFoundError("Template");
      if (before.status !== "ACTIVE")
        throw new ValidationError("This template is archived. Restore it before editing.");
      await tx.checklistTemplate.update({
        where: { id },
        data: {
          name: d.name,
          deviceType: d.deviceType,
          description: d.description,
          checklist: d.checklist as never,
          updatedById: ctx.user.id,
        },
      });
      await audit(tx, {
        organizationId: ctx.organization.id,
        actorUserId: ctx.user.id,
        action: "pm.template_updated",
        entityType: "checklist_template",
        entityId: id,
        metadata: { name: d.name, previousName: before.name, items: d.checklist.length },
        request: ctx.request,
      });
      return { id };
    });
  } catch (error) {
    if (isUniqueViolation(error)) throw new ValidationError(NAME_TAKEN, { name: ["Already in use"] });
    throw error;
  }
}

/** Archive or restore a saved template. Plans already made from it are not affected. */
export async function setTemplateArchived(ctx: AccessContext, id: string, archived: boolean) {
  await requirePermission(ctx, "pm.manage", { entityType: "checklist_template" });
  if (!UUID.test(id)) throw new NotFoundError("Template");
  return withTenant(tenant(ctx), async (tx) => {
    const row = await tx.checklistTemplate.findUnique({ where: { id }, select: { status: true } });
    if (!row) throw new NotFoundError("Template");
    const to = archived ? "ARCHIVED" : "ACTIVE";
    if (row.status === to) return { id };
    await tx.checklistTemplate.update({ where: { id }, data: { status: to, updatedById: ctx.user.id } });
    await audit(tx, {
      organizationId: ctx.organization.id,
      actorUserId: ctx.user.id,
      action: archived ? "pm.template_archived" : "pm.template_restored",
      entityType: "checklist_template",
      entityId: id,
      request: ctx.request,
    });
    return { id };
  });
}
