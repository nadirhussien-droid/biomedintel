// External service (Stage 8): work sent to an outside supplier, always as part
// of an EXISTING work order — not a second repair system. The work order keeps
// its own status and sign-off; a supplier finishing its part never completes
// the job, and never returns the device to service.
//
// Supplier performance is shown only where the needed dates are recorded:
// "completed by the expected date" needs both an expected date and a
// completion date. A closed work order is not evidence that a service-level
// agreement was met.
import { withTenant, type Tx } from "../db/tenant";
import { audit } from "../audit/audit";
import { can, requirePermission, type AccessContext } from "../authz/access";
import { AuthorizationError, NotFoundError, ValidationError } from "../authz/errors";
import { parseInput } from "../validation";
import { addEvent, OPEN, peopleNames } from "./work-order-core";
import { workOrderScopeWhere } from "./work-orders";
import { tenant } from "./inventory";
import { localToday, toDbDate } from "@/lib/pm/dates";
import { SERVICE_STATUS_LABELS, serviceCreateSchema, serviceUpdateSchema } from "@/lib/validation/inventory";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const d = (v: string | null) => (v ? toDbDate(v) : null);
const iso = (v: Date | null) => (v ? v.toISOString().slice(0, 10) : null);

async function loadJob(ctx: AccessContext, tx: Tx, id: string) {
  if (!UUID.test(id)) throw new NotFoundError("Work order");
  const wo = await tx.workOrder.findFirst({
    where: { AND: [{ id }, workOrderScopeWhere(ctx)] },
    select: { id: true, number: true, status: true, assetId: true, assignedToId: true },
  });
  if (!wo) throw new NotFoundError("Work order");
  return wo;
}

/** Managers on any job in scope; a technician only on a job assigned to them. */
function mayManage(ctx: AccessContext, wo: { assignedToId: string | null }) {
  return can(ctx, "service.manage") && (ctx.role !== "TECHNICIAN" || wo.assignedToId === ctx.user.id);
}

export async function listServicesForWorkOrder(ctx: AccessContext, workOrderId: string) {
  if (!can(ctx, "supplier.view") && !can(ctx, "service.manage")) return null;
  return withTenant(tenant(ctx), async (tx) => {
    const wo = await loadJob(ctx, tx, workOrderId);
    const rows = await tx.externalService.findMany({
      where: { workOrderId: wo.id },
      orderBy: { createdAt: "asc" },
      include: {
        supplier: { select: { id: true, name: true } },
        warrantyClaim: { select: { id: true, status: true, claimReference: true } },
      },
    });
    const showCost = can(ctx, "inventory.viewCost");
    return {
      canManage: mayManage(ctx, wo),
      rows: rows.map((r) => ({
        ...r,
        cost: showCost ? r.cost : null,
        currency: showCost ? r.currency : null,
        onTime: r.expectedBy && r.completedOn ? r.completedOn <= r.expectedBy : null,
      })),
    };
  });
}

export async function createExternalService(ctx: AccessContext, input: unknown) {
  await requirePermission(ctx, "service.manage", { entityType: "external_service" });
  const data = parseInput(serviceCreateSchema, input);
  return withTenant(tenant(ctx), async (tx) => {
    const wo = await loadJob(ctx, tx, data.workOrderId);
    if (!mayManage(ctx, wo))
      throw new AuthorizationError("service.manage", "Only the assigned technician or a manager can do this.");
    if (!OPEN.includes(wo.status)) throw new ValidationError("External service can only be requested on an open job.");
    const supplier = await tx.supplier.findFirst({
      where: { id: data.supplierId, status: "ACTIVE" },
      select: { id: true, name: true },
    });
    if (!supplier)
      throw new ValidationError("Choose a supplier from the register.", { supplierId: ["Unknown supplier"] });
    if (data.warrantyClaimId) {
      const claim = await tx.warrantyClaim.findFirst({
        where: { id: data.warrantyClaimId, assetId: wo.assetId },
        select: { id: true },
      });
      if (!claim) throw new ValidationError("Choose a claim for this device.", { warrantyClaimId: ["Unknown claim"] });
    }
    const row = await tx.externalService.create({
      data: {
        organizationId: ctx.organization.id,
        workOrderId: wo.id,
        assetId: wo.assetId,
        supplierId: supplier.id,
        warrantyClaimId: data.warrantyClaimId,
        description: data.description,
        supplierReference: data.supplierReference,
        requestedOn: toDbDate(data.requestedOn),
        expectedBy: d(data.expectedBy),
        createdById: ctx.user.id,
        updatedById: ctx.user.id,
      },
      select: { id: true },
    });
    await addEvent(tx, ctx, wo.id, "EXTERNAL_SERVICE", { note: `External service requested from ${supplier.name}` });
    await audit(tx, {
      organizationId: ctx.organization.id,
      actorUserId: ctx.user.id,
      action: "service.requested",
      entityType: "external_service",
      entityId: row.id,
      metadata: { workOrderId: wo.id, number: wo.number, supplierId: supplier.id },
      request: ctx.request,
    });
    return row;
  });
}

const FINAL = ["COMPLETED", "CANCELLED"];

export async function updateExternalService(ctx: AccessContext, input: unknown) {
  await requirePermission(ctx, "service.manage", { entityType: "external_service" });
  const data = parseInput(serviceUpdateSchema, input);
  return withTenant(tenant(ctx), async (tx) => {
    const svc = await tx.externalService.findUnique({
      where: { id: data.id },
      select: {
        id: true,
        status: true,
        workOrderId: true,
        requestedOn: true,
        cost: true,
        supplier: { select: { name: true } },
      },
    });
    if (!svc) throw new NotFoundError("External service");
    const wo = await loadJob(ctx, tx, svc.workOrderId);
    if (!mayManage(ctx, wo))
      throw new AuthorizationError("service.manage", "Only the assigned technician or a manager can do this.");
    if (FINAL.includes(svc.status) && data.status !== svc.status) {
      throw new ValidationError(
        `This record is ${SERVICE_STATUS_LABELS[svc.status as keyof typeof SERVICE_STATUS_LABELS].toLowerCase()} and its status can no longer change.`,
      );
    }
    const requested = iso(svc.requestedOn)!;
    for (const [field, value] of [
      ["dispatchedOn", data.dispatchedOn],
      ["expectedBy", data.expectedBy],
      ["completedOn", data.completedOn],
    ] as const) {
      if (value && value < requested)
        throw new ValidationError("Dates cannot be before the request date.", { [field]: [`Before ${requested}`] });
    }
    // Things that already happened cannot be dated in the future (latest "today" anywhere on Earth).
    const latestToday = localToday("Pacific/Kiritimati");
    for (const [field, value] of [
      ["dispatchedOn", data.dispatchedOn],
      ["completedOn", data.completedOn],
    ] as const) {
      if (value && value > latestToday)
        throw new ValidationError("This date is in the future.", { [field]: ["In the future"] });
    }
    // Costs are financial: only roles that may see them can change them.
    const showCost = can(ctx, "inventory.viewCost");
    await tx.externalService.update({
      where: { id: svc.id },
      data: {
        status: data.status,
        supplierReference: data.supplierReference,
        dispatchedOn: d(data.dispatchedOn),
        expectedBy: d(data.expectedBy),
        completedOn: d(data.completedOn),
        serviceReportRef: data.serviceReportRef,
        partsSupplied: data.partsSupplied,
        ...(showCost ? { cost: data.cost, currency: data.currency } : {}),
        notes: data.notes,
        updatedById: ctx.user.id,
      },
    });
    if (data.status !== svc.status) {
      await addEvent(tx, ctx, wo.id, "EXTERNAL_SERVICE", {
        note: `${svc.supplier.name}: ${SERVICE_STATUS_LABELS[data.status]}${data.serviceReportRef ? ` (report ${data.serviceReportRef})` : ""}`,
      });
    }
    await audit(tx, {
      organizationId: ctx.organization.id,
      actorUserId: ctx.user.id,
      action: data.status !== svc.status ? "service.status_changed" : "service.updated",
      entityType: "external_service",
      entityId: svc.id,
      metadata: {
        from: svc.status,
        to: data.status,
        costChanged: showCost && String(svc.cost ?? "") !== String(data.cost ?? ""),
      },
      request: ctx.request,
    });
  });
}

/** Outstanding supplier work in the user's scope (for the supplier pages and reminders). */
export async function outstandingServices(ctx: AccessContext) {
  await requirePermission(ctx, "supplier.view", { entityType: "external_service" });
  return withTenant(tenant(ctx), async (tx) => {
    const rows = await tx.externalService.findMany({
      where: { status: { in: ["REQUESTED", "IN_PROGRESS"] }, workOrder: workOrderScopeWhere(ctx) },
      orderBy: [{ expectedBy: { sort: "asc", nulls: "last" } }, { requestedOn: "asc" }],
      take: 200,
      select: {
        id: true,
        status: true,
        requestedOn: true,
        expectedBy: true,
        supplierReference: true,
        createdById: true,
        supplier: { select: { id: true, name: true } },
        workOrder: { select: { id: true, number: true } },
        asset: { select: { id: true, assetTag: true } },
      },
    });
    const names = await peopleNames(
      tx,
      rows.map((r) => r.createdById),
    );
    return { rows, names };
  });
}
