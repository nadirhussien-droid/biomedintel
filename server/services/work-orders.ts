// Work Order Management (Stage 5).
//
// Same pattern as every BiomedIntel.ai service: requirePermission → parseInput
// → scope check → withTenant (RLS) → audit, in one transaction.
//
// Workflow (Stage 2 workflows C, D and E, with the decisions of 15 Oct 2026):
//   REQUESTED → ASSIGNED → IN_PROGRESS ⇄ ON_HOLD → COMPLETED   (or CANCELLED)
//   • Anyone allowed to report finds the device by barcode, asset ID or search.
//   • Managers assign; technicians may take an unassigned job.
//   • Only the assigned technician works on and SIGNS OFF the job (decision of
//     15 Oct 2026; also enforced by a database CHECK). Managers can review
//     self-signed jobs afterwards and reopen them; review never blocks.
//   • Safety-critical jobs (decision 9) get at least High priority and notify
//     managers and organisation admins immediately.
import { createHash } from "node:crypto";
import sharp from "sharp";
import type { Prisma, WorkOrderPriority, WorkOrderStatus } from "../db/generated/client";
import { withTenant, type Tx } from "../db/tenant";
import { auditStandalone } from "../audit/audit";
import { can, requirePermission, type AccessContext } from "../authz/access";
import { AuthorizationError, NotFoundError, ValidationError } from "../authz/errors";
import { parseInput } from "../validation";
import { assetScopeWhere } from "./assets";
import { findStaff, notify } from "./notifications";
import {
  addEvent,
  auditWO,
  createWorkOrderRecord,
  dueFrom,
  endDowntime,
  managersToAlert,
  OPEN,
  openSafetyHold,
  peopleNames,
  releaseJobReservations,
  setAssetStatus,
  startDowntime,
  WORKER_ROLES,
} from "./work-order-core";
import { onHoldRepairCompleted, onHoldRetestCompleted, placeSafetyHold } from "./safety-holds";
import { localToday, isOnTime, fromDbDate } from "@/lib/pm/dates";
import { pmCompleteSchema, type ChecklistItem, DO_NOT_USE_LABEL } from "@/lib/validation/pm";
import {
  assignSchema,
  completeSchema,
  editCompletedJobSchema,
  holdSchema,
  logWorkSchema,
  MAX_PHOTO_BYTES,
  MAX_PHOTOS,
  noteSchema,
  prioritySchema,
  reasonSchema,
  reportFaultSchema,
  WO_PAGE_SIZE,
  workOrderIdSchema,
  workOrderQuerySchema,
  type WorkOrderQuery,
} from "@/lib/validation/work-orders";

const tenant = (ctx: AccessContext) => ({ userId: ctx.user.id, organizationId: ctx.organization.id });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ─── Scope ───────────────────────────────────────────────────────────────────

/** Work orders the user may see: their hospitals/departments; Fault Reporters only their own reports. */
export function workOrderScopeWhere(ctx: AccessContext): Prisma.WorkOrderWhereInput {
  if (ctx.hospitals.length === 0) return { id: { in: [] } };
  const location: Prisma.WorkOrderWhereInput = {
    OR: ctx.hospitals.map((h) =>
      h.departments === "ALL" ? { hospitalId: h.id } : { hospitalId: h.id, departmentId: { in: h.departments } },
    ),
  };
  return ctx.role === "FAULT_REPORTER" ? { AND: [location, { reportedById: ctx.user.id }] } : location;
}

async function denied(ctx: AccessContext, entityId: string | undefined, attemptedAction: string, reason: string) {
  await auditStandalone({
    organizationId: ctx.organization.id,
    actorUserId: ctx.user.id,
    action: "workorder.access_denied",
    outcome: "DENIED",
    entityType: "work_order",
    entityId,
    metadata: { attemptedAction, reason, role: ctx.role },
    request: ctx.request,
  });
}

const WO_CORE = {
  id: true,
  number: true,
  assetId: true,
  hospitalId: true,
  departmentId: true,
  status: true,
  priority: true,
  safetyCritical: true,
  outOfUse: true,
  reportedById: true,
  assignedToId: true,
  completedById: true,
  reviewedAt: true,
  createdAt: true,
} satisfies Prisma.WorkOrderSelect;

/** Loads a job the user may see, or throws NotFoundError (audited). */
async function loadScoped(ctx: AccessContext, tx: Tx, id: string, action: string) {
  if (!UUID.test(id)) throw new NotFoundError("Work order");
  const wo = await tx.workOrder.findFirst({ where: { AND: [{ id }, workOrderScopeWhere(ctx)] }, select: WO_CORE });
  if (!wo) {
    await denied(ctx, id, action, "not_found_or_outside_scope");
    throw new NotFoundError("Work order");
  }
  return wo;
}

type CoreWO = Awaited<ReturnType<typeof loadScoped>>;

async function requireAssignee(ctx: AccessContext, wo: CoreWO, action: string) {
  if (wo.assignedToId !== ctx.user.id) {
    await denied(ctx, wo.id, action, "not_the_assigned_technician");
    throw new AuthorizationError(action);
  }
}

function expectStatus(wo: CoreWO, allowed: WorkOrderStatus[], message: string) {
  if (!allowed.includes(wo.status)) throw new ValidationError(message);
}

// ─── Reporting a fault (workflow C) ──────────────────────────────────────────

export type ReportResult = { id: string; number: string };

/**
 * Creates a corrective work order for an asset found by barcode, asset ID or
 * search. The asset must be in the reporter's scope (a barcode grants
 * nothing), active and not decommissioned.
 */
export async function reportFault(ctx: AccessContext, input: unknown): Promise<ReportResult> {
  await requirePermission(ctx, "workorder.report", { entityType: "work_order" });
  const data = parseInput(reportFaultSchema, input);
  return withTenant(tenant(ctx), async (tx) => {
    const asset = await tx.asset.findFirst({
      where: { AND: [{ id: data.assetId }, assetScopeWhere(ctx)] },
      select: {
        id: true,
        assetTag: true,
        name: true,
        status: true,
        riskClass: true,
        archivedAt: true,
        hospitalId: true,
        departmentId: true,
        model: { select: { category: { select: { safetyCritical: true } } } },
      },
    });
    if (!asset) {
      await denied(ctx, undefined, "workorder.report", "asset_not_found_or_outside_scope");
      throw new NotFoundError("Asset");
    }
    if (asset.archivedAt) throw new ValidationError("This asset is archived. Ask your engineering team.");
    if (asset.status === "DECOMMISSIONED") throw new ValidationError("This asset is decommissioned.");

    // Planned maintenance jobs are not faults, so only open fault jobs count here.
    const existing = await tx.workOrder.findFirst({
      where: { assetId: asset.id, status: { in: OPEN }, type: "CORRECTIVE" },
      select: { number: true },
      orderBy: { createdAt: "asc" },
    });
    if (existing && !data.confirmDuplicate) {
      throw new ValidationError(`There is already an open job for this device (${existing.number}).`, {
        confirmDuplicate: [
          `${existing.number} is still open for this device. Add a note to that job instead, or tick the box to report a separate fault.`,
        ],
      });
    }

    const safetyCritical = asset.model.category.safetyCritical || asset.riskClass === "HIGH";
    const priority: WorkOrderPriority = safetyCritical
      ? data.outOfUse
        ? "URGENT"
        : "HIGH"
      : asset.riskClass === "LOW"
        ? "LOW"
        : "MEDIUM";
    const now = new Date();
    const wo = await createWorkOrderRecord(tx, ctx, {
      asset,
      type: "CORRECTIVE",
      priority,
      safetyCritical,
      outOfUse: data.outOfUse,
      description: data.faultDescription,
      reportedById: ctx.user.id,
      dueAt: dueFrom(now, priority),
      now,
      source: "fault",
      outOfUseStatusReason: (n) => `Taken out of use: fault reported (${n})`,
      outOfUseDowntimeReason: (n) => `Fault reported (${n})`,
      auditExtra: { duplicateConfirmed: existing ? true : undefined },
    });
    const number = wo.number;
    await notify(tx, ctx, await managersToAlert(tx, wo, safetyCritical), {
      type: safetyCritical ? "workorder.safety_critical" : "workorder.reported",
      title: `${safetyCritical ? "SAFETY-CRITICAL fault" : "New fault"}: ${asset.assetTag} ${asset.name}`,
      body: `${number} · ${data.outOfUse ? "taken out of use" : "still in use"}`,
      link: `/work-orders/${wo.id}`,
      entityType: "work_order",
      entityId: wo.id,
    });
    return { id: wo.id, number };
  });
}

// ─── Reading ─────────────────────────────────────────────────────────────────

const LIST_SELECT = {
  id: true,
  number: true,
  status: true,
  priority: true,
  safetyCritical: true,
  outOfUse: true,
  faultDescription: true,
  dueAt: true,
  createdAt: true,
  completedAt: true,
  reviewedAt: true,
  assignedToId: true,
  asset: { select: { id: true, assetTag: true, name: true } },
  hospital: { select: { code: true } },
  department: { select: { name: true } },
} satisfies Prisma.WorkOrderSelect;

function buildWhere(ctx: AccessContext, q: WorkOrderQuery): Prisma.WorkOrderWhereInput {
  const and: Prisma.WorkOrderWhereInput[] = [workOrderScopeWhere(ctx)];
  if (q.view === "open") and.push({ status: { in: OPEN } });
  if (q.view === "mine") and.push({ assignedToId: ctx.user.id, status: { in: OPEN } });
  if (q.view === "triage") and.push({ status: "REQUESTED" });
  if (q.view === "review") and.push({ status: "COMPLETED", safetyCritical: true, reviewedAt: null });
  if (q.view === "completed") and.push({ status: "COMPLETED" });
  if (q.status) and.push({ status: q.status });
  if (q.priority) and.push({ priority: q.priority });
  if (q.hospital) and.push({ hospitalId: q.hospital });
  if (q.department) and.push({ departmentId: q.department });
  if (q.safety === "only") and.push({ safetyCritical: true });
  if (q.q) {
    const contains = { contains: q.q, mode: "insensitive" as const };
    and.push({
      OR: [
        { number: contains },
        { faultDescription: contains },
        { asset: { assetTag: contains } },
        { asset: { name: contains } },
      ],
    });
  }
  return { AND: and };
}

export async function listWorkOrders(ctx: AccessContext, rawQuery: unknown) {
  await requirePermission(ctx, "workorder.view", { entityType: "work_order" });
  const q = workOrderQuerySchema.parse(rawQuery ?? {});
  const now = new Date();
  const where = buildWhere(ctx, q);
  return withTenant(tenant(ctx), async (tx) => {
    const total = await tx.workOrder.count({ where });
    const pageCount = Math.max(1, Math.ceil(total / WO_PAGE_SIZE));
    const page = Math.min(q.page, pageCount);
    const rows = await tx.workOrder.findMany({
      where,
      orderBy: [{ [q.sort]: q.dir }, { id: "asc" }],
      skip: (page - 1) * WO_PAGE_SIZE,
      take: WO_PAGE_SIZE,
      select: LIST_SELECT,
    });
    const names = await peopleNames(
      tx,
      rows.map((r) => r.assignedToId),
    );
    return {
      rows: rows.map((r) => ({
        ...r,
        assignedTo: r.assignedToId ? (names[r.assignedToId] ?? "Unknown") : null,
        overdue: OPEN.includes(r.status) && r.dueAt !== null && r.dueAt < now,
      })),
      total,
      page,
      pageCount,
      query: { ...q, page },
    };
  });
}

/** Everything the work order page needs, plus what THIS user may do (decided on the server). */
export async function getWorkOrder(ctx: AccessContext, id: string) {
  await requirePermission(ctx, "workorder.view", { entityType: "work_order" });
  return withTenant(tenant(ctx), async (tx) => {
    const core = await loadScoped(ctx, tx, id, "workorder.view");
    const wo = await tx.workOrder.findUniqueOrThrow({
      where: { id: core.id },
      include: {
        asset: {
          select: {
            id: true,
            assetTag: true,
            name: true,
            status: true,
            serialNumber: true,
            riskClass: true,
            model: { select: { id: true, modelName: true, manufacturer: { select: { name: true } } } },
            location: { select: { name: true } },
          },
        },
        hospital: { select: { name: true, code: true, timezone: true } },
        department: { select: { name: true } },
        events: { orderBy: { createdAt: "asc" } },
        tasks: { orderBy: { createdAt: "asc" } },
        attachments: {
          orderBy: { createdAt: "asc" },
          select: { id: true, filename: true, mime: true, sizeBytes: true, width: true, height: true, createdAt: true },
        },
        downtime: { orderBy: { startedAt: "asc" } },
        checklistResults: { orderBy: [{ attempt: "desc" }, { recordedAt: "asc" }, { itemKey: "asc" }] },
        pmOccurrence: {
          select: {
            id: true,
            dueOn: true,
            status: true,
            completedOn: true,
            onTime: true,
            plan: {
              select: {
                id: true,
                name: true,
                requiredCompetency: true,
                estimatedMinutes: true,
                documentReference: true,
              },
            },
          },
        },
        planRevision: { select: { revisionNo: true, snapshot: true } },
        safetyHold: { select: { id: true, status: true } },
      },
    });
    const assetHold = await openSafetyHold(tx, wo.assetId);
    const names = await peopleNames(tx, [
      wo.reportedById,
      wo.assignedToId,
      wo.assignedById,
      wo.completedById,
      wo.reviewedById,
      wo.cancelledById,
      ...wo.events.map((e) => e.actorId),
      ...wo.tasks.map((t) => t.performedById),
      ...wo.checklistResults.map((r) => r.recordedById),
    ]);

    const manage = can(ctx, "workorder.manage");
    const isAssignee = wo.assignedToId === ctx.user.id && can(ctx, "workorder.work");
    const open = OPEN.includes(wo.status);
    const candidates = manage && open ? await assigneeCandidates(tx, wo) : [];
    // The work log shows each line as last corrected; earlier versions stay in the history.
    const tasks = effectiveTasks(wo.tasks);
    const totalMinutes = tasks.reduce((sum, t) => sum + t.minutes, 0);
    const workedOnIt = wo.tasks.some((t) => t.performedById === ctx.user.id);
    const mayEdit =
      wo.status === "COMPLETED" &&
      can(ctx, "workorder.work") &&
      (wo.assignedToId === ctx.user.id || wo.completedById === ctx.user.id || workedOnIt);
    const checklist = Array.isArray(wo.checklist) ? (wo.checklist as unknown as ChecklistItem[]) : null;
    // Instructions come from the approved plan version this job was made from.
    const snapshot = (wo.planRevision?.snapshot ?? null) as { instructions?: string | null } | null;
    return {
      ...wo,
      tasks,
      checklistItems: checklist,
      planned: checklist !== null,
      instructions: snapshot?.instructions ?? null,
      assetHold,
      people: names,
      totalMinutes,
      overdue: open && wo.dueAt !== null && wo.dueAt < new Date(),
      candidates,
      allowed: {
        assign: manage && open,
        take: can(ctx, "workorder.work") && wo.status === "REQUESTED",
        priority: manage && open,
        start: isAssignee && (wo.status === "ASSIGNED" || wo.status === "ON_HOLD"),
        hold: isAssignee && wo.status === "IN_PROGRESS",
        logWork: isAssignee && (wo.status === "IN_PROGRESS" || wo.status === "ON_HOLD"),
        complete: isAssignee && (wo.status === "IN_PROGRESS" || wo.status === "ON_HOLD"),
        comment: can(ctx, "workorder.comment") && wo.status !== "CANCELLED",
        photos:
          open &&
          wo.attachments.length < MAX_PHOTOS &&
          (manage || isAssignee || (wo.reportedById === ctx.user.id && can(ctx, "workorder.report"))),
        // Repair and retest jobs of a safety hold cannot be cancelled: the hold needs them.
        cancel: open && !wo.safetyHoldId && (manage || (wo.reportedById === ctx.user.id && wo.status === "REQUESTED")),
        reopen: manage && wo.status === "COMPLETED",
        editCompleted: mayEdit,
        review: manage && wo.status === "COMPLETED" && wo.reviewedAt === null && wo.completedById !== ctx.user.id,
      },
    };
  });
}

async function assigneeCandidates(tx: Tx, wo: { hospitalId: string; departmentId: string }) {
  const staff = await findStaff(tx, {
    hospitalId: wo.hospitalId,
    departmentId: wo.departmentId,
    roles: [...WORKER_ROLES],
  });
  const names = await peopleNames(
    tx,
    staff.map((s) => s.userId),
  );
  return staff
    .map((s) => ({ userId: s.userId, name: names[s.userId] ?? "Unknown", role: s.role }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Jobs on one asset, for the asset page (same visibility rules). */
export async function listWorkOrdersForAsset(ctx: AccessContext, assetId: string) {
  if (!can(ctx, "workorder.view") || !UUID.test(assetId)) return [];
  return withTenant(tenant(ctx), (tx) =>
    tx.workOrder.findMany({
      where: { AND: [{ assetId }, workOrderScopeWhere(ctx)] },
      orderBy: { createdAt: "desc" },
      take: 50,
      select: {
        id: true,
        number: true,
        status: true,
        priority: true,
        faultDescription: true,
        resolution: true,
        outcome: true,
        createdAt: true,
        completedAt: true,
      },
    }),
  );
}

export async function getWorkOrderCounts(ctx: AccessContext, hospitalId?: string | null) {
  if (!can(ctx, "workorder.view")) return null;
  const scope: Prisma.WorkOrderWhereInput = {
    AND: [workOrderScopeWhere(ctx), ...(hospitalId ? [{ hospitalId }] : [])],
  };
  const now = new Date();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  return withTenant(tenant(ctx), async (tx) => {
    const [open, overdue, triage, safety, review, mine, completedThisMonth] = await Promise.all([
      tx.workOrder.count({ where: { AND: [scope, { status: { in: OPEN } }] } }),
      tx.workOrder.count({ where: { AND: [scope, { status: { in: OPEN }, dueAt: { lt: now } }] } }),
      tx.workOrder.count({ where: { AND: [scope, { status: "REQUESTED" }] } }),
      tx.workOrder.count({ where: { AND: [scope, { status: { in: OPEN }, safetyCritical: true }] } }),
      tx.workOrder.count({ where: { AND: [scope, { status: "COMPLETED", safetyCritical: true, reviewedAt: null }] } }),
      tx.workOrder.count({ where: { AND: [scope, { status: { in: OPEN }, assignedToId: ctx.user.id }] } }),
      tx.workOrder.count({ where: { AND: [scope, { status: "COMPLETED", completedAt: { gte: monthStart } }] } }),
    ]);
    return { open, overdue, triage, safety, review, mine, completedThisMonth };
  });
}

// ─── Triage (workflow D) ─────────────────────────────────────────────────────

export async function assignWorkOrder(ctx: AccessContext, input: unknown) {
  await requirePermission(ctx, "workorder.manage", { entityType: "work_order" });
  const data = parseInput(assignSchema, input);
  return withTenant(tenant(ctx), async (tx) => {
    const wo = await loadScoped(ctx, tx, data.id, "workorder.assign");
    expectStatus(wo, OPEN, "Only open jobs can be assigned.");
    // The assignee must be a technician or engineering manager with access to
    // this job's department — never trusted from the form.
    const candidates = await findStaff(tx, {
      hospitalId: wo.hospitalId,
      departmentId: wo.departmentId,
      roles: [...WORKER_ROLES],
    });
    if (!candidates.some((c) => c.userId === data.assigneeId)) {
      throw new ValidationError("Choose a technician who has access to this department.", {
        assigneeId: ["Not a technician for this department"],
      });
    }
    const status: WorkOrderStatus = wo.status === "REQUESTED" ? "ASSIGNED" : wo.status;
    await tx.workOrder.update({
      where: { id: wo.id },
      data: {
        assignedToId: data.assigneeId,
        assignedById: ctx.user.id,
        assignedAt: new Date(),
        status,
        updatedById: ctx.user.id,
      },
    });
    await addEvent(tx, ctx, wo.id, "ASSIGNED", { fromStatus: wo.status, toStatus: status });
    await auditWO(tx, ctx, "workorder.assigned", wo, { number: wo.number, assigneeId: data.assigneeId });
    await notify(tx, ctx, [data.assigneeId], {
      type: "workorder.assigned",
      title: `Job assigned to you: ${wo.number}`,
      body: wo.safetyCritical ? "Safety-critical device" : undefined,
      link: `/work-orders/${wo.id}`,
      entityType: "work_order",
      entityId: wo.id,
    });
  });
}

/** A technician takes an unassigned job. */
export async function takeWorkOrder(ctx: AccessContext, input: unknown) {
  await requirePermission(ctx, "workorder.work", { entityType: "work_order" });
  const { id } = parseInput(workOrderIdSchema, input);
  return withTenant(tenant(ctx), async (tx) => {
    const wo = await loadScoped(ctx, tx, id, "workorder.take");
    const r = await tx.workOrder.updateMany({
      where: { id: wo.id, status: "REQUESTED" },
      data: {
        assignedToId: ctx.user.id,
        assignedById: ctx.user.id,
        assignedAt: new Date(),
        status: "ASSIGNED",
        updatedById: ctx.user.id,
      },
    });
    if (r.count === 0) throw new ValidationError("This job has already been taken or assigned.");
    await addEvent(tx, ctx, wo.id, "TAKEN", { fromStatus: "REQUESTED", toStatus: "ASSIGNED" });
    await auditWO(tx, ctx, "workorder.assigned", wo, { number: wo.number, assigneeId: ctx.user.id, self: true });
  });
}

export async function setWorkOrderPriority(ctx: AccessContext, input: unknown) {
  await requirePermission(ctx, "workorder.manage", { entityType: "work_order" });
  const data = parseInput(prioritySchema, input);
  return withTenant(tenant(ctx), async (tx) => {
    const wo = await loadScoped(ctx, tx, data.id, "workorder.priority");
    expectStatus(wo, OPEN, "Only open jobs can be re-prioritised.");
    if (wo.priority === data.priority) return;
    if (wo.safetyCritical && (data.priority === "MEDIUM" || data.priority === "LOW")) {
      throw new ValidationError("Safety-critical jobs are always High or Urgent priority.", {
        priority: ["Safety-critical: High or Urgent only"],
      });
    }
    await tx.workOrder.update({
      where: { id: wo.id },
      data: { priority: data.priority, dueAt: dueFrom(wo.createdAt, data.priority), updatedById: ctx.user.id },
    });
    await addEvent(tx, ctx, wo.id, "PRIORITY_CHANGED", { note: `${wo.priority} → ${data.priority}` });
    await auditWO(tx, ctx, "workorder.priority_changed", wo, { from: wo.priority, to: data.priority });
  });
}

// ─── Doing the work (workflow D) ─────────────────────────────────────────────

export async function startWorkOrder(ctx: AccessContext, input: unknown) {
  await requirePermission(ctx, "workorder.work", { entityType: "work_order" });
  const { id } = parseInput(workOrderIdSchema, input);
  return withTenant(tenant(ctx), async (tx) => {
    const wo = await loadScoped(ctx, tx, id, "workorder.start");
    await requireAssignee(ctx, wo, "workorder.start");
    expectStatus(wo, ["ASSIGNED", "ON_HOLD"], "This job cannot be started now.");
    const now = new Date();
    await tx.workOrder.update({
      where: { id: wo.id },
      data: { status: "IN_PROGRESS", holdReason: null, updatedById: ctx.user.id },
    });
    await tx.workOrder.updateMany({ where: { id: wo.id, startedAt: null }, data: { startedAt: now } });
    const asset = await tx.asset.findUniqueOrThrow({
      where: { id: wo.assetId },
      select: { id: true, status: true, assetTag: true },
    });
    // A device that was taken out of use is now with the technician.
    if (asset.status === "OUT_OF_SERVICE") {
      await setAssetStatus(tx, ctx, asset, "UNDER_REPAIR", wo.id, `Repair started (${wo.number})`);
    }
    await addEvent(tx, ctx, wo.id, wo.status === "ON_HOLD" ? "RESUMED" : "STARTED", {
      fromStatus: wo.status,
      toStatus: "IN_PROGRESS",
    });
    await auditWO(tx, ctx, "workorder.started", wo, { number: wo.number });
  });
}

export async function holdWorkOrder(ctx: AccessContext, input: unknown) {
  await requirePermission(ctx, "workorder.work", { entityType: "work_order" });
  const data = parseInput(holdSchema, input);
  return withTenant(tenant(ctx), async (tx) => {
    const wo = await loadScoped(ctx, tx, data.id, "workorder.hold");
    await requireAssignee(ctx, wo, "workorder.hold");
    expectStatus(wo, ["IN_PROGRESS"], "Only a job in progress can be put on hold.");
    await tx.workOrder.update({
      where: { id: wo.id },
      data: { status: "ON_HOLD", holdReason: data.reason, updatedById: ctx.user.id },
    });
    await addEvent(tx, ctx, wo.id, "ON_HOLD", { fromStatus: "IN_PROGRESS", toStatus: "ON_HOLD", note: data.reason });
    await auditWO(tx, ctx, "workorder.on_hold", wo, { number: wo.number });
  });
}

export async function logWork(ctx: AccessContext, input: unknown) {
  await requirePermission(ctx, "workorder.work", { entityType: "work_order" });
  const data = parseInput(logWorkSchema, input);
  return withTenant(tenant(ctx), async (tx) => {
    const wo = await loadScoped(ctx, tx, data.id, "workorder.log_work");
    await requireAssignee(ctx, wo, "workorder.log_work");
    expectStatus(wo, ["IN_PROGRESS", "ON_HOLD"], "Start the job before logging work.");
    await tx.workOrderTask.create({
      data: {
        organizationId: ctx.organization.id,
        workOrderId: wo.id,
        description: data.description,
        minutes: data.minutes,
        performedById: ctx.user.id,
      },
    });
    await addEvent(tx, ctx, wo.id, "WORK_LOGGED", { note: `${data.minutes} min` });
    await auditWO(tx, ctx, "workorder.work_logged", wo, { number: wo.number, minutes: data.minutes });
  });
}

export async function addWorkOrderNote(ctx: AccessContext, input: unknown) {
  await requirePermission(ctx, "workorder.comment", { entityType: "work_order" });
  const data = parseInput(noteSchema, input);
  return withTenant(tenant(ctx), async (tx) => {
    const wo = await loadScoped(ctx, tx, data.id, "workorder.note");
    if (wo.status === "CANCELLED") throw new ValidationError("This job was cancelled.");
    await addEvent(tx, ctx, wo.id, "NOTE", { note: data.note });
    // The note text stays in the timeline; the audit log records only that it was added.
    await auditWO(tx, ctx, "workorder.note_added", wo, { number: wo.number });
    await notify(tx, ctx, [wo.assignedToId, wo.reportedById], {
      type: "workorder.note",
      title: `New note on ${wo.number}`,
      link: `/work-orders/${wo.id}`,
      entityType: "work_order",
      entityId: wo.id,
    });
  });
}

// ─── Sign-off by the technician (workflow E, decision of 15 Oct 2026) ────────

type Completion = {
  diagnosis: string | null;
  resolution: string;
  outcome: "REPAIRED" | "NO_FAULT_FOUND" | "NOT_REPAIRABLE" | "CHECKS_PASSED" | "CHECKS_FAILED";
  functionalCheck: "PASS" | "FAIL" | "NOT_APPLICABLE";
  electricalSafetyCheck: "PASS" | "FAIL" | "NOT_APPLICABLE";
  checkNotes: string | null;
  failureCategory?: string | null;
  results: {
    item: ChecklistItem;
    result: "PASS" | "FAIL" | "NOT_APPLICABLE";
    value: number | null;
    notes: string | null;
  }[];
};

const fmtNum = (n: number) => String(Number(n.toFixed(4)));

/**
 * Checks a planned job's checklist answers against the checklist copied onto
 * the job. The summary checks and the outcome are DERIVED from the answers,
 * so a failed item can never be signed off as a pass.
 */
function parsePlannedCompletion(
  input: unknown,
  checklist: ChecklistItem[],
  standard: { code: string | null; version: string | null },
): Completion {
  let data;
  try {
    data = parseInput(pmCompleteSchema, input);
  } catch (error) {
    // Show answer problems next to their checklist item ("answers.2.result" → "item_<key>").
    if (!(error instanceof ValidationError)) throw error;
    const raw = ((input as { answers?: { key?: unknown }[] })?.answers ?? []) as { key?: unknown }[];
    const mapped: Record<string, string[]> = {};
    for (const [field, messages] of Object.entries(error.fieldErrors)) {
      const m = /^answers\.(\d+)\./.exec(field);
      const key = m ? String(raw[Number(m[1])]?.key ?? "") : "";
      mapped[key ? `item_${key}` : field] = messages;
    }
    throw new ValidationError(error.message, mapped);
  }
  const answers = new Map(data.answers.map((a) => [a.key, a]));
  const errors: Record<string, string[]> = {};
  const results: Completion["results"] = [];
  for (const item of checklist) {
    const a = answers.get(item.key);
    const field = `item_${item.key}`;
    if (!a) {
      errors[field] = ["Answer this item"];
      continue;
    }
    if (a.result !== "NOT_APPLICABLE" && item.kind === "MEASUREMENT" && a.value === null) {
      errors[field] = [`Enter the measured value (${item.unit ?? "value"})`];
      continue;
    }
    if (a.value !== null && a.result === "PASS") {
      if ((item.min !== null && a.value < item.min) || (item.max !== null && a.value > item.max)) {
        errors[field] = [
          `${fmtNum(a.value)} ${item.unit ?? ""} is outside the limits (${item.min ?? "—"} to ${item.max ?? "—"}): record it as Fail`.trim(),
        ];
        continue;
      }
    }
    if (a.result === "FAIL" && !a.notes) {
      errors[field] = ["Describe what failed"];
      continue;
    }
    if (a.result === "NOT_APPLICABLE" && item.required && !a.notes) {
      errors[field] = ["Say why this required item does not apply"];
      continue;
    }
    if (
      item.section === "ELECTRICAL_SAFETY" &&
      a.result !== "NOT_APPLICABLE" &&
      (!standard.code || !standard.version)
    ) {
      errors[field] = ["No verified test standard is recorded for this job; ask your engineering manager"];
      continue;
    }
    results.push({ item, result: a.result, value: a.value, notes: a.notes });
  }
  for (const key of answers.keys()) {
    if (!checklist.some((i) => i.key === key)) errors.answers = ["Unknown checklist item"];
  }
  if (Object.keys(errors).length) {
    throw new ValidationError("Some checklist answers need attention.", errors);
  }
  const summary = (section: string) => {
    const rs = results.filter((r) => r.item.section === section);
    if (rs.some((r) => r.result === "FAIL")) return "FAIL" as const;
    if (rs.some((r) => r.result === "PASS")) return "PASS" as const;
    return "NOT_APPLICABLE" as const;
  };
  const anyFail = results.some((r) => r.result === "FAIL");
  const es = summary("ELECTRICAL_SAFETY");
  return {
    diagnosis: data.diagnosis,
    resolution: data.resolution,
    outcome: anyFail ? "CHECKS_FAILED" : "CHECKS_PASSED",
    functionalCheck: summary("FUNCTIONAL"),
    electricalSafetyCheck: es,
    checkNotes:
      es === "NOT_APPLICABLE"
        ? "No electrical safety items in this checklist, or all marked not applicable"
        : `Electrical safety tested to ${standard.code} ${standard.version}`,
    results,
  };
}

const failedSummary = (c: Completion, section?: string) =>
  c.results
    .filter((r) => r.result === "FAIL" && (!section || r.item.section === section))
    .map(
      (r) =>
        `${r.item.label}${r.value !== null ? ` (${fmtNum(r.value)} ${r.item.unit ?? ""})`.replace(" )", ")") : ""}`,
    )
    .join("; ")
    .slice(0, 900);

export async function completeWorkOrder(ctx: AccessContext, input: unknown) {
  await requirePermission(ctx, "workorder.work", { entityType: "work_order" });
  const raw = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  return withTenant(tenant(ctx), async (tx) => {
    const wo = await loadScoped(ctx, tx, String(raw.id ?? ""), "workorder.complete");
    // Only the technician who did the job signs it off (also a database CHECK).
    await requireAssignee(ctx, wo, "workorder.complete");
    expectStatus(wo, ["IN_PROGRESS", "ON_HOLD"], "Only a started job can be signed off.");
    const job = await tx.workOrder.findUniqueOrThrow({
      where: { id: wo.id },
      select: {
        type: true,
        checklist: true,
        reopenCount: true,
        pmOccurrenceId: true,
        safetyHoldId: true,
        testStandardCode: true,
        testStandardVersion: true,
        hospital: { select: { timezone: true } },
      },
    });
    const checklist = Array.isArray(job.checklist) ? (job.checklist as unknown as ChecklistItem[]) : null;
    const c: Completion = checklist
      ? parsePlannedCompletion(input, checklist, { code: job.testStandardCode, version: job.testStandardVersion })
      : { ...parseInput(completeSchema, input), results: [] };

    const now = new Date();
    const r = await tx.workOrder.updateMany({
      where: { id: wo.id, status: { in: ["IN_PROGRESS", "ON_HOLD"] }, assignedToId: ctx.user.id },
      data: {
        status: "COMPLETED",
        diagnosis: c.diagnosis,
        resolution: c.resolution,
        outcome: c.outcome,
        functionalCheck: c.functionalCheck,
        electricalSafetyCheck: c.electricalSafetyCheck,
        checkNotes: c.checkNotes,
        // Stage 7: only repair jobs carry a fault category (also a database CHECK).
        failureCategory: job.type === "CORRECTIVE" ? ((c.failureCategory ?? null) as never) : null,
        signOffDeclaration: true,
        completedById: ctx.user.id,
        completedAt: now,
        holdReason: null,
        updatedById: ctx.user.id,
      },
    });
    if (r.count === 0) throw new ValidationError("This job changed while you were signing off. Reload and try again.");
    await addEvent(tx, ctx, wo.id, "COMPLETED", { fromStatus: wo.status, toStatus: "COMPLETED", note: c.outcome });
    // Stage 8: parts still only reserved (never issued) go back on the shelf.
    await releaseJobReservations(tx, ctx, wo.id, "job completed");

    // Checklist answers: append-only; a reopened job records a new attempt.
    if (c.results.length) {
      await tx.checklistResult.createMany({
        data: c.results.map((x) => ({
          organizationId: ctx.organization.id,
          workOrderId: wo.id,
          attempt: job.reopenCount,
          itemKey: x.item.key,
          label: x.item.label,
          section: x.item.section,
          result: x.result,
          value: x.value,
          unit: x.item.unit,
          lowerLimit: x.item.min,
          upperLimit: x.item.max,
          notes: x.notes,
          testStandardCode: x.item.section === "ELECTRICAL_SAFETY" ? job.testStandardCode : null,
          testStandardVersion: x.item.section === "ELECTRICAL_SAFETY" ? job.testStandardVersion : null,
          recordedById: ctx.user.id,
          recordedAt: now,
        })),
      });
    }

    const asset = await tx.asset.findUniqueOrThrow({
      where: { id: wo.assetId },
      select: { id: true, status: true, assetTag: true, archivedAt: true },
    });
    const esFailed = c.electricalSafetyCheck === "FAIL";
    const isRetest = Boolean(job.safetyHoldId) && job.type === "SAFETY_TEST";
    const isHoldRepair = Boolean(job.safetyHoldId) && job.type === "CORRECTIVE";
    let returnedToService = false;
    let safetyHoldPlaced = false;
    let correctiveCreated: string | null = null;

    if (isRetest) {
      // Retest of a safety hold: the hold decides; never back to service here.
      await onHoldRetestCompleted(
        tx,
        ctx,
        { id: wo.id, number: wo.number, safetyHoldId: job.safetyHoldId! },
        c.outcome === "CHECKS_PASSED",
        failedSummary(c) || "Retest failed",
      );
    } else if (esFailed) {
      // Decision of 15 Oct 2026: Failed Safety Test — Do Not Use.
      await placeSafetyHold(tx, ctx, {
        assetId: asset.id,
        failedWo: { id: wo.id, number: wo.number },
        summary: failedSummary(c, "ELECTRICAL_SAFETY") || c.checkNotes || "Electrical safety test failed",
        createRepair: c.outcome !== "NOT_REPAIRABLE",
      });
      safetyHoldPlaced = true;
    } else if (isHoldRepair) {
      await onHoldRepairCompleted(
        tx,
        ctx,
        { id: wo.id, number: wo.number, safetyHoldId: job.safetyHoldId! },
        c.outcome !== "NOT_REPAIRABLE",
      );
      if (c.outcome === "NOT_REPAIRABLE" && asset.status !== "OUT_OF_SERVICE") {
        await setAssetStatus(tx, ctx, asset, "OUT_OF_SERVICE", wo.id, `Not repairable (${wo.number})`);
      }
    } else if (c.outcome === "CHECKS_FAILED") {
      // Planned work found a fault: out of use, and a repair job through the normal workflow.
      const full = await tx.asset.findUniqueOrThrow({
        where: { id: asset.id },
        select: { id: true, assetTag: true, status: true, hospitalId: true, departmentId: true, name: true },
      });
      const repair = await createWorkOrderRecord(tx, ctx, {
        asset: full,
        type: "CORRECTIVE",
        priority: wo.safetyCritical ? "URGENT" : "HIGH",
        safetyCritical: wo.safetyCritical,
        outOfUse: true,
        description: `Fault found during ${wo.number}: ${failedSummary(c) || "a check failed"}`,
        reportedById: ctx.user.id,
        dueAt: dueFrom(now, wo.safetyCritical ? "URGENT" : "HIGH"),
        now,
        source: "pm_failed_check",
        outOfUseStatusReason: (n) => `Check failed during ${wo.number}; repair ${n}`,
        outOfUseDowntimeReason: (n) => `Check failed during ${wo.number} (${n})`,
      });
      correctiveCreated = repair.number;
      await notify(tx, ctx, await managersToAlert(tx, wo, wo.safetyCritical), {
        type: "workorder.reported",
        title: `Fault found during maintenance: ${asset.assetTag}`,
        body: `${repair.number} created from ${wo.number}`,
        link: `/work-orders/${repair.id}`,
        entityType: "work_order",
        entityId: repair.id,
      });
    } else if (c.outcome === "NOT_REPAIRABLE") {
      if (asset.status !== "OUT_OF_SERVICE") {
        await setAssetStatus(tx, ctx, asset, "OUT_OF_SERVICE", wo.id, `Not repairable (${wo.number})`);
      }
    } else if (
      c.outcome !== "CHECKS_PASSED" &&
      (asset.status === "OUT_OF_SERVICE" || asset.status === "UNDER_REPAIR")
    ) {
      // Stage 5: a repaired device returns to service on the technician's
      // sign-off — unless another open job took it out of use, or a safety
      // hold is open (setAssetStatus refuses; so does the database).
      // Passed planned maintenance never changes the device status by itself.
      const blocking = await tx.workOrder.count({
        where: { assetId: asset.id, id: { not: wo.id }, status: { in: OPEN }, outOfUse: true },
      });
      if (!blocking && !asset.archivedAt) {
        returnedToService = await setAssetStatus(
          tx,
          ctx,
          asset,
          "IN_SERVICE",
          wo.id,
          `Returned to service after ${wo.number}`,
        );
        if (returnedToService) await endDowntime(tx, asset.id);
      }
    }

    // The PM occurrence is done (on time = by the due date + grace days, hospital date).
    if (job.pmOccurrenceId) {
      const occ = await tx.pmOccurrence.findUnique({
        where: { id: job.pmOccurrenceId },
        select: { id: true, dueOn: true, scheduleId: true, plan: { select: { graceDays: true } } },
      });
      if (occ) {
        const doneOn = localToday(job.hospital.timezone, now);
        await tx.pmOccurrence.update({
          where: { id: occ.id },
          data: {
            status: "COMPLETED",
            completedOn: new Date(`${doneOn}T00:00:00.000Z`),
            onTime: isOnTime(fromDbDate(occ.dueOn), doneOn, occ.plan.graceDays),
          },
        });
        await tx.pmSchedule.update({
          where: { id: occ.scheduleId },
          data: { lastDoneOn: new Date(`${doneOn}T00:00:00.000Z`), updatedById: ctx.user.id },
        });
      }
    }

    await auditWO(tx, ctx, "workorder.completed", wo, {
      number: wo.number,
      outcome: c.outcome,
      functionalCheck: c.functionalCheck,
      electricalSafetyCheck: c.electricalSafetyCheck,
      checklistItems: c.results.length || undefined,
      testStandard: job.testStandardCode ? `${job.testStandardCode} ${job.testStandardVersion}` : undefined,
      signedOffBy: "assigned_technician",
      safetyCritical: wo.safetyCritical,
      returnedToService,
      safetyHoldPlaced: safetyHoldPlaced || undefined,
      correctiveCreated: correctiveCreated ?? undefined,
    });
    const reviewers = wo.safetyCritical ? await managersToAlert(tx, wo, false) : [];
    await notify(tx, ctx, [wo.reportedById, ...reviewers], {
      type: "workorder.completed",
      title: `${wo.number} completed${wo.safetyCritical ? " — safety-critical, please review" : ""}`,
      body: safetyHoldPlaced
        ? `${DO_NOT_USE_LABEL}: repair and retest required.`
        : c.outcome === "NOT_REPAIRABLE"
          ? "Device not repairable; it stays out of service."
          : c.outcome === "CHECKS_FAILED"
            ? `A check failed; repair job ${correctiveCreated ?? ""} created.`
            : undefined,
      link: `/work-orders/${wo.id}`,
      entityType: "work_order",
      entityId: wo.id,
    });
    return { returnedToService, safetyHoldPlaced };
  });
}

// ─── Manager actions after the fact ──────────────────────────────────────────

/** A manager confirms they have reviewed a technician's sign-off (never blocks the job). */
export async function reviewWorkOrder(ctx: AccessContext, input: unknown) {
  await requirePermission(ctx, "workorder.manage", { entityType: "work_order" });
  const { id } = parseInput(workOrderIdSchema, input);
  return withTenant(tenant(ctx), async (tx) => {
    const wo = await loadScoped(ctx, tx, id, "workorder.review");
    expectStatus(wo, ["COMPLETED"], "Only completed jobs can be reviewed.");
    if (wo.completedById === ctx.user.id) {
      throw new ValidationError("You signed this job off yourself; another manager should review it.");
    }
    const r = await tx.workOrder.updateMany({
      where: { id: wo.id, reviewedAt: null },
      data: { reviewedById: ctx.user.id, reviewedAt: new Date(), updatedById: ctx.user.id },
    });
    if (r.count === 0) throw new ValidationError("This job has already been reviewed.");
    await addEvent(tx, ctx, wo.id, "REVIEWED");
    await auditWO(tx, ctx, "workorder.reviewed", wo, { number: wo.number });
  });
}

// ─── Editing a completed job ─────────────────────────────────────────────────
//
// Decision of 24 Oct 2026 (Nadir): a completed job has one Edit button. The
// technician, biomedical engineer or manager who worked on the job (assigned
// to it, signed it off, or logged work on it) can fix mistakes in the
// diagnosis, the work done, the fault category and the work log. Nothing is
// shown on the job page or the printed job sheet about the edit.
//
// Kept on purpose (not visible to technicians): the earlier values in
// work_order_corrections and an audit log entry, so an audit can still see what
// a signed record said. Safety test results, the outcome, the declaration and
// the device status cannot be edited: a failed test must go through the
// safety hold and retest; a manager reopens the job if those are wrong.

type TaskRow = {
  id: string;
  description: string;
  minutes: number;
  performedById: string;
  createdAt: Date;
  correctsTaskId: string | null;
};

/** Lines of the work log as last edited, in the order they were first logged. */
export function effectiveTasks<T extends TaskRow>(rows: T[]) {
  const replaced = new Set(rows.map((r) => r.correctsTaskId).filter((x): x is string => Boolean(x)));
  return rows.filter((r) => !replaced.has(r.id)).sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
}

/** The people who worked on the job: assigned to it, signed it off, or logged work on it. */
async function requireWorkedOnJob(ctx: AccessContext, tx: Tx, wo: CoreWO, action: string) {
  const worked =
    can(ctx, "workorder.work") &&
    (wo.assignedToId === ctx.user.id ||
      wo.completedById === ctx.user.id ||
      (await tx.workOrderTask.count({ where: { workOrderId: wo.id, performedById: ctx.user.id } })) > 0);
  if (!worked) {
    await denied(ctx, wo.id, action, "did_not_work_on_this_job");
    throw new AuthorizationError(action);
  }
}

export async function editCompletedJob(ctx: AccessContext, input: unknown) {
  await requirePermission(ctx, "workorder.work", { entityType: "work_order" });
  const data = parseInput(editCompletedJobSchema, input);
  return withTenant(tenant(ctx), async (tx) => {
    const wo = await loadScoped(ctx, tx, data.id, "workorder.edit_completed");
    expectStatus(wo, ["COMPLETED"], "Only a completed job is edited this way.");
    await requireWorkedOnJob(ctx, tx, wo, "workorder.edit_completed");
    const job = await tx.workOrder.findUniqueOrThrow({
      where: { id: wo.id },
      select: { type: true, diagnosis: true, resolution: true, failureCategory: true },
    });
    const isRepair = job.type === "CORRECTIVE";
    const newCategory = isRepair ? data.failureCategory : null;
    const changes: {
      field: "DIAGNOSIS" | "RESOLUTION" | "FAILURE_CATEGORY";
      oldValue: string | null;
      newValue: string | null;
    }[] = [];
    if (data.diagnosis !== (job.diagnosis ?? "")) {
      changes.push({ field: "DIAGNOSIS", oldValue: job.diagnosis, newValue: data.diagnosis });
    }
    if (data.resolution !== (job.resolution ?? "")) {
      changes.push({ field: "RESOLUTION", oldValue: job.resolution, newValue: data.resolution });
    }
    if (isRepair && newCategory !== job.failureCategory) {
      changes.push({ field: "FAILURE_CATEGORY", oldValue: job.failureCategory, newValue: newCategory });
    }

    // Work log lines: only current lines of this job can be edited.
    const rows = await tx.workOrderTask.findMany({ where: { workOrderId: wo.id } });
    const current = new Map(effectiveTasks(rows).map((t) => [t.id, t]));
    const lineEdits = [];
    for (const l of data.lines) {
      const line = current.get(l.taskId);
      if (!line)
        throw new ValidationError("The work log changed while you were editing. Reload the page and try again.");
      if (line.description !== l.description || line.minutes !== l.minutes) lineEdits.push({ line, edit: l });
    }
    if (changes.length === 0 && lineEdits.length === 0) {
      throw new ValidationError("Nothing was changed.");
    }

    if (changes.length) {
      await tx.workOrder.update({
        where: { id: wo.id },
        data: {
          diagnosis: data.diagnosis,
          resolution: data.resolution,
          ...(isRepair ? { failureCategory: newCategory } : {}),
          updatedById: ctx.user.id,
        },
      });
      await tx.workOrderCorrection.createMany({
        data: changes.map((c) => ({
          organizationId: ctx.organization.id,
          workOrderId: wo.id,
          field: c.field,
          oldValue: c.oldValue,
          newValue: c.newValue,
          reason: data.reason,
          correctedById: ctx.user.id,
        })),
      });
    }
    for (const { line, edit } of lineEdits) {
      await tx.workOrderTask.create({
        data: {
          organizationId: ctx.organization.id,
          workOrderId: wo.id,
          description: edit.description,
          minutes: edit.minutes,
          performedById: line.performedById, // still credited to the person who did the work
          correctsTaskId: line.id,
          correctedById: ctx.user.id,
          correctionReason: data.reason,
          createdAt: line.createdAt, // keeps its place in the list and in reports by period
        },
      });
    }
    // Audit only (not shown on the job): which parts changed, never the text.
    await auditWO(tx, ctx, "workorder.edited_after_completion", wo, {
      number: wo.number,
      fields: changes.map((c) => c.field),
      workLogLines: lineEdits.length,
    });
    return { fields: changes.length, lines: lineEdits.length };
  });
}

export async function reopenWorkOrder(ctx: AccessContext, input: unknown) {
  await requirePermission(ctx, "workorder.manage", { entityType: "work_order" });
  const data = parseInput(reasonSchema, input);
  return withTenant(tenant(ctx), async (tx) => {
    const wo = await loadScoped(ctx, tx, data.id, "workorder.reopen");
    expectStatus(wo, ["COMPLETED"], "Only completed jobs can be reopened.");
    const job = await tx.workOrder.findUniqueOrThrow({
      where: { id: wo.id },
      select: { pmOccurrenceId: true, safetyHoldId: true, type: true, checklist: true },
    });
    // A retest waiting for second-person approval goes back to "awaiting retest".
    if (job.safetyHoldId && job.type === "SAFETY_TEST") {
      const hold = await tx.safetyHold.findUnique({
        where: { id: job.safetyHoldId },
        select: { status: true, retestWorkOrderId: true },
      });
      if (hold?.status === "RELEASED" && hold.retestWorkOrderId === wo.id) {
        throw new ValidationError("This retest led to an approved return to service and can no longer be reopened.");
      }
      if (hold?.status === "AWAITING_APPROVAL" && hold.retestWorkOrderId === wo.id) {
        await tx.safetyHold.update({
          where: { id: job.safetyHoldId },
          data: { status: "AWAITING_RETEST", retestedById: null, retestedAt: null },
        });
        await tx.safetyHoldEvent.create({
          data: {
            organizationId: ctx.organization.id,
            holdId: job.safetyHoldId,
            kind: "RETEST_REOPENED",
            workOrderId: wo.id,
            note: data.reason,
            actorId: ctx.user.id,
          },
        });
      }
    }
    if (job.pmOccurrenceId) {
      await tx.pmOccurrence.update({
        where: { id: job.pmOccurrenceId },
        data: { status: "WORK_ORDER_CREATED", completedOn: null, onTime: null },
      });
    }
    await tx.workOrder.update({
      where: { id: wo.id },
      data: {
        status: "IN_PROGRESS",
        outcome: null,
        functionalCheck: null,
        electricalSafetyCheck: null,
        signOffDeclaration: false,
        completedById: null,
        completedAt: null,
        reviewedById: null,
        reviewedAt: null,
        reopenCount: { increment: 1 },
        updatedById: ctx.user.id,
      },
    });
    const asset = await tx.asset.findUniqueOrThrow({
      where: { id: wo.assetId },
      select: { id: true, status: true, assetTag: true },
    });
    // Reopening a repair takes the device back; planned maintenance (with a
    // checklist) never changed the device status, so reopening it does not either.
    if (asset.status === "IN_SERVICE" && job.checklist === null) {
      await setAssetStatus(tx, ctx, asset, "UNDER_REPAIR", wo.id, `Job reopened (${wo.number})`);
      await startDowntime(tx, ctx, asset.id, wo.id, `Job reopened (${wo.number})`);
    }
    await addEvent(tx, ctx, wo.id, "REOPENED", { fromStatus: "COMPLETED", toStatus: "IN_PROGRESS", note: data.reason });
    await auditWO(tx, ctx, "workorder.reopened", wo, { number: wo.number });
    await notify(tx, ctx, [wo.assignedToId], {
      type: "workorder.reopened",
      title: `${wo.number} was reopened`,
      body: data.reason,
      link: `/work-orders/${wo.id}`,
      entityType: "work_order",
      entityId: wo.id,
    });
  });
}

export async function cancelWorkOrder(ctx: AccessContext, input: unknown) {
  await requirePermission(ctx, "workorder.view", { entityType: "work_order" });
  const data = parseInput(reasonSchema, input);
  return withTenant(tenant(ctx), async (tx) => {
    const wo = await loadScoped(ctx, tx, data.id, "workorder.cancel");
    const manager = can(ctx, "workorder.manage");
    const ownReport = wo.reportedById === ctx.user.id && wo.status === "REQUESTED" && can(ctx, "workorder.report");
    if (!manager && !ownReport) {
      await denied(ctx, wo.id, "workorder.cancel", "not_manager_or_own_new_report");
      throw new AuthorizationError("workorder.cancel");
    }
    expectStatus(wo, OPEN, "Only open jobs can be cancelled.");
    const job = await tx.workOrder.findUniqueOrThrow({
      where: { id: wo.id },
      select: { pmOccurrenceId: true, safetyHoldId: true },
    });
    if (job.safetyHoldId) {
      throw new ValidationError(
        "This job belongs to a Failed Safety Test hold and cannot be cancelled. Sign it off as Not repairable if the device cannot be fixed.",
      );
    }
    if (job.pmOccurrenceId) {
      // Counted as not done in maintenance compliance.
      await tx.pmOccurrence.update({
        where: { id: job.pmOccurrenceId },
        data: { status: "CANCELLED", note: data.reason },
      });
    }
    await tx.workOrder.update({
      where: { id: wo.id },
      data: {
        status: "CANCELLED",
        cancelledById: ctx.user.id,
        cancelledAt: new Date(),
        cancelReason: data.reason,
        updatedById: ctx.user.id,
      },
    });
    // The device status is NOT changed automatically: someone must confirm it is safe to use.
    await addEvent(tx, ctx, wo.id, "CANCELLED", { fromStatus: wo.status, toStatus: "CANCELLED", note: data.reason });
    // Stage 8: reserved parts go back on the shelf; issued parts stay issued until a return is recorded.
    await releaseJobReservations(tx, ctx, wo.id, "job cancelled");
    await auditWO(tx, ctx, "workorder.cancelled", wo, { number: wo.number });
    await notify(tx, ctx, [wo.assignedToId, wo.reportedById], {
      type: "workorder.cancelled",
      title: `${wo.number} was cancelled`,
      body: data.reason,
      link: `/work-orders/${wo.id}`,
      entityType: "work_order",
      entityId: wo.id,
    });
  });
}

// ─── Photos ──────────────────────────────────────────────────────────────────

const FORMAT_MIME = { jpeg: "image/jpeg", png: "image/png", webp: "image/webp" } as const;

function safeFilename(name: string, ext: string): string {
  const base = (name.split(/[\\/]/).pop() ?? "photo")
    .replace(/\.[^.]*$/, "")
    .replace(/[^A-Za-z0-9 _-]/g, "")
    .trim()
    .slice(0, 80);
  return `${base || "photo"}.${ext}`;
}

/**
 * Adds a photo to a job. The file is checked by actually decoding it (not by
 * its name or declared type), re-encoded so camera and GPS metadata are
 * removed, resized to at most 2048 px, and stored in the database.
 */
export async function addWorkOrderPhoto(
  ctx: AccessContext,
  workOrderId: string,
  file: { name: string; bytes: Uint8Array },
) {
  await requirePermission(ctx, "workorder.view", { entityType: "work_order" });
  if (file.bytes.byteLength === 0) throw new ValidationError("The file is empty.");
  if (file.bytes.byteLength > MAX_PHOTO_BYTES) throw new ValidationError("Photos must be 5 MB or smaller.");

  let processed: { data: Buffer; info: { width: number; height: number } };
  let format: keyof typeof FORMAT_MIME;
  try {
    const image = sharp(file.bytes, { limitInputPixels: 50_000_000, failOn: "error" });
    const meta = await image.metadata();
    if (meta.format !== "jpeg" && meta.format !== "png" && meta.format !== "webp") {
      throw new ValidationError("Only JPEG, PNG or WebP photos are accepted.");
    }
    format = meta.format;
    const pipeline = image.rotate().resize({ width: 2048, height: 2048, fit: "inside", withoutEnlargement: true });
    const encoded =
      format === "jpeg"
        ? pipeline.jpeg({ quality: 85, mozjpeg: true })
        : format === "png"
          ? pipeline.png({ compressionLevel: 9 })
          : pipeline.webp({ quality: 85 });
    processed = await encoded.toBuffer({ resolveWithObject: true });
  } catch (error) {
    if (error instanceof ValidationError) throw error;
    throw new ValidationError("This file is not a readable photo. Use a JPEG, PNG or WebP image.");
  }
  if (processed.data.byteLength > MAX_PHOTO_BYTES)
    throw new ValidationError("This photo is too large after processing.");

  return withTenant(tenant(ctx), async (tx) => {
    const wo = await loadScoped(ctx, tx, workOrderId, "workorder.photo");
    const manager = can(ctx, "workorder.manage");
    const isAssignee = wo.assignedToId === ctx.user.id && can(ctx, "workorder.work");
    const isReporter = wo.reportedById === ctx.user.id && can(ctx, "workorder.report");
    if (!manager && !isAssignee && !isReporter) {
      await denied(ctx, wo.id, "workorder.photo", "not_reporter_assignee_or_manager");
      throw new AuthorizationError("workorder.photo");
    }
    expectStatus(wo, OPEN, "Photos can only be added to open jobs.");
    // Lock the job row so two uploads at once cannot exceed the limit.
    await tx.$queryRaw`SELECT id FROM work_orders WHERE id = ${wo.id}::uuid FOR UPDATE`;
    const count = await tx.attachment.count({ where: { workOrderId: wo.id } });
    if (count >= MAX_PHOTOS) throw new ValidationError(`A job can have at most ${MAX_PHOTOS} photos.`);
    const sha256 = createHash("sha256").update(processed.data).digest("hex");
    const ext = format === "jpeg" ? "jpg" : format;
    const photo = await tx.attachment.create({
      data: {
        organizationId: ctx.organization.id,
        workOrderId: wo.id,
        filename: safeFilename(file.name, ext),
        mime: FORMAT_MIME[format],
        sizeBytes: processed.data.byteLength,
        sha256,
        width: processed.info.width,
        height: processed.info.height,
        content: Uint8Array.from(processed.data),
        uploadedById: ctx.user.id,
      },
      select: { id: true },
    });
    await addEvent(tx, ctx, wo.id, "PHOTO_ADDED");
    await auditWO(tx, ctx, "workorder.photo_added", wo, { number: wo.number, attachmentId: photo.id, sha256 });
    return photo;
  });
}

/** Returns a photo's bytes if the user may see the job. */
export async function getWorkOrderPhoto(ctx: AccessContext, workOrderId: string, photoId: string) {
  await requirePermission(ctx, "workorder.view", { entityType: "work_order" });
  if (!UUID.test(photoId)) throw new NotFoundError("Photo");
  return withTenant(tenant(ctx), async (tx) => {
    const wo = await loadScoped(ctx, tx, workOrderId, "workorder.photo_view");
    const photo = await tx.attachment.findFirst({
      where: { id: photoId, workOrderId: wo.id },
      select: { content: true, mime: true, filename: true, sha256: true },
    });
    if (!photo) throw new NotFoundError("Photo");
    return photo;
  });
}

// ─── Used by the asset register ──────────────────────────────────────────────

export async function openWorkOrderNumbers(tx: Tx, assetId: string): Promise<string[]> {
  const rows = await tx.workOrder.findMany({
    where: { assetId, status: { in: OPEN } },
    select: { number: true },
    orderBy: { createdAt: "asc" },
  });
  return rows.map((r) => r.number);
}
