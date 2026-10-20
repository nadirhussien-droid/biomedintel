// Scheduled reports (Stage 7).
//
// A schedule says WHAT (report kind), HOW OFTEN (weekly or monthly), WHERE
// (one hospital, or the whole organisation) and WHO receives it. The daily
// job (see daily-jobs.ts) stores a read-only SNAPSHOT for each completed
// period and tells recipients in the app. There is no email provider yet, so
// nothing leaves BiomedIntel.ai.
//
// Safety and privacy rules:
//   • UNIQUE (schedule, period) — a retried or concurrent run never creates
//     a second snapshot or a second notification.
//   • Snapshots are computed with a READ-ONLY context limited to the
//     schedule's hospital (or organisation) — never wider than the creator
//     was allowed to choose — using the Auditor role, so they never contain
//     per-engineer workload or financial figures.
//   • Recipients are re-checked at every run: still an active member, still
//     allowed to view analytics, still covering the schedule's hospital.
//   • Snapshots are append-only (database trigger), so a past report never changes.
import type { Prisma } from "../db/generated/client";
import { withTenant, type Tx } from "../db/tenant";
import { audit } from "../audit/audit";
import { can, requirePermission, type AccessContext, type HospitalAccess } from "../authz/access";
import { NotFoundError, ValidationError } from "../authz/errors";
import { roleCan } from "../authz/permissions";
import type { MembershipRole } from "../authz/roles";
import { isUniqueViolation, parseInput } from "../validation";
import { notify } from "./notifications";
import { peopleNames, SYSTEM_SCHEDULER, systemActor } from "./work-order-core";
import {
  getAnalyticsOverview,
  getPmComplianceReport,
  getReliabilityReport,
  getSafetyReport,
  getWorkOrderAnalytics,
} from "./analytics";
import { localToday } from "@/lib/pm/dates";
import { previousCompletePeriod } from "@/lib/analytics/period";
import { REPORT_KIND_LABELS, scheduleSchema } from "@/lib/validation/analytics";
import { log } from "../log";

const tenant = (ctx: AccessContext) => ({ userId: ctx.user.id, organizationId: ctx.organization.id });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Kind = "OVERVIEW" | "PM_COMPLIANCE" | "WORK_ORDERS" | "RELIABILITY" | "SAFETY";

/** Members who may receive a report for this hospital (null = organisation-wide report). */
async function eligibleRecipients(tx: Tx, hospitalId: string | null) {
  const members = await tx.membership.findMany({
    where: { status: "ACTIVE" },
    select: { userId: true, role: true, orgWide: true, scopes: { select: { hospitalId: true, departmentId: true } } },
  });
  return members.filter(
    (m) =>
      roleCan(m.role as MembershipRole, "analytics.view") &&
      (m.orgWide ||
        (hospitalId !== null && m.scopes.some((s) => s.hospitalId === hospitalId && s.departmentId === null))),
  );
}

/** Snapshot visibility: analytics permission and coverage of the snapshot's hospital. */
function canSeeScope(ctx: AccessContext, hospitalId: string | null) {
  if (!can(ctx, "analytics.view")) return false;
  if (hospitalId === null) return ctx.orgWide;
  const h = ctx.hospitals.find((x) => x.id === hospitalId);
  return Boolean(h && h.departments === "ALL");
}

// ─── Managing schedules ──────────────────────────────────────────────────────

export async function listReportSchedules(ctx: AccessContext) {
  await requirePermission(ctx, "analytics.view", { entityType: "report_schedule" });
  return withTenant(tenant(ctx), async (tx) => {
    const schedules = await tx.reportSchedule.findMany({
      orderBy: [{ active: "desc" }, { name: "asc" }],
      include: { hospital: { select: { code: true, name: true } } },
    });
    const visible = schedules.filter((s) => canSeeScope(ctx, s.hospitalId));
    const snapshots = await tx.reportSnapshot.findMany({
      orderBy: { generatedAt: "desc" },
      take: 100,
      select: {
        id: true,
        kind: true,
        hospitalId: true,
        periodFrom: true,
        periodTo: true,
        generatedAt: true,
        scheduleId: true,
      },
    });
    // Recipient choices: members allowed to view analytics. Each choice is
    // re-checked against the chosen hospital when the schedule is saved.
    const members = can(ctx, "reports.schedule")
      ? (await tx.membership.findMany({ where: { status: "ACTIVE" }, select: { userId: true, role: true } })).filter(
          (m) => roleCan(m.role as MembershipRole, "analytics.view"),
        )
      : [];
    const names = await peopleNames(tx, [
      ...visible.flatMap((s) => [...s.recipientIds, s.createdById]),
      ...members.map((m) => m.userId),
    ]);
    return {
      schedules: visible,
      snapshots: snapshots.filter((s) => canSeeScope(ctx, s.hospitalId)),
      names,
      people: members
        .map((m) => ({ userId: m.userId, name: names[m.userId] ?? "Unknown", role: m.role }))
        .sort((x, y) => x.name.localeCompare(y.name)),
    };
  });
}

export async function createReportSchedule(ctx: AccessContext, input: unknown) {
  await requirePermission(ctx, "reports.schedule", { entityType: "report_schedule" });
  const data = parseInput(scheduleSchema, input);
  if (data.hospitalId === null && !ctx.orgWide) {
    throw new ValidationError("Choose the hospital this report covers.", {
      hospitalId: ["Only organisation-wide staff can schedule organisation-wide reports"],
    });
  }
  if (data.hospitalId && !canSeeScope(ctx, data.hospitalId)) {
    throw new ValidationError("Choose a hospital you manage.", { hospitalId: ["Outside your access"] });
  }
  return withTenant(tenant(ctx), async (tx) => {
    const eligible = new Set((await eligibleRecipients(tx, data.hospitalId)).map((m) => m.userId));
    const bad = data.recipientIds.filter((id) => !eligible.has(id));
    if (bad.length) {
      throw new ValidationError("Some recipients may not see this report.", {
        recipientIds: ["Recipients must be allowed to view analytics for the whole of the chosen hospital"],
      });
    }
    const row = await tx.reportSchedule.create({
      data: {
        organizationId: ctx.organization.id,
        name: data.name,
        kind: data.kind,
        frequency: data.frequency,
        hospitalId: data.hospitalId,
        recipientIds: [...new Set(data.recipientIds)],
        createdById: ctx.user.id,
        updatedById: ctx.user.id,
      },
      select: { id: true },
    });
    await audit(tx, {
      organizationId: ctx.organization.id,
      actorUserId: ctx.user.id,
      action: "report.schedule_created",
      entityType: "report_schedule",
      entityId: row.id,
      metadata: {
        kind: data.kind,
        frequency: data.frequency,
        hospitalId: data.hospitalId,
        recipients: data.recipientIds.length,
      },
      request: ctx.request,
    });
    return row;
  });
}

export async function setReportScheduleActive(ctx: AccessContext, input: unknown) {
  await requirePermission(ctx, "reports.schedule", { entityType: "report_schedule" });
  const id = String((input as { id?: unknown })?.id ?? "");
  const active = (input as { active?: unknown })?.active === true;
  if (!UUID.test(id)) throw new NotFoundError("Report schedule");
  return withTenant(tenant(ctx), async (tx) => {
    const s = await tx.reportSchedule.findUnique({ where: { id }, select: { hospitalId: true } });
    if (!s || !canSeeScope(ctx, s.hospitalId)) throw new NotFoundError("Report schedule");
    await tx.reportSchedule.update({ where: { id }, data: { active, updatedById: ctx.user.id } });
    await audit(tx, {
      organizationId: ctx.organization.id,
      actorUserId: ctx.user.id,
      action: active ? "report.schedule_resumed" : "report.schedule_paused",
      entityType: "report_schedule",
      entityId: id,
      request: ctx.request,
    });
  });
}

export async function getReportSnapshot(ctx: AccessContext, id: string) {
  await requirePermission(ctx, "analytics.view", { entityType: "report_snapshot" });
  if (!UUID.test(id)) throw new NotFoundError("Report");
  return withTenant(tenant(ctx), async (tx) => {
    const snap = await tx.reportSnapshot.findUnique({
      where: { id },
      include: { schedule: { select: { name: true } } },
    });
    if (!snap || !canSeeScope(ctx, snap.hospitalId)) throw new NotFoundError("Report");
    const hospital = snap.hospitalId
      ? await tx.hospital.findUnique({ where: { id: snap.hospitalId }, select: { code: true, name: true } })
      : null;
    return { ...snap, hospital };
  });
}

// ─── Generation ──────────────────────────────────────────────────────────────

/** A read-only context limited to the schedule's hospital (or the whole organisation). */
async function reportContext(
  tx: Tx,
  organization: { id: string; name: string; slug: string },
  hospitalId: string | null,
) {
  const hospitals = await tx.hospital.findMany({
    where: { status: "ACTIVE", ...(hospitalId ? { id: hospitalId } : {}) },
    select: { id: true, name: true, code: true },
  });
  const access: HospitalAccess[] = hospitals.map((h) => ({ ...h, departments: "ALL" }));
  const ctx: AccessContext = {
    user: {
      id: SYSTEM_SCHEDULER,
      name: "BiomedIntel.ai scheduler",
      email: "",
      twoFactorEnabled: true,
      isPlatformAdmin: false,
    },
    organization,
    membershipId: "",
    role: "AUDITOR", // read-only: no workload per engineer, no financial figures
    orgWide: hospitalId === null,
    hospitals: access,
    organizations: [],
    mfaRequired: false,
  };
  return ctx;
}

const json = (v: unknown) => JSON.parse(JSON.stringify(v)) as Prisma.InputJsonValue;

async function computeReport(ctx: AccessContext, kind: Kind, from: string, to: string, now: Date) {
  const q = { period: "custom", from, to };
  if (kind === "OVERVIEW") {
    const o = await getAnalyticsOverview(ctx, q, { now });
    return { metrics: o.metrics, periodLabel: o.period.label };
  }
  if (kind === "PM_COMPLIANCE") {
    const r = await getPmComplianceReport(ctx, { ...q, by: "department" }, { now });
    return { total: r.total, groups: r.groups, months: r.months, periodLabel: r.period.label };
  }
  if (kind === "WORK_ORDERS") {
    const r = await getWorkOrderAnalytics(ctx, q, { now });
    return {
      counts: r.counts,
      durations: r.durations,
      target: r.target,
      backlog: r.backlog,
      repeats: { count: r.repeats.list.length, rate: r.repeats.rate },
      periodLabel: r.period.label,
    };
  }
  if (kind === "RELIABILITY") {
    const r = await getReliabilityReport(ctx, q, { now });
    return {
      failures: r.failures,
      faultCategories: r.faultCategories,
      repeatAssets: r.repeatAssets,
      durations: r.durations,
      monthly: r.monthly,
      periodLabel: r.period.label,
    };
  }
  const r = await getSafetyReport(ctx, q, { now });
  return {
    tests: r.tests,
    holds: {
      awaitingRepair: r.holds.awaitingRepair.length,
      awaitingRetest: r.holds.awaitingRetest.length,
      awaitingApproval: r.holds.awaitingApproval.length,
    },
    released: r.released.length,
    overdue: r.overdue.length,
    periodLabel: r.period.label,
  };
}

export type ReportRunResult = { scheduleId: string; outcome: "created" | "exists" | "failed"; snapshotId?: string };

/** Creates the snapshot for the last complete period of one schedule (idempotent). */
async function generateForSchedule(
  organizationId: string,
  scheduleId: string,
  now: Date,
  actorId: string,
): Promise<ReportRunResult> {
  const scope = { userId: actorId, organizationId };
  try {
    return await withTenant(scope, async (tx) => {
      const s = await tx.reportSchedule.findUnique({ where: { id: scheduleId } });
      if (!s || !s.active) return { scheduleId, outcome: "exists" as const };
      const org = await tx.organization.findUniqueOrThrow({
        where: { id: organizationId },
        select: { id: true, name: true, slug: true },
      });
      const tzHospital = await tx.hospital.findFirst({
        where: s.hospitalId ? { id: s.hospitalId } : { status: "ACTIVE" },
        select: { timezone: true },
        orderBy: { createdAt: "asc" },
      });
      const period = previousCompletePeriod(s.frequency, localToday(tzHospital?.timezone ?? "UTC", now));
      const existing = await tx.reportSnapshot.findUnique({
        where: { scheduleId_periodKey: { scheduleId: s.id, periodKey: period.key } },
        select: { id: true },
      });
      if (existing) return { scheduleId, outcome: "exists" as const, snapshotId: existing.id };
      const ctx = await reportContext(tx, org, s.hospitalId);
      const data = await computeReport(ctx, s.kind as Kind, period.from, period.to, now);
      const snap = await tx.reportSnapshot.create({
        data: {
          organizationId,
          scheduleId: s.id,
          kind: s.kind,
          hospitalId: s.hospitalId,
          periodFrom: new Date(`${period.from}T00:00:00.000Z`),
          periodTo: new Date(`${period.to}T00:00:00.000Z`),
          periodKey: period.key,
          data: json(data),
          generatedById: actorId,
          generatedAt: now,
        },
        select: { id: true },
      });
      const eligible = new Set((await eligibleRecipients(tx, s.hospitalId)).map((m) => m.userId));
      const recipients = s.recipientIds.filter((id) => eligible.has(id));
      await notify(tx, systemActor(organizationId), recipients, {
        type: "report.ready",
        title: `Report ready: ${s.name}`,
        body: `${REPORT_KIND_LABELS[s.kind]} · ${period.from} to ${period.to}`,
        link: `/reports/scheduled/${snap.id}`,
        entityType: "report_snapshot",
        entityId: snap.id,
        dedupeKey: `report:${snap.id}`,
      });
      await audit(tx, {
        organizationId,
        actorUserId: actorId.startsWith("system:") ? null : actorId,
        action: "report.snapshot_generated",
        entityType: "report_snapshot",
        entityId: snap.id,
        metadata: {
          scheduleId: s.id,
          kind: s.kind,
          period: period.key,
          recipients: recipients.length,
          recipientsDropped: s.recipientIds.length - recipients.length || undefined,
        },
      });
      return { scheduleId, outcome: "created" as const, snapshotId: snap.id };
    });
  } catch (error) {
    if (isUniqueViolation(error)) return { scheduleId, outcome: "exists" };
    log.error("reports.schedule_failed", { scheduleId }, error);
    await withTenant(scope, (tx) =>
      audit(tx, {
        organizationId,
        actorUserId: null,
        action: "report.generation_failed",
        outcome: "FAILURE",
        entityType: "report_schedule",
        entityId: scheduleId,
        metadata: { reason: "Report could not be generated; see the server log. It is retried on the next run." },
      }),
    );
    return { scheduleId, outcome: "failed" };
  }
}

/** "Generate now" by a manager: the last complete period (never a duplicate). */
export async function generateReportNow(ctx: AccessContext, input: unknown, opts: { now?: Date } = {}) {
  await requirePermission(ctx, "reports.schedule", { entityType: "report_schedule" });
  const id = String((input as { id?: unknown })?.id ?? "");
  if (!UUID.test(id)) throw new NotFoundError("Report schedule");
  const s = await withTenant(tenant(ctx), (tx) =>
    tx.reportSchedule.findUnique({ where: { id }, select: { hospitalId: true } }),
  );
  if (!s || !canSeeScope(ctx, s.hospitalId)) throw new NotFoundError("Report schedule");
  return generateForSchedule(ctx.organization.id, id, opts.now ?? new Date(), ctx.user.id);
}

/** The daily job: every active schedule of every organisation that has one. */
export async function runScheduledReports(opts: { now?: Date; organizationIds?: string[] } = {}) {
  const now = opts.now ?? new Date();
  const orgs = await withTenant(
    { userId: SYSTEM_SCHEDULER, organizationId: null },
    (tx) => tx.$queryRaw<{ id: string }[]>`SELECT app_report_organizations() AS id`,
  );
  const results: ReportRunResult[] = [];
  for (const { id: orgId } of orgs) {
    if (opts.organizationIds && !opts.organizationIds.includes(orgId)) continue;
    const schedules = await withTenant({ userId: SYSTEM_SCHEDULER, organizationId: orgId }, (tx) =>
      tx.reportSchedule.findMany({ where: { active: true }, select: { id: true } }),
    );
    for (const s of schedules) results.push(await generateForSchedule(orgId, s.id, now, SYSTEM_SCHEDULER));
  }
  return results;
}
