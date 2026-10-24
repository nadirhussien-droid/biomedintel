// Staff effectiveness: recorded work and results for each engineer, for managers.
//
// Every figure comes from records people made in the system (jobs assigned to
// them, minutes they logged, planned maintenance assigned to them). It is
// context for a conversation, not a ranking and not a single score:
//   • Completed jobs: jobs assigned to the person and signed off in the period.
//   • Hours logged: minutes the person logged on jobs in the period (a corrected line replaces the line it fixes).
//   • Mean time to complete: calendar time from reported to signed off, repair jobs only.
//   • Repeat faults: of their completed repair jobs, how many had another repair job on the same device
//     reported within 30 days after sign-off.
//   • Reopened jobs: their jobs that someone reopened in the period.
//   • Open now / overdue now: assigned jobs not yet finished, and those past their due date.
//   • PM on time: planned maintenance assigned to them, due in the period, signed off by the due date plus grace days.
// Needs analytics.workload (Organization Administrator and Engineering Manager only).
import { Prisma } from "../db/generated/client";
import { withTenant } from "../db/tenant";
import { audit } from "../audit/audit";
import { requirePermission, type AccessContext } from "../authz/access";
import { NotFoundError } from "../authz/errors";
import { analyticsQuerySchema } from "@/lib/validation/analytics";
import { resolvePeriod } from "@/lib/analytics/period";
import { peopleNames } from "./work-order-core";
import { pmComplianceMetrics, todayFor } from "./pm-schedule";

const tenant = (ctx: AccessContext) => ({ userId: ctx.user.id, organizationId: ctx.organization.id });
const n = (v: bigint | number | string | null | undefined) => (v === null || v === undefined ? 0 : Number(v));
const round1 = (v: number | null) => (v === null ? null : Math.round(v * 10) / 10);
const PLANNED = ["PREVENTIVE", "SAFETY_TEST", "INSPECTION", "CALIBRATION", "ACCEPTANCE"];

export type StaffRow = {
  userId: string;
  name: string;
  completed: number;
  corrective: number;
  planned: number;
  hours: number;
  hoursPerJob: number | null;
  meanCompletionH: number | null;
  repeatFaults: number;
  reopened: number;
  openNow: number;
  overdueNow: number;
  pmDue: number;
  pmOnTime: number;
  pmOnTimePct: number | null;
};

export async function getStaffEffectiveness(ctx: AccessContext, raw: unknown, opts: { now?: Date } = {}) {
  await requirePermission(ctx, "analytics.workload", { entityType: "analytics" });
  const q = analyticsQuerySchema.parse(raw ?? {});
  if (q.hospital && !ctx.hospitals.some((h) => h.id === q.hospital)) throw new NotFoundError("Hospital");
  const now = opts.now ?? new Date();
  const today = await todayFor(ctx, q.hospital);
  const p = resolvePeriod(q.period, today, { from: q.from, to: q.to });
  const scope = ctx.hospitals.length
    ? Prisma.join(
        ctx.hospitals
          .filter((h) => !q.hospital || h.id === q.hospital)
          .map((h) =>
            h.departments === "ALL"
              ? Prisma.sql`w.hospital_id = ${h.id}::uuid`
              : h.departments.length
                ? Prisma.sql`(w.hospital_id = ${h.id}::uuid AND w.department_id IN (${Prisma.join(h.departments.map((d) => Prisma.sql`${d}::uuid`))}))`
                : Prisma.sql`FALSE`,
          ),
        " OR ",
      )
    : Prisma.sql`FALSE`;
  const dept = q.department ? Prisma.sql`w.department_id = ${q.department}::uuid` : Prisma.sql`TRUE`;
  const inPeriod = (col: Prisma.Sql) =>
    Prisma.sql`(${col} >= (${p.from}::date)::timestamp AT TIME ZONE h.timezone AND ${col} < ((${p.to}::date + 1))::timestamp AT TIME ZONE h.timezone)`;
  const planned = Prisma.join(PLANNED.map((t) => Prisma.sql`${t}`));

  return withTenant(tenant(ctx), async (tx) => {
    const jobs = await tx.$queryRaw<
      {
        user_id: string;
        completed: bigint;
        corrective: bigint;
        planned: bigint;
        mean_h: number | null;
        repeat: bigint;
        reopened: bigint;
        open_now: bigint;
        overdue_now: bigint;
      }[]
    >`
      SELECT w.assigned_to AS user_id,
        count(*) FILTER (WHERE w.status = 'COMPLETED' AND ${inPeriod(Prisma.sql`w.completed_at`)}) AS completed,
        count(*) FILTER (WHERE w.status = 'COMPLETED' AND ${inPeriod(Prisma.sql`w.completed_at`)} AND w.type = 'CORRECTIVE') AS corrective,
        count(*) FILTER (WHERE w.status = 'COMPLETED' AND ${inPeriod(Prisma.sql`w.completed_at`)} AND w.type::text IN (${planned})) AS planned,
        avg(extract(epoch FROM w.completed_at - w.created_at) / 3600)
          FILTER (WHERE w.status = 'COMPLETED' AND ${inPeriod(Prisma.sql`w.completed_at`)} AND w.type = 'CORRECTIVE') AS mean_h,
        count(*) FILTER (WHERE w.status = 'COMPLETED' AND ${inPeriod(Prisma.sql`w.completed_at`)} AND w.type = 'CORRECTIVE'
          AND EXISTS (SELECT 1 FROM work_orders x WHERE x.asset_id = w.asset_id AND x.type = 'CORRECTIVE' AND x.id <> w.id
                      AND x.status <> 'CANCELLED' AND x.created_at > w.completed_at
                      AND x.created_at <= w.completed_at + interval '30 days')) AS repeat,
        count(*) FILTER (WHERE EXISTS (SELECT 1 FROM work_order_events e WHERE e.work_order_id = w.id AND e.kind = 'REOPENED'
                                        AND ${inPeriod(Prisma.sql`e.created_at`)})) AS reopened,
        count(*) FILTER (WHERE w.status IN ('ASSIGNED', 'IN_PROGRESS', 'ON_HOLD')) AS open_now,
        count(*) FILTER (WHERE w.status IN ('ASSIGNED', 'IN_PROGRESS', 'ON_HOLD') AND w.due_at IS NOT NULL AND w.due_at < ${now}) AS overdue_now
      FROM work_orders w JOIN hospitals h ON h.id = w.hospital_id
      WHERE w.assigned_to IS NOT NULL AND (${scope}) AND ${dept}
      GROUP BY 1`;
    const minutes = await tx.$queryRaw<{ user_id: string; minutes: bigint }[]>`
      SELECT t.performed_by AS user_id, sum(t.minutes) AS minutes
      FROM work_order_tasks t JOIN work_orders w ON w.id = t.work_order_id JOIN hospitals h ON h.id = w.hospital_id
      WHERE (${scope}) AND ${dept} AND ${inPeriod(Prisma.sql`t.created_at`)}
        AND NOT EXISTS (SELECT 1 FROM work_order_tasks c WHERE c.corrects_task_id = t.id)
      GROUP BY 1`;
    const pm = await pmComplianceMetrics(
      ctx,
      tx,
      { from: p.from, to: p.to, by: "assignee", hospital: q.hospital, department: q.department },
      now,
    );

    const ids = [
      ...new Set([...jobs.map((j) => j.user_id), ...minutes.map((m) => m.user_id), ...pm.groups.map((g) => g.key)]),
    ].filter((id) => id && id !== "none");
    const names = await peopleNames(tx, ids);
    const rows: StaffRow[] = ids
      .map((id) => {
        const j = jobs.find((x) => x.user_id === id);
        const mins = n(minutes.find((x) => x.user_id === id)?.minutes);
        const g = pm.groups.find((x) => x.key === id);
        const completed = n(j?.completed);
        return {
          userId: id,
          name: names[id] ?? "Unknown",
          completed,
          corrective: n(j?.corrective),
          planned: n(j?.planned),
          hours: round1(mins / 60) ?? 0,
          hoursPerJob: completed ? round1(mins / 60 / completed) : null,
          meanCompletionH: round1(j?.mean_h ?? null),
          repeatFaults: n(j?.repeat),
          reopened: n(j?.reopened),
          openNow: n(j?.open_now),
          overdueNow: n(j?.overdue_now),
          pmDue: g?.due ?? 0,
          pmOnTime: g?.onTime ?? 0,
          pmOnTimePct: g?.compliance ?? null,
        };
      })
      .filter((r) => r.completed || r.hours || r.openNow || r.pmDue || r.reopened)
      .sort((a, b) => a.name.localeCompare(b.name));

    await audit(tx, {
      organizationId: ctx.organization.id,
      actorUserId: ctx.user.id,
      action: "analytics.workload_viewed",
      entityType: "analytics",
      metadata: { report: "staff-effectiveness", hospital: q.hospital ?? null, from: p.from, to: p.to },
      request: ctx.request,
    });
    return { q, period: p, today, rows };
  });
}

export type StaffEffectiveness = Awaited<ReturnType<typeof getStaffEffectiveness>>;
