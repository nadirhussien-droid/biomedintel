// Automatic preventive maintenance work orders (Stage 6).
//
// How one run works (button, `npm run pm:generate`, or the protected
// scheduler endpoint — all call the same code):
//
//   For every ACTIVE schedule of an ACTIVE, APPROVED plan, in its OWN
//   database transaction:
//     1. Lock the schedule row (SELECT … FOR UPDATE). A second run at the same
//        moment waits here, then sees the schedule already moved on.
//     2. Re-read the schedule, plan, approved plan version and asset.
//     3. Is the next due date within the plan's lead time (hospital date)?
//        If not, nothing to do.
//     4. Catch-up: if several due dates have already passed, the older ones
//        are recorded as MISSED (visible, counted as not done) and one work
//        order is created for the latest.
//     5. Record the occurrence (UNIQUE schedule + due date), create the work
//        order through the shared Stage 5 logic (UNIQUE occurrence per work
//        order), and only THEN advance the schedule to the next due date.
//     6. Audit and notify (reminders carry a key, so a retry never repeats one).
//   If anything fails, the whole transaction rolls back — the schedule is NOT
//   advanced — and the failure is recorded on the occurrence (FAILED, with a
//   short message and attempt count) in a separate transaction. The next run
//   retries the same due date. Managers are told once per occurrence.
//
// Paused, archived and draft plans never generate work. Decommissioned or
// archived assets get a SKIPPED occurrence and their schedule ends.
import type { Prisma } from "../db/generated/client";
import { withTenant, type TenantScope, type Tx } from "../db/tenant";
import { audit } from "../audit/audit";
import { requirePermission, type AccessContext } from "../authz/access";
import { ValidationError } from "../authz/errors";
import { isUniqueViolation } from "../validation";
import { assetScopeWhere } from "./assets";
import { notify } from "./notifications";
import { resolveStandard } from "./test-standards";
import {
  auditActorId,
  createWorkOrderRecord,
  isEligibleAssignee,
  managersToAlert,
  SYSTEM_SCHEDULER,
  systemActor,
  type Actor,
} from "./work-order-core";
import {
  addDays,
  daysBetween,
  dueDate,
  endOfLocalDay,
  formatDateOnly,
  fromDbDate,
  lastIndexOnOrBefore,
  localToday,
  toDbDate,
  type IntervalUnitValue,
} from "@/lib/pm/dates";
import { hasElectricalSafety, WORK_TYPE_LABELS, type ChecklistItem } from "@/lib/validation/pm";
import { log } from "../log";

/** A problem someone can fix (shown to managers as the failure reason). */
export class GenerationError extends Error {}

type Snapshot = {
  name: string;
  workType: "PREVENTIVE" | "SAFETY_TEST" | "INSPECTION" | "CALIBRATION";
  endsOn: string | null;
  leadDays: number;
  graceDays: number;
  defaultAssigneeId: string | null;
  priority: "URGENT" | "HIGH" | "MEDIUM" | "LOW";
  instructions: string | null;
  estimatedMinutes: number | null;
  requiredCompetency: string | null;
};

export type ScheduleOutcome = "created" | "not_due" | "already" | "skipped" | "ended" | "failed";

export type RunSummary = {
  runId: string;
  organizationId: string;
  schedulesChecked: number;
  created: number;
  missed: number;
  skipped: number;
  failed: number;
  remindersSent: number;
};

/** Safe, short failure text: our own messages in full, anything else generic. */
function failureMessage(error: unknown): string {
  if (error instanceof GenerationError || error instanceof ValidationError) return error.message.slice(0, 300);
  const code = (error as { code?: string })?.code;
  return `Unexpected error while creating the work order${code ? ` (code ${code})` : ""}. It will be retried on the next run.`;
}

// ─── One schedule ────────────────────────────────────────────────────────────

type Planned = { dueOn: string; seq: number };

async function lockAndLoad(tx: Tx, scheduleId: string) {
  await tx.$queryRaw`SELECT id FROM pm_schedules WHERE id = ${scheduleId}::uuid FOR UPDATE`;
  return tx.pmSchedule.findUnique({
    where: { id: scheduleId },
    include: {
      plan: { include: { approvedRevision: true } },
      asset: {
        select: {
          id: true,
          assetTag: true,
          name: true,
          status: true,
          archivedAt: true,
          riskClass: true,
          hospitalId: true,
          departmentId: true,
          hospital: { select: { timezone: true } },
          model: { select: { categoryId: true, category: { select: { safetyCritical: true } } } },
        },
      },
    },
  });
}

async function endScheduleFor(tx: Tx, actor: Actor, scheduleId: string, planId: string, reason: string) {
  await tx.pmSchedule.update({
    where: { id: scheduleId },
    data: { status: "ENDED", endedAt: new Date(), endReason: reason, updatedById: actor.user.id },
  });
  await audit(tx, {
    organizationId: actor.organization.id,
    actorUserId: auditActorId(actor),
    action: "pm.schedule_ended",
    entityType: "maintenance_plan",
    entityId: planId,
    metadata: { scheduleId, reason, actor: auditActorId(actor) ? undefined : "scheduler" },
  });
}

/** Records MISSED or SKIPPED due dates; never overwrites an existing occurrence. */
async function recordNoWork(
  tx: Tx,
  orgId: string,
  s: { id: string; planId: string; assetId: string },
  revisionId: string,
  seq: number,
  dueOn: string,
  status: "MISSED" | "SKIPPED",
  note: string,
  runId: string,
) {
  await tx.$executeRaw`
    INSERT INTO pm_occurrences (id, organization_id, schedule_id, plan_id, asset_id, revision_id, seq, due_on,
                                status, note, run_id, created_at, updated_at)
    VALUES (gen_random_uuid(), ${orgId}::uuid, ${s.id}::uuid, ${s.planId}::uuid, ${s.assetId}::uuid,
            ${revisionId}::uuid, ${seq}, ${dueOn}::date, ${status}::pm_occurrence_status, ${note},
            ${runId}::uuid, now(), now())
    ON CONFLICT (schedule_id, due_on) DO NOTHING`;
}

async function processSchedule(
  scope: TenantScope,
  actor: Actor,
  scheduleId: string,
  runId: string,
  now: Date,
): Promise<{ outcome: ScheduleOutcome; missed: number }> {
  const orgId = actor.organization.id;
  const system = systemActor(orgId);
  let planned: Planned | null = null;
  try {
    return await withTenant(scope, async (tx) => {
      const s = await lockAndLoad(tx, scheduleId);
      const rev = s?.plan.approvedRevision;
      if (!s || s.status !== "ACTIVE" || s.plan.status !== "ACTIVE" || !rev) return { outcome: "not_due", missed: 0 };
      const snap = rev.snapshot as unknown as Snapshot;
      const unit = rev.intervalUnit as IntervalUnitValue;
      const count = rev.intervalCount;
      const tz = s.asset.hospital.timezone;
      const today = localToday(tz, now);
      const anchor = fromDbDate(s.anchorOn);
      let seq = s.nextSeq;
      let due = fromDbDate(s.nextDueOn);

      if (s.asset.archivedAt || s.asset.status === "DECOMMISSIONED") {
        const why = s.asset.archivedAt ? "Asset archived" : "Asset decommissioned";
        await recordNoWork(tx, orgId, s, rev.id, seq, due, "SKIPPED", why, runId);
        await endScheduleFor(tx, actor, s.id, s.planId, why);
        return { outcome: "skipped", missed: 0 };
      }
      if (snap.endsOn && due > snap.endsOn) {
        await endScheduleFor(tx, actor, s.id, s.planId, "Plan end date reached");
        return { outcome: "ended", missed: 0 };
      }
      if (addDays(due, -snap.leadDays) > today) return { outcome: "not_due", missed: 0 };

      // Catch-up: older passed due dates are MISSED; work is created for the latest.
      const last = lastIndexOnOrBefore(anchor, unit, count, seq, today);
      let missed = 0;
      if (last !== null && last > seq) {
        for (let k = seq; k < last; k++) {
          await recordNoWork(
            tx,
            orgId,
            s,
            rev.id,
            k,
            dueDate(anchor, unit, count, k),
            "MISSED",
            `Due date passed before a work order was created (caught up on ${today})`,
            runId,
          );
          missed++;
        }
        seq = last;
        due = dueDate(anchor, unit, count, seq);
      }
      planned = { dueOn: due, seq };

      const existing = await tx.pmOccurrence.findUnique({
        where: { scheduleId_dueOn: { scheduleId: s.id, dueOn: toDbDate(due) } },
        select: { id: true, status: true },
      });
      const advance = () =>
        tx.pmSchedule.update({
          where: { id: s.id },
          data: {
            nextSeq: seq + 1,
            nextDueOn: toDbDate(dueDate(anchor, unit, count, seq + 1)),
            updatedById: actor.user.id,
          },
        });
      if (existing && existing.status !== "FAILED") {
        await advance();
        return { outcome: "already", missed };
      }

      const checklist = rev.checklist as unknown as ChecklistItem[];
      let standard: { id: string; code: string; version: string } | null = null;
      if (hasElectricalSafety(checklist)) {
        const r = await resolveStandard(tx, { hospitalId: s.asset.hospitalId, categoryId: s.asset.model.categoryId });
        if (!r) {
          throw new GenerationError(
            "No electrical safety test standard applies to this asset's hospital and category. Add a rule under Maintenance → Settings.",
          );
        }
        if (!r.verified) {
          throw new GenerationError(
            `The test standard ${r.code} ${r.version} has not been verified by an engineering manager yet.`,
          );
        }
        standard = { id: r.id, code: r.code, version: r.version };
      }

      const occ = existing
        ? await tx.pmOccurrence.update({
            where: { id: existing.id },
            data: {
              status: "WORK_ORDER_CREATED",
              attempts: { increment: 1 },
              lastAttemptAt: now,
              lastError: null,
              generatedAt: now,
              runId,
              revisionId: rev.id,
            },
            select: { id: true },
          })
        : await tx.pmOccurrence.create({
            data: {
              organizationId: orgId,
              scheduleId: s.id,
              planId: s.planId,
              assetId: s.assetId,
              revisionId: rev.id,
              seq,
              dueOn: toDbDate(due),
              status: "WORK_ORDER_CREATED",
              attempts: 1,
              lastAttemptAt: now,
              generatedAt: now,
              runId,
            },
            select: { id: true },
          });

      const assigneeId =
        snap.defaultAssigneeId && (await isEligibleAssignee(tx, s.asset, snap.defaultAssigneeId))
          ? snap.defaultAssigneeId
          : null;
      const safetyCritical = s.asset.model.category.safetyCritical || s.asset.riskClass === "HIGH";
      const priority =
        safetyCritical && (snap.priority === "MEDIUM" || snap.priority === "LOW") ? "HIGH" : snap.priority;
      const kind = WORK_TYPE_LABELS[snap.workType] ?? "Planned maintenance";
      const extras = [
        snap.estimatedMinutes ? `Estimated ${snap.estimatedMinutes} min.` : null,
        snap.requiredCompetency ? `Competency: ${snap.requiredCompetency}.` : null,
        snap.instructions ? snap.instructions : null,
      ]
        .filter(Boolean)
        .join(" ");
      const wo = await createWorkOrderRecord(tx, actor, {
        asset: s.asset,
        type: snap.workType,
        priority,
        safetyCritical,
        outOfUse: false,
        description: `${kind}: ${snap.name} — due ${formatDateOnly(due)}.${extras ? ` ${extras}` : ""}`,
        reportedById: SYSTEM_SCHEDULER,
        assigneeId,
        dueAt: endOfLocalDay(due, tz),
        now,
        pmOccurrenceId: occ.id,
        planRevisionId: rev.id,
        checklist: rev.checklist as Prisma.InputJsonValue,
        testStandard: standard,
        source: "pm",
        auditExtra: { planId: s.planId, occurrenceId: occ.id, dueOn: due, revisionNo: rev.revisionNo },
      });
      // Only now, with the occurrence and the job safely recorded, move on.
      await advance();
      await audit(tx, {
        organizationId: orgId,
        actorUserId: auditActorId(actor),
        action: "pm.workorder_generated",
        entityType: "pm_occurrence",
        entityId: occ.id,
        metadata: {
          workOrder: wo.number,
          planId: s.planId,
          assetTag: s.asset.assetTag,
          dueOn: due,
          missedBefore: missed || undefined,
          testStandard: standard ? `${standard.code} ${standard.version}` : undefined,
          actor: auditActorId(actor) ? undefined : "scheduler",
        },
      });
      const recipients = assigneeId ? [assigneeId] : await managersToAlert(tx, wo, false);
      await notify(tx, system, recipients, {
        type: "pm.generated",
        title: `PM work order ${wo.number}: ${s.asset.assetTag} ${s.asset.name}`,
        body: `${snap.name} · due ${formatDateOnly(due)}`,
        link: `/work-orders/${wo.id}`,
        entityType: "work_order",
        entityId: wo.id,
        dedupeKey: `pm.generated:${occ.id}`,
      });
      return { outcome: "created", missed };
    });
  } catch (error) {
    // A concurrent run created this occurrence first: not a failure.
    if (isUniqueViolation(error)) return { outcome: "already", missed: 0 };
    await recordFailure(scope, actor, scheduleId, planned, runId, error, now);
    return { outcome: "failed", missed: 0 };
  }
}

async function recordFailure(
  scope: TenantScope,
  actor: Actor,
  scheduleId: string,
  planned: Planned | null,
  runId: string,
  error: unknown,
  now: Date,
) {
  const message = failureMessage(error);
  if (!(error instanceof GenerationError)) {
    // Server log only (never shown in the app): the technical cause.
    log.error("pm.generation_failed", { scheduleId }, error);
  }
  const orgId = actor.organization.id;
  await withTenant(scope, async (tx) => {
    const s = await tx.pmSchedule.findUnique({
      where: { id: scheduleId },
      select: {
        id: true,
        planId: true,
        assetId: true,
        nextSeq: true,
        nextDueOn: true,
        plan: { select: { approvedRevisionId: true, name: true } },
        asset: { select: { assetTag: true, hospitalId: true, departmentId: true } },
      },
    });
    if (!s || !s.plan.approvedRevisionId) return;
    const dueOn = planned?.dueOn ?? fromDbDate(s.nextDueOn);
    const seq = planned?.seq ?? s.nextSeq;
    const rows = await tx.$queryRaw<{ id: string; attempts: number }[]>`
      INSERT INTO pm_occurrences (id, organization_id, schedule_id, plan_id, asset_id, revision_id, seq, due_on,
                                  status, attempts, last_error, last_attempt_at, run_id, created_at, updated_at)
      VALUES (gen_random_uuid(), ${orgId}::uuid, ${s.id}::uuid, ${s.planId}::uuid, ${s.assetId}::uuid,
              ${s.plan.approvedRevisionId}::uuid, ${seq}, ${dueOn}::date, 'FAILED'::pm_occurrence_status, 1,
              ${message}, ${now}, ${runId}::uuid, now(), now())
      ON CONFLICT (schedule_id, due_on) DO UPDATE
        SET attempts = pm_occurrences.attempts + 1, last_error = EXCLUDED.last_error,
            last_attempt_at = EXCLUDED.last_attempt_at, run_id = EXCLUDED.run_id, updated_at = now()
        WHERE pm_occurrences.status = 'FAILED'
      RETURNING id, attempts`;
    if (!rows.length) return; // it is not a failed occurrence (e.g. a concurrent run succeeded)
    await audit(tx, {
      organizationId: orgId,
      actorUserId: auditActorId(actor),
      action: "pm.generation_failed",
      outcome: "FAILURE",
      entityType: "pm_occurrence",
      entityId: rows[0].id,
      metadata: { planId: s.planId, assetTag: s.asset.assetTag, dueOn, attempt: rows[0].attempts, reason: message },
    });
    await notify(tx, systemActor(orgId), await managersToAlert(tx, s.asset, true), {
      type: "pm.generation_failed",
      title: `PM work order could not be created: ${s.asset.assetTag}`,
      body: `${s.plan.name} · due ${formatDateOnly(dueOn)} · ${message}`,
      link: `/maintenance/review`,
      entityType: "pm_occurrence",
      entityId: rows[0].id,
      dedupeKey: `pm.failed:${rows[0].id}`,
    });
  });
}

// ─── Reminders ───────────────────────────────────────────────────────────────

/**
 * Upcoming (within 7 days), due today and overdue reminders for open PM work
 * orders. Each kind is sent once per occurrence and person (dedupe key).
 */
async function sendReminders(scope: TenantScope, orgId: string, now: Date, assetScope: Prisma.AssetWhereInput) {
  const system = systemActor(orgId);
  return withTenant(scope, async (tx) => {
    const open = await tx.pmOccurrence.findMany({
      where: { status: "WORK_ORDER_CREATED", asset: assetScope },
      select: {
        id: true,
        dueOn: true,
        plan: { select: { name: true } },
        asset: { select: { assetTag: true, name: true, hospital: { select: { timezone: true } } } },
        workOrder: {
          select: { id: true, number: true, assignedToId: true, hospitalId: true, departmentId: true, status: true },
        },
      },
      take: 5000,
    });
    let sent = 0;
    for (const o of open) {
      if (!o.workOrder) continue;
      const today = localToday(o.asset.hospital.timezone, now);
      const due = fromDbDate(o.dueOn);
      const kind =
        due === today ? "due_today" : due < today ? "overdue" : daysBetween(today, due) <= 7 ? "upcoming" : null;
      if (!kind) continue;
      const managers =
        kind === "overdue" || !o.workOrder.assignedToId ? await managersToAlert(tx, o.workOrder, false) : [];
      const recipients = [o.workOrder.assignedToId, ...managers];
      const title =
        kind === "overdue"
          ? `Overdue PM: ${o.asset.assetTag} ${o.asset.name}`
          : kind === "due_today"
            ? `PM due today: ${o.asset.assetTag} ${o.asset.name}`
            : `PM due ${formatDateOnly(due)}: ${o.asset.assetTag} ${o.asset.name}`;
      sent += await notify(tx, system, recipients, {
        type: `pm.${kind}`,
        title,
        body: `${o.workOrder.number} · ${o.plan.name}`,
        link: `/work-orders/${o.workOrder.id}`,
        entityType: "work_order",
        entityId: o.workOrder.id,
        dedupeKey: `pm.${kind}:${o.id}`,
      });
    }
    return sent;
  });
}

// ─── Runs ────────────────────────────────────────────────────────────────────

async function generateForOrganization(
  actor: Actor,
  trigger: "MANUAL" | "SCHEDULER",
  assetScope: Prisma.AssetWhereInput,
  now: Date,
): Promise<RunSummary> {
  const orgId = actor.organization.id;
  const scope: TenantScope = { userId: actor.user.id, organizationId: orgId };
  const run = await withTenant(scope, (tx) =>
    tx.pmGenerationRun.create({
      data: { organizationId: orgId, trigger, actorId: trigger === "MANUAL" ? actor.user.id : null, startedAt: now },
      select: { id: true },
    }),
  );
  // Coarse pre-filter (largest lead time is 90 days); exact checks per schedule.
  const horizon = toDbDate(addDays(now.toISOString().slice(0, 10), 92));
  const candidates = await withTenant(scope, (tx) =>
    tx.pmSchedule.findMany({
      where: { status: "ACTIVE", plan: { status: "ACTIVE" }, nextDueOn: { lte: horizon }, asset: assetScope },
      select: { id: true },
      orderBy: { nextDueOn: "asc" },
      take: 10_000,
    }),
  );
  const summary: RunSummary = {
    runId: run.id,
    organizationId: orgId,
    schedulesChecked: candidates.length,
    created: 0,
    missed: 0,
    skipped: 0,
    failed: 0,
    remindersSent: 0,
  };
  for (const c of candidates) {
    const r = await processSchedule(scope, actor, c.id, run.id, now);
    summary.missed += r.missed;
    if (r.outcome === "created") summary.created++;
    if (r.outcome === "skipped") summary.skipped++;
    if (r.outcome === "failed") summary.failed++;
  }
  summary.remindersSent = await sendReminders(scope, orgId, now, assetScope);
  await withTenant(scope, async (tx) => {
    await tx.pmGenerationRun.update({
      where: { id: run.id },
      data: {
        status: summary.failed ? "COMPLETED_WITH_FAILURES" : "COMPLETED",
        finishedAt: new Date(),
        schedulesChecked: summary.schedulesChecked,
        created: summary.created,
        missed: summary.missed,
        skipped: summary.skipped,
        failed: summary.failed,
        remindersSent: summary.remindersSent,
      },
    });
    await audit(tx, {
      organizationId: orgId,
      actorUserId: auditActorId(actor),
      action: "pm.generation_run",
      outcome: summary.failed ? "FAILURE" : "SUCCESS",
      entityType: "pm_generation_run",
      entityId: run.id,
      metadata: { trigger, ...summary, runId: undefined, organizationId: undefined },
    });
  });
  return summary;
}

/** "Run now" by a manager: only schedules for assets in their own scope. */
export async function runPmGenerationNow(ctx: AccessContext, opts: { now?: Date } = {}) {
  await requirePermission(ctx, "pm.generate", { entityType: "pm_generation_run" });
  return generateForOrganization(ctx, "MANUAL", assetScopeWhere(ctx), opts.now ?? new Date());
}

/**
 * The daily scheduler: every organisation that has active plans. Works inside
 * each organisation with the normal tenant context (RLS) and the restricted
 * database role; the only cross-organisation step is listing organisation ids.
 */
export async function runScheduledGeneration(opts: { now?: Date; organizationIds?: string[] } = {}) {
  const now = opts.now ?? new Date();
  const ids = await withTenant(
    { userId: SYSTEM_SCHEDULER, organizationId: null },
    (tx) => tx.$queryRaw<{ id: string }[]>`SELECT app_pm_organizations() AS id`,
  );
  const wanted = opts.organizationIds ? ids.filter((r) => opts.organizationIds!.includes(r.id)) : ids;
  const results: RunSummary[] = [];
  for (const { id } of wanted) results.push(await generateForOrganization(systemActor(id), "SCHEDULER", {}, now));
  return results;
}

export async function listGenerationRuns(ctx: AccessContext, take = 10) {
  await requirePermission(ctx, "pm.view", { entityType: "pm_generation_run" });
  return withTenant({ userId: ctx.user.id, organizationId: ctx.organization.id }, (tx) =>
    tx.pmGenerationRun.findMany({ orderBy: { startedAt: "desc" }, take }),
  );
}
