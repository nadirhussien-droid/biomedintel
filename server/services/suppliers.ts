// Supplier and external service provider register (Stage 8).
//
// Suppliers are organisation-wide records (Row-Level Security keeps them in
// the organisation). What a supplier page shows about equipment, contracts,
// purchase requests and service jobs is limited to the user's hospitals and
// departments, like everything else.
import type { Prisma } from "../db/generated/client";
import { withTenant } from "../db/tenant";
import { audit } from "../audit/audit";
import { can, requirePermission, type AccessContext } from "../authz/access";
import { NotFoundError, ValidationError } from "../authz/errors";
import { isUniqueViolation, parseInput } from "../validation";
import { assetScopeWhere } from "./assets";
import { workOrderScopeWhere } from "./work-orders";
import { supplierSchema } from "@/lib/validation/inventory";

const tenant = (ctx: AccessContext) => ({ userId: ctx.user.id, organizationId: ctx.organization.id });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function listSuppliers(ctx: AccessContext, raw: { q?: string; archived?: string } = {}) {
  await requirePermission(ctx, "supplier.view", { entityType: "supplier" });
  const q = (raw.q ?? "").trim().slice(0, 80);
  const archived = raw.archived === "1";
  return withTenant(tenant(ctx), async (tx) => {
    const where: Prisma.SupplierWhereInput = {
      status: archived ? "ARCHIVED" : "ACTIVE",
      ...(q
        ? {
            OR: [
              { name: { contains: q, mode: "insensitive" } },
              { contactName: { contains: q, mode: "insensitive" } },
              { serviceCategories: { has: q } },
            ],
          }
        : {}),
    };
    const rows = await tx.supplier.findMany({
      where,
      orderBy: { name: "asc" },
      take: 200,
      select: {
        id: true,
        name: true,
        kinds: true,
        contactName: true,
        email: true,
        phone: true,
        serviceCategories: true,
        status: true,
        manufacturers: { select: { manufacturer: { select: { name: true } } } },
      },
    });
    const today = new Date();
    const contracts = await tx.warranty.groupBy({
      by: ["supplierId"],
      where: {
        supplierId: { in: rows.map((r) => r.id) },
        kind: "SERVICE_CONTRACT",
        archivedAt: null,
        endsOn: { gte: today },
        asset: assetScopeWhere(ctx),
      },
      _count: { _all: true },
    });
    return {
      q,
      archived,
      suppliers: rows.map((r) => ({
        ...r,
        manufacturers: r.manufacturers.map((m) => m.manufacturer.name),
        activeContracts: contracts.find((c) => c.supplierId === r.id)?._count._all ?? 0,
      })),
    };
  });
}

/** Choices for supplier pickers (active suppliers only). */
export async function supplierOptions(ctx: AccessContext) {
  if (!can(ctx, "supplier.view") && !can(ctx, "warranty.manage") && !can(ctx, "purchase.request")) return [];
  return withTenant(tenant(ctx), (tx) =>
    tx.supplier.findMany({ where: { status: "ACTIVE" }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
  );
}

/** Manufacturers in the catalogue, for the supplier form. */
export async function manufacturerOptions(ctx: AccessContext) {
  await requirePermission(ctx, "supplier.manage", { entityType: "supplier" });
  return withTenant(tenant(ctx), (tx) =>
    tx.manufacturer.findMany({
      where: { status: "ACTIVE" },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
  );
}

export async function getSupplier(ctx: AccessContext, id: string) {
  await requirePermission(ctx, "supplier.view", { entityType: "supplier" });
  if (!UUID.test(id)) throw new NotFoundError("Supplier");
  return withTenant(tenant(ctx), async (tx) => {
    const supplier = await tx.supplier.findUnique({
      where: { id },
      include: { manufacturers: { select: { manufacturerId: true, manufacturer: { select: { name: true } } } } },
    });
    if (!supplier) throw new NotFoundError("Supplier");
    const [warranties, services, parts, purchases, assets] = await Promise.all([
      tx.warranty.findMany({
        where: { supplierId: id, archivedAt: null, asset: assetScopeWhere(ctx) },
        orderBy: { endsOn: "asc" },
        take: 200,
        select: {
          id: true,
          kind: true,
          reference: true,
          startsOn: true,
          endsOn: true,
          responseTargetHours: true,
          asset: { select: { id: true, assetTag: true, name: true } },
        },
      }),
      tx.externalService.findMany({
        where: { supplierId: id, workOrder: workOrderScopeWhere(ctx) },
        orderBy: { requestedOn: "desc" },
        take: 100,
        select: {
          id: true,
          status: true,
          requestedOn: true,
          expectedBy: true,
          completedOn: true,
          supplierReference: true,
          workOrder: { select: { id: true, number: true } },
          asset: { select: { id: true, assetTag: true } },
        },
      }),
      tx.partSupplier.findMany({
        where: { supplierId: id },
        select: {
          supplierPartNumber: true,
          part: { select: { id: true, partNumber: true, name: true, status: true } },
        },
        take: 200,
      }),
      can(ctx, "purchase.view")
        ? tx.purchaseRequest.findMany({
            where: { supplierId: id, hospitalId: { in: ctx.hospitals.map((h) => h.id) } },
            orderBy: { createdAt: "desc" },
            take: 50,
            select: { id: true, number: true, status: true, createdAt: true },
          })
        : Promise.resolve([]),
      tx.asset.count({ where: { AND: [{ supplierId: id }, assetScopeWhere(ctx)] } }),
    ]);
    return { supplier, warranties, services, parts, purchases, assetCount: assets };
  });
}

export async function saveSupplier(ctx: AccessContext, input: unknown) {
  await requirePermission(ctx, "supplier.manage", { entityType: "supplier" });
  const data = parseInput(supplierSchema, input);
  try {
    return await withTenant(tenant(ctx), async (tx) => {
      const manufacturers = await tx.manufacturer.findMany({
        where: { id: { in: data.manufacturerIds } },
        select: { id: true },
      });
      if (manufacturers.length !== new Set(data.manufacturerIds).size) {
        throw new ValidationError("Choose manufacturers from the catalogue.", {
          manufacturerIds: ["Unknown manufacturer"],
        });
      }
      const fields = {
        name: data.name,
        kinds: [...new Set(data.kinds)],
        contactName: data.contactName,
        email: data.email,
        phone: data.phone,
        address: data.address,
        serviceCategories: [...new Set(data.serviceCategories)],
        notes: data.notes,
        updatedById: ctx.user.id,
      };
      let id = data.id;
      if (id) {
        const existing = await tx.supplier.findUnique({ where: { id }, select: { status: true } });
        if (!existing) throw new NotFoundError("Supplier");
        if (existing.status === "ARCHIVED") throw new ValidationError("Restore this supplier before editing it.");
        await tx.supplier.update({ where: { id }, data: fields });
        await tx.supplierManufacturer.deleteMany({ where: { supplierId: id } });
      } else {
        id = (
          await tx.supplier.create({
            data: { ...fields, organizationId: ctx.organization.id, createdById: ctx.user.id },
            select: { id: true },
          })
        ).id;
      }
      if (manufacturers.length) {
        await tx.supplierManufacturer.createMany({
          data: manufacturers.map((m) => ({
            organizationId: ctx.organization.id,
            supplierId: id!,
            manufacturerId: m.id,
          })),
        });
      }
      await audit(tx, {
        organizationId: ctx.organization.id,
        actorUserId: ctx.user.id,
        action: data.id ? "supplier.updated" : "supplier.created",
        entityType: "supplier",
        entityId: id,
        metadata: { name: data.name, kinds: data.kinds, manufacturers: manufacturers.length },
        request: ctx.request,
      });
      return { id: id! };
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new ValidationError("A supplier with this name already exists.", { name: ["Already in the register"] });
    }
    throw error;
  }
}

export async function setSupplierArchived(ctx: AccessContext, input: { id?: unknown; archived?: unknown }) {
  await requirePermission(ctx, "supplier.manage", { entityType: "supplier" });
  const id = String(input?.id ?? "");
  const archived = input?.archived === true;
  if (!UUID.test(id)) throw new NotFoundError("Supplier");
  return withTenant(tenant(ctx), async (tx) => {
    const s = await tx.supplier.findUnique({ where: { id }, select: { id: true } });
    if (!s) throw new NotFoundError("Supplier");
    await tx.supplier.update({
      where: { id },
      data: {
        status: archived ? "ARCHIVED" : "ACTIVE",
        archivedAt: archived ? new Date() : null,
        updatedById: ctx.user.id,
      },
    });
    await audit(tx, {
      organizationId: ctx.organization.id,
      actorUserId: ctx.user.id,
      action: archived ? "supplier.archived" : "supplier.restored",
      entityType: "supplier",
      entityId: id,
      request: ctx.request,
    });
  });
}
