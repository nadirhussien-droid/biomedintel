// Equipment catalog: manufacturers, categories, models and locations.
// One list per organisation (RLS); locations also respect hospital/department scope.
import { withTenant, type Tx } from "../db/tenant";
import { audit } from "../audit/audit";
import { requireHospitalAccess, requirePermission, type AccessContext } from "../authz/access";
import { ValidationError } from "../authz/errors";
import { isUniqueViolation, parseInput } from "../validation";
import { categorySchema, locationSchema, manufacturerSchema, modelSchema } from "@/lib/validation/assets";

const tenant = (ctx: AccessContext) => ({ userId: ctx.user.id, organizationId: ctx.organization.id });

export async function getCatalog(ctx: AccessContext) {
  await requirePermission(ctx, "asset.view", { entityType: "catalog" });
  return withTenant(tenant(ctx), async (tx) => {
    const [manufacturers, categories, models] = await Promise.all([
      tx.manufacturer.findMany({
        where: { status: "ACTIVE" },
        orderBy: { name: "asc" },
        select: { id: true, name: true, country: true, supportContact: true, _count: { select: { models: true } } },
      }),
      tx.equipmentCategory.findMany({
        where: { status: "ACTIVE" },
        orderBy: { name: "asc" },
        select: { id: true, name: true, defaultRiskClass: true, defaultPmIntervalMonths: true },
      }),
      tx.equipmentModel.findMany({
        where: { status: "ACTIVE" },
        orderBy: [{ manufacturer: { name: "asc" } }, { modelName: "asc" }],
        select: {
          id: true,
          modelName: true,
          expectedLifeYears: true,
          manufacturer: { select: { name: true } },
          category: { select: { name: true } },
          _count: { select: { assets: true } },
        },
      }),
    ]);
    const departmentScope = ctx.hospitals.map((h) =>
      h.departments === "ALL" ? { hospitalId: h.id } : { hospitalId: h.id, departmentId: { in: h.departments } },
    );
    const locations = ctx.hospitals.length
      ? await tx.location.findMany({
          where: { status: "ACTIVE", OR: departmentScope },
          orderBy: [{ hospital: { name: "asc" } }, { department: { name: "asc" } }, { name: "asc" }],
          select: {
            id: true,
            name: true,
            building: true,
            floor: true,
            hospital: { select: { name: true } },
            department: { select: { name: true } },
          },
        })
      : [];
    return { manufacturers, categories, models, locations };
  });
}

function duplicate(what: string, field: string) {
  return new ValidationError(`${what} already exists in your organisation.`, { [field]: ["Already exists"] });
}

async function record(
  ctx: AccessContext,
  tx: Tx,
  action: string,
  entityType: string,
  entityId: string,
  metadata: Record<string, unknown>,
) {
  await audit(tx, {
    organizationId: ctx.organization.id,
    actorUserId: ctx.user.id,
    action,
    entityType,
    entityId,
    metadata,
    request: ctx.request,
  });
}

export async function createManufacturer(ctx: AccessContext, input: unknown) {
  await requirePermission(ctx, "catalog.create", { entityType: "manufacturer" });
  const data = parseInput(manufacturerSchema, input);
  try {
    return await withTenant(tenant(ctx), async (tx) => {
      const m = await tx.manufacturer.create({
        data: { organizationId: ctx.organization.id, ...data, createdById: ctx.user.id },
        select: { id: true, name: true },
      });
      await record(ctx, tx, "manufacturer.created", "manufacturer", m.id, { name: m.name });
      return m;
    });
  } catch (error) {
    if (isUniqueViolation(error)) throw duplicate("A manufacturer with this name", "name");
    throw error;
  }
}

export async function createCategory(ctx: AccessContext, input: unknown) {
  await requirePermission(ctx, "catalog.create", { entityType: "equipment_category" });
  const data = parseInput(categorySchema, input);
  try {
    return await withTenant(tenant(ctx), async (tx) => {
      const c = await tx.equipmentCategory.create({
        data: { organizationId: ctx.organization.id, ...data, createdById: ctx.user.id },
        select: { id: true, name: true },
      });
      await record(ctx, tx, "equipment_category.created", "equipment_category", c.id, { name: c.name });
      return c;
    });
  } catch (error) {
    if (isUniqueViolation(error)) throw duplicate("A category with this name", "name");
    throw error;
  }
}

export async function createModel(ctx: AccessContext, input: unknown) {
  await requirePermission(ctx, "catalog.create", { entityType: "equipment_model" });
  const data = parseInput(modelSchema, input);
  try {
    return await withTenant(tenant(ctx), async (tx) => {
      // Both must exist in THIS organisation (RLS hides others; composite FKs enforce it too).
      const [m, c] = await Promise.all([
        tx.manufacturer.findFirst({ where: { id: data.manufacturerId, status: "ACTIVE" }, select: { id: true } }),
        tx.equipmentCategory.findFirst({ where: { id: data.categoryId, status: "ACTIVE" }, select: { id: true } }),
      ]);
      if (!m) throw new ValidationError("Choose a manufacturer from the list.", { manufacturerId: ["Unknown"] });
      if (!c) throw new ValidationError("Choose a category from the list.", { categoryId: ["Unknown"] });
      const model = await tx.equipmentModel.create({
        data: { organizationId: ctx.organization.id, ...data, createdById: ctx.user.id },
        select: { id: true, modelName: true },
      });
      await record(ctx, tx, "equipment_model.created", "equipment_model", model.id, { modelName: model.modelName });
      return model;
    });
  } catch (error) {
    if (isUniqueViolation(error)) throw duplicate("This model for this manufacturer", "modelName");
    throw error;
  }
}

export async function createLocation(ctx: AccessContext, input: unknown) {
  await requirePermission(ctx, "catalog.create", { entityType: "location" });
  const data = parseInput(locationSchema, input);
  await requireHospitalAccess(ctx, data.hospitalId, data.departmentId);
  try {
    return await withTenant(tenant(ctx), async (tx) => {
      const dept = await tx.department.findFirst({
        where: { id: data.departmentId, hospitalId: data.hospitalId, status: "ACTIVE" },
        select: { id: true },
      });
      if (!dept) throw new ValidationError("Choose a department of this hospital.", { departmentId: ["Unknown"] });
      const loc = await tx.location.create({
        data: { organizationId: ctx.organization.id, ...data, createdById: ctx.user.id },
        select: { id: true, name: true },
      });
      await record(ctx, tx, "location.created", "location", loc.id, {
        name: loc.name,
        departmentId: data.departmentId,
      });
      return loc;
    });
  } catch (error) {
    if (isUniqueViolation(error)) throw duplicate("A location with this name in this department", "name");
    throw error;
  }
}
