// Preventive maintenance plans (Stage 6).
//
// Same pattern as every BiomedIntel.ai service: requirePermission → parseInput
// → scope check → withTenant (RLS) → audit, in one transaction.
//
// Interval rules (decision of 15 Oct 2026), in priority order:
//   1. a regulatory or organisational requirement (with its reference);
//   2. the manufacturer's interval for the specific model (recorded on the model);
//   3. an organisation-defined interval, ONLY where no manufacturer guidance
//      exists, with a written justification.
// Every plan starts as a DRAFT and generates nothing until an Engineering
// Manager approves it. Each approval and review is an append-only revision
// (source, approver, effective date). Equipment without an approved plan is
// listed for review; BiomedIntel.ai never invents a schedule (the category
// "default PM interval" from Stage 4 is shown as a hint only).
import type { Prisma } from "../db/generated/client";
import { withTenant, type Tx } from "../db/tenant";
import { audit, auditStandalone } from "../audit/audit";
import { can, requireHospitalAccess, requirePermission, type AccessContext } from "../authz/access";
import { NotFoundError, ValidationError } from "../authz/errors";
import { parseInput } from "../validation";
import { assetScopeWhere } from "./assets";
import { hasVerifiedStandard } from "./test-standards";
import { peopleNames, WORKER_ROLES } from "./work-order-core";
import {
  addDays,
  firstIndexOnOrAfter,
  dueDate,
  fromDbDate,
  intervalLabel,
  localToday,
  toDbDate,
  type IntervalUnitValue,
} from "@/lib/pm/dates";
import {
  approvePlanSchema,
  archivePlanSchema,
  endScheduleSchema,
  enrolSchema,
  hasElectricalSafety,
  modelIntervalSchema,
  pausePlanSchema,
  planIdSchema,
  planQuerySchema,
  planSchema,
  reviewPlanSchema,
  type ChecklistItem,
  type PlanInput,
} from "@/lib/validation/pm";

const tenant = (ctx: AccessContext) => ({ userId: ctx.user.id, organizationId: ctx.organization.id });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const PLAN_PAGE_SIZE = 25;

/** Plans the user may see: organisation-wide plans, and plans for their hospitals. */
export function planScopeWhere(ctx: AccessContext): Prisma.MaintenancePlanWhereInput {
  if (ctx.orgWide) return {};
  return { OR: [{ hospitalId: null }, { hospitalId: { in: ctx.hospitals.map((h) => h.id) } }] };
}

/** Plans the user may CHANGE: org-wide plans need org-wide staff. */
function canChangePlan(ctx: AccessContext, plan: { hospitalId: string | null }) {
  return plan.hospitalId === null ? ctx.orgWide : ctx.hospitals.some((h) => h.id === plan.hospitalId);
}

async function denied(ctx: AccessContext, entityId: string | undefined, attemptedAction: string, reason: string) {
  await auditStandalone({
    organizationId: ctx.organization.id,
    actorUserId: ctx.user.id,
    action: "pm.access_denied",
    outcome: "DENIED",
    entityType: "maintenance_plan",
    entityId,
    metadata: { attemptedAction, reason, role: ctx.role },
    request: ctx.request,
  });
}

function auditPlan(tx: Tx, ctx: AccessContext, action: string, planId: string, metadata: Record<string, unknown>) {
  return audit(tx, {
    organizationId: ctx.organization.id,
    actorUserId: ctx.user.id,
    action,
    entityType: "maintenance_plan",
    entityId: planId,
    metadata,
    request: ctx.request,
  });
}

async function loadPlan(ctx: AccessContext, tx: Tx, id: string, action: string, forChange = false) {
  if (!UUID.test(id)) throw new NotFoundError("Maintenance plan");
  const plan = await tx.maintenancePlan.findFirst({ where: { AND: [{ id }, planScopeWhere(ctx)] } });
  if (!plan || (forChange && !canChangePlan(ctx, plan))) {
    await denied(ctx, id, action, plan ? "plan_outside_change_scope" : "not_found_or_outside_scope");
    throw new NotFoundError("Maintenance plan");
  }
  return plan;
}

type PlanRow = Awaited<ReturnType<typeof loadPlan>>;

// ─── Validation against the database ─────────────────────────────────────────

/**
 * Resolves and checks the plan target; returns the model ids it covers.
 * `approval`: re-checking a stored plan at approval time — the target must
 * still exist and be active in the organisation, but the writer's scope rules
 * (which hospital, which assets the approver can see) do not apply.
 */
async function checkTarget(ctx: AccessContext, tx: Tx, d: PlanInput, opts: { approval?: boolean } = {}) {
  if (opts.approval) {
    // nothing: scope was checked when the plan was written
  } else if (d.hospitalId) await requireHospitalAccess(ctx, d.hospitalId);
  else if (!ctx.orgWide) {
    throw new ValidationError("Choose the hospital this plan is for.", {
      hospitalId: ["Only organisation-wide staff can write plans for every hospital"],
    });
  }
  if (d.targetKind === "ASSET") {
    const asset = await tx.asset.findFirst({
      where: { AND: [{ id: d.targetId }, opts.approval ? {} : assetScopeWhere(ctx)] },
      select: { id: true, hospitalId: true, modelId: true, status: true, archivedAt: true, assetTag: true },
    });
    if (!asset) throw new ValidationError("Choose an asset you can access.", { targetId: ["Unknown asset"] });
    if (asset.archivedAt || asset.status === "DECOMMISSIONED") {
      throw new ValidationError("This asset is archived or decommissioned.", { targetId: ["Not an active asset"] });
    }
    if (d.hospitalId && asset.hospitalId !== d.hospitalId) {
      throw new ValidationError("This asset is in a different hospital.", { targetId: ["Different hospital"] });
    }
    return { modelIds: [asset.modelId], label: asset.assetTag };
  }
  if (d.targetKind === "MODEL") {
    const model = await tx.equipmentModel.findFirst({
      where: { id: d.targetId, status: "ACTIVE" },
      select: { id: true, modelName: true },
    });
    if (!model) throw new ValidationError("Choose an active model.", { targetId: ["Unknown model"] });
    return { modelIds: [model.id], label: model.modelName };
  }
  if (d.targetKind === "DEPARTMENT") {
    // The schema guarantees a hospital for a department plan; the department must belong to it
    // and, for a writer, be inside the writer's scope.
    const dept = await tx.department.findFirst({
      where: { id: d.targetId, hospitalId: d.hospitalId!, status: "ACTIVE" },
      select: { id: true, name: true, hospitalId: true },
    });
    if (!dept) {
      throw new ValidationError("Choose an active department of this hospital.", {
        targetId: ["Unknown department for this hospital"],
      });
    }
    if (!opts.approval) await requireHospitalAccess(ctx, dept.hospitalId, dept.id);
    const inDept = await tx.asset.findMany({
      where: { departmentId: dept.id, archivedAt: null, status: { not: "DECOMMISSIONED" } },
      select: { modelId: true },
      distinct: ["modelId"],
    });
    return { modelIds: inDept.map((a) => a.modelId), label: dept.name };
  }
  const cat = await tx.equipmentCategory.findFirst({
    where: { id: d.targetId, status: "ACTIVE" },
    select: { id: true, name: true, models: { where: { status: "ACTIVE" }, select: { id: true } } },
  });
  if (!cat) throw new ValidationError("Choose an active category.", { targetId: ["Unknown category"] });
  return { modelIds: cat.models.map((m) => m.id), label: cat.name };
}

/** Enforces the interval priority rules against the manufacturer intervals on record. */
async function checkIntervalSource(tx: Tx, d: PlanInput, modelIds: string[]) {
  const models = await tx.equipmentModel.findMany({
    where: { id: { in: modelIds } },
    select: {
      modelName: true,
      manufacturerPmIntervalCount: true,
      manufacturerPmIntervalUnit: true,
      manufacturerPmReference: true,
    },
  });
  const guided = models.filter((m) => m.manufacturerPmIntervalCount !== null && m.manufacturerPmIntervalUnit !== null);
  if (d.intervalSource === "MANUFACTURER") {
    const m = guided[0];
    if (!m || d.targetKind === "CATEGORY") {
      throw new ValidationError(
        "No manufacturer interval is recorded for this model. Record it under Maintenance → Settings, or choose another source.",
        { intervalSource: ["No manufacturer interval on record"] },
      );
    }
    if (m.manufacturerPmIntervalCount !== d.intervalCount || m.manufacturerPmIntervalUnit !== d.intervalUnit) {
      const rec = intervalLabel(m.manufacturerPmIntervalCount!, m.manufacturerPmIntervalUnit as IntervalUnitValue);
      throw new ValidationError(`The manufacturer interval on record for ${m.modelName} is: ${rec}.`, {
        intervalCount: [`Use the recorded manufacturer interval (${rec}), or choose another source`],
      });
    }
  }
  if (d.intervalSource === "ORGANIZATION_DEFINED" && guided.length) {
    const list = guided
      .map(
        (m) =>
          `${m.modelName}: ${intervalLabel(m.manufacturerPmIntervalCount!, m.manufacturerPmIntervalUnit as IntervalUnitValue)}`,
      )
      .join("; ");
    throw new ValidationError(
      `Manufacturer guidance exists (${list}). Use it, or a regulatory or organisational requirement.`,
      { intervalSource: ["Organisation-defined intervals are only for equipment without manufacturer guidance"] },
    );
  }
}

async function checkAssignee(tx: Tx, d: PlanInput) {
  if (!d.defaultAssigneeId) return;
  const m = await tx.membership.findFirst({
    where: { userId: d.defaultAssigneeId, status: "ACTIVE", role: { in: [...WORKER_ROLES] } },
    select: { id: true, orgWide: true, scopes: { select: { hospitalId: true } } },
  });
  const coversHospital = !d.hospitalId || !m || m.orgWide || m.scopes.some((s) => s.hospitalId === d.hospitalId);
  if (!m || !coversHospital) {
    throw new ValidationError("Choose a technician or engineering manager for this hospital.", {
      defaultAssigneeId: ["Not a technician for this hospital"],
    });
  }
}

const planData = (d: PlanInput) => ({
  hospitalId: d.hospitalId,
  name: d.name,
  description: d.description,
  workType: d.workType,
  targetKind: d.targetKind,
  assetId: d.targetKind === "ASSET" ? d.targetId : null,
  modelId: d.targetKind === "MODEL" ? d.targetId : null,
  categoryId: d.targetKind === "CATEGORY" ? d.targetId : null,
  departmentId: d.targetKind === "DEPARTMENT" ? d.targetId : null,
  intervalCount: d.intervalCount,
  intervalUnit: d.intervalUnit,
  intervalSource: d.intervalSource,
  sourceReference: d.sourceReference,
  justification: d.justification,
  startsOn: toDbDate(d.startsOn),
  endsOn: d.endsOn ? toDbDate(d.endsOn) : null,
  leadDays: d.leadDays,
  graceDays: d.graceDays,
  estimatedMinutes: d.estimatedMinutes,
  defaultAssigneeId: d.defaultAssigneeId,
  requiredCompetency: d.requiredCompetency,
  priority: d.priority,
  documentReference: d.documentReference,
  instructions: d.instructions,
  checklist: d.checklist as unknown as Prisma.InputJsonValue,
});

// ─── Writing plans ───────────────────────────────────────────────────────────

export async function createPlan(ctx: AccessContext, input: unknown) {
  await requirePermission(ctx, "pm.manage", { entityType: "maintenance_plan" });
  const d = parseInput(planSchema, input);
  return withTenant(tenant(ctx), async (tx) => {
    const { modelIds, label } = await checkTarget(ctx, tx, d);
    await checkIntervalSource(tx, d, modelIds);
    await checkAssignee(tx, d);
    const plan = await tx.maintenancePlan.create({
      data: {
        organizationId: ctx.organization.id,
        ...planData(d),
        status: "DRAFT",
        hasUnapprovedChanges: true,
        createdById: ctx.user.id,
        updatedById: ctx.user.id,
      },
      select: { id: true },
    });
    await auditPlan(tx, ctx, "pm.plan_created", plan.id, {
      name: d.name,
      target: `${d.targetKind}:${label}`,
      interval: intervalLabel(d.intervalCount, d.intervalUnit),
      source: d.intervalSource,
      checklistItems: d.checklist.length,
    });
    return plan;
  });
}

const TRACKED: (keyof ReturnType<typeof planData>)[] = [
  "name",
  "hospitalId",
  "intervalCount",
  "intervalUnit",
  "intervalSource",
  "sourceReference",
  "justification",
  "startsOn",
  "endsOn",
  "leadDays",
  "graceDays",
  "defaultAssigneeId",
  "priority",
  "checklist",
  "instructions",
];

/** Edits the working copy. Work keeps using the approved version until the change is approved. */
export async function updatePlan(ctx: AccessContext, id: string, input: unknown) {
  await requirePermission(ctx, "pm.manage", { entityType: "maintenance_plan", entityId: id });
  const d = parseInput(planSchema, input);
  return withTenant(tenant(ctx), async (tx) => {
    const plan = await loadPlan(ctx, tx, id, "pm.plan_update", true);
    if (plan.status === "ARCHIVED") throw new ValidationError("Archived plans cannot be changed.");
    const next = planData(d);
    if (plan.approvedRevisionId) {
      const targetChanged =
        next.targetKind !== plan.targetKind ||
        next.assetId !== plan.assetId ||
        next.modelId !== plan.modelId ||
        next.categoryId !== plan.categoryId ||
        next.departmentId !== plan.departmentId ||
        next.workType !== plan.workType;
      if (targetChanged) {
        throw new ValidationError("An approved plan keeps its type and target. Create a new plan instead.", {
          targetId: ["Cannot change after approval"],
        });
      }
    }
    const { modelIds } = await checkTarget(ctx, tx, d);
    await checkIntervalSource(tx, d, modelIds);
    await checkAssignee(tx, d);
    const norm = (v: unknown) => (v instanceof Date ? v.toISOString().slice(0, 10) : JSON.stringify(v ?? null));
    const changed = TRACKED.filter((f) => norm(plan[f as keyof PlanRow]) !== norm(next[f]));
    if (!changed.length && next.description === plan.description) return { changed: [] };
    await tx.maintenancePlan.update({
      where: { id: plan.id },
      data: { ...next, hasUnapprovedChanges: true, updatedById: ctx.user.id },
    });
    await auditPlan(tx, ctx, "pm.plan_updated", plan.id, { changed, needsApproval: true });
    return { changed };
  });
}

/**
 * An Engineering Manager approves the working copy: a new APPROVAL revision
 * (full copy, source, approver, effective date) becomes the version used for
 * new work orders.
 */
export async function approvePlan(ctx: AccessContext, input: unknown) {
  await requirePermission(ctx, "pm.approve", { entityType: "maintenance_plan" });
  const data = parseInput(approvePlanSchema, input);
  return withTenant(tenant(ctx), async (tx) => {
    // Approval is a technical sign-off of the procedure, limits and interval:
    // any Engineering Manager who can see the plan may give it (also for
    // organisation-wide plans). Editing and enrolling stay limited to scope.
    const plan = await loadPlan(ctx, tx, data.id, "pm.plan_approve");
    if (plan.status === "ARCHIVED") throw new ValidationError("Archived plans cannot be approved.");
    if (!plan.hasUnapprovedChanges && plan.approvedRevisionId) {
      throw new ValidationError("There are no changes to approve. Use “Review interval” to record a review.");
    }
    if (data.nextReviewOn <= data.effectiveFrom) {
      throw new ValidationError("The next review must be after the effective date.", {
        nextReviewOn: ["After the effective date"],
      });
    }
    // Re-check the stored working copy against today's catalogue and standards.
    const d = parseInput(planSchema, {
      ...plan,
      targetId: plan.assetId ?? plan.modelId ?? plan.categoryId ?? plan.departmentId,
      startsOn: fromDbDate(plan.startsOn),
      endsOn: plan.endsOn ? fromDbDate(plan.endsOn) : null,
      checklist: plan.checklist,
    });
    const { modelIds } = await checkTarget(ctx, tx, d, { approval: true });
    await checkIntervalSource(tx, d, modelIds);
    if (hasElectricalSafety(d.checklist) && !(await hasVerifiedStandard(tx))) {
      throw new ValidationError(
        "This checklist has electrical safety items, but no verified test standard applies yet. Verify a standard under Maintenance → Settings first.",
      );
    }
    const previous = plan.approvedRevisionId
      ? await tx.maintenancePlanRevision.findUnique({ where: { id: plan.approvedRevisionId } })
      : null;
    const last = await tx.maintenancePlanRevision.aggregate({ where: { planId: plan.id }, _max: { revisionNo: true } });
    const revisionNo = (last._max.revisionNo ?? 0) + 1;
    const snapshot = {
      name: plan.name,
      description: plan.description,
      workType: plan.workType,
      targetKind: plan.targetKind,
      hospitalId: plan.hospitalId,
      startsOn: fromDbDate(plan.startsOn),
      endsOn: plan.endsOn ? fromDbDate(plan.endsOn) : null,
      leadDays: plan.leadDays,
      graceDays: plan.graceDays,
      estimatedMinutes: plan.estimatedMinutes,
      defaultAssigneeId: plan.defaultAssigneeId,
      requiredCompetency: plan.requiredCompetency,
      priority: plan.priority,
      documentReference: plan.documentReference,
      instructions: plan.instructions,
    };
    const rev = await tx.maintenancePlanRevision.create({
      data: {
        organizationId: ctx.organization.id,
        planId: plan.id,
        revisionNo,
        kind: "APPROVAL",
        intervalCount: plan.intervalCount,
        intervalUnit: plan.intervalUnit,
        intervalSource: plan.intervalSource,
        sourceReference: plan.sourceReference,
        justification: plan.justification,
        checklist: plan.checklist as Prisma.InputJsonValue,
        snapshot,
        effectiveFrom: toDbDate(data.effectiveFrom),
        approvedById: ctx.user.id,
        note: data.note,
      },
      select: { id: true },
    });
    await tx.maintenancePlan.update({
      where: { id: plan.id },
      data: {
        approvedRevisionId: rev.id,
        hasUnapprovedChanges: false,
        status: plan.status === "DRAFT" ? "ACTIVE" : plan.status,
        nextReviewOn: toDbDate(data.nextReviewOn),
        updatedById: ctx.user.id,
      },
    });
    // A new interval applies from each schedule's next due date onwards.
    let reanchored = 0;
    if (previous && (previous.intervalCount !== plan.intervalCount || previous.intervalUnit !== plan.intervalUnit)) {
      const schedules = await tx.pmSchedule.findMany({
        where: { planId: plan.id, status: "ACTIVE" },
        select: { id: true, nextDueOn: true },
      });
      for (const s of schedules) {
        await tx.pmSchedule.update({
          where: { id: s.id },
          data: { anchorOn: s.nextDueOn, nextSeq: 0, updatedById: ctx.user.id },
        });
      }
      reanchored = schedules.length;
    }
    await auditPlan(tx, ctx, "pm.plan_approved", plan.id, {
      revisionNo,
      interval: intervalLabel(plan.intervalCount, plan.intervalUnit),
      source: plan.intervalSource,
      effectiveFrom: data.effectiveFrom,
      nextReviewOn: data.nextReviewOn,
      reanchoredSchedules: reanchored || undefined,
    });
    return { revisionNo };
  });
}

/** Records that the approved interval was reviewed and still stands. */
export async function reviewPlanInterval(ctx: AccessContext, input: unknown) {
  await requirePermission(ctx, "pm.approve", { entityType: "maintenance_plan" });
  const data = parseInput(reviewPlanSchema, input);
  return withTenant(tenant(ctx), async (tx) => {
    const plan = await loadPlan(ctx, tx, data.id, "pm.plan_review");
    if (!plan.approvedRevisionId) throw new ValidationError("Approve the plan before reviewing its interval.");
    const current = await tx.maintenancePlanRevision.findUniqueOrThrow({ where: { id: plan.approvedRevisionId } });
    const last = await tx.maintenancePlanRevision.aggregate({ where: { planId: plan.id }, _max: { revisionNo: true } });
    await tx.maintenancePlanRevision.create({
      data: {
        organizationId: ctx.organization.id,
        planId: plan.id,
        revisionNo: (last._max.revisionNo ?? 0) + 1,
        kind: "REVIEW",
        intervalCount: current.intervalCount,
        intervalUnit: current.intervalUnit,
        intervalSource: current.intervalSource,
        sourceReference: current.sourceReference,
        justification: current.justification,
        checklist: current.checklist as Prisma.InputJsonValue,
        snapshot: current.snapshot as Prisma.InputJsonValue,
        effectiveFrom: current.effectiveFrom,
        approvedById: ctx.user.id,
        note: data.note,
      },
    });
    await tx.maintenancePlan.update({
      where: { id: plan.id },
      data: { nextReviewOn: toDbDate(data.nextReviewOn), updatedById: ctx.user.id },
    });
    await auditPlan(tx, ctx, "pm.interval_reviewed", plan.id, { nextReviewOn: data.nextReviewOn });
  });
}

export async function pausePlan(ctx: AccessContext, input: unknown) {
  await requirePermission(ctx, "pm.manage", { entityType: "maintenance_plan" });
  const data = parseInput(pausePlanSchema, input);
  return withTenant(tenant(ctx), async (tx) => {
    const plan = await loadPlan(ctx, tx, data.id, "pm.plan_pause", true);
    const r = await tx.maintenancePlan.updateMany({
      where: { id: plan.id, status: "ACTIVE" },
      data: {
        status: "PAUSED",
        pausedAt: new Date(),
        pausedById: ctx.user.id,
        pauseReason: data.reason,
        updatedById: ctx.user.id,
      },
    });
    if (r.count === 0) throw new ValidationError("Only an active plan can be paused.");
    await auditPlan(tx, ctx, "pm.plan_paused", plan.id, { reason: data.reason });
  });
}

/**
 * Resumes a paused plan. Due dates that fell during the pause are not created
 * or counted; each schedule continues from its next due date on or after
 * today (hospital date). The pause itself is in the audit log.
 */
export async function resumePlan(ctx: AccessContext, input: unknown) {
  await requirePermission(ctx, "pm.manage", { entityType: "maintenance_plan" });
  const { id } = parseInput(planIdSchema, input);
  return withTenant(tenant(ctx), async (tx) => {
    const plan = await loadPlan(ctx, tx, id, "pm.plan_resume", true);
    const r = await tx.maintenancePlan.updateMany({
      where: { id: plan.id, status: "PAUSED" },
      data: { status: "ACTIVE", pausedAt: null, pausedById: null, pauseReason: null, updatedById: ctx.user.id },
    });
    if (r.count === 0) throw new ValidationError("Only a paused plan can be resumed.");
    const schedules = await tx.pmSchedule.findMany({
      where: { planId: plan.id, status: "ACTIVE" },
      select: {
        id: true,
        anchorOn: true,
        nextSeq: true,
        nextDueOn: true,
        asset: { select: { hospital: { select: { timezone: true } } } },
      },
    });
    let moved = 0;
    for (const s of schedules) {
      const today = localToday(s.asset.hospital.timezone);
      const anchor = fromDbDate(s.anchorOn);
      if (fromDbDate(s.nextDueOn) >= today) continue;
      const n = Math.max(s.nextSeq, firstIndexOnOrAfter(anchor, plan.intervalUnit, plan.intervalCount, today));
      await tx.pmSchedule.update({
        where: { id: s.id },
        data: {
          nextSeq: n,
          nextDueOn: toDbDate(dueDate(anchor, plan.intervalUnit, plan.intervalCount, n)),
          updatedById: ctx.user.id,
        },
      });
      moved++;
    }
    await auditPlan(tx, ctx, "pm.plan_resumed", plan.id, { schedulesMovedPastPause: moved });
    return { moved };
  });
}

/** Archives a plan: no new work; its schedules end; history and open jobs stay. */
export async function archivePlan(ctx: AccessContext, input: unknown) {
  await requirePermission(ctx, "pm.manage", { entityType: "maintenance_plan" });
  const data = parseInput(archivePlanSchema, input);
  return withTenant(tenant(ctx), async (tx) => {
    const plan = await loadPlan(ctx, tx, data.id, "pm.plan_archive", true);
    const r = await tx.maintenancePlan.updateMany({
      where: { id: plan.id, status: { not: "ARCHIVED" } },
      data: { status: "ARCHIVED", archivedAt: new Date(), archivedById: ctx.user.id, updatedById: ctx.user.id },
    });
    if (r.count === 0) throw new ValidationError("This plan is already archived.");
    const ended = await tx.pmSchedule.updateMany({
      where: { planId: plan.id, status: "ACTIVE" },
      data: {
        status: "ENDED",
        endedAt: new Date(),
        endReason: `Plan archived: ${data.reason}`.slice(0, 300),
        updatedById: ctx.user.id,
      },
    });
    await auditPlan(tx, ctx, "pm.plan_archived", plan.id, { reason: data.reason, schedulesEnded: ended.count });
  });
}

// ─── Assets in a plan ────────────────────────────────────────────────────────

function eligibleWhere(ctx: AccessContext, plan: PlanRow): Prisma.AssetWhereInput {
  const target: Prisma.AssetWhereInput =
    plan.targetKind === "ASSET"
      ? { id: plan.assetId! }
      : plan.targetKind === "MODEL"
        ? { modelId: plan.modelId! }
        : plan.targetKind === "DEPARTMENT"
          ? { departmentId: plan.departmentId! }
          : { model: { categoryId: plan.categoryId! } };
  return {
    AND: [
      target,
      assetScopeWhere(ctx),
      plan.hospitalId ? { hospitalId: plan.hospitalId } : {},
      { archivedAt: null, status: { not: "DECOMMISSIONED" } },
    ],
  };
}

/** Enrols matching assets (all, or the chosen ones) with a first due date. */
export async function enrolAssets(ctx: AccessContext, input: unknown) {
  await requirePermission(ctx, "pm.manage", { entityType: "maintenance_plan" });
  const data = parseInput(enrolSchema, input);
  return withTenant(tenant(ctx), async (tx) => {
    const plan = await loadPlan(ctx, tx, data.id, "pm.enrol", true);
    if (plan.status === "ARCHIVED") throw new ValidationError("Archived plans cannot take new assets.");
    if (data.firstDueOn < fromDbDate(plan.startsOn) || (plan.endsOn && data.firstDueOn > fromDbDate(plan.endsOn))) {
      throw new ValidationError("The first due date must fall between the plan's start and end dates.", {
        firstDueOn: ["Outside the plan dates"],
      });
    }
    const assets = await tx.asset.findMany({
      where: { AND: [eligibleWhere(ctx, plan), data.assetIds.length ? { id: { in: data.assetIds } } : {}] },
      select: { id: true, assetTag: true },
      take: 500,
    });
    if (data.assetIds.length && assets.length !== new Set(data.assetIds).size) {
      throw new ValidationError("Some chosen assets do not match this plan or are outside your access.");
    }
    const skipped: { assetTag: string; reason: string }[] = [];
    let enrolled = 0;
    for (const a of assets) {
      const own = await tx.pmSchedule.findUnique({ where: { planId_assetId: { planId: plan.id, assetId: a.id } } });
      if (own?.status === "ACTIVE") {
        skipped.push({ assetTag: a.assetTag, reason: "already in this plan" });
        continue;
      }
      const other = await tx.pmSchedule.findFirst({
        where: { assetId: a.id, workType: plan.workType, status: "ACTIVE" },
        select: { plan: { select: { name: true } } },
      });
      if (other) {
        skipped.push({ assetTag: a.assetTag, reason: `already scheduled by “${other.plan.name}”` });
        continue;
      }
      const values = {
        status: "ACTIVE" as const,
        anchorOn: toDbDate(data.firstDueOn),
        nextSeq: 0,
        nextDueOn: toDbDate(data.firstDueOn),
        endedAt: null,
        endReason: null,
        updatedById: ctx.user.id,
      };
      if (own) await tx.pmSchedule.update({ where: { id: own.id }, data: values });
      else {
        await tx.pmSchedule.create({
          data: {
            organizationId: ctx.organization.id,
            planId: plan.id,
            assetId: a.id,
            workType: plan.workType,
            createdById: ctx.user.id,
            ...values,
          },
        });
      }
      enrolled++;
    }
    await auditPlan(tx, ctx, "pm.assets_enrolled", plan.id, {
      enrolled,
      skipped: skipped.length,
      firstDueOn: data.firstDueOn,
    });
    return { enrolled, skipped };
  });
}

export async function endSchedule(ctx: AccessContext, input: unknown) {
  await requirePermission(ctx, "pm.manage", { entityType: "pm_schedule" });
  const data = parseInput(endScheduleSchema, input);
  return withTenant(tenant(ctx), async (tx) => {
    const s = await tx.pmSchedule.findFirst({
      where: { id: data.id, asset: assetScopeWhere(ctx) },
      select: {
        id: true,
        planId: true,
        status: true,
        plan: { select: { hospitalId: true } },
        asset: { select: { assetTag: true } },
      },
    });
    if (!s || !canChangePlan(ctx, s.plan)) {
      await denied(ctx, data.id, "pm.schedule_end", "not_found_or_outside_scope");
      throw new NotFoundError("Schedule");
    }
    if (s.status !== "ACTIVE") throw new ValidationError("This schedule has already ended.");
    await tx.pmSchedule.update({
      where: { id: s.id },
      data: { status: "ENDED", endedAt: new Date(), endReason: data.reason, updatedById: ctx.user.id },
    });
    await auditPlan(tx, ctx, "pm.schedule_ended", s.planId, { assetTag: s.asset.assetTag, reason: data.reason });
  });
}

// ─── Reading ─────────────────────────────────────────────────────────────────

const targetSelect = {
  asset: { select: { id: true, assetTag: true, name: true } },
  model: {
    select: {
      id: true,
      modelName: true,
      manufacturer: { select: { name: true } },
      manufacturerPmIntervalCount: true,
      manufacturerPmIntervalUnit: true,
      manufacturerPmReference: true,
    },
  },
  category: { select: { id: true, name: true } },
  department: { select: { id: true, name: true } },
  hospital: { select: { id: true, code: true, name: true } },
} satisfies Prisma.MaintenancePlanInclude;

export function targetLabel(p: {
  targetKind: string;
  asset: { assetTag: string; name: string } | null;
  model: { modelName: string; manufacturer: { name: string } } | null;
  category: { name: string } | null;
  department?: { name: string } | null;
}) {
  if (p.targetKind === "ASSET" && p.asset) return `${p.asset.assetTag} · ${p.asset.name}`;
  if (p.targetKind === "MODEL" && p.model) return `${p.model.manufacturer.name} ${p.model.modelName}`;
  if (p.targetKind === "DEPARTMENT" && p.department) return `All assets in ${p.department.name}`;
  if (p.category) return `All ${p.category.name.toLowerCase()} assets`;
  return "—";
}

export async function listPlans(ctx: AccessContext, rawQuery: unknown) {
  await requirePermission(ctx, "pm.view", { entityType: "maintenance_plan" });
  const q = planQuerySchema.parse(rawQuery ?? {});
  const and: Prisma.MaintenancePlanWhereInput[] = [planScopeWhere(ctx)];
  if (q.status) and.push({ status: q.status });
  else and.push({ status: { not: "ARCHIVED" } });
  if (q.type) and.push({ workType: q.type });
  if (q.q) and.push({ name: { contains: q.q, mode: "insensitive" } });
  const where = { AND: and };
  return withTenant(tenant(ctx), async (tx) => {
    const total = await tx.maintenancePlan.count({ where });
    const pageCount = Math.max(1, Math.ceil(total / PLAN_PAGE_SIZE));
    const page = Math.min(q.page, pageCount);
    const rows = await tx.maintenancePlan.findMany({
      where,
      orderBy: [{ status: "asc" }, { name: "asc" }, { id: "asc" }],
      skip: (page - 1) * PLAN_PAGE_SIZE,
      take: PLAN_PAGE_SIZE,
      include: {
        ...targetSelect,
        _count: { select: { schedules: { where: { status: "ACTIVE", asset: assetScopeWhere(ctx) } } } },
      },
    });
    return { rows: rows.map((r) => ({ ...r, target: targetLabel(r) })), total, page, pageCount, query: { ...q, page } };
  });
}

export async function getPlan(ctx: AccessContext, id: string) {
  await requirePermission(ctx, "pm.view", { entityType: "maintenance_plan" });
  return withTenant(tenant(ctx), async (tx) => {
    const core = await loadPlan(ctx, tx, id, "pm.plan_view");
    const plan = await tx.maintenancePlan.findUniqueOrThrow({
      where: { id: core.id },
      include: {
        ...targetSelect,
        revisions: { orderBy: { revisionNo: "desc" } },
        schedules: {
          where: { asset: assetScopeWhere(ctx) },
          orderBy: [{ status: "asc" }, { nextDueOn: "asc" }],
          take: 500,
          include: {
            asset: {
              select: {
                id: true,
                assetTag: true,
                name: true,
                status: true,
                hospital: { select: { code: true } },
                department: { select: { name: true } },
              },
            },
          },
        },
      },
    });
    const eligible = await tx.asset.count({ where: eligibleWhere(ctx, core) });
    const enrolledIds = new Set(plan.schedules.filter((s) => s.status === "ACTIVE").map((s) => s.assetId));
    const unenrolled = await tx.asset.findMany({
      where: { AND: [eligibleWhere(ctx, core), { id: { notIn: [...enrolledIds] } }] },
      select: { id: true, assetTag: true, name: true, hospital: { select: { code: true } } },
      orderBy: { assetTag: "asc" },
      take: 200,
    });
    const names = await peopleNames(tx, [
      plan.createdById,
      plan.updatedById,
      plan.defaultAssigneeId,
      plan.pausedById,
      plan.archivedById,
      ...plan.revisions.map((r) => r.approvedById),
    ]);
    const change = can(ctx, "pm.manage") && canChangePlan(ctx, plan);
    const approve = can(ctx, "pm.approve"); // the plan is visible, so the manager may approve it
    return {
      ...plan,
      checklistItems: plan.checklist as unknown as ChecklistItem[],
      target: targetLabel(plan),
      eligible,
      unenrolled,
      names,
      allowed: {
        edit: change && plan.status !== "ARCHIVED",
        approve: approve && plan.status !== "ARCHIVED" && (plan.hasUnapprovedChanges || !plan.approvedRevisionId),
        review: approve && plan.status !== "ARCHIVED" && Boolean(plan.approvedRevisionId),
        pause: change && plan.status === "ACTIVE",
        resume: change && plan.status === "PAUSED",
        archive: change && plan.status !== "ARCHIVED",
        enrol: change && plan.status !== "ARCHIVED",
      },
    };
  });
}

/** Choices for the plan form, limited to what the user may use. */
export async function planFormOptions(ctx: AccessContext) {
  await requirePermission(ctx, "pm.manage", { entityType: "maintenance_plan" });
  return withTenant(tenant(ctx), async (tx) => {
    const [models, categories, departmentRows, assets, workers] = await Promise.all([
      tx.equipmentModel.findMany({
        where: { status: "ACTIVE" },
        select: {
          id: true,
          modelName: true,
          manufacturer: { select: { name: true } },
          category: { select: { name: true } },
          manufacturerPmIntervalCount: true,
          manufacturerPmIntervalUnit: true,
          manufacturerPmReference: true,
        },
        orderBy: { modelName: "asc" },
      }),
      tx.equipmentCategory.findMany({
        where: { status: "ACTIVE" },
        select: { id: true, name: true, defaultPmIntervalMonths: true },
        orderBy: { name: "asc" },
      }),
      tx.department.findMany({
        where: { status: "ACTIVE", hospitalId: { in: ctx.hospitals.map((h) => h.id) } },
        select: { id: true, name: true, hospitalId: true },
        orderBy: { name: "asc" },
      }),
      tx.asset.findMany({
        where: { AND: [assetScopeWhere(ctx), { archivedAt: null, status: { not: "DECOMMISSIONED" } }] },
        select: { id: true, assetTag: true, name: true, hospitalId: true },
        orderBy: { assetTag: "asc" },
        take: 1000,
      }),
      tx.membership.findMany({
        where: { status: "ACTIVE", role: { in: [...WORKER_ROLES] } },
        select: { userId: true, role: true },
      }),
    ]);
    const names = await peopleNames(
      tx,
      workers.map((w) => w.userId),
    );
    return {
      hospitals: ctx.hospitals.map((h) => ({ id: h.id, code: h.code, name: h.name })),
      orgWide: ctx.orgWide,
      models,
      categories,
      // Only departments the user may use: every department of a hospital they cover fully,
      // or the listed ones for a department-limited user.
      departments: departmentRows.filter((d) => {
        const h = ctx.hospitals.find((x) => x.id === d.hospitalId);
        return h && (h.departments === "ALL" || h.departments.includes(d.id));
      }),
      assets,
      assignees: workers
        .map((w) => ({ userId: w.userId, name: names[w.userId] ?? "Unknown", role: w.role }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    };
  });
}

// ─── Manufacturer intervals ──────────────────────────────────────────────────

export async function listModelIntervals(ctx: AccessContext) {
  await requirePermission(ctx, "pm.view", { entityType: "equipment_model" });
  return withTenant(tenant(ctx), (tx) =>
    tx.equipmentModel.findMany({
      where: { status: "ACTIVE" },
      select: {
        id: true,
        modelName: true,
        manufacturer: { select: { name: true } },
        category: { select: { name: true, defaultPmIntervalMonths: true } },
        manufacturerPmIntervalCount: true,
        manufacturerPmIntervalUnit: true,
        manufacturerPmReference: true,
      },
      orderBy: [{ category: { name: "asc" } }, { modelName: "asc" }],
    }),
  );
}

export async function setModelInterval(ctx: AccessContext, input: unknown) {
  await requirePermission(ctx, "pm.manage", { entityType: "equipment_model" });
  const data = parseInput(modelIntervalSchema, input);
  return withTenant(tenant(ctx), async (tx) => {
    const model = await tx.equipmentModel.findFirst({
      where: { id: data.modelId },
      select: { id: true, modelName: true },
    });
    if (!model) throw new NotFoundError("Model");
    await tx.equipmentModel.update({
      where: { id: model.id },
      data: {
        manufacturerPmIntervalCount: data.count,
        manufacturerPmIntervalUnit: data.unit,
        manufacturerPmReference: data.reference,
      },
    });
    await audit(tx, {
      organizationId: ctx.organization.id,
      actorUserId: ctx.user.id,
      action: "catalog.manufacturer_interval_set",
      entityType: "equipment_model",
      entityId: model.id,
      metadata: {
        model: model.modelName,
        interval: data.count && data.unit ? intervalLabel(data.count, data.unit) : null,
        reference: data.reference,
      },
      request: ctx.request,
    });
  });
}

// ─── Needs review ────────────────────────────────────────────────────────────

/** Assets with no live schedule under an approved plan: flagged, never auto-scheduled. */
export function withoutApprovedPmWhere(ctx: AccessContext): Prisma.AssetWhereInput {
  return {
    AND: [
      assetScopeWhere(ctx),
      { archivedAt: null, status: { not: "DECOMMISSIONED" } },
      {
        pmSchedules: {
          none: { status: "ACTIVE", plan: { approvedRevisionId: { not: null }, status: { in: ["ACTIVE", "PAUSED"] } } },
        },
      },
    ],
  };
}

export async function getNeedsReview(ctx: AccessContext) {
  await requirePermission(ctx, "pm.view", { entityType: "maintenance_plan" });
  return withTenant(tenant(ctx), async (tx) => {
    const first = ctx.hospitals[0]
      ? await tx.hospital.findUnique({ where: { id: ctx.hospitals[0].id }, select: { timezone: true } })
      : null;
    const today = localToday(first?.timezone ?? "UTC");
    const soon = toDbDate(addDays(today, 30));
    const [assetsTotal, assets, unapproved, reviewDue, failed] = await Promise.all([
      tx.asset.count({ where: withoutApprovedPmWhere(ctx) }),
      tx.asset.findMany({
        where: withoutApprovedPmWhere(ctx),
        orderBy: { assetTag: "asc" },
        take: 200,
        select: {
          id: true,
          assetTag: true,
          name: true,
          hospital: { select: { code: true } },
          department: { select: { name: true } },
          model: {
            select: {
              modelName: true,
              manufacturerPmIntervalCount: true,
              manufacturerPmIntervalUnit: true,
              category: { select: { name: true, defaultPmIntervalMonths: true } },
            },
          },
        },
      }),
      tx.maintenancePlan.findMany({
        where: { AND: [planScopeWhere(ctx), { status: { not: "ARCHIVED" }, hasUnapprovedChanges: true }] },
        select: { id: true, name: true, status: true, updatedAt: true },
        orderBy: { updatedAt: "desc" },
        take: 100,
      }),
      tx.maintenancePlan.findMany({
        where: { AND: [planScopeWhere(ctx), { status: { in: ["ACTIVE", "PAUSED"] }, nextReviewOn: { lte: soon } }] },
        select: { id: true, name: true, nextReviewOn: true },
        orderBy: { nextReviewOn: "asc" },
        take: 100,
      }),
      tx.pmOccurrence.findMany({
        where: { status: "FAILED", asset: assetScopeWhere(ctx) },
        select: {
          id: true,
          dueOn: true,
          attempts: true,
          lastError: true,
          lastAttemptAt: true,
          plan: { select: { id: true, name: true } },
          asset: { select: { id: true, assetTag: true, name: true } },
        },
        orderBy: { dueOn: "asc" },
        take: 100,
      }),
    ]);
    return { assetsTotal, assets, unapproved, reviewDue, failed, today };
  });
}
