// Department spend by month: parts, in-house labour and external service.
//
// Only RECORDED figures, never estimates:
//   • Parts = quantity issued minus returned on a job, at the unit cost recorded when issued.
//   • Labour hours = the minutes people logged on jobs (a corrected line replaces the line it fixes).
//     Labour cost = hours x the hourly rate that applied to that person on the day the work was logged.
//     Work by someone with no rate still counts as hours, with no money value (reported as "unrated").
//   • External service = the cost on the supplier record, in the month it was completed.
//   • A job belongs to the department it was raised for. Months follow each hospital's time zone.
//   • Each currency is reported separately; currencies are never converted or added.
// Cost figures need analytics.financial and every view is audited.
import { Prisma } from "../db/generated/client";
import { withTenant } from "../db/tenant";
import { audit } from "../audit/audit";
import { requirePermission, type AccessContext } from "../authz/access";
import { NotFoundError } from "../authz/errors";
import { analyticsQuerySchema } from "@/lib/validation/analytics";
import { monthsBetween, resolvePeriod } from "@/lib/analytics/period";
import { todayFor } from "./pm-schedule";

const tenant = (ctx: AccessContext) => ({ userId: ctx.user.id, organizationId: ctx.organization.id });
const n = (v: bigint | number | string | null | undefined) => (v === null || v === undefined ? 0 : Number(v));

export type SpendRow = {
  month: string;
  departmentId: string;
  department: string;
  /** Hours logged by everyone, rated or not. */
  hours: number;
  currency: string | null;
  parts: number;
  labour: number;
  service: number;
  total: number;
};

export async function getDepartmentSpend(ctx: AccessContext, raw: unknown) {
  await requirePermission(ctx, "analytics.financial", { entityType: "analytics" });
  const q = analyticsQuerySchema.parse(raw ?? {});
  if (q.hospital && !ctx.hospitals.some((h) => h.id === q.hospital)) throw new NotFoundError("Hospital");
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
  const month = (col: Prisma.Sql) => Prisma.sql`to_char(${col} AT TIME ZONE h.timezone, 'YYYY-MM')`;

  return withTenant(tenant(ctx), async (tx) => {
    type Money = { month: string; department_id: string; currency: string; amount: string };
    const parts = await tx.$queryRaw<Money[]>`
      SELECT ${month(Prisma.sql`m.created_at`)} AS month, w.department_id, m.currency,
             (-sum(m.quantity * m.unit_cost))::numeric(14,2)::text AS amount
      FROM stock_movements m JOIN work_orders w ON w.id = m.work_order_id JOIN hospitals h ON h.id = w.hospital_id
      WHERE (${scope}) AND ${dept} AND m.type IN ('ISSUE', 'RETURN') AND m.unit_cost IS NOT NULL
        AND ${inPeriod(Prisma.sql`m.created_at`)}
      GROUP BY 1, 2, 3`;
    const service = await tx.$queryRaw<Money[]>`
      SELECT to_char(e.completed_on, 'YYYY-MM') AS month, w.department_id, e.currency,
             sum(e.cost)::numeric(14,2)::text AS amount
      FROM external_services e JOIN work_orders w ON w.id = e.work_order_id
      WHERE (${scope}) AND ${dept} AND e.status = 'COMPLETED' AND e.cost IS NOT NULL
        AND e.completed_on BETWEEN ${p.from}::date AND ${p.to}::date
      GROUP BY 1, 2, 3`;
    // Each logged line, priced with the rate in force on the day it was logged (if any).
    const LABOUR = Prisma.sql`
      FROM work_order_tasks t
      JOIN work_orders w ON w.id = t.work_order_id
      JOIN hospitals h ON h.id = w.hospital_id
      LEFT JOIN LATERAL (
        SELECT lr.hourly_rate, lr.currency FROM labour_rates lr
        WHERE lr.user_id = t.performed_by AND lr.effective_from <= (t.created_at AT TIME ZONE h.timezone)::date
        ORDER BY lr.effective_from DESC, lr.created_at DESC LIMIT 1) r ON TRUE
      WHERE (${scope}) AND ${dept} AND ${inPeriod(Prisma.sql`t.created_at`)}
        AND NOT EXISTS (SELECT 1 FROM work_order_tasks c WHERE c.corrects_task_id = t.id)`;
    const labour = await tx.$queryRaw<Money[]>`
      SELECT ${month(Prisma.sql`t.created_at`)} AS month, w.department_id, r.currency,
             sum(t.minutes / 60.0 * r.hourly_rate)::numeric(14,2)::text AS amount
      ${LABOUR} AND r.hourly_rate IS NOT NULL GROUP BY 1, 2, 3`;
    const hours = await tx.$queryRaw<{ month: string; department_id: string; minutes: bigint; unrated: bigint }[]>`
      SELECT ${month(Prisma.sql`t.created_at`)} AS month, w.department_id, sum(t.minutes) AS minutes,
             coalesce(sum(t.minutes) FILTER (WHERE r.hourly_rate IS NULL), 0) AS unrated
      ${LABOUR} GROUP BY 1, 2`;

    const ids = [...new Set([...parts, ...service, ...labour, ...hours].map((x) => x.department_id))];
    const departments = ids.length
      ? await tx.department.findMany({
          where: { id: { in: ids } },
          select: { id: true, name: true, hospital: { select: { code: true } } },
        })
      : [];
    const deptName = new Map(departments.map((d) => [d.id, `${d.hospital.code} · ${d.name}`]));

    // Merge into one row per (month, department, currency); hours ride on the first row of a month/department.
    const cells = new Map<string, SpendRow>();
    const cell = (m: string, d: string, currency: string | null) => {
      const key = `${m}|${d}|${currency ?? ""}`;
      let r = cells.get(key);
      if (!r) {
        r = {
          month: m,
          departmentId: d,
          department: deptName.get(d) ?? "Unknown department",
          hours: 0,
          currency,
          parts: 0,
          labour: 0,
          service: 0,
          total: 0,
        };
        cells.set(key, r);
      }
      return r;
    };
    for (const x of parts) cell(x.month, x.department_id, x.currency).parts += n(x.amount);
    for (const x of service) cell(x.month, x.department_id, x.currency).service += n(x.amount);
    for (const x of labour) cell(x.month, x.department_id, x.currency).labour += n(x.amount);
    const hourRows = new Map<string, { minutes: number; unrated: number }>();
    for (const x of hours) {
      hourRows.set(`${x.month}|${x.department_id}`, { minutes: n(x.minutes), unrated: n(x.unrated) });
      if (![...cells.keys()].some((k) => k.startsWith(`${x.month}|${x.department_id}|`)))
        cell(x.month, x.department_id, null); // hours with no money anywhere that month
    }
    const seen = new Set<string>();
    const rows = [...cells.values()].sort(
      (a, b) =>
        a.month.localeCompare(b.month) ||
        a.department.localeCompare(b.department) ||
        (a.currency ?? "").localeCompare(b.currency ?? ""),
    );
    for (const r of rows) {
      r.parts = Math.round(r.parts * 100) / 100;
      r.labour = Math.round(r.labour * 100) / 100;
      r.service = Math.round(r.service * 100) / 100;
      r.total = Math.round((r.parts + r.labour + r.service) * 100) / 100;
      const hk = `${r.month}|${r.departmentId}`;
      if (!seen.has(hk)) {
        seen.add(hk);
        r.hours = Math.round(((hourRows.get(hk)?.minutes ?? 0) / 60) * 10) / 10;
      }
    }
    const totalMinutes = [...hourRows.values()].reduce((a, b) => a + b.minutes, 0);
    const unratedMinutes = [...hourRows.values()].reduce((a, b) => a + b.unrated, 0);

    const totals = new Map<
      string,
      { currency: string; parts: number; labour: number; service: number; total: number }
    >();
    for (const r of rows) {
      if (!r.currency) continue;
      const t = totals.get(r.currency) ?? { currency: r.currency, parts: 0, labour: 0, service: 0, total: 0 };
      t.parts += r.parts;
      t.labour += r.labour;
      t.service += r.service;
      t.total += r.total;
      totals.set(r.currency, t);
    }

    await audit(tx, {
      organizationId: ctx.organization.id,
      actorUserId: ctx.user.id,
      action: "analytics.financial_viewed",
      entityType: "analytics",
      metadata: { report: "department-spend", hospital: q.hospital ?? null, from: p.from, to: p.to },
      request: ctx.request,
    });
    return {
      q,
      period: p,
      today,
      months: monthsBetween(p.from, p.to),
      rows,
      totals: [...totals.values()].map((t) => ({
        currency: t.currency,
        parts: Math.round(t.parts * 100) / 100,
        labour: Math.round(t.labour * 100) / 100,
        service: Math.round(t.service * 100) / 100,
        total: Math.round(t.total * 100) / 100,
      })),
      totalHours: Math.round((totalMinutes / 60) * 10) / 10,
      unratedHours: Math.round((unratedMinutes / 60) * 10) / 10,
    };
  });
}

export type DepartmentSpend = Awaited<ReturnType<typeof getDepartmentSpend>>;
