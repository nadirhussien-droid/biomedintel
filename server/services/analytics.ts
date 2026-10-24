// Analytics and reporting (Stage 7). READ-ONLY.
//
// Every function: requirePermission → validate the query → check filters
// against the user's scope → aggregate IN THE DATABASE under RLS
// (withTenant) and the user's hospital/department scope. Nothing here writes
// operational records; the only writes are audit events for exports and
// financial views.
//
// Reporting periods are calendar dates in each record's hospital time zone
// (lib/analytics/period.ts). Durations are CALENDAR time (no working hours or
// holidays are configured). Every figure returned carries its definition.
import { Prisma } from "../db/generated/client";
import { withTenant } from "../db/tenant";
import { audit } from "../audit/audit";
import { can, requirePermission, type AccessContext } from "../authz/access";
import { NotFoundError } from "../authz/errors";
import { assetScopeWhere } from "./assets";
import { toCsv, type ExportDoc, type ExportFormat, type Section } from "../export/document";
import { renderExport } from "../export/render";
import { peopleNames } from "./work-order-core";
import { withoutApprovedPmWhere } from "./pm-plans";
import {
  hospitalDays,
  ITEMS,
  pmComplianceMetrics,
  scopeSql,
  todaySql,
  todayFor,
  type ComplianceGroupBy,
} from "./pm-schedule";
import { monthsBetween, percent, resolvePeriod, type Period } from "@/lib/analytics/period";
import { addDays, intervalLabel, type IntervalUnitValue } from "@/lib/pm/dates";
import { analyticsQuerySchema, REPORT_TITLES, type AnalyticsQuery, type ReportName } from "@/lib/validation/analytics";
import { FAILURE_CATEGORY_LABELS, type FailureCategoryValue } from "@/lib/validation/work-orders";

const tenant = (ctx: AccessContext) => ({ userId: ctx.user.id, organizationId: ctx.organization.id });
const n = (v: bigint | number | null | undefined) => (v === null || v === undefined ? 0 : Number(v));
const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));
const round1 = (v: number | null) => (v === null ? null : Math.round(v * 10) / 10);
const PLANNED_TYPES = ["PREVENTIVE", "SAFETY_TEST", "INSPECTION", "CALIBRATION", "ACCEPTANCE"];

export type Metric = {
  key: string;
  label: string;
  value: number | null;
  display: string;
  definition: string;
  basis: "now" | "period";
  href?: string;
  tone?: "danger" | "warn" | "ok";
};

// ─── Shared query plumbing ───────────────────────────────────────────────────

export type Resolved = { q: AnalyticsQuery; period: Period; today: string };

/** Validates the query and its filters against the user's scope. */
async function resolve(ctx: AccessContext, raw: unknown): Promise<Resolved> {
  const q = analyticsQuerySchema.parse(raw ?? {});
  // Filtering by one engineer is individual performance: management only.
  if (q.assignee && !can(ctx, "analytics.workload")) throw new NotFoundError("Report");
  if (q.hospital && !ctx.hospitals.some((h) => h.id === q.hospital)) throw new NotFoundError("Hospital");
  if (q.department) {
    const ok = ctx.hospitals.some(
      (h) =>
        (q.hospital ? h.id === q.hospital : true) && (h.departments === "ALL" || h.departments.includes(q.department!)),
    );
    if (!ok) throw new NotFoundError("Department");
  }
  const today = await todayFor(ctx, q.hospital);
  return { q, period: resolvePeriod(q.period, today, { from: q.from, to: q.to }), today };
}

/** Work order scope on the job's own hospital/department (alias w). */
function woScopeSql(ctx: AccessContext): Prisma.Sql {
  if (!ctx.hospitals.length) return Prisma.sql`FALSE`;
  const parts = ctx.hospitals.map((h) =>
    h.departments === "ALL"
      ? Prisma.sql`w.hospital_id = ${h.id}::uuid`
      : h.departments.length
        ? Prisma.sql`(w.hospital_id = ${h.id}::uuid AND w.department_id IN (${Prisma.join(h.departments.map((d) => Prisma.sql`${d}::uuid`))}))`
        : Prisma.sql`FALSE`,
  );
  return Prisma.sql`(${Prisma.join(parts, " OR ")})`;
}

/** Asset-level filters (alias a, m). */
function assetFilters(q: AnalyticsQuery): Prisma.Sql[] {
  const f: Prisma.Sql[] = [];
  if (q.hospital) f.push(Prisma.sql`a.hospital_id = ${q.hospital}::uuid`);
  if (q.department) f.push(Prisma.sql`a.department_id = ${q.department}::uuid`);
  if (q.location) f.push(Prisma.sql`a.location_id = ${q.location}::uuid`);
  if (q.category) f.push(Prisma.sql`m.category_id = ${q.category}::uuid`);
  return f;
}

/** Work order filters (alias w, a, m). */
function woFilters(q: AnalyticsQuery, opts: { status?: boolean } = { status: true }): Prisma.Sql[] {
  const f: Prisma.Sql[] = [];
  if (q.hospital) f.push(Prisma.sql`w.hospital_id = ${q.hospital}::uuid`);
  if (q.department) f.push(Prisma.sql`w.department_id = ${q.department}::uuid`);
  if (q.location) f.push(Prisma.sql`a.location_id = ${q.location}::uuid`);
  if (q.category) f.push(Prisma.sql`m.category_id = ${q.category}::uuid`);
  if (q.priority) f.push(Prisma.sql`w.priority = ${q.priority}::work_order_priority`);
  if (q.assignee) f.push(Prisma.sql`w.assigned_to = ${q.assignee}`);
  if (opts.status && q.status) f.push(Prisma.sql`w.status = ${q.status}::work_order_status`);
  return f;
}

const and = (parts: Prisma.Sql[]) => (parts.length ? Prisma.join(parts, " AND ") : Prisma.sql`TRUE`);

/** Timestamp `col` falls inside the period, in the hospital's time zone (alias h). */
const inPeriod = (col: Prisma.Sql, p: Period) =>
  Prisma.sql`(${col} >= (${p.from}::date)::timestamp AT TIME ZONE h.timezone AND ${col} < ((${p.to}::date + 1))::timestamp AT TIME ZONE h.timezone)`;

const WO_FROM = Prisma.sql`
  FROM work_orders w
  JOIN hospitals h ON h.id = w.hospital_id
  JOIN assets a ON a.id = w.asset_id
  JOIN equipment_models m ON m.id = a.model_id`;

function qs(r: Resolved, extra: Record<string, string | undefined> = {}) {
  const p = new URLSearchParams();
  const base: Record<string, string | undefined> = {
    hospital: r.q.hospital,
    department: r.q.department,
    priority: r.q.priority,
    ...extra,
  };
  for (const [k, v] of Object.entries(base)) if (v) p.set(k, v);
  return p.toString();
}

const hours = (v: number | null) => (v === null ? "N/A" : v < 48 ? `${round1(v)} h` : `${round1(v / 24)} days`);

// ─── Filter choices ──────────────────────────────────────────────────────────

/** Choices for the report filters, limited to the user's scope. */
export async function analyticsFilterOptions(ctx: AccessContext) {
  await requirePermission(ctx, "analytics.view", { entityType: "analytics" });
  return withTenant(tenant(ctx), async (tx) => {
    const inScope = ctx.hospitals.map((h) =>
      h.departments === "ALL" ? { hospitalId: h.id } : { hospitalId: h.id, id: { in: h.departments } },
    );
    const [departments, categories, locations, workers] = await Promise.all([
      tx.department.findMany({
        where: { status: "ACTIVE", OR: inScope.length ? inScope : [{ id: "00000000-0000-0000-0000-000000000000" }] },
        select: { id: true, name: true, hospital: { select: { code: true } } },
        orderBy: [{ hospital: { code: "asc" } }, { name: "asc" }],
      }),
      tx.equipmentCategory.findMany({
        where: { status: "ACTIVE" },
        select: { id: true, name: true },
        orderBy: { name: "asc" },
      }),
      tx.location.findMany({
        where: {
          status: "ACTIVE",
          OR: ctx.hospitals.length
            ? ctx.hospitals.map((h) =>
                h.departments === "ALL"
                  ? { hospitalId: h.id }
                  : { hospitalId: h.id, departmentId: { in: h.departments } },
              )
            : [{ id: "00000000-0000-0000-0000-000000000000" }],
        },
        select: { id: true, name: true, hospital: { select: { code: true } } },
        orderBy: { name: "asc" },
      }),
      can(ctx, "analytics.workload")
        ? tx.membership.findMany({
            where: { status: "ACTIVE", role: { in: ["TECHNICIAN", "ENGINEERING_MANAGER"] } },
            select: { userId: true },
          })
        : Promise.resolve([]),
    ]);
    const names = await peopleNames(
      tx,
      workers.map((w) => w.userId),
    );
    return {
      hospitals: ctx.hospitals.map((h) => ({ id: h.id, code: h.code, name: h.name })),
      departments: departments.map((d) => ({ id: d.id, name: `${d.hospital.code} · ${d.name}` })),
      categories,
      locations: locations.map((l) => ({ id: l.id, name: `${l.hospital.code} · ${l.name}` })),
      engineers: workers
        .map((w) => ({ id: w.userId, name: names[w.userId] ?? "Unknown" }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    };
  });
}

// ─── Dashboard ───────────────────────────────────────────────────────────────

export async function getAnalyticsOverview(ctx: AccessContext, raw: unknown, opts: { now?: Date } = {}) {
  await requirePermission(ctx, "analytics.view", { entityType: "analytics" });
  const r = await resolve(ctx, raw);
  const { q, period: p } = r;
  const now = opts.now ?? new Date();
  return withTenant(tenant(ctx), async (tx) => {
    const [assets] = await tx.$queryRaw<{ registered: bigint; in_service: bigint; unavailable: bigint }[]>`
      SELECT count(*) FILTER (WHERE a.status <> 'DECOMMISSIONED') AS registered,
             count(*) FILTER (WHERE a.status = 'IN_SERVICE') AS in_service,
             count(*) FILTER (WHERE a.status IN ('OUT_OF_SERVICE', 'UNDER_REPAIR')) AS unavailable
      FROM assets a JOIN equipment_models m ON m.id = a.model_id
      WHERE a.archived_at IS NULL AND ${scopeSql(ctx)} AND ${and(assetFilters(q))}`;
    const [wo] = await tx.$queryRaw<
      {
        open: bigint;
        awaiting_review: bigint;
        backlog_30: bigint;
        completed: bigint;
        avg_h: number | null;
        median_h: number | null;
        created: bigint;
      }[]
    >`
      SELECT
        count(*) FILTER (WHERE w.status IN ('REQUESTED','ASSIGNED','IN_PROGRESS','ON_HOLD')) AS open,
        count(*) FILTER (WHERE w.status = 'COMPLETED' AND w.safety_critical AND w.reviewed_at IS NULL) AS awaiting_review,
        count(*) FILTER (WHERE w.status IN ('REQUESTED','ASSIGNED','IN_PROGRESS','ON_HOLD') AND w.created_at < ${now}::timestamptz - interval '30 days') AS backlog_30,
        count(*) FILTER (WHERE w.status = 'COMPLETED' AND ${inPeriod(Prisma.sql`w.completed_at`, p)}) AS completed,
        avg(extract(epoch FROM w.completed_at - w.created_at) / 3600) FILTER (WHERE w.status = 'COMPLETED' AND ${inPeriod(Prisma.sql`w.completed_at`, p)}) AS avg_h,
        percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM w.completed_at - w.created_at) / 3600)
          FILTER (WHERE w.status = 'COMPLETED' AND ${inPeriod(Prisma.sql`w.completed_at`, p)}) AS median_h,
        count(*) FILTER (WHERE ${inPeriod(Prisma.sql`w.created_at`, p)}) AS created
      ${WO_FROM}
      WHERE ${woScopeSql(ctx)} AND ${and(woFilters(q, { status: false }))}`;
    const days = await hospitalDays(ctx, tx, now);
    const open = Prisma.join(["SCHEDULED", "WORK_ORDER_CREATED", "FAILED"].map((s) => Prisma.sql`${s}`));
    const [pm] = await tx.$queryRaw<{ overdue: bigint; due30: bigint }[]>`
      SELECT count(*) FILTER (WHERE i.status IN (${open}) AND i.due_on < t.d) AS overdue,
             count(*) FILTER (WHERE i.status IN (${open}) AND i.due_on >= t.d AND i.due_on <= t.d + 30) AS due30
      FROM (${ITEMS}) i
      JOIN assets a ON a.id = i.asset_id
      JOIN equipment_models m ON m.id = a.model_id
      JOIN (${todaySql(days)}) t(hospital_id, d) ON t.hospital_id = a.hospital_id
      WHERE ${scopeSql(ctx)} AND ${and(assetFilters(q))}`;
    const compliance = await pmComplianceMetrics(
      ctx,
      tx,
      {
        from: p.from,
        to: p.to,
        by: "none",
        hospital: q.hospital,
        department: q.department,
        category: q.category,
        location: q.location,
        assignee: q.assignee,
      },
      now,
    );
    const [safety] = await tx.$queryRaw<{ failed: bigint; tested: bigint }[]>`
      SELECT count(*) FILTER (WHERE w.electrical_safety_check = 'FAIL') AS failed,
             count(*) FILTER (WHERE w.electrical_safety_check IN ('PASS','FAIL')) AS tested
      ${WO_FROM}
      WHERE w.status = 'COMPLETED' AND ${inPeriod(Prisma.sql`w.completed_at`, p)} AND ${woScopeSql(ctx)} AND ${and(woFilters(q, { status: false }))}`;
    const [holds] = await tx.$queryRaw<{ repair: bigint; retest: bigint; approval: bigint }[]>`
      SELECT count(*) FILTER (WHERE s.status = 'AWAITING_REPAIR') AS repair,
             count(*) FILTER (WHERE s.status = 'AWAITING_RETEST') AS retest,
             count(*) FILTER (WHERE s.status = 'AWAITING_APPROVAL') AS approval
      FROM safety_holds s JOIN assets a ON a.id = s.asset_id JOIN equipment_models m ON m.id = a.model_id
      WHERE ${scopeSql(ctx)} AND ${and(assetFilters(q))}`;
    const [recurring] = await tx.$queryRaw<{ assets: bigint }[]>`
      SELECT count(*) AS assets FROM (
        SELECT w.asset_id ${WO_FROM}
        WHERE w.type = 'CORRECTIVE' AND w.status <> 'CANCELLED' AND ${inPeriod(Prisma.sql`w.created_at`, p)}
          AND ${woScopeSql(ctx)} AND ${and(woFilters(q, { status: false }))}
        GROUP BY w.asset_id HAVING count(*) >= 2) x`;

    const base = qs(r);
    const c = compliance.total;
    const metrics: Metric[] = [
      {
        key: "registered",
        label: "Registered equipment",
        value: n(assets.registered),
        display: String(n(assets.registered)),
        basis: "now",
        definition: "Assets in the register that are not archived or decommissioned.",
        href: `/assets?${base}`,
      },
      {
        key: "in_service",
        label: "In service",
        value: n(assets.in_service),
        display: String(n(assets.in_service)),
        basis: "now",
        definition: "Registered assets whose current status is In service.",
        href: `/assets?status=IN_SERVICE&${base}`,
      },
      {
        key: "unavailable",
        label: "Unavailable",
        value: n(assets.unavailable),
        display: String(n(assets.unavailable)),
        basis: "now",
        definition: "Registered assets currently Out of service or Under repair.",
        href: `/assets?status=OUT_OF_SERVICE&${base}`,
        tone: n(assets.unavailable) ? "warn" : undefined,
      },
      {
        key: "open_wo",
        label: "Open work orders",
        value: n(wo.open),
        display: String(n(wo.open)),
        basis: "now",
        definition: "Jobs that are Reported, Assigned, In progress or On hold, right now.",
        href: `/work-orders?view=open&${base}`,
      },
      {
        key: "awaiting_review",
        label: "Jobs awaiting manager review",
        value: n(wo.awaiting_review),
        display: String(n(wo.awaiting_review)),
        basis: "now",
        definition:
          "Safety-critical jobs signed off by the technician and not yet reviewed by a manager (review never blocks return to service).",
        href: `/work-orders?view=review&${base}`,
      },
      {
        key: "backlog",
        label: "Backlog older than 30 days",
        value: n(wo.backlog_30),
        display: String(n(wo.backlog_30)),
        basis: "now",
        definition: "Open jobs reported more than 30 calendar days ago.",
        href: `/reports/work-orders?${base}`,
        tone: n(wo.backlog_30) ? "warn" : undefined,
      },
      {
        key: "avg_completion",
        label: "Average completion time",
        value: round1(num(wo.avg_h)),
        display: hours(num(wo.avg_h)),
        basis: "period",
        definition: `Mean calendar time from reported to signed off, for jobs completed in the period (${n(wo.completed)} jobs; median ${hours(num(wo.median_h))}).`,
        href: `/reports/work-orders?${base}`,
      },
      {
        key: "pm_due_soon",
        label: "PM due in the next 30 days",
        value: n(pm.due30),
        display: String(n(pm.due30)),
        basis: "now",
        definition:
          "Planned maintenance not yet signed off with a due date from today to 30 days ahead (hospital date).",
        href: `/maintenance/schedule?view=upcoming&within=30&${qs(r)}`,
      },
      {
        key: "pm_overdue",
        label: "Overdue PM",
        value: n(pm.overdue),
        display: String(n(pm.overdue)),
        basis: "now",
        definition: "Planned maintenance whose due date has passed and is not signed off.",
        href: `/maintenance/schedule?view=overdue&${qs(r)}`,
        tone: n(pm.overdue) ? "danger" : undefined,
      },
      {
        key: "pm_compliance",
        label: "PM completed on time",
        value: c.compliance,
        display: c.compliance === null ? "N/A" : `${c.compliance}%`,
        basis: "period",
        definition: `On-time PM compliance: ${c.onTime} of ${c.due} due dates in the period (up to today) were signed off by their due date plus grace days. N/A when nothing was due.`,
        href: `/reports/pm-compliance?${base}&period=${q.period}${q.period === "custom" ? `&from=${p.from}&to=${p.to}` : ""}`,
        tone: c.compliance === null ? undefined : c.compliance >= 90 ? "ok" : c.compliance >= 70 ? "warn" : "danger",
      },
      {
        key: "failed_tests",
        label: "Failed electrical safety tests",
        value: n(safety.failed),
        display: String(n(safety.failed)),
        basis: "period",
        definition: `Jobs signed off in the period with a failed electrical safety result (${n(safety.tested)} jobs recorded a pass or fail).`,
        href: `/reports/safety?${base}`,
        tone: n(safety.failed) ? "danger" : undefined,
      },
      {
        key: "awaiting_retest",
        label: "Awaiting repair or retest",
        value: n(holds.repair) + n(holds.retest),
        display: String(n(holds.repair) + n(holds.retest)),
        basis: "now",
        definition: `Devices on a Failed Safety Test hold: ${n(holds.repair)} awaiting repair, ${n(holds.retest)} awaiting retest.`,
        href: `/maintenance/holds`,
        tone: n(holds.repair) + n(holds.retest) ? "danger" : undefined,
      },
      {
        key: "awaiting_approval",
        label: "Awaiting return-to-service approval",
        value: n(holds.approval),
        display: String(n(holds.approval)),
        basis: "now",
        definition:
          "Held devices whose retest passed and which wait for an authorised second person to approve return to service.",
        href: `/maintenance/holds`,
        tone: n(holds.approval) ? "danger" : undefined,
      },
      {
        key: "recurring",
        label: "Equipment with recurring faults",
        value: n(recurring.assets),
        display: String(n(recurring.assets)),
        basis: "period",
        definition: "Assets with two or more fault reports (corrective jobs, not cancelled) created in the period.",
        href: `/reports/reliability?${base}`,
        tone: n(recurring.assets) ? "warn" : undefined,
      },
    ];
    return { ...r, metrics, workOrdersCreated: n(wo.created) };
  });
}

// ─── PM compliance ───────────────────────────────────────────────────────────

export async function getPmComplianceReport(ctx: AccessContext, raw: unknown, opts: { now?: Date } = {}) {
  await requirePermission(ctx, "analytics.view", { entityType: "analytics" });
  const r = await resolve(ctx, raw);
  const now = opts.now ?? new Date();
  const by = (r.q.by && r.q.by !== "model" ? r.q.by : "category") as ComplianceGroupBy;
  if (by === "assignee" && !can(ctx, "analytics.workload")) throw new NotFoundError("Report");
  return withTenant(tenant(ctx), async (tx) => {
    const filters = {
      hospital: r.q.hospital,
      department: r.q.department,
      category: r.q.category,
      location: r.q.location,
      assignee: r.q.assignee,
    };
    const [breakdown, trend] = await Promise.all([
      pmComplianceMetrics(ctx, tx, { from: r.period.from, to: r.period.to, by, ...filters }, now),
      pmComplianceMetrics(ctx, tx, { from: r.period.from, to: r.period.to, by: "month", ...filters }, now),
    ]);
    const months = monthsBetween(r.period.from, r.period.to).map((m) => {
      const g = trend.groups.find((x) => x.key === m);
      return { month: m, due: g?.due ?? 0, onTime: g?.onTime ?? 0, compliance: g?.compliance ?? null };
    });
    const PAGE = 50;
    const pageCount = Math.max(1, Math.ceil(breakdown.groups.length / PAGE));
    const page = Math.min(r.q.page, pageCount);
    return {
      ...r,
      by,
      total: breakdown.total,
      groups: breakdown.groups.slice((page - 1) * PAGE, page * PAGE),
      groupCount: breakdown.groups.length,
      page,
      pageCount,
      months,
    };
  });
}

// ─── Work order performance ──────────────────────────────────────────────────

export async function getWorkOrderAnalytics(ctx: AccessContext, raw: unknown, opts: { now?: Date } = {}) {
  await requirePermission(ctx, "analytics.view", { entityType: "analytics" });
  const r = await resolve(ctx, raw);
  const { q, period: p } = r;
  const now = opts.now ?? new Date();
  const scope = woScopeSql(ctx);
  const f = and(woFilters(q));
  const fNoStatus = and(woFilters(q, { status: false }));
  return withTenant(tenant(ctx), async (tx) => {
    const [counts] = await tx.$queryRaw<
      {
        created: bigint;
        completed: bigint;
        open: bigint;
        cancelled: bigint;
        reopened: bigint;
        planned: bigint;
        corrective: bigint;
      }[]
    >`
      SELECT
        count(*) FILTER (WHERE ${inPeriod(Prisma.sql`w.created_at`, p)}) AS created,
        count(*) FILTER (WHERE w.status = 'COMPLETED' AND ${inPeriod(Prisma.sql`w.completed_at`, p)}) AS completed,
        count(*) FILTER (WHERE w.status IN ('REQUESTED','ASSIGNED','IN_PROGRESS','ON_HOLD')) AS open,
        count(*) FILTER (WHERE w.status = 'CANCELLED' AND ${inPeriod(Prisma.sql`w.cancelled_at`, p)}) AS cancelled,
        count(*) FILTER (WHERE EXISTS (SELECT 1 FROM work_order_events e WHERE e.work_order_id = w.id AND e.kind = 'REOPENED'
                                        AND ${inPeriod(Prisma.sql`e.created_at`, p)})) AS reopened,
        count(*) FILTER (WHERE ${inPeriod(Prisma.sql`w.created_at`, p)} AND w.type::text IN (${Prisma.join(PLANNED_TYPES)})) AS planned,
        count(*) FILTER (WHERE ${inPeriod(Prisma.sql`w.created_at`, p)} AND w.type = 'CORRECTIVE') AS corrective
      ${WO_FROM} WHERE ${scope} AND ${f}`;
    const breakdown = await tx.$queryRaw<{ dim: string; value: string; n: bigint }[]>`
      SELECT 'type' AS dim, w.type::text AS value, count(*) AS n ${WO_FROM}
        WHERE ${inPeriod(Prisma.sql`w.created_at`, p)} AND ${scope} AND ${f} GROUP BY 2
      UNION ALL
      SELECT 'status', w.status::text, count(*) ${WO_FROM}
        WHERE ${inPeriod(Prisma.sql`w.created_at`, p)} AND ${scope} AND ${f} GROUP BY 2
      UNION ALL
      SELECT 'priority', w.priority::text, count(*) ${WO_FROM}
        WHERE ${inPeriod(Prisma.sql`w.created_at`, p)} AND ${scope} AND ${f} GROUP BY 2`;
    // Durations for jobs signed off in the period (calendar hours).
    const [d] = await tx.$queryRaw<
      {
        jobs: bigint;
        completion_avg: number | null;
        completion_median: number | null;
        assign_avg: number | null;
        assign_median: number | null;
        start_avg: number | null;
        start_median: number | null;
        repair_avg: number | null;
        repair_median: number | null;
        hold_jobs: bigint;
        hold_avg: number | null;
        with_target: bigint;
        within_target: bigint;
      }[]
    >`
      WITH done AS (
        SELECT w.id, w.created_at, w.started_at, w.completed_at, w.due_at,
          (SELECT min(e.created_at) FROM work_order_events e WHERE e.work_order_id = w.id AND e.kind IN ('ASSIGNED','TAKEN')) AS first_assigned,
          (SELECT sum(extract(epoch FROM (
              SELECT min(e2.created_at) FROM work_order_events e2
              WHERE e2.work_order_id = e.work_order_id AND e2.created_at > e.created_at
                AND e2.kind IN ('RESUMED','STARTED','COMPLETED','CANCELLED')) - e.created_at))
           FROM work_order_events e WHERE e.work_order_id = w.id AND e.kind = 'ON_HOLD') AS hold_s
        ${WO_FROM}
        WHERE w.status = 'COMPLETED' AND ${inPeriod(Prisma.sql`w.completed_at`, p)} AND ${scope} AND ${fNoStatus}
      )
      SELECT count(*) AS jobs,
        avg(extract(epoch FROM completed_at - created_at) / 3600) AS completion_avg,
        percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM completed_at - created_at) / 3600) AS completion_median,
        avg(extract(epoch FROM first_assigned - created_at) / 3600) AS assign_avg,
        percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM first_assigned - created_at) / 3600) AS assign_median,
        avg(extract(epoch FROM started_at - first_assigned) / 3600) FILTER (WHERE started_at >= first_assigned) AS start_avg,
        percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM started_at - first_assigned) / 3600)
          FILTER (WHERE started_at >= first_assigned) AS start_median,
        avg(extract(epoch FROM completed_at - started_at) / 3600) AS repair_avg,
        percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM completed_at - started_at) / 3600) AS repair_median,
        count(*) FILTER (WHERE hold_s > 0) AS hold_jobs,
        avg(hold_s / 3600) FILTER (WHERE hold_s > 0) AS hold_avg,
        count(*) FILTER (WHERE due_at IS NOT NULL) AS with_target,
        count(*) FILTER (WHERE due_at IS NOT NULL AND completed_at <= due_at) AS within_target
      FROM done`;
    const targetsByPriority = await tx.$queryRaw<{ priority: string; with_target: bigint; within: bigint }[]>`
      SELECT w.priority::text AS priority, count(*) AS with_target, count(*) FILTER (WHERE w.completed_at <= w.due_at) AS within
      ${WO_FROM}
      WHERE w.status = 'COMPLETED' AND w.due_at IS NOT NULL AND ${inPeriod(Prisma.sql`w.completed_at`, p)} AND ${scope} AND ${fNoStatus}
      GROUP BY 1`;
    const backlog = await tx.$queryRaw<{ bucket: string; n: bigint }[]>`
      SELECT CASE WHEN w.created_at >= ${now}::timestamptz - interval '7 days' THEN '0-7'
                  WHEN w.created_at >= ${now}::timestamptz - interval '30 days' THEN '8-30'
                  WHEN w.created_at >= ${now}::timestamptz - interval '90 days' THEN '31-90'
                  ELSE '90+' END AS bucket, count(*) AS n
      ${WO_FROM}
      WHERE w.status IN ('REQUESTED','ASSIGNED','IN_PROGRESS','ON_HOLD') AND ${scope} AND ${fNoStatus}
      GROUP BY 1`;
    // Repeat repairs: a new fault report within 30 days after a repair of the same asset was signed off.
    const repeats = await tx.$queryRaw<
      {
        asset_id: string;
        asset_tag: string;
        new_id: string;
        new_number: string;
        prev_id: string;
        prev_number: string;
        days: number;
      }[]
    >`
      SELECT w.asset_id, a.asset_tag, w.id AS new_id, w.number AS new_number, prev.id AS prev_id, prev.number AS prev_number,
             round(extract(epoch FROM w.created_at - prev.completed_at) / 86400)::int AS days
      ${WO_FROM}
      JOIN LATERAL (
        SELECT p2.id, p2.number, p2.completed_at FROM work_orders p2
        WHERE p2.asset_id = w.asset_id AND p2.id <> w.id AND p2.type = 'CORRECTIVE' AND p2.status = 'COMPLETED'
          AND p2.outcome = 'REPAIRED' AND p2.completed_at <= w.created_at AND p2.completed_at > w.created_at - interval '30 days'
        ORDER BY p2.completed_at DESC LIMIT 1) prev ON true
      WHERE w.type = 'CORRECTIVE' AND w.status <> 'CANCELLED' AND ${inPeriod(Prisma.sql`w.created_at`, p)} AND ${scope} AND ${fNoStatus}
      ORDER BY w.created_at DESC LIMIT 200`;
    const [correctiveInPeriod] = await tx.$queryRaw<{ n: bigint }[]>`
      SELECT count(*) AS n ${WO_FROM}
      WHERE w.type = 'CORRECTIVE' AND w.status <> 'CANCELLED' AND ${inPeriod(Prisma.sql`w.created_at`, p)} AND ${scope} AND ${fNoStatus}`;

    let workload:
      | {
          userId: string;
          name: string;
          open: number;
          completed: number;
          minutes: number;
          avgCompletionH: number | null;
        }[]
      | null = null;
    if (can(ctx, "analytics.workload")) {
      const rows = await tx.$queryRaw<{ user_id: string; open: bigint; completed: bigint; avg_h: number | null }[]>`
        SELECT w.assigned_to AS user_id,
          count(*) FILTER (WHERE w.status IN ('ASSIGNED','IN_PROGRESS','ON_HOLD')) AS open,
          count(*) FILTER (WHERE w.status = 'COMPLETED' AND ${inPeriod(Prisma.sql`w.completed_at`, p)}) AS completed,
          avg(extract(epoch FROM w.completed_at - w.created_at) / 3600) FILTER (WHERE w.status = 'COMPLETED' AND ${inPeriod(Prisma.sql`w.completed_at`, p)}) AS avg_h
        ${WO_FROM}
        WHERE w.assigned_to IS NOT NULL AND ${scope} AND ${fNoStatus}
        GROUP BY 1`;
      const minutes = await tx.$queryRaw<{ user_id: string; minutes: bigint }[]>`
        SELECT t.performed_by AS user_id, sum(t.minutes) AS minutes
        FROM work_order_tasks t
        JOIN work_orders w ON w.id = t.work_order_id
        JOIN hospitals h ON h.id = w.hospital_id
        JOIN assets a ON a.id = w.asset_id
        JOIN equipment_models m ON m.id = a.model_id
        WHERE ${inPeriod(Prisma.sql`t.created_at`, p)} AND ${scope} AND ${fNoStatus}
          AND NOT EXISTS (SELECT 1 FROM work_order_tasks c WHERE c.corrects_task_id = t.id)
        GROUP BY 1`;
      const ids = [...new Set([...rows.map((x) => x.user_id), ...minutes.map((x) => x.user_id)])];
      const names = await peopleNames(tx, ids);
      workload = ids
        .map((id) => {
          const row = rows.find((x) => x.user_id === id);
          return {
            userId: id,
            name: names[id] ?? "Unknown",
            open: n(row?.open),
            completed: n(row?.completed),
            minutes: n(minutes.find((x) => x.user_id === id)?.minutes),
            avgCompletionH: round1(num(row?.avg_h)),
          };
        })
        .filter((x) => x.open || x.completed || x.minutes)
        .sort((a, b) => a.name.localeCompare(b.name)); // alphabetical: context, not a ranking
    }
    const group = (dim: string) =>
      breakdown.filter((b) => b.dim === dim).map((b) => ({ value: b.value, count: n(b.n) }));
    return {
      ...r,
      counts: {
        created: n(counts.created),
        completed: n(counts.completed),
        open: n(counts.open),
        cancelled: n(counts.cancelled),
        reopened: n(counts.reopened),
        planned: n(counts.planned),
        corrective: n(counts.corrective),
      },
      byType: group("type"),
      byStatus: group("status"),
      byPriority: group("priority"),
      durations: {
        jobs: n(d.jobs),
        completion: { avg: round1(num(d.completion_avg)), median: round1(num(d.completion_median)) },
        toAssignment: { avg: round1(num(d.assign_avg)), median: round1(num(d.assign_median)) },
        assignmentToStart: { avg: round1(num(d.start_avg)), median: round1(num(d.start_median)) },
        repair: { avg: round1(num(d.repair_avg)), median: round1(num(d.repair_median)) },
        onHold: { jobs: n(d.hold_jobs), avg: round1(num(d.hold_avg)) },
      },
      target: {
        withTarget: n(d.with_target),
        within: n(d.within_target),
        rate: percent(n(d.within_target), n(d.with_target)),
        byPriority: targetsByPriority.map((t) => ({
          priority: t.priority,
          withTarget: n(t.with_target),
          within: n(t.within),
          rate: percent(n(t.within), n(t.with_target)),
        })),
      },
      backlog: ["0-7", "8-30", "31-90", "90+"].map((b) => ({
        bucket: b,
        count: n(backlog.find((x) => x.bucket === b)?.n),
      })),
      repeats: {
        list: repeats,
        corrective: n(correctiveInPeriod.n),
        rate: percent(repeats.length, n(correctiveInPeriod.n)),
      },
      workload,
    };
  });
}

// ─── Reliability ─────────────────────────────────────────────────────────────

export async function getReliabilityReport(ctx: AccessContext, raw: unknown, opts: { now?: Date } = {}) {
  await requirePermission(ctx, "analytics.view", { entityType: "analytics" });
  const r = await resolve(ctx, raw);
  const { q, period: p } = r;
  const now = opts.now ?? new Date();
  const scope = woScopeSql(ctx);
  const f = and(woFilters(q, { status: false }));
  const by = r.q.by === "model" ? "model" : "category";
  return withTenant(tenant(ctx), async (tx) => {
    const groupCol = by === "model" ? Prisma.sql`m.id::text` : Prisma.sql`c.id::text`;
    const groupLabel = by === "model" ? Prisma.sql`mf.name || ' ' || m.model_name` : Prisma.sql`c.name`;
    const failures = await tx.$queryRaw<
      { key: string; label: string; reports: bigint; assets_affected: bigint; nff: bigint; repaired: bigint }[]
    >`
      SELECT ${groupCol} AS key, ${groupLabel} AS label, count(*) AS reports, count(DISTINCT w.asset_id) AS assets_affected,
        count(*) FILTER (WHERE w.outcome = 'NO_FAULT_FOUND') AS nff,
        count(*) FILTER (WHERE w.outcome = 'REPAIRED') AS repaired
      ${WO_FROM}
      JOIN equipment_categories c ON c.id = m.category_id
      JOIN manufacturers mf ON mf.id = m.manufacturer_id
      WHERE w.type = 'CORRECTIVE' AND w.status <> 'CANCELLED' AND ${inPeriod(Prisma.sql`w.created_at`, p)} AND ${scope} AND ${f}
      GROUP BY 1, 2 ORDER BY 3 DESC, 2`;
    const population = await tx.$queryRaw<{ key: string; assets: bigint }[]>`
      SELECT ${groupCol} AS key, count(*) AS assets
      FROM assets a JOIN equipment_models m ON m.id = a.model_id JOIN equipment_categories c ON c.id = m.category_id
      WHERE a.archived_at IS NULL AND a.status <> 'DECOMMISSIONED' AND ${scopeSql(ctx)} AND ${and(assetFilters(q))}
      GROUP BY 1`;
    const categories = await tx.$queryRaw<{ category: string | null; n: bigint }[]>`
      SELECT w.failure_category::text AS category, count(*) AS n
      ${WO_FROM}
      WHERE w.type = 'CORRECTIVE' AND w.status = 'COMPLETED' AND w.outcome <> 'NO_FAULT_FOUND'
        AND ${inPeriod(Prisma.sql`w.completed_at`, p)} AND ${scope} AND ${f}
      GROUP BY 1 ORDER BY 2 DESC`;
    const repeatAssets = await tx.$queryRaw<
      { asset_id: string; asset_tag: string; name: string; reports: bigint; mean_gap_days: number | null }[]
    >`
      WITH faults AS (
        SELECT w.asset_id, w.created_at,
               w.created_at - lag(w.created_at) OVER (PARTITION BY w.asset_id ORDER BY w.created_at) AS gap
        ${WO_FROM}
        WHERE w.type = 'CORRECTIVE' AND w.status <> 'CANCELLED' AND ${inPeriod(Prisma.sql`w.created_at`, p)} AND ${scope} AND ${f})
      SELECT x.asset_id, a.asset_tag, a.name, count(*) AS reports, avg(extract(epoch FROM x.gap) / 86400) AS mean_gap_days
      FROM faults x JOIN assets a ON a.id = x.asset_id
      GROUP BY 1, 2, 3 HAVING count(*) >= 2 ORDER BY 4 DESC, 2 LIMIT 100`;
    // Downtime overlapping the period (an ongoing period counts up to now).
    const downtime = await tx.$queryRaw<
      { key: string; label: string; hours: number; events: bigint; ongoing: bigint }[]
    >`
      SELECT ${groupCol} AS key, ${groupLabel} AS label,
        sum(extract(epoch FROM least(coalesce(dt.ended_at, ${now}::timestamptz), ((${p.to}::date + 1))::timestamp AT TIME ZONE h.timezone)
                             - greatest(dt.started_at, (${p.from}::date)::timestamp AT TIME ZONE h.timezone)) / 3600) AS hours,
        count(*) AS events, count(*) FILTER (WHERE dt.ended_at IS NULL) AS ongoing
      FROM downtime_events dt
      JOIN assets a ON a.id = dt.asset_id
      JOIN hospitals h ON h.id = a.hospital_id
      JOIN equipment_models m ON m.id = a.model_id
      JOIN equipment_categories c ON c.id = m.category_id
      JOIN manufacturers mf ON mf.id = m.manufacturer_id
      WHERE dt.started_at < ((${p.to}::date + 1))::timestamp AT TIME ZONE h.timezone
        AND coalesce(dt.ended_at, ${now}::timestamptz) > (${p.from}::date)::timestamp AT TIME ZONE h.timezone
        AND ${scopeSql(ctx)} AND ${and(assetFilters(q))}
      GROUP BY 1, 2 ORDER BY 3 DESC`;
    const [durations] = await tx.$queryRaw<
      { downtime_avg_h: number | null; downtime_events: bigint; repair_avg_h: number | null; repairs: bigint }[]
    >`
      SELECT
        (SELECT avg(extract(epoch FROM dt.ended_at - dt.started_at) / 3600) FROM downtime_events dt
           JOIN assets a ON a.id = dt.asset_id JOIN hospitals h ON h.id = a.hospital_id JOIN equipment_models m ON m.id = a.model_id
           WHERE dt.ended_at IS NOT NULL AND ${inPeriod(Prisma.sql`dt.ended_at`, p)} AND ${scopeSql(ctx)} AND ${and(assetFilters(q))}) AS downtime_avg_h,
        (SELECT count(*) FROM downtime_events dt
           JOIN assets a ON a.id = dt.asset_id JOIN hospitals h ON h.id = a.hospital_id JOIN equipment_models m ON m.id = a.model_id
           WHERE dt.ended_at IS NOT NULL AND ${inPeriod(Prisma.sql`dt.ended_at`, p)} AND ${scopeSql(ctx)} AND ${and(assetFilters(q))}) AS downtime_events,
        (SELECT avg(extract(epoch FROM w.completed_at - w.started_at) / 3600) ${WO_FROM}
           WHERE w.type = 'CORRECTIVE' AND w.status = 'COMPLETED' AND w.outcome = 'REPAIRED' AND w.started_at IS NOT NULL
             AND ${inPeriod(Prisma.sql`w.completed_at`, p)} AND ${scope} AND ${f}) AS repair_avg_h,
        (SELECT count(*) ${WO_FROM}
           WHERE w.type = 'CORRECTIVE' AND w.status = 'COMPLETED' AND w.outcome = 'REPAIRED' AND w.started_at IS NOT NULL
             AND ${inPeriod(Prisma.sql`w.completed_at`, p)} AND ${scope} AND ${f}) AS repairs`;
    const prolonged = await tx.$queryRaw<
      {
        asset_id: string;
        asset_tag: string;
        name: string;
        status: string;
        since: Date;
        days: number;
        hospital: string;
      }[]
    >`
      SELECT a.id AS asset_id, a.asset_tag, a.name, a.status::text AS status, dt.started_at AS since,
             floor(extract(epoch FROM ${now}::timestamptz - dt.started_at) / 86400)::int AS days, h.code AS hospital
      FROM downtime_events dt
      JOIN assets a ON a.id = dt.asset_id JOIN hospitals h ON h.id = a.hospital_id JOIN equipment_models m ON m.id = a.model_id
      WHERE dt.ended_at IS NULL AND dt.started_at < ${now}::timestamptz - interval '7 days' AND ${scopeSql(ctx)} AND ${and(assetFilters(q))}
      ORDER BY dt.started_at LIMIT 100`;
    const monthly = await tx.$queryRaw<{ month: string; n: bigint }[]>`
      SELECT to_char(w.created_at AT TIME ZONE h.timezone, 'YYYY-MM') AS month, count(*) AS n
      ${WO_FROM}
      WHERE w.type = 'CORRECTIVE' AND w.status <> 'CANCELLED' AND ${inPeriod(Prisma.sql`w.created_at`, p)} AND ${scope} AND ${f}
      GROUP BY 1`;
    const workload = await tx.$queryRaw<
      { asset_id: string; asset_tag: string; name: string; jobs: bigint; corrective: bigint; minutes: bigint }[]
    >`
      SELECT w.asset_id, a.asset_tag, a.name, count(*) AS jobs, count(*) FILTER (WHERE w.type = 'CORRECTIVE') AS corrective,
             coalesce(sum((SELECT sum(t.minutes) FROM work_order_tasks t WHERE t.work_order_id = w.id
               AND NOT EXISTS (SELECT 1 FROM work_order_tasks c WHERE c.corrects_task_id = t.id))), 0) AS minutes
      ${WO_FROM}
      WHERE w.status <> 'CANCELLED' AND ${inPeriod(Prisma.sql`w.created_at`, p)} AND ${scope} AND ${f}
      GROUP BY 1, 2, 3 HAVING count(*) >= 2 ORDER BY 5 DESC, 4 DESC LIMIT 10`;

    const pop = new Map(population.map((x) => [x.key, n(x.assets)]));
    const classified = categories.filter((c) => c.category !== null).reduce((s, c) => s + n(c.n), 0);
    const totalCompleted = categories.reduce((s, c) => s + n(c.n), 0);
    return {
      ...r,
      by,
      failures: failures.map((x) => ({
        key: x.key,
        label: x.label,
        reports: n(x.reports),
        assetsAffected: n(x.assets_affected),
        assetsInRegister: pop.get(x.key) ?? 0,
        reportsPerAsset: pop.get(x.key) ? Math.round((n(x.reports) / pop.get(x.key)!) * 100) / 100 : null,
        noFaultFound: n(x.nff),
        repaired: n(x.repaired),
      })),
      faultCategories: {
        rows: categories.map((c) => ({
          category: c.category,
          label: c.category ? FAILURE_CATEGORY_LABELS[c.category as FailureCategoryValue] : "Not classified",
          count: n(c.n),
        })),
        classifiedShare: percent(classified, totalCompleted),
        total: totalCompleted,
      },
      repeatAssets: repeatAssets.map((x) => ({
        ...x,
        reports: n(x.reports),
        meanGapDays: round1(num(x.mean_gap_days)),
      })),
      downtime: downtime.map((x) => ({
        key: x.key,
        label: x.label,
        hours: round1(num(x.hours)) ?? 0,
        events: n(x.events),
        ongoing: n(x.ongoing),
      })),
      durations: {
        downtimePerEventH: round1(num(durations.downtime_avg_h)),
        downtimeEvents: n(durations.downtime_events),
        repairDurationH: round1(num(durations.repair_avg_h)),
        repairs: n(durations.repairs),
      },
      prolonged,
      monthly: monthsBetween(p.from, p.to).map((m) => ({ month: m, count: n(monthly.find((x) => x.month === m)?.n) })),
      highWorkload: workload.map((x) => ({
        ...x,
        jobs: n(x.jobs),
        corrective: n(x.corrective),
        minutes: n(x.minutes),
      })),
    };
  });
}

// ─── Electrical safety ───────────────────────────────────────────────────────

export async function getSafetyReport(ctx: AccessContext, raw: unknown, opts: { now?: Date } = {}) {
  await requirePermission(ctx, "analytics.view", { entityType: "analytics" });
  const r = await resolve(ctx, raw);
  const { q, period: p } = r;
  const now = opts.now ?? new Date();
  const scope = woScopeSql(ctx);
  const f = and(woFilters(q, { status: false }));
  const PAGE = 50;
  return withTenant(tenant(ctx), async (tx) => {
    const summary = await tx.$queryRaw<{ type: string; result: string; n: bigint }[]>`
      SELECT w.type::text AS type, w.electrical_safety_check::text AS result, count(*) AS n
      ${WO_FROM}
      WHERE w.status = 'COMPLETED' AND w.electrical_safety_check IN ('PASS','FAIL')
        AND ${inPeriod(Prisma.sql`w.completed_at`, p)} AND ${scope} AND ${f}
      GROUP BY 1, 2`;
    const holds = await tx.safetyHold.findMany({
      where: {
        status: { not: "RELEASED" },
        asset: {
          AND: [
            {
              OR: ctx.hospitals.map((h) =>
                h.departments === "ALL"
                  ? { hospitalId: h.id }
                  : { hospitalId: h.id, departmentId: { in: h.departments } },
              ),
            },
            q.hospital ? { hospitalId: q.hospital } : {},
            q.department ? { departmentId: q.department } : {},
            q.category ? { model: { categoryId: q.category } } : {},
          ],
        },
      },
      orderBy: { placedAt: "asc" },
      take: 200,
      select: {
        id: true,
        status: true,
        placedAt: true,
        retestedAt: true,
        retestedById: true,
        asset: { select: { id: true, assetTag: true, name: true, hospital: { select: { code: true } } } },
        failedWorkOrder: { select: { id: true, number: true } },
      },
    });
    const released = await tx.$queryRaw<
      {
        id: string;
        asset_id: string;
        asset_tag: string;
        retested_by: string;
        retested_at: Date;
        released_by: string;
        released_at: Date;
        placed_at: Date;
      }[]
    >`
      SELECT s.id, s.asset_id, a.asset_tag, s.retested_by, s.retested_at, s.released_by, s.released_at, s.placed_at
      FROM safety_holds s JOIN assets a ON a.id = s.asset_id JOIN hospitals h ON h.id = a.hospital_id
      JOIN equipment_models m ON m.id = a.model_id
      WHERE s.status = 'RELEASED' AND ${inPeriod(Prisma.sql`s.released_at`, p)} AND ${scopeSql(ctx)} AND ${and(assetFilters(q))}
      ORDER BY s.released_at DESC LIMIT 200`;
    const days = await hospitalDays(ctx, tx, now);
    const open = Prisma.join(["SCHEDULED", "WORK_ORDER_CREATED", "FAILED"].map((s) => Prisma.sql`${s}`));
    const overdue = await tx.$queryRaw<
      {
        kind: string;
        id: string;
        due_on: Date;
        asset_id: string;
        asset_tag: string;
        plan_name: string;
        wo_id: string | null;
        wo_number: string | null;
      }[]
    >`
      SELECT i.kind, i.id, i.due_on, a.id AS asset_id, a.asset_tag, p.name AS plan_name, i.wo_id, i.wo_number
      FROM (${ITEMS}) i
      JOIN assets a ON a.id = i.asset_id
      JOIN equipment_models m ON m.id = a.model_id
      JOIN maintenance_plans p ON p.id = i.plan_id
      JOIN maintenance_plan_revisions rv ON rv.id = p.approved_revision_id
      JOIN (${todaySql(days)}) t(hospital_id, d) ON t.hospital_id = a.hospital_id
      WHERE i.status IN (${open}) AND i.due_on < t.d
        AND (p.work_type = 'SAFETY_TEST' OR rv.checklist @> '[{"section":"ELECTRICAL_SAFETY"}]'::jsonb)
        AND ${scopeSql(ctx)} AND ${and(assetFilters(q))}
      ORDER BY i.due_on LIMIT 200`;
    // Test history (paginated).
    const historyWhere = Prisma.sql`w.status = 'COMPLETED' AND w.electrical_safety_check IN ('PASS','FAIL')
      AND ${inPeriod(Prisma.sql`w.completed_at`, p)} AND ${scope} AND ${f}`;
    const [{ total }] = await tx.$queryRaw<
      { total: bigint }[]
    >`SELECT count(*) AS total ${WO_FROM} WHERE ${historyWhere}`;
    const pageCount = Math.max(1, Math.ceil(n(total) / PAGE));
    const page = Math.min(q.page, pageCount);
    const history = await tx.$queryRaw<
      {
        id: string;
        number: string;
        type: string;
        result: string;
        completed_at: Date;
        completed_by: string;
        asset_id: string;
        asset_tag: string;
        model: string;
        hospital: string;
        standard: string | null;
        measurements: bigint;
        failed_items: bigint;
      }[]
    >`
      SELECT w.id, w.number, w.type::text AS type, w.electrical_safety_check::text AS result, w.completed_at, w.completed_by,
             a.id AS asset_id, a.asset_tag, m.model_name AS model, h.code AS hospital,
             CASE WHEN w.test_standard_code IS NULL THEN NULL ELSE w.test_standard_code || ' ' || w.test_standard_version END AS standard,
             (SELECT count(*) FROM checklist_results cr WHERE cr.work_order_id = w.id AND cr.section = 'ELECTRICAL_SAFETY' AND cr.attempt = w.reopen_count) AS measurements,
             (SELECT count(*) FROM checklist_results cr WHERE cr.work_order_id = w.id AND cr.section = 'ELECTRICAL_SAFETY' AND cr.attempt = w.reopen_count AND cr.result = 'FAIL') AS failed_items
      ${WO_FROM}
      WHERE ${historyWhere}
      ORDER BY w.completed_at DESC LIMIT ${PAGE} OFFSET ${(page - 1) * PAGE}`;
    const names = await peopleNames(tx, [
      ...history.map((h) => h.completed_by),
      ...released.flatMap((x) => [x.retested_by, x.released_by]),
      ...holds.map((h) => h.retestedById),
    ]);
    const count = (result: string, type?: string) =>
      summary.filter((s) => s.result === result && (!type || s.type === type)).reduce((t, s) => t + n(s.n), 0);
    return {
      ...r,
      tests: {
        performed: count("PASS") + count("FAIL"),
        passed: count("PASS"),
        failed: count("FAIL"),
        byType: [...new Set(summary.map((s) => s.type))].map((t) => ({
          type: t,
          passed: count("PASS", t),
          failed: count("FAIL", t),
        })),
      },
      holds: {
        awaitingRepair: holds.filter((h) => h.status === "AWAITING_REPAIR"),
        awaitingRetest: holds.filter((h) => h.status === "AWAITING_RETEST"),
        awaitingApproval: holds.filter((h) => h.status === "AWAITING_APPROVAL"),
      },
      released,
      overdue,
      history: {
        rows: history.map((h) => ({ ...h, measurements: n(h.measurements), failedItems: n(h.failed_items) })),
        total: n(total),
        page,
        pageCount,
      },
      names,
    };
  });
}

// ─── Plan governance (manufacturer requirements) ─────────────────────────────

export async function getPlanGovernance(ctx: AccessContext, opts: { now?: Date } = {}) {
  await requirePermission(ctx, "analytics.view", { entityType: "analytics" });
  const today = await todayFor(ctx);
  void opts;
  return withTenant(tenant(ctx), async (tx) => {
    const planScope: Prisma.MaintenancePlanWhereInput = ctx.orgWide
      ? {}
      : { OR: [{ hospitalId: null }, { hospitalId: { in: ctx.hospitals.map((h) => h.id) } }] };
    const [withoutPlanTotal, withoutPlanByCategory, modelsWithoutInterval, awaiting, reviews, plans] =
      await Promise.all([
        tx.asset.count({ where: withoutApprovedPmWhere(ctx) }),
        tx.asset.groupBy({ by: ["modelId"], where: withoutApprovedPmWhere(ctx), _count: { _all: true } }),
        tx.equipmentModel.findMany({
          where: {
            status: "ACTIVE",
            manufacturerPmIntervalCount: null,
            // models of equipment in the user's scope that is still in use
            assets: { some: { AND: [assetScopeWhere(ctx), { archivedAt: null, status: { not: "DECOMMISSIONED" } }] } },
          },
          select: {
            id: true,
            modelName: true,
            manufacturer: { select: { name: true } },
            category: { select: { name: true } },
          },
          orderBy: { modelName: "asc" },
        }),
        tx.maintenancePlan.findMany({
          where: { AND: [planScope, { status: { not: "ARCHIVED" }, hasUnapprovedChanges: true }] },
          select: { id: true, name: true, status: true, updatedAt: true },
          orderBy: { updatedAt: "asc" },
        }),
        tx.maintenancePlan.findMany({
          where: {
            AND: [
              planScope,
              {
                status: { in: ["ACTIVE", "PAUSED"] },
                nextReviewOn: { lte: new Date(`${addDays(today, 60)}T00:00:00Z`) },
              },
            ],
          },
          select: { id: true, name: true, nextReviewOn: true },
          orderBy: { nextReviewOn: "asc" },
        }),
        tx.maintenancePlan.findMany({
          where: { AND: [planScope, { status: { in: ["ACTIVE", "PAUSED"] }, approvedRevisionId: { not: null } }] },
          select: {
            id: true,
            name: true,
            targetKind: true,
            approvedRevision: {
              select: {
                intervalCount: true,
                intervalUnit: true,
                intervalSource: true,
                sourceReference: true,
                justification: true,
                approvedById: true,
                approvedAt: true,
                effectiveFrom: true,
              },
            },
            model: { select: { modelName: true, manufacturerPmIntervalCount: true, manufacturerPmIntervalUnit: true } },
            asset: {
              select: {
                model: {
                  select: { modelName: true, manufacturerPmIntervalCount: true, manufacturerPmIntervalUnit: true },
                },
              },
            },
          },
        }),
      ]);
    const models = await tx.equipmentModel.findMany({
      where: { id: { in: withoutPlanByCategory.map((g) => g.modelId) } },
      select: { id: true, category: { select: { name: true } } },
    });
    const byCategory = new Map<string, number>();
    for (const g of withoutPlanByCategory) {
      const cat = models.find((m) => m.id === g.modelId)?.category.name ?? "Unknown";
      byCategory.set(cat, (byCategory.get(cat) ?? 0) + g._count._all);
    }
    // Exceptions: organisation-defined intervals, and requirement intervals that differ from the manufacturer's.
    const exceptions = plans
      .map((pl) => {
        const rev = pl.approvedRevision!;
        const model = pl.model ?? pl.asset?.model ?? null;
        const mfr =
          model?.manufacturerPmIntervalCount && model.manufacturerPmIntervalUnit
            ? { count: model.manufacturerPmIntervalCount, unit: model.manufacturerPmIntervalUnit }
            : null;
        const differs = mfr && (mfr.count !== rev.intervalCount || mfr.unit !== rev.intervalUnit);
        if (rev.intervalSource !== "ORGANIZATION_DEFINED" && !(differs && rev.intervalSource !== "MANUFACTURER"))
          return null;
        return {
          id: pl.id,
          name: pl.name,
          interval: intervalLabel(rev.intervalCount, rev.intervalUnit as IntervalUnitValue),
          manufacturer: mfr ? intervalLabel(mfr.count, mfr.unit as IntervalUnitValue) : null,
          source: rev.intervalSource,
          basis: rev.intervalSource === "ORGANIZATION_DEFINED" ? rev.justification : rev.sourceReference,
          approvedById: rev.approvedById,
          approvedAt: rev.approvedAt,
        };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null);
    const names = await peopleNames(
      tx,
      exceptions.map((e) => e.approvedById),
    );
    return {
      today,
      withoutPlan: {
        total: withoutPlanTotal,
        byCategory: [...byCategory.entries()]
          .map(([category, count]) => ({ category, count }))
          .sort((a, b) => b.count - a.count),
      },
      modelsWithoutInterval,
      awaiting,
      reviews: reviews.map((x) => ({
        ...x,
        overdue: x.nextReviewOn ? x.nextReviewOn.toISOString().slice(0, 10) < today : false,
      })),
      exceptions,
      names,
    };
  });
}

// ─── Lifecycle and cost ──────────────────────────────────────────────────────

export async function getLifecycleReport(ctx: AccessContext, raw: unknown) {
  await requirePermission(ctx, "analytics.view", { entityType: "analytics" });
  const r = await resolve(ctx, raw);
  const { q } = r;
  const financial = can(ctx, "analytics.financial");
  const today = r.today;
  const result = await withTenant(tenant(ctx), async (tx) => {
    const ages = await tx.$queryRaw<{ bucket: string; n: bigint }[]>`
      SELECT CASE
          WHEN coalesce(a.purchase_date, a.commissioned_at) IS NULL THEN 'unknown'
          WHEN coalesce(a.purchase_date, a.commissioned_at) > ${today}::date - interval '2 years' THEN '0-2'
          WHEN coalesce(a.purchase_date, a.commissioned_at) > ${today}::date - interval '5 years' THEN '2-5'
          WHEN coalesce(a.purchase_date, a.commissioned_at) > ${today}::date - interval '8 years' THEN '5-8'
          WHEN coalesce(a.purchase_date, a.commissioned_at) > ${today}::date - interval '10 years' THEN '8-10'
          ELSE '10+' END AS bucket, count(*) AS n
      FROM assets a JOIN equipment_models m ON m.id = a.model_id
      WHERE a.archived_at IS NULL AND a.status <> 'DECOMMISSIONED' AND ${scopeSql(ctx)} AND ${and(assetFilters(q))}
      GROUP BY 1`;
    const warranty = await tx.$queryRaw<{ state: string; n: bigint }[]>`
      SELECT CASE WHEN wy.ends_on IS NULL THEN 'none'
                  WHEN wy.ends_on < ${today}::date THEN 'expired'
                  WHEN wy.ends_on <= ${today}::date + 90 THEN 'expiring'
                  ELSE 'active' END AS state, count(*) AS n
      FROM assets a JOIN equipment_models m ON m.id = a.model_id
      LEFT JOIN LATERAL (SELECT max(w.ends_on) AS ends_on FROM warranties w WHERE w.asset_id = a.id AND w.archived_at IS NULL) wy ON true
      WHERE a.archived_at IS NULL AND a.status <> 'DECOMMISSIONED' AND ${scopeSql(ctx)} AND ${and(assetFilters(q))}
      GROUP BY 1`;
    // Replacement review: age within `threshold` months of the model's expected life, or EOL date within it.
    const review = await tx.$queryRaw<
      {
        id: string;
        asset_tag: string;
        name: string;
        hospital: string;
        acquired: Date | null;
        expected_life: number | null;
        eol_date: Date | null;
        reason: string;
      }[]
    >`
      SELECT a.id, a.asset_tag, a.name, h.code AS hospital, coalesce(a.purchase_date, a.commissioned_at) AS acquired,
             m.expected_life_years AS expected_life, a.eol_date,
             CASE WHEN a.eol_date IS NOT NULL AND a.eol_date <= ${today}::date + make_interval(months => ${q.threshold}) THEN 'eol_date'
                  ELSE 'expected_life' END AS reason
      FROM assets a JOIN equipment_models m ON m.id = a.model_id JOIN hospitals h ON h.id = a.hospital_id
      WHERE a.archived_at IS NULL AND a.status <> 'DECOMMISSIONED' AND ${scopeSql(ctx)} AND ${and(assetFilters(q))}
        AND ((a.eol_date IS NOT NULL AND a.eol_date <= ${today}::date + make_interval(months => ${q.threshold}))
          OR (m.expected_life_years IS NOT NULL AND coalesce(a.purchase_date, a.commissioned_at) IS NOT NULL
              AND coalesce(a.purchase_date, a.commissioned_at) + make_interval(years => m.expected_life_years)
                  <= ${today}::date + make_interval(months => ${q.threshold})))
      ORDER BY coalesce(a.eol_date, coalesce(a.purchase_date, a.commissioned_at) + make_interval(years => coalesce(m.expected_life_years, 0)))
      LIMIT 200`;
    let costs: { currency: string; group: string; assets: number; total: string }[] | null = null;
    let costCoverage: { withCost: number; total: number } | null = null;
    if (financial) {
      const rows = await tx.$queryRaw<{ currency: string; grp: string; assets: bigint; total: string }[]>`
        SELECT a.purchase_currency AS currency, c.name AS grp, count(*) AS assets, sum(a.purchase_cost)::text AS total
        FROM assets a JOIN equipment_models m ON m.id = a.model_id JOIN equipment_categories c ON c.id = m.category_id
        WHERE a.archived_at IS NULL AND a.status <> 'DECOMMISSIONED' AND a.purchase_cost IS NOT NULL
          AND ${scopeSql(ctx)} AND ${and(assetFilters(q))}
        GROUP BY 1, 2 ORDER BY 1, 2`;
      costs = rows.map((x) => ({ currency: x.currency ?? "—", group: x.grp, assets: n(x.assets), total: x.total }));
      const [cov] = await tx.$queryRaw<{ with_cost: bigint; total: bigint }[]>`
        SELECT count(*) FILTER (WHERE a.purchase_cost IS NOT NULL) AS with_cost, count(*) AS total
        FROM assets a JOIN equipment_models m ON m.id = a.model_id
        WHERE a.archived_at IS NULL AND a.status <> 'DECOMMISSIONED' AND ${scopeSql(ctx)} AND ${and(assetFilters(q))}`;
      costCoverage = { withCost: n(cov.with_cost), total: n(cov.total) };
      await audit(tx, {
        organizationId: ctx.organization.id,
        actorUserId: ctx.user.id,
        action: "analytics.financial_viewed",
        entityType: "analytics",
        metadata: { report: "lifecycle", hospital: q.hospital ?? null },
        request: ctx.request,
      });
    }
    const bucket = (rows: { n: bigint }[], key: string, k: string) =>
      n((rows as { [x: string]: unknown; n: bigint }[]).find((x) => x[key] === k)?.n);
    return {
      ages: ["0-2", "2-5", "5-8", "8-10", "10+", "unknown"].map((b) => ({
        bucket: b,
        count: bucket(ages, "bucket", b),
      })),
      warranty: ["active", "expiring", "expired", "none"].map((s) => ({
        state: s,
        count: bucket(warranty, "state", s),
      })),
      review,
      costs,
      costCoverage,
    };
  });
  return { ...r, financial, ...result };
}

// ─── Export (CSV, Excel, PDF) ────────────────────────────────────────────────

/**
 * The content of one report export: same permission, scope and server-side
 * filters as the screen. The first lines state the report, organisation,
 * generation time and period. Rendered as CSV, Excel or PDF by server/export.
 */
async function buildAnalyticsDoc(
  ctx: AccessContext,
  report: ReportName,
  raw: unknown,
  opts: { now?: Date } = {},
): Promise<{ doc: ExportDoc; rows: number }> {
  const generatedAt = (opts.now ?? new Date()).toISOString();
  const meta = (period: string): [string, string][] => [
    ["Report", REPORT_TITLES[report]],
    ["Organisation", ctx.organization.name],
    ["Generated (UTC)", generatedAt],
    ["Period", period],
    ["Times", "Calendar time; dates in each hospital's local time zone"],
  ];
  const doc = (period: string, sections: Section[]): ExportDoc => ({
    title: REPORT_TITLES[report],
    organization: ctx.organization.name,
    meta: meta(period),
    sections,
  });
  const na = (v: number | string | null | undefined) => v ?? "N/A";

  if (report === "overview") {
    const o = await getAnalyticsOverview(ctx, raw, opts);
    return {
      doc: doc(o.period.label, [
        {
          title: "Key figures",
          columns: ["Metric", "Value", "Basis", "Definition"],
          rows: o.metrics.map((m) => [m.label, m.display, m.basis === "now" ? "Right now" : "In period", m.definition]),
        },
      ]),
      rows: o.metrics.length,
    };
  }
  if (report === "pm-compliance") {
    const all = await getPmComplianceReport(ctx, { ...(raw as object), page: 1 }, opts);
    const groups = [all.total, ...all.groups];
    return {
      doc: doc(all.period.label, [
        {
          title: "Compliance by group",
          columns: [
            "Group",
            "Due",
            "On time",
            "Late",
            "Open/overdue",
            "Missed",
            "Cancelled",
            "Failed to generate",
            "On-time compliance %",
            "Completion %",
          ],
          rows: groups.map((g) => [
            g.label,
            g.due,
            g.onTime,
            g.late,
            g.open,
            g.missed,
            g.cancelled,
            g.failed,
            na(g.compliance),
            na(g.completion),
          ]),
        },
      ]),
      rows: groups.length,
    };
  }
  if (report === "work-orders") {
    const w = await getWorkOrderAnalytics(ctx, raw, opts);
    const sections: Section[] = [
      {
        title: "Summary",
        columns: ["Metric", "Value"],
        rows: [
          ["Created in period", w.counts.created],
          ["Completed in period", w.counts.completed],
          ["Open now", w.counts.open],
          ["Cancelled in period", w.counts.cancelled],
          ["Reopened in period", w.counts.reopened],
          ["Planned (PM, tests, inspections) created", w.counts.planned],
          ["Corrective created", w.counts.corrective],
          ["Completion time mean (h)", w.durations.completion.avg],
          ["Completion time median (h)", w.durations.completion.median],
          ["Report to first assignment mean (h)", w.durations.toAssignment.avg],
          ["Assignment to start mean (h)", w.durations.assignmentToStart.avg],
          ["Repair duration (start to sign-off) mean (h)", w.durations.repair.avg],
          ["Jobs with time on hold", w.durations.onHold.jobs],
          ["Time on hold mean (h)", w.durations.onHold.avg],
          ["Completed within target %", na(w.target.rate)],
          ["Repeat repairs (within 30 days)", w.repeats.list.length],
        ],
      },
      {
        title: "Open jobs by age",
        columns: ["Backlog age (days)", "Open jobs"],
        rows: w.backlog.map((b) => [b.bucket, b.count]),
      },
    ];
    if (w.workload) {
      sections.push({
        title: "Engineer workload",
        columns: ["Engineer", "Open assigned", "Completed in period", "Logged minutes", "Mean completion (h)"],
        rows: w.workload.map((x) => [x.name, x.open, x.completed, x.minutes, x.avgCompletionH]),
      });
    }
    return { doc: doc(w.period.label, sections), rows: 17 };
  }
  if (report === "reliability") {
    const rel = await getReliabilityReport(ctx, raw, opts);
    return {
      doc: doc(rel.period.label, [
        {
          title: rel.by === "model" ? "Fault reports by model" : "Fault reports by category",
          columns: [
            rel.by === "model" ? "Model" : "Category",
            "Fault reports",
            "Assets affected",
            "Assets in register",
            "Reports per asset",
            "No fault found",
            "Repaired",
          ],
          rows: rel.failures.map((f) => [
            f.label,
            f.reports,
            f.assetsAffected,
            f.assetsInRegister,
            f.reportsPerAsset,
            f.noFaultFound,
            f.repaired,
          ]),
        },
        {
          title: "Assets with repeat faults",
          columns: [
            "Asset with repeat faults",
            "Name",
            "Fault reports",
            "Mean calendar days between reports (proxy, not MTBF)",
          ],
          rows: rel.repeatAssets.map((a) => [a.asset_tag, a.name, a.reports, a.meanGapDays]),
        },
      ]),
      rows: rel.failures.length + rel.repeatAssets.length,
    };
  }
  if (report === "safety") {
    const s = await getSafetyReport(ctx, { ...(raw as object), page: 1 }, opts);
    const all = [s.history.rows];
    for (let pg = 2; pg <= Math.min(s.history.pageCount, 40); pg++)
      all.push((await getSafetyReport(ctx, { ...(raw as object), page: pg }, opts)).history.rows);
    const names = s.names;
    const rows = all.flat();
    return {
      doc: doc(s.period.label, [
        {
          title: "Electrical safety and test history",
          columns: [
            "Signed off (UTC)",
            "Work order",
            "Type",
            "Result",
            "Asset",
            "Model",
            "Hospital",
            "Standard and version",
            "Electrical safety items",
            "Failed items",
            "Tester",
          ],
          rows: rows.map((h) => [
            h.completed_at,
            h.number,
            h.type,
            h.result,
            h.asset_tag,
            h.model,
            h.hospital,
            h.standard ?? "",
            h.measurements,
            h.failedItems,
            names[h.completed_by] ?? h.completed_by,
          ]),
        },
      ]),
      rows: rows.length,
    };
  }
  if (report === "governance") {
    const g = await getPlanGovernance(ctx, opts);
    return {
      doc: doc(`As of ${g.today}`, [
        {
          title: "Assets without an approved plan",
          columns: ["Assets without an approved plan, by category", "Count"],
          rows: g.withoutPlan.byCategory.map((c) => [c.category, c.count]),
        },
        {
          title: "Plans with an interval exception",
          columns: [
            "Plan with interval exception",
            "Interval",
            "Manufacturer interval",
            "Source",
            "Justification or reference",
            "Approved by",
            "Approved at (UTC)",
          ],
          rows: g.exceptions.map((e) => [
            e.name,
            e.interval,
            e.manufacturer ?? "None recorded",
            e.source,
            e.basis ?? "",
            g.names[e.approvedById] ?? e.approvedById,
            e.approvedAt,
          ]),
        },
      ]),
      rows: g.withoutPlan.byCategory.length + g.exceptions.length,
    };
  }
  if (report === "costs") {
    const { getCostReport } = await import("./cost-analytics");
    const c = await getCostReport(ctx, raw);
    const sections: Section[] = [
      {
        note: "Recorded figures only. Parts cost = issued minus returned at the unit cost recorded when issued; external service = cost recorded on the supplier record. Labour is not included. Currencies are never combined.",
      },
      {
        title: "Parts used",
        columns: ["Part number", "Name", "Unit", "Net quantity used", "Jobs"],
        rows: c.consumption.map((x) => [x.part_number, x.name, x.unit, x.used, x.jobs]),
      },
      {
        title: "Parts written off",
        columns: ["Written off: part number", "Name", "Units", "Reasons"],
        rows: c.writeOffs.map((x) => [x.part_number, x.name, x.units, x.reasons]),
      },
      {
        title: "External service by supplier",
        columns: [
          "Supplier",
          "Service requests",
          "Completed",
          "Open",
          "With expected and completion dates",
          "Completed by expected date",
        ],
        rows: c.supplierHistory.map((x) => [x.name, x.requests, x.completed, x.open, x.withDates, x.onTime]),
      },
    ];
    if (c.costs) {
      sections.push({
        title: "Recorded cost by asset",
        columns: ["Asset", "Name", "Currency", "Parts cost", "External service cost", "Total recorded"],
        rows: c.costs.byAsset.map((x) => [x.asset_tag, x.name, x.currency, x.parts, x.service, x.total]),
      });
    }
    return {
      doc: doc(c.period.label, sections),
      rows: c.consumption.length + c.writeOffs.length + c.supplierHistory.length + (c.costs?.byAsset.length ?? 0),
    };
  }
  const l = await getLifecycleReport(ctx, raw);
  const sections: Section[] = [
    {
      title: "Assets due for replacement review",
      columns: [
        "Asset",
        "Name",
        "Hospital",
        "Acquired",
        "Expected life (years)",
        "EOL date",
        "Reason for replacement review",
      ],
      rows: l.review.map((a) => [
        a.asset_tag,
        a.name,
        a.hospital,
        a.acquired?.toISOString().slice(0, 10),
        a.expected_life,
        a.eol_date?.toISOString().slice(0, 10),
        a.reason === "eol_date" ? "EOL date within threshold" : "Expected life reached within threshold",
      ]),
    },
  ];
  if (l.costs) {
    sections.push({
      title: "Acquisition cost by category",
      columns: ["Currency", "Category", "Assets with cost", "Total acquisition cost"],
      rows: l.costs.map((c) => [c.currency, c.group, c.assets, c.total]),
    });
  }
  return { doc: doc(`As of ${l.today}`, sections), rows: l.review.length };
}

/** One report as CSV, Excel or PDF. Permission-checked and audited (with the format). */
export async function exportAnalytics(
  ctx: AccessContext,
  report: ReportName,
  raw: unknown,
  format: ExportFormat,
  opts: { now?: Date } = {},
) {
  await requirePermission(ctx, "analytics.export", { entityType: "analytics" });
  const { doc, rows } = await buildAnalyticsDoc(ctx, report, raw, opts);
  const file = await renderExport(ctx, doc, format, { csv: () => toCsv(doc) });
  await withTenant(tenant(ctx), (tx) =>
    audit(tx, {
      organizationId: ctx.organization.id,
      actorUserId: ctx.user.id,
      action: "analytics.exported",
      entityType: "analytics",
      metadata: { report, rows, format, filters: analyticsQuerySchema.parse(raw ?? {}) },
      request: ctx.request,
    }),
  );
  return { ...file, report };
}

/** CSV for one report (kept for existing callers and tests). */
export async function exportAnalyticsCsv(
  ctx: AccessContext,
  report: ReportName,
  raw: unknown,
  opts: { now?: Date } = {},
) {
  const r = await exportAnalytics(ctx, report, raw, "csv", opts);
  return { csv: r.body.toString(), report };
}
