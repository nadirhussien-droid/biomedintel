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
import type { Prisma, WorkOrderPriority, WorkOrderStatus, AssetStatus } from "../db/generated/client";
import { withTenant, type Tx } from "../db/tenant";
import { audit, auditStandalone } from "../audit/audit";
import { can, requirePermission, type AccessContext } from "../authz/access";
import { AuthorizationError, NotFoundError, ValidationError } from "../authz/errors";
import { parseInput } from "../validation";
import { assetScopeWhere } from "./assets";
import { findStaff, notify } from "./notifications";
import {
  assignSchema,
  completeSchema,
  holdSchema,
  logWorkSchema,
  MAX_PHOTO_BYTES,
  MAX_PHOTOS,
  noteSchema,
  OPEN_STATUSES,
  PRIORITY_TARGET_HOURS,
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
const OPEN: WorkOrderStatus[] = [...OPEN_STATUSES];
const WORKER_ROLES = ["TECHNICIAN", "ENGINEERING_MANAGER"] as const;

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

const dueFrom = (from: Date, priority: WorkOrderPriority) =>
  new Date(from.getTime() + PRIORITY_TARGET_HOURS[priority] * 3600_000);

async function addEvent(
  tx: Tx,
  ctx: AccessContext,
  workOrderId: string,
  kind: string,
  extra: { fromStatus?: WorkOrderStatus; toStatus?: WorkOrderStatus; note?: string | null } = {},
) {
  await tx.workOrderEvent.create({
    data: {
      organizationId: ctx.organization.id,
      workOrderId,
      kind,
      fromStatus: extra.fromStatus ?? null,
      toStatus: extra.toStatus ?? null,
      note: extra.note ?? null,
      actorId: ctx.user.id,
    },
  });
}

function auditWO(tx: Tx, ctx: AccessContext, action: string, wo: { id: string }, metadata: Record<string, unknown>) {
  return audit(tx, {
    organizationId: ctx.organization.id,
    actorUserId: ctx.user.id,
    action,
    entityType: "work_order",
    entityId: wo.id,
    metadata,
    request: ctx.request,
  });
}

/** Changes the asset's operational status because of a job, with history and audit. */
async function setAssetStatus(
  tx: Tx,
  ctx: AccessContext,
  asset: { id: string; status: AssetStatus; assetTag: string },
  to: AssetStatus,
  workOrderId: string,
  reason: string,
) {
  if (asset.status === to || asset.status === "DECOMMISSIONED") return;
  await tx.asset.updateMany({ where: { id: asset.id }, data: { status: to, updatedById: ctx.user.id } });
  await tx.assetStatusHistory.create({
    data: {
      organizationId: ctx.organization.id,
      assetId: asset.id,
      fromStatus: asset.status,
      toStatus: to,
      reason,
      changedById: ctx.user.id,
      workOrderId,
    },
  });
  await audit(tx, {
    organizationId: ctx.organization.id,
    actorUserId: ctx.user.id,
    action: to === "IN_SERVICE" ? "asset.returned_to_service" : "asset.status_changed",
    entityType: "asset",
    entityId: asset.id,
    metadata: { from: asset.status, to, assetTag: asset.assetTag, workOrderId },
    request: ctx.request,
  });
}

async function startDowntime(tx: Tx, ctx: AccessContext, assetId: string, workOrderId: string, reason: string) {
  const open = await tx.downtimeEvent.findFirst({ where: { assetId, endedAt: null }, select: { id: true } });
  if (!open) {
    await tx.downtimeEvent.create({
      data: { organizationId: ctx.organization.id, assetId, workOrderId, reason },
    });
  }
}

async function endDowntime(tx: Tx, assetId: string) {
  await tx.downtimeEvent.updateMany({ where: { assetId, endedAt: null }, data: { endedAt: new Date() } });
}

/** Next number per organisation and year: WO-2026-00001. Concurrency-safe (row lock). */
async function nextNumber(tx: Tx, ctx: AccessContext, now: Date): Promise<string> {
  const year = now.getUTCFullYear();
  const rows = await tx.$queryRaw<{ last_number: number }[]>`
    INSERT INTO work_order_counters (organization_id, year, last_number)
    VALUES (${ctx.organization.id}::uuid, ${year}, 1)
    ON CONFLICT (organization_id, year) DO UPDATE SET last_number = work_order_counters.last_number + 1
    RETURNING last_number`;
  return `WO-${year}-${String(rows[0].last_number).padStart(5, "0")}`;
}

async function managersToAlert(tx: Tx, wo: { hospitalId: string; departmentId: string }, safetyCritical: boolean) {
  const staff = await findStaff(tx, {
    hospitalId: wo.hospitalId,
    departmentId: wo.departmentId,
    roles: safetyCritical ? ["ENGINEERING_MANAGER", "ORG_ADMIN", "TECHNICIAN"] : ["ENGINEERING_MANAGER", "TECHNICIAN"],
  });
  const managers = staff.filter((s) => s.role === "ENGINEERING_MANAGER").map((s) => s.userId);
  const admins = staff.filter((s) => s.role === "ORG_ADMIN").map((s) => s.userId);
  // Hospitals without an engineering manager: tell the technicians instead.
  const fallback = managers.length ? [] : staff.filter((s) => s.role === "TECHNICIAN").map((s) => s.userId);
  return [...managers, ...admins, ...fallback];
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

    const existing = await tx.workOrder.findFirst({
      where: { assetId: asset.id, status: { in: OPEN } },
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
    const number = await nextNumber(tx, ctx, now);
    const wo = await tx.workOrder.create({
      data: {
        organizationId: ctx.organization.id,
        number,
        assetId: asset.id,
        hospitalId: asset.hospitalId,
        departmentId: asset.departmentId,
        type: "CORRECTIVE",
        priority,
        status: "REQUESTED",
        safetyCritical,
        outOfUse: data.outOfUse,
        faultDescription: data.faultDescription,
        reportedById: ctx.user.id,
        dueAt: dueFrom(now, priority),
        updatedById: ctx.user.id,
        createdAt: now, // same moment the target time is measured from
      },
      select: { id: true, number: true, hospitalId: true, departmentId: true },
    });
    await addEvent(tx, ctx, wo.id, "CREATED", { toStatus: "REQUESTED" });
    if (data.outOfUse) {
      await setAssetStatus(tx, ctx, asset, "OUT_OF_SERVICE", wo.id, `Taken out of use: fault reported (${number})`);
      await startDowntime(tx, ctx, asset.id, wo.id, `Fault reported (${number})`);
    }
    await auditWO(tx, ctx, "workorder.requested", wo, {
      number,
      assetTag: asset.assetTag,
      priority,
      safetyCritical,
      outOfUse: data.outOfUse,
      duplicateConfirmed: existing ? true : undefined,
    });
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

async function peopleNames(tx: Tx, ids: (string | null | undefined)[]): Promise<Record<string, string>> {
  const unique = [...new Set(ids.filter((i): i is string => Boolean(i)))];
  if (!unique.length) return {};
  const people = await tx.user.findMany({ where: { id: { in: unique } }, select: { id: true, name: true } });
  return Object.fromEntries(people.map((p) => [p.id, p.name]));
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
            model: { select: { modelName: true, manufacturer: { select: { name: true } } } },
            location: { select: { name: true } },
          },
        },
        hospital: { select: { name: true, code: true } },
        department: { select: { name: true } },
        events: { orderBy: { createdAt: "asc" } },
        tasks: { orderBy: { createdAt: "asc" } },
        attachments: {
          orderBy: { createdAt: "asc" },
          select: { id: true, filename: true, mime: true, sizeBytes: true, width: true, height: true, createdAt: true },
        },
        downtime: { orderBy: { startedAt: "asc" } },
      },
    });
    const names = await peopleNames(tx, [
      wo.reportedById,
      wo.assignedToId,
      wo.assignedById,
      wo.completedById,
      wo.reviewedById,
      wo.cancelledById,
      ...wo.events.map((e) => e.actorId),
      ...wo.tasks.map((t) => t.performedById),
    ]);

    const manage = can(ctx, "workorder.manage");
    const isAssignee = wo.assignedToId === ctx.user.id && can(ctx, "workorder.work");
    const open = OPEN.includes(wo.status);
    const candidates = manage && open ? await assigneeCandidates(tx, wo) : [];
    const totalMinutes = wo.tasks.reduce((sum, t) => sum + t.minutes, 0);
    return {
      ...wo,
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
        cancel: open && (manage || (wo.reportedById === ctx.user.id && wo.status === "REQUESTED")),
        reopen: manage && wo.status === "COMPLETED",
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

export async function completeWorkOrder(ctx: AccessContext, input: unknown) {
  await requirePermission(ctx, "workorder.work", { entityType: "work_order" });
  const raw = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  return withTenant(tenant(ctx), async (tx) => {
    const wo = await loadScoped(ctx, tx, String(raw.id ?? ""), "workorder.complete");
    // Only the technician who did the job signs it off (also a database CHECK).
    await requireAssignee(ctx, wo, "workorder.complete");
    expectStatus(wo, ["IN_PROGRESS", "ON_HOLD"], "Only a started job can be signed off.");
    const data = parseInput(completeSchema, input);
    const now = new Date();
    const r = await tx.workOrder.updateMany({
      where: { id: wo.id, status: { in: ["IN_PROGRESS", "ON_HOLD"] }, assignedToId: ctx.user.id },
      data: {
        status: "COMPLETED",
        diagnosis: data.diagnosis,
        resolution: data.resolution,
        outcome: data.outcome,
        functionalCheck: data.functionalCheck,
        electricalSafetyCheck: data.electricalSafetyCheck,
        checkNotes: data.checkNotes,
        signOffDeclaration: true,
        completedById: ctx.user.id,
        completedAt: now,
        holdReason: null,
        updatedById: ctx.user.id,
      },
    });
    if (r.count === 0) throw new ValidationError("This job changed while you were signing off. Reload and try again.");
    await addEvent(tx, ctx, wo.id, "COMPLETED", { fromStatus: wo.status, toStatus: "COMPLETED", note: data.outcome });

    const asset = await tx.asset.findUniqueOrThrow({
      where: { id: wo.assetId },
      select: { id: true, status: true, assetTag: true, archivedAt: true },
    });
    let returnedToService = false;
    if (data.outcome === "NOT_REPAIRABLE") {
      if (asset.status !== "OUT_OF_SERVICE") {
        await setAssetStatus(tx, ctx, asset, "OUT_OF_SERVICE", wo.id, `Not repairable (${wo.number})`);
      }
    } else if (asset.status === "OUT_OF_SERVICE" || asset.status === "UNDER_REPAIR") {
      // Another open job that took the device out of use keeps it out.
      const blocking = await tx.workOrder.count({
        where: { assetId: asset.id, id: { not: wo.id }, status: { in: OPEN }, outOfUse: true },
      });
      if (!blocking && !asset.archivedAt) {
        await setAssetStatus(tx, ctx, asset, "IN_SERVICE", wo.id, `Returned to service after ${wo.number}`);
        await endDowntime(tx, asset.id);
        returnedToService = true;
      }
    }
    await auditWO(tx, ctx, "workorder.completed", wo, {
      number: wo.number,
      outcome: data.outcome,
      functionalCheck: data.functionalCheck,
      electricalSafetyCheck: data.electricalSafetyCheck,
      signedOffBy: "assigned_technician",
      safetyCritical: wo.safetyCritical,
      returnedToService,
    });
    const reviewers = wo.safetyCritical ? await managersToAlert(tx, wo, false) : [];
    await notify(tx, ctx, [wo.reportedById, ...reviewers], {
      type: "workorder.completed",
      title: `${wo.number} completed${wo.safetyCritical ? " — safety-critical, please review" : ""}`,
      body: data.outcome === "NOT_REPAIRABLE" ? "Device not repairable; it stays out of service." : undefined,
      link: `/work-orders/${wo.id}`,
      entityType: "work_order",
      entityId: wo.id,
    });
    return { returnedToService };
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

export async function reopenWorkOrder(ctx: AccessContext, input: unknown) {
  await requirePermission(ctx, "workorder.manage", { entityType: "work_order" });
  const data = parseInput(reasonSchema, input);
  return withTenant(tenant(ctx), async (tx) => {
    const wo = await loadScoped(ctx, tx, data.id, "workorder.reopen");
    expectStatus(wo, ["COMPLETED"], "Only completed jobs can be reopened.");
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
    if (asset.status === "IN_SERVICE") {
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
