// Purchase requests (Stage 8). A controlled REQUEST workflow only:
//
//   Draft → Submitted → Approved (or Rejected) → Ordered → Partly received → Received
//                                                      (Cancelled from any step before receipt)
//
//   • BiomedIntel.ai never sends an order to a supplier and never spends money.
//     "Ordered" is recorded by a person after ordering through the hospital's
//     own purchasing process (outside the app), with that order's reference.
//   • Approval needs a second person (purchase.approve; database CHECK:
//     approver <> requester). An approved request is NOT stock.
//   • Stock increases only when a receipt is recorded against an ORDERED
//     request (enforced by the stock movement trigger), never by a status change.
//   • Lines are frozen once the request is submitted (database trigger).
import { withTenant, type Tx } from "../db/tenant";
import { audit } from "../audit/audit";
import { can, requirePermission, type AccessContext } from "../authz/access";
import { AuthorizationError, NotFoundError, ValidationError } from "../authz/errors";
import { parseInput } from "../validation";
import { notify } from "./notifications";
import { peopleNames } from "./work-order-core";
import { tenant } from "./inventory";
import {
  purchaseCreateSchema,
  purchaseDecisionSchema,
  purchaseIdSchema,
  purchaseOrderedSchema,
} from "@/lib/validation/inventory";
import { roleCan } from "../authz/permissions";
import type { MembershipRole } from "../authz/roles";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const hospitalIds = (ctx: AccessContext) => ctx.hospitals.map((h) => h.id);

async function loadRequest(ctx: AccessContext, tx: Tx, id: string) {
  if (!UUID.test(id)) throw new NotFoundError("Purchase request");
  const r = await tx.purchaseRequest.findFirst({
    where: { id, hospitalId: { in: hospitalIds(ctx) } },
    select: { id: true, number: true, status: true, hospitalId: true, requestedById: true },
  });
  if (!r) throw new NotFoundError("Purchase request");
  return r;
}

const pAudit = (
  tx: Tx,
  ctx: AccessContext,
  action: string,
  r: { id: string; number: string },
  metadata: Record<string, unknown> = {},
) =>
  audit(tx, {
    organizationId: ctx.organization.id,
    actorUserId: ctx.user.id,
    action,
    entityType: "purchase_request",
    entityId: r.id,
    metadata: { number: r.number, ...metadata },
    request: ctx.request,
  });

/** People who may approve requests for this hospital (managers and admins covering it). */
async function approversFor(tx: Tx, hospitalId: string) {
  const members = await tx.membership.findMany({
    where: { status: "ACTIVE" },
    select: { userId: true, role: true, orgWide: true, scopes: { select: { hospitalId: true } } },
  });
  return members
    .filter(
      (m) =>
        roleCan(m.role as MembershipRole, "purchase.approve") &&
        (m.orgWide || m.scopes.some((s) => s.hospitalId === hospitalId)),
    )
    .map((m) => m.userId);
}

async function nextPurchaseNumber(tx: Tx, organizationId: string) {
  const year = new Date().getUTCFullYear();
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${organizationId + ":purchase"}))`;
  const [row] = await tx.$queryRaw<{ max: number | null }[]>`
    SELECT max(substring(number FROM 9)::int) AS max FROM purchase_requests
    WHERE organization_id = ${organizationId}::uuid AND number LIKE ${`PR-${year}-%`}`;
  return `PR-${year}-${String((row?.max ?? 0) + 1).padStart(4, "0")}`;
}

// ─── Read ────────────────────────────────────────────────────────────────────

export async function listPurchaseRequests(ctx: AccessContext, raw: { status?: string } = {}) {
  await requirePermission(ctx, "purchase.view", { entityType: "purchase_request" });
  const statuses = [
    "DRAFT",
    "SUBMITTED",
    "APPROVED",
    "REJECTED",
    "ORDERED",
    "PARTIALLY_RECEIVED",
    "RECEIVED",
    "CANCELLED",
  ] as const;
  const status = statuses.find((s) => s === raw.status);
  return withTenant(tenant(ctx), async (tx) => {
    const rows = await tx.purchaseRequest.findMany({
      where: { hospitalId: { in: hospitalIds(ctx) }, ...(status ? { status } : {}) },
      orderBy: { createdAt: "desc" },
      take: 200,
      select: {
        id: true,
        number: true,
        status: true,
        createdAt: true,
        requestedById: true,
        hospital: { select: { code: true } },
        supplier: { select: { name: true } },
        _count: { select: { lines: true } },
      },
    });
    const names = await peopleNames(
      tx,
      rows.map((r) => r.requestedById),
    );
    return { rows, names, status };
  });
}

export async function getPurchaseRequest(ctx: AccessContext, id: string) {
  await requirePermission(ctx, "purchase.view", { entityType: "purchase_request" });
  return withTenant(tenant(ctx), async (tx) => {
    const base = await loadRequest(ctx, tx, id);
    const r = await tx.purchaseRequest.findUniqueOrThrow({
      where: { id: base.id },
      include: {
        hospital: { select: { code: true, name: true } },
        supplier: { select: { id: true, name: true } },
        lines: {
          include: { part: { select: { id: true, partNumber: true, name: true, unit: true } } },
          orderBy: { id: "asc" },
        },
      },
    });
    const names = await peopleNames(tx, [r.requestedById, r.decidedById, r.orderedById, r.cancelledById]);
    const showCost = can(ctx, "inventory.viewCost");
    const mine = r.requestedById === ctx.user.id;
    const estimate = new Map<string, number>();
    if (showCost) {
      for (const l of r.lines) {
        if (l.estimatedUnitCost && l.currency)
          estimate.set(l.currency, (estimate.get(l.currency) ?? 0) + Number(l.estimatedUnitCost) * l.quantity);
      }
    }
    return {
      request: {
        ...r,
        lines: r.lines.map((l) => (showCost ? l : { ...l, estimatedUnitCost: null, currency: null })),
      },
      names,
      estimate: showCost ? [...estimate.entries()].map(([currency, total]) => ({ currency, total })) : null,
      allowed: {
        submit: r.status === "DRAFT" && mine,
        decide: r.status === "SUBMITTED" && can(ctx, "purchase.approve") && !mine,
        order: r.status === "APPROVED" && can(ctx, "purchase.order"),
        receive: (r.status === "ORDERED" || r.status === "PARTIALLY_RECEIVED") && can(ctx, "stock.receive"),
        cancel:
          (["DRAFT", "SUBMITTED"].includes(r.status) && (mine || can(ctx, "purchase.approve"))) ||
          (["APPROVED", "ORDERED"].includes(r.status) && can(ctx, "purchase.approve")),
      },
    };
  });
}

// ─── Write ───────────────────────────────────────────────────────────────────

export async function createPurchaseRequest(ctx: AccessContext, input: unknown) {
  await requirePermission(ctx, "purchase.request", { entityType: "purchase_request" });
  const data = parseInput(purchaseCreateSchema, input);
  if (!ctx.hospitals.some((h) => h.id === data.hospitalId)) throw new NotFoundError("Hospital");
  const partIds = data.lines.map((l) => l.partId);
  if (new Set(partIds).size !== partIds.length) {
    throw new ValidationError("Each part may appear once; change the quantity instead.", { lines: ["Duplicate part"] });
  }
  return withTenant(tenant(ctx), async (tx) => {
    const parts = await tx.part.findMany({ where: { id: { in: partIds }, status: "ACTIVE" }, select: { id: true } });
    if (parts.length !== partIds.length)
      throw new ValidationError("Choose active parts from the catalogue.", { lines: ["Unknown part"] });
    if (
      data.supplierId &&
      !(await tx.supplier.findFirst({ where: { id: data.supplierId, status: "ACTIVE" }, select: { id: true } }))
    ) {
      throw new ValidationError("Choose a supplier from the register.", { supplierId: ["Unknown supplier"] });
    }
    const number = await nextPurchaseNumber(tx, ctx.organization.id);
    const r = await tx.purchaseRequest.create({
      data: {
        organizationId: ctx.organization.id,
        number,
        hospitalId: data.hospitalId,
        supplierId: data.supplierId,
        justification: data.justification,
        requestedById: ctx.user.id,
      },
      select: { id: true, number: true },
    });
    await tx.purchaseRequestLine.createMany({
      data: data.lines.map((l) => ({
        organizationId: ctx.organization.id,
        requestId: r.id,
        partId: l.partId,
        quantity: l.quantity,
        estimatedUnitCost: l.estimatedUnitCost,
        currency: l.currency,
      })),
    });
    await pAudit(tx, ctx, "purchase.created", r, { lines: data.lines.length, hospitalId: data.hospitalId });
    return r;
  });
}

export async function submitPurchaseRequest(ctx: AccessContext, input: unknown) {
  await requirePermission(ctx, "purchase.request", { entityType: "purchase_request" });
  const { id } = parseInput(purchaseIdSchema, input);
  return withTenant(tenant(ctx), async (tx) => {
    const r = await loadRequest(ctx, tx, id);
    if (r.requestedById !== ctx.user.id)
      throw new AuthorizationError("purchase.submit", "Only the person who wrote the request can submit it.");
    const updated = await tx.purchaseRequest.updateMany({
      where: { id: r.id, status: "DRAFT" },
      data: { status: "SUBMITTED", submittedAt: new Date() },
    });
    if (!updated.count) throw new ValidationError("Only a draft can be submitted.");
    await pAudit(tx, ctx, "purchase.submitted", r);
    await notify(tx, ctx, await approversFor(tx, r.hospitalId), {
      type: "purchase.submitted",
      title: `Purchase request ${r.number} awaits approval`,
      link: `/inventory/purchasing/${r.id}`,
      entityType: "purchase_request",
      entityId: r.id,
      dedupeKey: `purchase-submitted:${r.id}`,
    });
  });
}

export async function decidePurchaseRequest(ctx: AccessContext, input: unknown) {
  await requirePermission(ctx, "purchase.approve", { entityType: "purchase_request" });
  const data = parseInput(purchaseDecisionSchema, input);
  return withTenant(tenant(ctx), async (tx) => {
    const r = await loadRequest(ctx, tx, data.id);
    if (r.requestedById === ctx.user.id) {
      throw new AuthorizationError(
        "purchase.approve",
        "A request must be approved by someone other than the person who made it.",
      );
    }
    if (!data.approve && !data.note)
      throw new ValidationError("Give a reason for rejecting the request.", { note: ["Required when rejecting"] });
    const updated = await tx.purchaseRequest.updateMany({
      where: { id: r.id, status: "SUBMITTED" },
      data: {
        status: data.approve ? "APPROVED" : "REJECTED",
        decidedById: ctx.user.id,
        decidedAt: new Date(),
        decisionNote: data.note,
      },
    });
    if (!updated.count) throw new ValidationError("Only a submitted request can be approved or rejected.");
    await pAudit(tx, ctx, data.approve ? "purchase.approved" : "purchase.rejected", r);
    await notify(tx, ctx, [r.requestedById], {
      type: data.approve ? "purchase.approved" : "purchase.rejected",
      title: `Purchase request ${r.number} was ${data.approve ? "approved" : "rejected"}`,
      body: data.approve
        ? "Approved requests are not orders: order through your purchasing process, then mark it as ordered."
        : (data.note ?? undefined),
      link: `/inventory/purchasing/${r.id}`,
      entityType: "purchase_request",
      entityId: r.id,
    });
  });
}

/** Records that the approved request was ordered outside BiomedIntel.ai. */
export async function markPurchaseOrdered(ctx: AccessContext, input: unknown) {
  await requirePermission(ctx, "purchase.order", { entityType: "purchase_request" });
  const data = parseInput(purchaseOrderedSchema, input);
  return withTenant(tenant(ctx), async (tx) => {
    const r = await loadRequest(ctx, tx, data.id);
    const updated = await tx.purchaseRequest.updateMany({
      where: { id: r.id, status: "APPROVED" },
      data: { status: "ORDERED", orderedById: ctx.user.id, orderedAt: new Date(), orderReference: data.orderReference },
    });
    if (!updated.count) throw new ValidationError("Only an approved request can be marked as ordered.");
    await pAudit(tx, ctx, "purchase.ordered", r, { orderReference: data.orderReference });
  });
}

export async function cancelPurchaseRequest(ctx: AccessContext, input: unknown) {
  await requirePermission(ctx, "purchase.view", { entityType: "purchase_request" });
  const data = parseInput(purchaseIdSchema, input);
  return withTenant(tenant(ctx), async (tx) => {
    const r = await loadRequest(ctx, tx, data.id);
    const mine = r.requestedById === ctx.user.id && can(ctx, "purchase.request");
    const manager = can(ctx, "purchase.approve");
    const allowed =
      (["DRAFT", "SUBMITTED"].includes(r.status) && (mine || manager)) ||
      (["APPROVED", "ORDERED"].includes(r.status) && manager);
    if (!allowed) {
      if (["PARTIALLY_RECEIVED", "RECEIVED", "CANCELLED", "REJECTED"].includes(r.status)) {
        throw new ValidationError("This request can no longer be cancelled.");
      }
      throw new AuthorizationError("purchase.cancel");
    }
    if (!data.reason) throw new ValidationError("Give a reason for cancelling.", { reason: ["Required"] });
    const updated = await tx.purchaseRequest.updateMany({
      where: { id: r.id, status: r.status },
      data: { status: "CANCELLED", cancelledById: ctx.user.id, cancelledAt: new Date(), decisionNote: data.reason },
    });
    if (!updated.count) throw new ValidationError("This request changed. Reload and try again.");
    await pAudit(tx, ctx, "purchase.cancelled", r, { from: r.status });
  });
}
