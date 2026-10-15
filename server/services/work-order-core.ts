// Shared work order internals (Stage 5 logic, shared from Stage 6).
//
// Fault reports, preventive maintenance generation and safety holds all create
// and update work orders through THESE functions, so there is one work order
// system with one numbering, timeline, audit and asset-status behaviour.
//
// Functions here assume the caller has ALREADY checked permission and scope
// and is inside `withTenant` (RLS). They are never called from the browser.
import type { AssetStatus, Prisma, WorkOrderPriority, WorkOrderStatus, WorkOrderType } from "../db/generated/client";
import type { Tx } from "../db/tenant";
import { audit, type RequestMeta } from "../audit/audit";
import { findStaff } from "./notifications";
import { PRIORITY_TARGET_HOURS, OPEN_STATUSES } from "@/lib/validation/work-orders";

/** Who is acting: a signed-in person (an AccessContext fits) or the scheduler. */
export type Actor = { user: { id: string }; organization: { id: string }; request?: RequestMeta };

/** Actor id recorded for work done by the PM scheduler (no person pressed a button). */
export const SYSTEM_SCHEDULER = "system:pm-scheduler";
export const SYSTEM_LABEL = "BiomedIntel.ai scheduler";

export const systemActor = (organizationId: string): Actor => ({
  user: { id: SYSTEM_SCHEDULER },
  organization: { id: organizationId },
});

export const isSystemActor = (actor: Actor) => actor.user.id.startsWith("system:");
/** Audit rows record no user id for the scheduler (metadata says who). */
export const auditActorId = (actor: Actor) => (isSystemActor(actor) ? null : actor.user.id);

export const OPEN: WorkOrderStatus[] = [...OPEN_STATUSES];
export const WORKER_ROLES = ["TECHNICIAN", "ENGINEERING_MANAGER"] as const;

export const dueFrom = (from: Date, priority: WorkOrderPriority) =>
  new Date(from.getTime() + PRIORITY_TARGET_HOURS[priority] * 3600_000);

export async function addEvent(
  tx: Tx,
  actor: Actor,
  workOrderId: string,
  kind: string,
  extra: { fromStatus?: WorkOrderStatus; toStatus?: WorkOrderStatus; note?: string | null } = {},
) {
  await tx.workOrderEvent.create({
    data: {
      organizationId: actor.organization.id,
      workOrderId,
      kind,
      fromStatus: extra.fromStatus ?? null,
      toStatus: extra.toStatus ?? null,
      note: extra.note ?? null,
      actorId: actor.user.id,
    },
  });
}

export function auditWO(tx: Tx, actor: Actor, action: string, wo: { id: string }, metadata: Record<string, unknown>) {
  return audit(tx, {
    organizationId: actor.organization.id,
    actorUserId: auditActorId(actor),
    action,
    entityType: "work_order",
    entityId: wo.id,
    metadata: isSystemActor(actor) ? { ...metadata, actor: "scheduler" } : metadata,
    request: actor.request,
  });
}

/** Is there an open "Failed Safety Test — Do Not Use" hold on this asset? */
export async function openSafetyHold(tx: Tx, assetId: string) {
  return tx.safetyHold.findFirst({
    where: { assetId, status: { not: "RELEASED" } },
    select: { id: true, status: true, failedWorkOrderId: true },
  });
}

/**
 * Changes the asset's operational status because of a job, with history and
 * audit. Returning a device to service while a safety hold is open is
 * refused here AND by a database trigger.
 */
export async function setAssetStatus(
  tx: Tx,
  actor: Actor,
  asset: { id: string; status: AssetStatus; assetTag: string },
  to: AssetStatus,
  workOrderId: string | null,
  reason: string,
) {
  if (asset.status === to || asset.status === "DECOMMISSIONED") return false;
  if (to === "IN_SERVICE" && (await openSafetyHold(tx, asset.id))) return false;
  await tx.asset.updateMany({ where: { id: asset.id }, data: { status: to, updatedById: actor.user.id } });
  await tx.assetStatusHistory.create({
    data: {
      organizationId: actor.organization.id,
      assetId: asset.id,
      fromStatus: asset.status,
      toStatus: to,
      reason,
      changedById: actor.user.id,
      workOrderId,
    },
  });
  await audit(tx, {
    organizationId: actor.organization.id,
    actorUserId: auditActorId(actor),
    action: to === "IN_SERVICE" ? "asset.returned_to_service" : "asset.status_changed",
    entityType: "asset",
    entityId: asset.id,
    metadata: { from: asset.status, to, assetTag: asset.assetTag, workOrderId },
    request: actor.request,
  });
  asset.status = to;
  return true;
}

export async function startDowntime(tx: Tx, actor: Actor, assetId: string, workOrderId: string, reason: string) {
  const open = await tx.downtimeEvent.findFirst({ where: { assetId, endedAt: null }, select: { id: true } });
  if (!open) {
    await tx.downtimeEvent.create({
      data: { organizationId: actor.organization.id, assetId, workOrderId, reason },
    });
  }
}

export async function endDowntime(tx: Tx, assetId: string) {
  await tx.downtimeEvent.updateMany({ where: { assetId, endedAt: null }, data: { endedAt: new Date() } });
}

/** Next number per organisation and year: WO-2026-00001. Concurrency-safe (row lock). */
export async function nextNumber(tx: Tx, organizationId: string, now: Date): Promise<string> {
  const year = now.getUTCFullYear();
  const rows = await tx.$queryRaw<{ last_number: number }[]>`
    INSERT INTO work_order_counters (organization_id, year, last_number)
    VALUES (${organizationId}::uuid, ${year}, 1)
    ON CONFLICT (organization_id, year) DO UPDATE SET last_number = work_order_counters.last_number + 1
    RETURNING last_number`;
  return `WO-${year}-${String(rows[0].last_number).padStart(5, "0")}`;
}

/** Engineering managers (and admins for safety-critical jobs) covering a job's location. */
export async function managersToAlert(
  tx: Tx,
  wo: { hospitalId: string; departmentId: string },
  safetyCritical: boolean,
) {
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

/** True if this person is a technician or engineering manager covering the location. */
export async function isEligibleAssignee(
  tx: Tx,
  where: { hospitalId: string; departmentId: string },
  userId: string,
): Promise<boolean> {
  const staff = await findStaff(tx, { ...where, roles: [...WORKER_ROLES] });
  return staff.some((s) => s.userId === userId);
}

export type NewWorkOrder = {
  asset: { id: string; assetTag: string; status: AssetStatus; hospitalId: string; departmentId: string };
  type: WorkOrderType;
  priority: WorkOrderPriority;
  safetyCritical: boolean;
  outOfUse: boolean;
  description: string;
  reportedById: string;
  /** Already validated by the caller (eligible for the asset's department). */
  assigneeId?: string | null;
  dueAt: Date;
  now: Date;
  pmOccurrenceId?: string;
  planRevisionId?: string;
  checklist?: Prisma.InputJsonValue;
  testStandard?: { id: string; code: string; version: string } | null;
  safetyHoldId?: string;
  /** Short words for the timeline and audit, e.g. "pm", "fault", "safety_hold_repair". */
  source: string;
  /** Reasons recorded when the device is taken out of use (defaults are generic). */
  outOfUseStatusReason?: (number: string) => string;
  outOfUseDowntimeReason?: (number: string) => string;
  auditExtra?: Record<string, unknown>;
};

/**
 * Creates a work order: number, record, timeline, optional assignment,
 * taking the device out of use (with downtime), and the audit event.
 * Notifications are left to the caller, who knows who should hear about it.
 */
export async function createWorkOrderRecord(tx: Tx, actor: Actor, input: NewWorkOrder) {
  const number = await nextNumber(tx, actor.organization.id, input.now);
  const status: WorkOrderStatus = input.assigneeId ? "ASSIGNED" : "REQUESTED";
  const wo = await tx.workOrder.create({
    data: {
      organizationId: actor.organization.id,
      number,
      assetId: input.asset.id,
      hospitalId: input.asset.hospitalId,
      departmentId: input.asset.departmentId,
      type: input.type,
      priority: input.priority,
      status,
      safetyCritical: input.safetyCritical,
      outOfUse: input.outOfUse,
      faultDescription: input.description.slice(0, 4000),
      reportedById: input.reportedById,
      assignedToId: input.assigneeId ?? null,
      assignedById: input.assigneeId ? actor.user.id : null,
      assignedAt: input.assigneeId ? input.now : null,
      dueAt: input.dueAt,
      pmOccurrenceId: input.pmOccurrenceId ?? null,
      planRevisionId: input.planRevisionId ?? null,
      checklist: input.checklist,
      testStandardId: input.testStandard?.id ?? null,
      testStandardCode: input.testStandard?.code ?? null,
      testStandardVersion: input.testStandard?.version ?? null,
      safetyHoldId: input.safetyHoldId ?? null,
      updatedById: actor.user.id,
      createdAt: input.now, // same moment the target time is measured from
    },
    select: { id: true, number: true, hospitalId: true, departmentId: true, assignedToId: true },
  });
  await addEvent(tx, actor, wo.id, "CREATED", {
    toStatus: "REQUESTED",
    note: input.source === "fault" ? null : input.source,
  });
  if (input.assigneeId) await addEvent(tx, actor, wo.id, "ASSIGNED", { fromStatus: "REQUESTED", toStatus: "ASSIGNED" });
  if (input.outOfUse) {
    const statusReason = input.outOfUseStatusReason?.(number) ?? `Taken out of use (${number})`;
    const downtimeReason = input.outOfUseDowntimeReason?.(number) ?? `Out of use (${number})`;
    await setAssetStatus(tx, actor, input.asset, "OUT_OF_SERVICE", wo.id, statusReason);
    await startDowntime(tx, actor, input.asset.id, wo.id, downtimeReason);
  }
  await auditWO(tx, actor, "workorder.requested", wo, {
    number,
    assetTag: input.asset.assetTag,
    type: input.type,
    priority: input.priority,
    safetyCritical: input.safetyCritical,
    outOfUse: input.outOfUse,
    source: input.source,
    assigneeId: input.assigneeId ?? undefined,
    ...input.auditExtra,
  });
  return wo;
}

/** Names for ids shown on screen; the scheduler gets a readable label. */
export async function peopleNames(tx: Tx, ids: (string | null | undefined)[]): Promise<Record<string, string>> {
  const unique = [...new Set(ids.filter((i): i is string => Boolean(i)))];
  const out: Record<string, string> = {};
  for (const id of unique) if (id.startsWith("system:")) out[id] = SYSTEM_LABEL;
  const people = unique.filter((i) => !i.startsWith("system:"));
  if (people.length) {
    const rows = await tx.user.findMany({ where: { id: { in: people } }, select: { id: true, name: true } });
    for (const p of rows) out[p.id] = p.name;
  }
  return out;
}
