// Spare parts on work orders (Stage 8 + Stage 5 workflow D).
//
// Rules:
//   • Who: Engineering Managers and Inventory Managers on any job in their
//     scope; Technicians only on jobs assigned to them (Stage 2: "only the
//     assignee or a manager edits an in-progress job").
//   • Parts come from stores of the job's own hospital.
//   • Reserve and issue only while the job is open. Returns are allowed
//     whatever the job's status, because a cancelled job's parts come back
//     only when someone records the actual return.
//   • Cancelling or completing a job releases its RESERVATIONS (nothing was
//     taken from the shelf). Parts already ISSUED stay issued.
//   • Issuing parts never changes the job or the device status: a device is
//     only declared repaired by the sign-off, and returns to service only
//     through the existing safety rules.
import type { Prisma } from "../db/generated/client";
import { withTenant, type Tx } from "../db/tenant";
import { audit } from "../audit/audit";
import { can, requirePermission, type AccessContext } from "../authz/access";
import { AuthorizationError, NotFoundError, ValidationError } from "../authz/errors";
import { parseInput } from "../validation";
import { addEvent, OPEN, peopleNames } from "./work-order-core";
import { workOrderScopeWhere } from "./work-orders";
import {
  alreadyRecorded,
  keyed,
  loadStore,
  lockPart,
  recordMovement,
  stockAt,
  storeScopeWhere,
  tenant,
  type StockResult,
} from "./inventory";
import {
  issueSchema,
  reservationIdSchema,
  reserveSchema,
  returnSchema,
  unavailableSchema,
} from "@/lib/validation/inventory";
import { localToday } from "@/lib/pm/dates";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function loadJob(
  ctx: AccessContext,
  tx: Tx,
  id: string,
  action: string,
  opts: { open?: boolean; act?: boolean } = {},
) {
  if (!UUID.test(id)) throw new NotFoundError("Work order");
  const wo = await tx.workOrder.findFirst({
    where: { AND: [{ id }, workOrderScopeWhere(ctx)] },
    select: {
      id: true,
      number: true,
      status: true,
      hospitalId: true,
      assignedToId: true,
      asset: {
        select: {
          id: true,
          assetTag: true,
          modelId: true,
          model: { select: { categoryId: true, manufacturerId: true } },
        },
      },
      hospital: { select: { timezone: true } },
    },
  });
  if (!wo) throw new NotFoundError("Work order");
  if (opts.act && ctx.role === "TECHNICIAN" && wo.assignedToId !== ctx.user.id) {
    const { auditStandalone } = await import("../audit/audit");
    await auditStandalone({
      organizationId: ctx.organization.id,
      actorUserId: ctx.user.id,
      action: "workorder.access_denied",
      outcome: "DENIED",
      entityType: "work_order",
      entityId: wo.id,
      metadata: { attemptedAction: action, reason: "not_the_assigned_technician", role: ctx.role },
      request: ctx.request,
    });
    throw new AuthorizationError(action, "Only the assigned technician or a manager can handle parts on this job.");
  }
  if (opts.open && !OPEN.includes(wo.status)) {
    throw new ValidationError("Parts can only be reserved or issued while the job is open.");
  }
  return wo;
}

type Job = Awaited<ReturnType<typeof loadJob>>;

async function jobStore(ctx: AccessContext, tx: Tx, wo: Job, locationId: string | null | undefined, action: string) {
  const store = await loadStore(ctx, tx, locationId, action);
  if (store.hospitalId !== wo.hospitalId) {
    throw new ValidationError("Use a store in the job's hospital.", { locationId: ["Different hospital"] });
  }
  return store;
}

const woAudit = (
  tx: Tx,
  ctx: AccessContext,
  action: string,
  wo: { id: string; number: string },
  metadata: Record<string, unknown>,
) =>
  audit(tx, {
    organizationId: ctx.organization.id,
    actorUserId: ctx.user.id,
    action,
    entityType: "work_order",
    entityId: wo.id,
    metadata: { number: wo.number, ...metadata },
    request: ctx.request,
  });

// ─── Read ────────────────────────────────────────────────────────────────────

export async function getWorkOrderParts(ctx: AccessContext, workOrderId: string) {
  if (!can(ctx, "inventory.view")) return null;
  return withTenant(tenant(ctx), async (tx) => {
    const wo = await loadJob(ctx, tx, workOrderId, "workorder.parts_view");
    const today = localToday(wo.hospital.timezone);
    const stores = await tx.stockLocation.findMany({
      where: { AND: [storeScopeWhere(ctx), { hospitalId: wo.hospitalId, status: "ACTIVE" }] },
      select: { id: true, code: true, name: true },
      orderBy: { code: "asc" },
    });
    const [reservations, movements, unavailable] = await Promise.all([
      tx.partReservation.findMany({
        where: { workOrderId: wo.id },
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          quantity: true,
          status: true,
          createdAt: true,
          closedAt: true,
          createdById: true,
          part: { select: { id: true, partNumber: true, name: true, unit: true } },
          location: { select: { id: true, code: true } },
        },
      }),
      tx.stockMovement.findMany({
        where: { workOrderId: wo.id },
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          type: true,
          quantity: true,
          lotNumber: true,
          unitCost: true,
          currency: true,
          createdAt: true,
          performedById: true,
          reason: true,
          part: { select: { id: true, partNumber: true, name: true, unit: true } },
          location: { select: { id: true, code: true } },
        },
      }),
      tx.workOrderEvent.findMany({
        where: { workOrderId: wo.id, kind: "PARTS_UNAVAILABLE" },
        orderBy: { createdAt: "asc" },
        select: { id: true, note: true, actorId: true, createdAt: true },
      }),
    ]);
    // Net issued per part, store and lot (issued − returned) = quantity used on this job.
    const netMap = new Map<
      string,
      {
        part: (typeof movements)[number]["part"];
        location: { id: string; code: string };
        lotNumber: string;
        net: number;
      }
    >();
    for (const m of movements) {
      const k = `${m.part.id}|${m.location.id}|${m.lotNumber}`;
      const e = netMap.get(k) ?? { part: m.part, location: m.location, lotNumber: m.lotNumber, net: 0 };
      e.net += -m.quantity;
      netMap.set(k, e);
    }
    // Suggested parts: those recorded as fitting this asset's model, category or manufacturer.
    const a = wo.asset;
    const compat = await tx.part.findMany({
      where: {
        status: "ACTIVE",
        compatibility: {
          some: {
            OR: [
              { modelId: a.modelId },
              { categoryId: a.model.categoryId },
              { manufacturerId: a.model.manufacturerId },
            ],
          },
        },
      },
      select: { id: true, partNumber: true, name: true, unit: true },
      orderBy: { partNumber: "asc" },
      take: 50,
    });
    const suggested = await Promise.all(
      compat.map(async (p) => ({
        ...p,
        stores: await Promise.all(stores.map(async (s) => ({ store: s, ...(await stockAt(tx, p.id, s.id, today)) }))),
      })),
    );
    const names = await peopleNames(tx, [
      ...reservations.map((r) => r.createdById),
      ...movements.map((m) => m.performedById),
      ...unavailable.map((u) => u.actorId),
    ]);
    const showCost = can(ctx, "inventory.viewCost");
    const costs = new Map<string, number>();
    if (showCost) {
      for (const m of movements) {
        if (m.unitCost && m.currency)
          costs.set(m.currency, (costs.get(m.currency) ?? 0) + -m.quantity * Number(m.unitCost));
      }
    }
    const canAct = can(ctx, "stock.issue") && (ctx.role !== "TECHNICIAN" || wo.assignedToId === ctx.user.id);
    return {
      workOrder: { id: wo.id, number: wo.number, status: wo.status, open: OPEN.includes(wo.status) },
      stores,
      reservations,
      movements: movements.map((m) => (showCost ? m : { ...m, unitCost: null, currency: null })),
      used: [...netMap.values()].filter((u) => u.net !== 0),
      unavailable,
      suggested,
      names,
      partsCost: showCost
        ? [...costs.entries()].map(([currency, total]) => ({ currency, total: Math.round(total * 100) / 100 }))
        : null,
      canAct,
    };
  });
}

// ─── Reserve and release ─────────────────────────────────────────────────────

export async function reserveParts(ctx: AccessContext, input: unknown): Promise<StockResult> {
  await requirePermission(ctx, "stock.issue", { entityType: "part_reservation" });
  const data = parseInput(reserveSchema, input);
  const r = await keyed(() =>
    withTenant(tenant(ctx), async (tx) => {
      if (await alreadyRecorded(tx, ctx.organization.id, data.requestKey)) return { duplicate: true as const };
      const wo = await loadJob(ctx, tx, data.workOrderId, "stock.reserve", { open: true, act: true });
      const part = await lockPart(tx, data.partId);
      const store = await jobStore(ctx, tx, wo, data.locationId, "stock.reserve");
      const stock = await stockAt(tx, part.id, store.id, localToday(wo.hospital.timezone));
      if (stock.available < data.quantity) {
        throw new ValidationError(
          `Only ${Math.max(0, stock.available)} available in ${store.code} (${stock.usable} usable, ${stock.reserved} already reserved).`,
          { quantity: ["Not enough available"] },
        );
      }
      await tx.partReservation.create({
        data: {
          organizationId: ctx.organization.id,
          workOrderId: wo.id,
          partId: part.id,
          locationId: store.id,
          quantity: data.quantity,
          idempotencyKey: data.requestKey,
          createdById: ctx.user.id,
        },
      });
      await addEvent(tx, ctx, wo.id, "PARTS_RESERVED", {
        note: `${data.quantity} × ${part.part_number} ${part.name} from ${store.code}`,
      });
      await woAudit(tx, ctx, "stock.reserved", wo, {
        partNumber: part.part_number,
        store: store.code,
        quantity: data.quantity,
      });
      return {};
    }),
  );
  return "duplicate" in r ? { duplicate: true } : {};
}

export async function releaseReservation(ctx: AccessContext, input: unknown) {
  await requirePermission(ctx, "stock.issue", { entityType: "part_reservation" });
  const { reservationId } = parseInput(reservationIdSchema, input);
  return withTenant(tenant(ctx), async (tx) => {
    const res = await tx.partReservation.findUnique({
      where: { id: reservationId },
      select: {
        id: true,
        status: true,
        quantity: true,
        workOrderId: true,
        partId: true,
        part: { select: { partNumber: true } },
        location: { select: { code: true } },
      },
    });
    if (!res) throw new NotFoundError("Reservation");
    const wo = await loadJob(ctx, tx, res.workOrderId, "stock.release", { act: true });
    await lockPart(tx, res.partId, { active: false });
    const updated = await tx.partReservation.updateMany({
      where: { id: res.id, status: "ACTIVE" },
      data: { status: "RELEASED", closedAt: new Date(), closedById: ctx.user.id },
    });
    if (!updated.count) return { duplicate: true };
    await addEvent(tx, ctx, wo.id, "PARTS_RELEASED", {
      note: `${res.quantity} × ${res.part.partNumber} back to ${res.location.code} (reservation released)`,
    });
    await woAudit(tx, ctx, "stock.reservation_released", wo, {
      partNumber: res.part.partNumber,
      quantity: res.quantity,
    });
    return {};
  });
}

// ─── Issue and return ────────────────────────────────────────────────────────

export async function issueParts(ctx: AccessContext, input: unknown): Promise<StockResult> {
  await requirePermission(ctx, "stock.issue", { entityType: "stock_movement" });
  const data = parseInput(issueSchema, input);
  const r = await keyed(() =>
    withTenant(tenant(ctx), async (tx) => {
      if (await alreadyRecorded(tx, ctx.organization.id, data.requestKey)) return { duplicate: true as const };
      const wo = await loadJob(ctx, tx, data.workOrderId, "stock.issue", { open: true, act: true });
      let partId = data.partId;
      let locationId = data.locationId;
      let quantity = data.quantity;
      let reservationId: string | null = null;
      if (data.reservationId) {
        const res = await tx.partReservation.findFirst({
          where: { id: data.reservationId, workOrderId: wo.id },
          select: { id: true, status: true, partId: true, locationId: true, quantity: true },
        });
        if (!res) throw new NotFoundError("Reservation");
        if (res.status !== "ACTIVE") throw new ValidationError("This reservation has already been issued or released.");
        partId = res.partId;
        locationId = res.locationId;
        quantity = res.quantity;
        reservationId = res.id;
      }
      if (!quantity) throw new ValidationError("Enter the quantity to issue.", { quantity: ["Required"] });
      const part = await lockPart(tx, partId);
      const store = await jobStore(ctx, tx, wo, locationId, "stock.issue");
      if (reservationId) {
        // The reservation is consumed by this issue (so it no longer counts as reserved).
        await tx.partReservation.update({
          where: { id: reservationId },
          data: { status: "ISSUED", closedAt: new Date(), closedById: ctx.user.id },
        });
      }
      const stock = await stockAt(tx, part.id, store.id, localToday(wo.hospital.timezone));
      if (stock.available < quantity) {
        throw new ValidationError(
          `Only ${Math.max(0, stock.available)} available in ${store.code} (${stock.usable} usable, ${stock.reserved} reserved for other jobs).`,
          { quantity: ["Not enough available"] },
        );
      }
      // Lots: the one asked for, otherwise first-expiry-first-out from usable lots.
      let lots = stock.usableLots;
      if (data.lotNumber) {
        lots = lots.filter((l) => l.lotNumber === data.lotNumber);
        if (!lots.length || lots[0].onHand < quantity) {
          throw new ValidationError(`Lot ${data.lotNumber} does not have ${quantity} usable in ${store.code}.`, {
            lotNumber: ["Not enough in this lot"],
          });
        }
      }
      let left = quantity;
      let i = 0;
      for (const lot of lots) {
        if (left <= 0) break;
        const take = Math.min(left, lot.onHand);
        i += 1;
        await recordMovement(tx, ctx, {
          partId: part.id,
          locationId: store.id,
          lotNumber: lot.lotNumber,
          expiresOn: lot.expiresOn,
          type: "ISSUE",
          quantity: -take,
          unitCost: part.unit_cost,
          currency: part.currency,
          workOrderId: wo.id,
          reservationId,
          idempotencyKey: `${data.requestKey}:${i}`,
        });
        left -= take;
      }
      if (left > 0) throw new ValidationError("Not enough usable stock.", { quantity: ["Not enough"] });
      await addEvent(tx, ctx, wo.id, "PARTS_ISSUED", {
        note: `${quantity} × ${part.part_number} ${part.name} from ${store.code}`,
      });
      await woAudit(tx, ctx, "stock.issued", wo, {
        partNumber: part.part_number,
        store: store.code,
        quantity,
        fromReservation: Boolean(reservationId),
      });
      return {};
    }),
  );
  return "duplicate" in r ? { duplicate: true } : {};
}

export async function returnParts(ctx: AccessContext, input: unknown): Promise<StockResult> {
  await requirePermission(ctx, "stock.issue", { entityType: "stock_movement" });
  const data = parseInput(returnSchema, input);
  const r = await keyed(() =>
    withTenant(tenant(ctx), async (tx) => {
      if (await alreadyRecorded(tx, ctx.organization.id, data.requestKey)) return { duplicate: true as const };
      const wo = await loadJob(ctx, tx, data.workOrderId, "stock.return", { act: true });
      const part = await lockPart(tx, data.partId, { active: false });
      const store = await jobStore(ctx, tx, wo, data.locationId, "stock.return");
      // Only what was actually issued to this job (net of earlier returns), lot by lot.
      const where: Prisma.StockMovementWhereInput = { workOrderId: wo.id, partId: part.id, lotNumber: data.lotNumber };
      const net = -((await tx.stockMovement.aggregate({ where, _sum: { quantity: true } }))._sum.quantity ?? 0);
      if (net < data.quantity) {
        throw new ValidationError(
          net > 0
            ? `Only ${net} of this part${data.lotNumber ? ` (lot ${data.lotNumber})` : ""} is still issued to this job.`
            : "This part was not issued to this job.",
          { quantity: ["More than was issued"] },
        );
      }
      const issued = await tx.stockMovement.findFirst({
        where: { ...where, type: "ISSUE" },
        select: { expiresOn: true, unitCost: true, currency: true },
      });
      await recordMovement(tx, ctx, {
        partId: part.id,
        locationId: store.id,
        lotNumber: data.lotNumber,
        expiresOn: issued?.expiresOn ?? null,
        type: "RETURN",
        quantity: data.quantity,
        unitCost: issued?.unitCost?.toString() ?? null,
        currency: issued?.currency ?? null,
        workOrderId: wo.id,
        reason: data.reason,
        idempotencyKey: data.requestKey,
      });
      await addEvent(tx, ctx, wo.id, "PARTS_RETURNED", {
        note: `${data.quantity} × ${part.part_number} returned to ${store.code}${data.reason ? ` — ${data.reason}` : ""}`,
      });
      await woAudit(tx, ctx, "stock.returned", wo, {
        partNumber: part.part_number,
        store: store.code,
        quantity: data.quantity,
      });
      return {};
    }),
  );
  return "duplicate" in r ? { duplicate: true } : {};
}

/** Records that a needed part is not available (shown in the job timeline; no stock change). */
export async function recordPartUnavailable(ctx: AccessContext, input: unknown) {
  await requirePermission(ctx, "stock.issue", { entityType: "work_order" });
  const data = parseInput(unavailableSchema, input);
  return withTenant(tenant(ctx), async (tx) => {
    const wo = await loadJob(ctx, tx, data.workOrderId, "stock.unavailable", { open: true, act: true });
    let label = data.description;
    if (data.partId) {
      const part = await tx.part.findUnique({ where: { id: data.partId }, select: { partNumber: true } });
      if (!part) throw new NotFoundError("Part");
      label = `${part.partNumber} — ${data.description}`;
    }
    await addEvent(tx, ctx, wo.id, "PARTS_UNAVAILABLE", { note: `${data.quantity} × ${label}` });
    await woAudit(tx, ctx, "stock.part_unavailable", wo, { partId: data.partId ?? undefined, quantity: data.quantity });
  });
}
