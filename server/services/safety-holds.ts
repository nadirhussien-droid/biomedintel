// Safety holds: "Failed Safety Test — Do Not Use" (Stage 6, decision of 15 Oct 2026).
//
// When an electrical safety test fails:
//   1. The device is flagged "Failed Safety Test — Do Not Use" (an open hold),
//      taken out of service and its downtime starts.
//   2. A linked, urgent corrective (repair) job is created.
//   3. When the repair is signed off, a retest job (electrical safety test) is
//      created. The device stays out of service.
//   4. When the retest passes, the hold waits for an AUTHORISED SECOND PERSON
//      (an Engineering Manager who did not do the retest) to review the
//      results and approve return to service — or reject, which starts a new
//      repair.
//   5. Every step records who, when and what (safety_hold_events, audit log).
//
// The software NEVER returns a held device to service by itself: the work
// order sign-off cannot do it, the asset edit screen cannot do it, and a
// database trigger refuses "In service" while a hold is open. Exceptions
// (release without a passed retest) are NOT available: they need a written,
// authorised policy first (see docs/STAGE-6.md).
import type { AssetStatus, Prisma } from "../db/generated/client";
import { withTenant, type Tx } from "../db/tenant";
import { audit, auditStandalone } from "../audit/audit";
import { can, requirePermission, type AccessContext } from "../authz/access";
import { AuthorizationError, NotFoundError, ValidationError } from "../authz/errors";
import { parseInput } from "../validation";
import { assetScopeWhere } from "./assets";
import { findStaff, notify } from "./notifications";
import { resolveStandard } from "./test-standards";
import {
  auditActorId,
  createWorkOrderRecord,
  dueFrom,
  endDowntime,
  managersToAlert,
  OPEN,
  peopleNames,
  setAssetStatus,
  startDowntime,
  type Actor,
} from "./work-order-core";
import { DO_NOT_USE_LABEL, holdDecisionSchema, holdRejectSchema, type ChecklistItem } from "@/lib/validation/pm";

const tenant = (ctx: AccessContext) => ({ userId: ctx.user.id, organizationId: ctx.organization.id });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type HoldAsset = {
  id: string;
  assetTag: string;
  name: string;
  status: AssetStatus;
  hospitalId: string;
  departmentId: string;
  categoryId: string;
};

/** The retest checks only the electrical safety items of the job that failed. */
const DEFAULT_RETEST: ChecklistItem[] = [
  {
    key: "est_full",
    label: "Full electrical safety test to the applicable standard after repair",
    section: "ELECTRICAL_SAFETY",
    kind: "CHECK",
    required: true,
    unit: null,
    min: null,
    max: null,
    guidance: null,
  },
];

async function holdEvent(
  tx: Tx,
  actor: Actor,
  holdId: string,
  kind: string,
  extra: { workOrderId?: string | null; note?: string | null } = {},
) {
  await tx.safetyHoldEvent.create({
    data: {
      organizationId: actor.organization.id,
      holdId,
      kind,
      workOrderId: extra.workOrderId ?? null,
      note: extra.note ?? null,
      actorId: actor.user.id,
    },
  });
}

function auditHold(tx: Tx, actor: Actor, action: string, holdId: string, metadata: Record<string, unknown>) {
  return audit(tx, {
    organizationId: actor.organization.id,
    actorUserId: auditActorId(actor),
    action,
    entityType: "safety_hold",
    entityId: holdId,
    metadata,
    request: actor.request,
  });
}

async function loadHoldAsset(tx: Tx, assetId: string): Promise<HoldAsset> {
  const a = await tx.asset.findUniqueOrThrow({
    where: { id: assetId },
    select: {
      id: true,
      assetTag: true,
      name: true,
      status: true,
      hospitalId: true,
      departmentId: true,
      model: { select: { categoryId: true } },
    },
  });
  return { ...a, categoryId: a.model.categoryId };
}

async function createRepairJob(tx: Tx, actor: Actor, holdId: string, asset: HoldAsset, why: string) {
  const now = new Date();
  const wo = await createWorkOrderRecord(tx, actor, {
    asset,
    type: "CORRECTIVE",
    priority: "URGENT",
    safetyCritical: true,
    outOfUse: true,
    description: `${DO_NOT_USE_LABEL}. Repair required before retest. ${why}`,
    reportedById: actor.user.id,
    dueAt: dueFrom(now, "URGENT"),
    now,
    safetyHoldId: holdId,
    source: "safety_hold_repair",
  });
  await tx.safetyHold.update({ where: { id: holdId }, data: { correctiveWorkOrderId: wo.id } });
  await holdEvent(tx, actor, holdId, "REPAIR_CREATED", { workOrderId: wo.id });
  await notify(tx, actor, await managersToAlert(tx, wo, true), {
    type: "safety.repair_required",
    title: `${DO_NOT_USE_LABEL}: ${asset.assetTag} ${asset.name}`,
    body: `${wo.number} · repair and retest required`,
    link: `/work-orders/${wo.id}`,
    entityType: "work_order",
    entityId: wo.id,
  });
  return wo;
}

/**
 * Places (or adds to) the hold after a failed electrical safety test on
 * `failedWo`. Called inside the sign-off transaction of that job.
 */
export async function placeSafetyHold(
  tx: Tx,
  actor: Actor,
  input: { assetId: string; failedWo: { id: string; number: string }; summary: string; createRepair: boolean },
) {
  const asset = await loadHoldAsset(tx, input.assetId);
  const existing = await tx.safetyHold.findFirst({
    where: { assetId: asset.id, status: { not: "RELEASED" } },
    select: { id: true, status: true },
  });
  let holdId: string;
  if (existing) {
    holdId = existing.id;
    await holdEvent(tx, actor, holdId, "FAILURE_ADDED", { workOrderId: input.failedWo.id, note: input.summary });
    if (existing.status !== "AWAITING_REPAIR") {
      await tx.safetyHold.update({ where: { id: holdId }, data: { status: "AWAITING_REPAIR" } });
    }
  } else {
    const hold = await tx.safetyHold.create({
      data: {
        organizationId: actor.organization.id,
        assetId: asset.id,
        failedWorkOrderId: input.failedWo.id,
        failureSummary: input.summary.slice(0, 1000),
        placedById: actor.user.id,
      },
      select: { id: true },
    });
    holdId = hold.id;
    await holdEvent(tx, actor, holdId, "PLACED", { workOrderId: input.failedWo.id, note: input.summary });
  }
  await setAssetStatus(
    tx,
    actor,
    asset,
    "OUT_OF_SERVICE",
    input.failedWo.id,
    `${DO_NOT_USE_LABEL} (${input.failedWo.number})`,
  );
  await startDowntime(tx, actor, asset.id, input.failedWo.id, `${DO_NOT_USE_LABEL} (${input.failedWo.number})`);
  await auditHold(tx, actor, existing ? "safety.hold_failure_added" : "safety.hold_placed", holdId, {
    assetTag: asset.assetTag,
    failedWorkOrder: input.failedWo.number,
  });
  if (input.createRepair) {
    const openRepair = await tx.workOrder.count({
      where: { safetyHoldId: holdId, type: "CORRECTIVE", status: { in: OPEN } },
    });
    if (!openRepair)
      await createRepairJob(tx, actor, holdId, asset, `Failed in ${input.failedWo.number}: ${input.summary}`);
  } else {
    await notify(tx, actor, await managersToAlert(tx, asset, true), {
      type: "safety.hold_placed",
      title: `${DO_NOT_USE_LABEL}: ${asset.assetTag} ${asset.name}`,
      body: `Failed in ${input.failedWo.number}`,
      link: `/maintenance/holds/${holdId}`,
      entityType: "safety_hold",
      entityId: holdId,
    });
  }
  return holdId;
}

/** A repair job that belongs to a hold was signed off. */
export async function onHoldRepairCompleted(
  tx: Tx,
  actor: Actor,
  wo: { id: string; number: string; safetyHoldId: string },
  repaired: boolean,
) {
  const hold = await tx.safetyHold.findUnique({
    where: { id: wo.safetyHoldId },
    select: { id: true, status: true, assetId: true, failedWorkOrderId: true },
  });
  if (!hold || hold.status !== "AWAITING_REPAIR") return;
  await holdEvent(tx, actor, hold.id, "REPAIR_COMPLETED", {
    workOrderId: wo.id,
    note: repaired ? null : "Not repairable: the device stays out of service",
  });
  if (!repaired) return;

  const asset = await loadHoldAsset(tx, hold.assetId);
  const failed = await tx.workOrder.findUniqueOrThrow({
    where: { id: hold.failedWorkOrderId },
    select: { checklist: true, testStandardId: true, testStandardCode: true, testStandardVersion: true, number: true },
  });
  const failedItems = Array.isArray(failed.checklist) ? (failed.checklist as unknown as ChecklistItem[]) : [];
  const esItems = failedItems.filter((i) => i.section === "ELECTRICAL_SAFETY");
  const checklist = (esItems.length ? esItems : DEFAULT_RETEST) as unknown as Prisma.InputJsonValue;
  const resolved = await resolveStandard(tx, { hospitalId: asset.hospitalId, categoryId: asset.categoryId });
  const standard =
    resolved && resolved.verified
      ? { id: resolved.id, code: resolved.code, version: resolved.version }
      : failed.testStandardId && failed.testStandardCode && failed.testStandardVersion
        ? { id: failed.testStandardId, code: failed.testStandardCode, version: failed.testStandardVersion }
        : null;
  const now = new Date();
  const retest = await createWorkOrderRecord(tx, actor, {
    asset,
    type: "SAFETY_TEST",
    priority: "URGENT",
    safetyCritical: true,
    outOfUse: false, // already out of service
    description: `Retest after repair (${wo.number}) of the electrical safety failure in ${failed.number}. ${DO_NOT_USE_LABEL} until a second person approves return to service.`,
    reportedById: actor.user.id,
    dueAt: dueFrom(now, "URGENT"),
    now,
    checklist,
    testStandard: standard,
    safetyHoldId: hold.id,
    source: "safety_hold_retest",
  });
  await tx.safetyHold.update({
    where: { id: hold.id },
    data: { status: "AWAITING_RETEST", retestWorkOrderId: retest.id },
  });
  await holdEvent(tx, actor, hold.id, "RETEST_CREATED", { workOrderId: retest.id });
  await auditHold(tx, actor, "safety.retest_created", hold.id, { retestWorkOrder: retest.number });
  await notify(tx, actor, await managersToAlert(tx, asset, true), {
    type: "safety.retest_required",
    title: `Retest required: ${asset.assetTag} ${asset.name}`,
    body: `${retest.number} · ${DO_NOT_USE_LABEL} until approved`,
    link: `/work-orders/${retest.id}`,
    entityType: "work_order",
    entityId: retest.id,
  });
}

/** The retest job of a hold was signed off. */
export async function onHoldRetestCompleted(
  tx: Tx,
  actor: Actor,
  wo: { id: string; number: string; safetyHoldId: string },
  passed: boolean,
  failureSummary: string,
) {
  const hold = await tx.safetyHold.findUnique({
    where: { id: wo.safetyHoldId },
    select: { id: true, status: true, assetId: true, retestWorkOrderId: true },
  });
  if (!hold || hold.status !== "AWAITING_RETEST" || hold.retestWorkOrderId !== wo.id) return;
  const asset = await loadHoldAsset(tx, hold.assetId);
  if (passed) {
    await tx.safetyHold.update({
      where: { id: hold.id },
      data: { status: "AWAITING_APPROVAL", retestedById: actor.user.id, retestedAt: new Date() },
    });
    await holdEvent(tx, actor, hold.id, "RETEST_PASSED", { workOrderId: wo.id });
    await auditHold(tx, actor, "safety.retest_passed", hold.id, { retestWorkOrder: wo.number });
    const approvers = (
      await findStaff(tx, {
        hospitalId: asset.hospitalId,
        departmentId: asset.departmentId,
        roles: ["ENGINEERING_MANAGER"],
      })
    )
      .map((s) => s.userId)
      .filter((id) => id !== actor.user.id);
    await notify(tx, actor, approvers, {
      type: "safety.approval_required",
      title: `Approve return to service: ${asset.assetTag} ${asset.name}`,
      body: `Retest ${wo.number} passed. A second person must review and approve.`,
      link: `/maintenance/holds/${hold.id}`,
      entityType: "safety_hold",
      entityId: hold.id,
    });
  } else {
    await tx.safetyHold.update({ where: { id: hold.id }, data: { status: "AWAITING_REPAIR" } });
    await holdEvent(tx, actor, hold.id, "RETEST_FAILED", { workOrderId: wo.id, note: failureSummary });
    await auditHold(tx, actor, "safety.retest_failed", hold.id, { retestWorkOrder: wo.number });
    await createRepairJob(tx, actor, hold.id, asset, `Retest ${wo.number} failed: ${failureSummary}`);
  }
}

// ─── Screens and decisions ───────────────────────────────────────────────────

async function denied(ctx: AccessContext, holdId: string | undefined, attemptedAction: string, reason: string) {
  await auditStandalone({
    organizationId: ctx.organization.id,
    actorUserId: ctx.user.id,
    action: "safety.access_denied",
    outcome: "DENIED",
    entityType: "safety_hold",
    entityId: holdId,
    metadata: { attemptedAction, reason, role: ctx.role },
    request: ctx.request,
  });
}

async function loadScopedHold(ctx: AccessContext, tx: Tx, id: string, action: string) {
  if (!UUID.test(id)) throw new NotFoundError("Safety hold");
  const hold = await tx.safetyHold.findFirst({
    where: { id, asset: assetScopeWhere(ctx) },
    select: {
      id: true,
      status: true,
      assetId: true,
      retestedById: true,
      retestWorkOrderId: true,
      failedWorkOrderId: true,
    },
  });
  if (!hold) {
    await denied(ctx, id, action, "not_found_or_outside_scope");
    throw new NotFoundError("Safety hold");
  }
  return hold;
}

export async function listSafetyHolds(ctx: AccessContext, opts: { open?: boolean } = {}) {
  await requirePermission(ctx, "pm.view", { entityType: "safety_hold" });
  return withTenant(tenant(ctx), (tx) =>
    tx.safetyHold.findMany({
      where: { AND: [{ asset: assetScopeWhere(ctx) }, opts.open ? { status: { not: "RELEASED" } } : {}] },
      orderBy: [{ status: "asc" }, { placedAt: "desc" }],
      take: 200,
      select: {
        id: true,
        status: true,
        placedAt: true,
        releasedAt: true,
        failureSummary: true,
        asset: { select: { id: true, assetTag: true, name: true, hospital: { select: { code: true } } } },
        failedWorkOrder: { select: { id: true, number: true } },
      },
    }),
  );
}

export async function getSafetyHold(ctx: AccessContext, id: string) {
  await requirePermission(ctx, "pm.view", { entityType: "safety_hold" });
  return withTenant(tenant(ctx), async (tx) => {
    const core = await loadScopedHold(ctx, tx, id, "safety.view");
    const hold = await tx.safetyHold.findUniqueOrThrow({
      where: { id: core.id },
      include: {
        asset: { select: { id: true, assetTag: true, name: true, status: true, hospital: { select: { code: true } } } },
        failedWorkOrder: { select: { id: true, number: true, type: true, completedById: true, completedAt: true } },
        workOrders: {
          orderBy: { createdAt: "asc" },
          select: {
            id: true,
            number: true,
            type: true,
            status: true,
            outcome: true,
            completedById: true,
            completedAt: true,
          },
        },
        events: { orderBy: { createdAt: "asc" } },
      },
    });
    const retestResults = hold.retestWorkOrderId
      ? await tx.checklistResult.findMany({
          where: { workOrderId: hold.retestWorkOrderId },
          orderBy: [{ attempt: "desc" }, { recordedAt: "asc" }],
        })
      : [];
    const names = await peopleNames(tx, [
      hold.placedById,
      hold.retestedById,
      hold.releasedById,
      ...hold.events.map((e) => e.actorId),
      ...hold.workOrders.map((w) => w.completedById),
      hold.failedWorkOrder.completedById,
    ]);
    const decide = can(ctx, "safety.release") && hold.status === "AWAITING_APPROVAL";
    const openRepair = hold.workOrders.some((w) => w.type === "CORRECTIVE" && OPEN.includes(w.status));
    return {
      ...hold,
      retestResults,
      names,
      allowed: {
        release: decide && hold.retestedById !== ctx.user.id,
        reject: decide && hold.retestedById !== ctx.user.id,
        selfRetested: decide && hold.retestedById === ctx.user.id,
        createRepair: can(ctx, "workorder.manage") && hold.status === "AWAITING_REPAIR" && !openRepair,
      },
    };
  });
}

/**
 * The authorised second person approves return to service after a passed
 * retest. Refused for the person who did the retest (also a database CHECK).
 */
export async function approveRelease(ctx: AccessContext, input: unknown) {
  await requirePermission(ctx, "safety.release", { entityType: "safety_hold" });
  const data = parseInput(holdDecisionSchema, input);
  return withTenant(tenant(ctx), async (tx) => {
    const hold = await loadScopedHold(ctx, tx, data.id, "safety.release");
    if (hold.status !== "AWAITING_APPROVAL") throw new ValidationError("This hold is not waiting for approval.");
    if (hold.retestedById === ctx.user.id) {
      await denied(ctx, hold.id, "safety.release", "same_person_as_retest");
      throw new AuthorizationError("safety.release");
    }
    const retest = hold.retestWorkOrderId
      ? await tx.workOrder.findUnique({
          where: { id: hold.retestWorkOrderId },
          select: { status: true, outcome: true },
        })
      : null;
    if (!retest || retest.status !== "COMPLETED" || retest.outcome !== "CHECKS_PASSED") {
      throw new ValidationError("The retest must be signed off with every check passed before release.");
    }
    const r = await tx.safetyHold.updateMany({
      where: { id: hold.id, status: "AWAITING_APPROVAL" },
      data: { status: "RELEASED", releasedById: ctx.user.id, releasedAt: new Date(), releaseNote: data.note },
    });
    if (r.count === 0)
      throw new ValidationError("This hold changed while you were reviewing it. Reload and try again.");
    await holdEvent(tx, ctx, hold.id, "RELEASE_APPROVED", { note: data.note });

    const asset = await loadHoldAsset(tx, hold.assetId);
    const archived = await tx.asset.findUniqueOrThrow({ where: { id: asset.id }, select: { archivedAt: true } });
    const blocking = await tx.workOrder.count({
      where: { assetId: asset.id, status: { in: OPEN }, outOfUse: true },
    });
    let returnedToService = false;
    if (!blocking && !archived.archivedAt) {
      returnedToService = await setAssetStatus(
        tx,
        ctx,
        asset,
        "IN_SERVICE",
        hold.retestWorkOrderId,
        "Returned to service after passed retest and second-person approval",
      );
      if (returnedToService) await endDowntime(tx, asset.id);
    }
    await auditHold(tx, ctx, "safety.hold_released", hold.id, {
      assetTag: asset.assetTag,
      retestedBy: hold.retestedById,
      approvedBy: ctx.user.id,
      returnedToService,
    });
    return { returnedToService };
  });
}

/** The second person does not accept the retest: a new repair is started. */
export async function rejectRelease(ctx: AccessContext, input: unknown) {
  await requirePermission(ctx, "safety.release", { entityType: "safety_hold" });
  const data = parseInput(holdRejectSchema, input);
  return withTenant(tenant(ctx), async (tx) => {
    const hold = await loadScopedHold(ctx, tx, data.id, "safety.reject");
    if (hold.status !== "AWAITING_APPROVAL") throw new ValidationError("This hold is not waiting for approval.");
    if (hold.retestedById === ctx.user.id) {
      await denied(ctx, hold.id, "safety.reject", "same_person_as_retest");
      throw new AuthorizationError("safety.reject");
    }
    await tx.safetyHold.update({
      where: { id: hold.id },
      data: { status: "AWAITING_REPAIR", rejectedCount: { increment: 1 } },
    });
    await holdEvent(tx, ctx, hold.id, "RELEASE_REJECTED", { note: data.note });
    await auditHold(tx, ctx, "safety.release_rejected", hold.id, {});
    const asset = await loadHoldAsset(tx, hold.assetId);
    await createRepairJob(tx, ctx, hold.id, asset, `Return to service not approved: ${data.note}`);
  });
}

/** For a hold with no open repair job (e.g. "not repairable" was later reconsidered). */
export async function createRepairForHold(ctx: AccessContext, input: unknown) {
  await requirePermission(ctx, "workorder.manage", { entityType: "safety_hold" });
  const id = String((input as { id?: unknown })?.id ?? "");
  return withTenant(tenant(ctx), async (tx) => {
    const hold = await loadScopedHold(ctx, tx, id, "safety.create_repair");
    if (hold.status !== "AWAITING_REPAIR") throw new ValidationError("This hold is not waiting for a repair.");
    const open = await tx.workOrder.count({
      where: { safetyHoldId: hold.id, type: "CORRECTIVE", status: { in: OPEN } },
    });
    if (open) throw new ValidationError("A repair job is already open for this hold.");
    const asset = await loadHoldAsset(tx, hold.assetId);
    return createRepairJob(tx, ctx, hold.id, asset, "Repair requested by the engineering manager.");
  });
}
