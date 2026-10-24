// Preventive maintenance schedule views, asset summary, dashboard figures,
// reports and CSV export (Stage 6). Read-only.
//
// Every query runs under RLS (withTenant) AND is limited to the user's
// hospitals/departments (asset scope). "Today" is each hospital's own date.
//
// One schedule list mixes two kinds of row:
//   • occurrences — due dates already recorded (work order open, completed,
//     cancelled, missed, skipped, or generation failed);
//   • scheduled — each active schedule's NEXT due date that has no
//     occurrence yet (it gets one when it enters the plan's lead time).
//
// METRIC DEFINITIONS (shown on the report screen too):
//   Due in period     occurrences with a due date in the period, up to today
//                     (skipped ones excluded), plus schedules whose next due
//                     date in that window passed without any occurrence.
//   Completed on time signed off on or before due date + the plan's grace days.
//   Completed late    signed off after that.
//   Open / overdue    work order still open (or never created) after the due date.
//   Missed            due date passed with no work order (catch-up).
//   Cancelled         the PM work order was cancelled.
//   Generation failed the work order could not be created yet.
//   Compliance %      completed on time ÷ due in period.
//   Completion %      completed (on time or late) ÷ due in period.
// A work order being GENERATED never counts as maintenance DONE.
import { Prisma } from "../db/generated/client";
import { withTenant, type Tx } from "../db/tenant";
import { audit, auditStandalone } from "../audit/audit";
import { can, requirePermission, type AccessContext } from "../authz/access";
import { NotFoundError } from "../authz/errors";
import { assetScopeWhere } from "./assets";
import { tableCsv, type ExportDoc, type ExportFormat } from "../export/document";
import { renderExport } from "../export/render";
import { peopleNames } from "./work-order-core";
import {
  addDays,
  dueDate,
  fromDbDate,
  intervalLabel,
  localToday,
  type DateOnly,
  type IntervalUnitValue,
} from "@/lib/pm/dates";
import {
  OCCURRENCE_STATUS_LABELS,
  PM_PAGE_SIZE,
  reportQuerySchema,
  scheduleQuerySchema,
  type ScheduleQuery,
} from "@/lib/validation/pm";

const tenant = (ctx: AccessContext) => ({ userId: ctx.user.id, organizationId: ctx.organization.id });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const OPEN_ITEM = ["SCHEDULED", "WORK_ORDER_CREATED", "FAILED"];
const HISTORY_ITEM = ["COMPLETED", "CANCELLED", "MISSED", "SKIPPED"];

/** Each accessible hospital with its local "today". */
export async function hospitalDays(ctx: AccessContext, tx: Tx, now: Date) {
  const rows = await tx.hospital.findMany({
    where: { id: { in: ctx.hospitals.map((h) => h.id) } },
    select: { id: true, timezone: true },
  });
  return rows.map((r) => ({ id: r.id, today: localToday(r.timezone, now) }));
}

/** SQL version of assetScopeWhere for raw queries (alias "a" = assets). */
export function scopeSql(ctx: AccessContext): Prisma.Sql {
  if (!ctx.hospitals.length) return Prisma.sql`FALSE`;
  const parts = ctx.hospitals.map((h) =>
    h.departments === "ALL"
      ? Prisma.sql`a.hospital_id = ${h.id}::uuid`
      : h.departments.length
        ? Prisma.sql`(a.hospital_id = ${h.id}::uuid AND a.department_id IN (${Prisma.join(
            h.departments.map((d) => Prisma.sql`${d}::uuid`),
          )}))`
        : Prisma.sql`FALSE`,
  );
  return Prisma.sql`(${Prisma.join(parts, " OR ")})`;
}

export function todaySql(days: { id: string; today: string }[]): Prisma.Sql {
  if (!days.length) return Prisma.sql`SELECT NULL::uuid AS hospital_id, NULL::date AS d WHERE FALSE`;
  return Prisma.sql`VALUES ${Prisma.join(days.map((d) => Prisma.sql`(${d.id}::uuid, ${d.today}::date)`))}`;
}

/** The two kinds of schedule row as one set (see top of file). */
export const ITEMS = Prisma.sql`
  SELECT 'occurrence'::text AS kind, o.id, o.due_on, o.status::text AS status, o.asset_id, o.plan_id,
         w.id AS wo_id, w.number AS wo_number, w.status::text AS wo_status,
         COALESCE(w.priority::text, p.priority::text) AS priority, COALESCE(w.assigned_to, p.default_assignee_id) AS assignee,
         o.completed_on, o.on_time, o.last_error, o.note
  FROM pm_occurrences o
  JOIN maintenance_plans p ON p.id = o.plan_id
  LEFT JOIN work_orders w ON w.pm_occurrence_id = o.id
  UNION ALL
  SELECT 'scheduled'::text, s.id, s.next_due_on, 'SCHEDULED', s.asset_id, s.plan_id,
         NULL, NULL, NULL, p.priority::text, p.default_assignee_id, NULL, NULL, NULL, NULL
  FROM pm_schedules s
  JOIN maintenance_plans p ON p.id = s.plan_id
  WHERE s.status = 'ACTIVE' AND p.status = 'ACTIVE' AND p.approved_revision_id IS NOT NULL
    AND (p.ends_on IS NULL OR s.next_due_on <= p.ends_on)
    AND NOT EXISTS (SELECT 1 FROM pm_occurrences o2 WHERE o2.schedule_id = s.id AND o2.due_on = s.next_due_on)`;

export type ScheduleRow = {
  kind: "occurrence" | "scheduled";
  id: string;
  due_on: Date;
  status: string;
  asset_id: string;
  plan_id: string;
  wo_id: string | null;
  wo_number: string | null;
  wo_status: string | null;
  priority: string;
  assignee: string | null;
  completed_on: Date | null;
  on_time: boolean | null;
  last_error: string | null;
  note: string | null;
  asset_tag: string;
  asset_name: string;
  hospital_code: string;
  department_name: string;
  category_name: string;
  location_name: string | null;
  plan_name: string;
  work_type: string;
  today: Date;
};

function filtersSql(q: ScheduleQuery): Prisma.Sql[] {
  const f: Prisma.Sql[] = [];
  const open = Prisma.join(OPEN_ITEM.map((s) => Prisma.sql`${s}`));
  if (q.view === "upcoming") f.push(Prisma.sql`i.status IN (${open}) AND i.due_on >= t.d`);
  if (q.view === "today") f.push(Prisma.sql`i.status IN (${open}) AND i.due_on = t.d`);
  if (q.view === "overdue") f.push(Prisma.sql`i.status IN (${open}) AND i.due_on < t.d`);
  if (q.view === "history") f.push(Prisma.sql`i.status IN (${Prisma.join(HISTORY_ITEM.map((s) => Prisma.sql`${s}`))})`);
  if (q.within) f.push(Prisma.sql`i.due_on <= t.d + ${q.within}::int`);
  if (q.from) f.push(Prisma.sql`i.due_on >= ${q.from}::date`);
  if (q.to) f.push(Prisma.sql`i.due_on <= ${q.to}::date`);
  if (q.hospital) f.push(Prisma.sql`a.hospital_id = ${q.hospital}::uuid`);
  if (q.department) f.push(Prisma.sql`a.department_id = ${q.department}::uuid`);
  if (q.category) f.push(Prisma.sql`m.category_id = ${q.category}::uuid`);
  if (q.location) f.push(Prisma.sql`a.location_id = ${q.location}::uuid`);
  if (q.asset) f.push(Prisma.sql`a.id = ${q.asset}::uuid`);
  if (q.plan) f.push(Prisma.sql`i.plan_id = ${q.plan}::uuid`);
  if (q.assignee) f.push(Prisma.sql`i.assignee = ${q.assignee}`);
  if (q.status) f.push(Prisma.sql`i.status = ${q.status}`);
  if (q.priority) f.push(Prisma.sql`i.priority = ${q.priority}`);
  if (q.q) {
    const like = `%${q.q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    f.push(
      Prisma.sql`(a.asset_tag ILIKE ${like} OR a.name ILIKE ${like} OR p.name ILIKE ${like} OR COALESCE(i.wo_number, '') ILIKE ${like})`,
    );
  }
  return f;
}

const ORDER: Record<ScheduleQuery["sort"], Prisma.Sql> = {
  due: Prisma.sql`i.due_on`,
  asset: Prisma.sql`a.asset_tag`,
  plan: Prisma.sql`p.name`,
  priority: Prisma.sql`CASE i.priority WHEN 'URGENT' THEN 0 WHEN 'HIGH' THEN 1 WHEN 'MEDIUM' THEN 2 ELSE 3 END`,
};

async function querySchedule(
  ctx: AccessContext,
  tx: Tx,
  q: ScheduleQuery,
  page: { take: number; skip: number },
  now: Date,
) {
  const days = await hospitalDays(ctx, tx, now);
  const where = Prisma.join([scopeSql(ctx), ...filtersSql(q)], " AND ");
  const from = Prisma.sql`
    FROM (${ITEMS}) i
    JOIN assets a ON a.id = i.asset_id
    JOIN hospitals h ON h.id = a.hospital_id
    JOIN departments d ON d.id = a.department_id
    LEFT JOIN locations l ON l.id = a.location_id
    JOIN equipment_models m ON m.id = a.model_id
    JOIN equipment_categories c ON c.id = m.category_id
    JOIN maintenance_plans p ON p.id = i.plan_id
    JOIN (${todaySql(days)}) t(hospital_id, d) ON t.hospital_id = a.hospital_id
    WHERE ${where}`;
  const dir =
    q.view === "history" && q.sort === "due" && q.dir === "asc"
      ? Prisma.sql`DESC`
      : q.dir === "desc"
        ? Prisma.sql`DESC`
        : Prisma.sql`ASC`;
  const [{ count }] = await tx.$queryRaw<{ count: bigint }[]>`SELECT count(*) AS count ${from}`;
  const rows = await tx.$queryRaw<ScheduleRow[]>`
    SELECT i.*, a.asset_tag, a.name AS asset_name, h.code AS hospital_code, d.name AS department_name,
           c.name AS category_name, l.name AS location_name, p.name AS plan_name, p.work_type::text AS work_type, t.d AS today
    ${from}
    ORDER BY ${ORDER[q.sort]} ${dir}, i.due_on ASC, a.asset_tag ASC, i.id ASC
    LIMIT ${page.take} OFFSET ${page.skip}`;
  return { rows, total: Number(count) };
}

function present(rows: ScheduleRow[], names: Record<string, string>) {
  return rows.map((r) => {
    const due = fromDbDate(r.due_on);
    const today = fromDbDate(r.today);
    const open = OPEN_ITEM.includes(r.status);
    return {
      ...r,
      dueOn: due,
      completedOn: r.completed_on ? fromDbDate(r.completed_on) : null,
      state: open ? (due < today ? "overdue" : due === today ? "due_today" : "upcoming") : null,
      statusLabel: OCCURRENCE_STATUS_LABELS[r.status] ?? r.status,
      assigneeName: r.assignee ? (names[r.assignee] ?? "Unknown") : null,
    };
  });
}

export type ScheduleItem = ReturnType<typeof present>[number];

export async function listSchedule(ctx: AccessContext, rawQuery: unknown, opts: { now?: Date } = {}) {
  await requirePermission(ctx, "pm.view", { entityType: "pm_schedule" });
  const q = scheduleQuerySchema.parse(rawQuery ?? {});
  return withTenant(tenant(ctx), async (tx) => {
    const now = opts.now ?? new Date();
    const first = await querySchedule(ctx, tx, q, { take: PM_PAGE_SIZE, skip: (q.page - 1) * PM_PAGE_SIZE }, now);
    const pageCount = Math.max(1, Math.ceil(first.total / PM_PAGE_SIZE));
    const page = Math.min(q.page, pageCount);
    const result =
      page === q.page
        ? first
        : await querySchedule(ctx, tx, q, { take: PM_PAGE_SIZE, skip: (page - 1) * PM_PAGE_SIZE }, now);
    const names = await peopleNames(
      tx,
      result.rows.map((r) => r.assignee),
    );
    return { rows: present(result.rows, names), total: first.total, page, pageCount, query: { ...q, page } };
  });
}

/** Filters for the schedule screens: only the user's own hospitals and departments. */
export async function scheduleFilterOptions(ctx: AccessContext) {
  await requirePermission(ctx, "pm.view", { entityType: "pm_schedule" });
  return withTenant(tenant(ctx), async (tx) => {
    const [departments, categories, locations, plans, workers] = await Promise.all([
      tx.department.findMany({
        where: {
          status: "ACTIVE",
          OR: ctx.hospitals.map((h) =>
            h.departments === "ALL" ? { hospitalId: h.id } : { hospitalId: h.id, id: { in: h.departments } },
          ),
        },
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
          OR: ctx.hospitals.map((h) =>
            h.departments === "ALL" ? { hospitalId: h.id } : { hospitalId: h.id, departmentId: { in: h.departments } },
          ),
        },
        select: { id: true, name: true },
        orderBy: { name: "asc" },
      }),
      tx.maintenancePlan.findMany({
        where: {
          status: { not: "ARCHIVED" },
          ...(ctx.orgWide
            ? {}
            : { OR: [{ hospitalId: null }, { hospitalId: { in: ctx.hospitals.map((h) => h.id) } }] }),
        },
        select: { id: true, name: true },
        orderBy: { name: "asc" },
      }),
      tx.membership.findMany({
        where: { status: "ACTIVE", role: { in: ["TECHNICIAN", "ENGINEERING_MANAGER"] } },
        select: { userId: true },
      }),
    ]);
    const names = await peopleNames(
      tx,
      workers.map((w) => w.userId),
    );
    return {
      hospitals: ctx.hospitals.map((h) => ({ id: h.id, code: h.code, name: h.name })),
      departments,
      categories,
      locations,
      plans,
      assignees: workers
        .map((w) => ({ id: w.userId, name: names[w.userId] ?? "Unknown" }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    };
  });
}

/** Today's date in the chosen (or first accessible) hospital's time zone. */
export async function todayFor(ctx: AccessContext, hospitalId?: string | null): Promise<DateOnly> {
  const id = hospitalId && ctx.hospitals.some((h) => h.id === hospitalId) ? hospitalId : ctx.hospitals[0]?.id;
  if (!id) return localToday("UTC");
  const h = await withTenant(tenant(ctx), (tx) =>
    tx.hospital.findUnique({ where: { id }, select: { timezone: true } }),
  );
  return localToday(h?.timezone ?? "UTC");
}

// ─── Calendar ────────────────────────────────────────────────────────────────

export type CalendarEntry = {
  date: DateOnly;
  kind: "occurrence" | "scheduled" | "projected";
  status: string;
  label: string;
  assetTag: string;
  planName: string;
  href: string;
  state: "overdue" | "due_today" | "upcoming" | null;
};

/**
 * One month (or any window up to 62 days): recorded occurrences, next due
 * dates, and PROJECTED later due dates of active schedules (marked as such).
 */
export async function calendarMonth(
  ctx: AccessContext,
  input: { from: DateOnly; to: DateOnly; hospital?: string; department?: string },
  opts: { now?: Date } = {},
) {
  await requirePermission(ctx, "pm.view", { entityType: "pm_schedule" });
  const q = scheduleQuerySchema.parse({
    view: "all",
    from: input.from,
    to: input.to,
    hospital: input.hospital,
    department: input.department,
  });
  return withTenant(tenant(ctx), async (tx) => {
    const now = opts.now ?? new Date();
    const { rows } = await querySchedule(ctx, tx, q, { take: 2000, skip: 0 }, now);
    const items = present(rows, {});
    const entries: CalendarEntry[] = items.map((r) => ({
      date: r.dueOn,
      kind: r.kind,
      status: r.status,
      label: r.statusLabel,
      assetTag: r.asset_tag,
      planName: r.plan_name,
      href: r.wo_id ? `/work-orders/${r.wo_id}` : `/assets/${r.asset_id}#pm`,
      state: r.state as CalendarEntry["state"],
    }));
    // Projections: later due dates of active schedules inside the window.
    const schedules = await tx.pmSchedule.findMany({
      where: {
        status: "ACTIVE",
        plan: { status: "ACTIVE", approvedRevisionId: { not: null } },
        asset: {
          AND: [
            assetScopeWhere(ctx),
            input.hospital ? { hospitalId: input.hospital } : {},
            input.department ? { departmentId: input.department } : {},
          ],
        },
        nextDueOn: { lte: new Date(`${input.to}T00:00:00.000Z`) },
      },
      select: {
        id: true,
        anchorOn: true,
        nextSeq: true,
        asset: { select: { id: true, assetTag: true } },
        plan: {
          select: {
            name: true,
            endsOn: true,
            approvedRevision: { select: { intervalCount: true, intervalUnit: true } },
          },
        },
      },
      take: 2000,
    });
    for (const s of schedules) {
      const rev = s.plan.approvedRevision!;
      const anchor = fromDbDate(s.anchorOn);
      const ends = s.plan.endsOn ? fromDbDate(s.plan.endsOn) : null;
      for (let n = s.nextSeq + 1, i = 0; i < 400; n++, i++) {
        const d = dueDate(anchor, rev.intervalUnit as IntervalUnitValue, rev.intervalCount, n);
        if (d > input.to || (ends && d > ends)) break;
        if (d < input.from) continue;
        entries.push({
          date: d,
          kind: "projected",
          status: "PROJECTED",
          label: "Projected",
          assetTag: s.asset.assetTag,
          planName: s.plan.name,
          href: `/assets/${s.asset.id}#pm`,
          state: null,
        });
      }
    }
    entries.sort((a, b) => a.date.localeCompare(b.date) || a.assetTag.localeCompare(b.assetTag));
    return entries;
  });
}

// ─── One asset (asset page and barcode entry) ─────────────────────────────────

export async function getAssetPm(ctx: AccessContext, assetId: string, opts: { now?: Date } = {}) {
  if (!can(ctx, "pm.view")) return null;
  if (!UUID.test(assetId)) throw new NotFoundError("Asset");
  return withTenant(tenant(ctx), async (tx) => {
    const asset = await tx.asset.findFirst({
      where: { AND: [{ id: assetId }, assetScopeWhere(ctx)] },
      select: { id: true, assetTag: true, hospital: { select: { timezone: true } } },
    });
    if (!asset) {
      await auditStandalone({
        organizationId: ctx.organization.id,
        actorUserId: ctx.user.id,
        action: "pm.access_denied",
        outcome: "DENIED",
        entityType: "asset",
        entityId: assetId,
        metadata: { attemptedAction: "pm.asset_view", reason: "not_found_or_outside_scope", role: ctx.role },
        request: ctx.request,
      });
      throw new NotFoundError("Asset");
    }
    const today = localToday(asset.hospital.timezone, opts.now ?? new Date());
    const [schedules, occurrences, hold] = await Promise.all([
      tx.pmSchedule.findMany({
        where: { assetId: asset.id },
        orderBy: [{ status: "asc" }, { nextDueOn: "asc" }],
        select: {
          id: true,
          status: true,
          nextDueOn: true,
          lastDoneOn: true,
          endReason: true,
          plan: {
            select: {
              id: true,
              name: true,
              status: true,
              workType: true,
              approvedRevision: { select: { intervalCount: true, intervalUnit: true } },
            },
          },
        },
      }),
      tx.pmOccurrence.findMany({
        where: { assetId: asset.id },
        orderBy: { dueOn: "desc" },
        take: 20,
        select: {
          id: true,
          dueOn: true,
          status: true,
          completedOn: true,
          onTime: true,
          lastError: true,
          plan: { select: { name: true } },
          workOrder: { select: { id: true, number: true, status: true, outcome: true } },
        },
      }),
      tx.safetyHold.findFirst({
        where: { assetId: asset.id, status: { not: "RELEASED" } },
        select: { id: true, status: true, placedAt: true, failureSummary: true },
      }),
    ]);
    return {
      today,
      hold,
      schedules: schedules.map((s) => {
        const due = fromDbDate(s.nextDueOn);
        const rev = s.plan.approvedRevision;
        return {
          ...s,
          nextDue: due,
          lastDone: s.lastDoneOn ? fromDbDate(s.lastDoneOn) : null,
          interval: rev ? intervalLabel(rev.intervalCount, rev.intervalUnit as IntervalUnitValue) : "Not approved",
          state:
            s.status !== "ACTIVE" || s.plan.status !== "ACTIVE"
              ? null
              : due < today
                ? "overdue"
                : due === today
                  ? "due_today"
                  : "upcoming",
        };
      }),
      occurrences: occurrences.map((o) => ({
        ...o,
        due: fromDbDate(o.dueOn),
        completed: o.completedOn ? fromDbDate(o.completedOn) : null,
      })),
      noApprovedPlan: !schedules.some(
        (s) => s.status === "ACTIVE" && s.plan.approvedRevision && s.plan.status !== "ARCHIVED",
      ),
    };
  });
}

// ─── Dashboard and reports ───────────────────────────────────────────────────

/** Default period: this calendar month up to today (first accessible hospital's date). */
export async function defaultPeriod(ctx: AccessContext, tx: Tx, now: Date) {
  const days = await hospitalDays(ctx, tx, now);
  const today = days[0]?.today ?? now.toISOString().slice(0, 10);
  return { from: `${today.slice(0, 8)}01`, to: today, today };
}

type Bucket = {
  key: string;
  label: string;
  due: number;
  onTime: number;
  late: number;
  open: number;
  missed: number;
  cancelled: number;
  failed: number;
};

const emptyBucket = (key: string, label: string): Bucket => ({
  key,
  label,
  due: 0,
  onTime: 0,
  late: 0,
  open: 0,
  missed: 0,
  cancelled: 0,
  failed: 0,
});

export const pct = (n: number, d: number) => (d === 0 ? null : Math.round((n / d) * 1000) / 10);

type MetricRow = { key: string | null; label: string | null; status: string; on_time: boolean | null; n: bigint };

/**
 * Report metrics for a period (see METRIC DEFINITIONS at the top of this file),
 * overall and broken down by category, department, hospital, location or
 * assigned engineer.
 */
export type ComplianceGroupBy =
  | "category"
  | "department"
  | "hospital"
  | "assignee"
  | "location"
  | "month"
  | "asset"
  | "plan"
  | "none";

export type ComplianceFilters = {
  hospital?: string;
  department?: string;
  category?: string;
  location?: string;
  plan?: string;
  asset?: string;
  assignee?: string;
};

/**
 * PM compliance figures — the ONE calculation used by the maintenance
 * overview, the Stage 7 analytics pages, CSV exports, scheduled report
 * snapshots and the dashboard (see METRIC DEFINITIONS at the top of this file).
 */
export async function pmComplianceMetrics(
  ctx: AccessContext,
  tx: Tx,
  p: { from: string; to: string; by: ComplianceGroupBy } & ComplianceFilters,
  now: Date,
) {
  return metrics(ctx, tx, p, now);
}

async function metrics(
  ctx: AccessContext,
  tx: Tx,
  p: { from: string; to: string; by: ComplianceGroupBy } & ComplianceFilters,
  now: Date,
) {
  const days = await hospitalDays(ctx, tx, now);
  const groupKey = {
    category: Prisma.sql`c.id::text`,
    department: Prisma.sql`d.id::text`,
    hospital: Prisma.sql`h.id::text`,
    assignee: Prisma.sql`i.assignee`,
    location: Prisma.sql`l.id::text`,
    month: Prisma.sql`to_char(i.due_on, 'YYYY-MM')`,
    asset: Prisma.sql`a.id::text`,
    plan: Prisma.sql`p.id::text`,
    none: Prisma.sql`'all'`,
  }[p.by];
  const groupLabel = {
    category: Prisma.sql`c.name`,
    department: Prisma.sql`h.code || ' · ' || d.name`,
    hospital: Prisma.sql`h.name`,
    assignee: Prisma.sql`i.assignee`,
    location: Prisma.sql`l.name`,
    month: Prisma.sql`to_char(i.due_on, 'YYYY-MM')`,
    asset: Prisma.sql`a.asset_tag || ' · ' || a.name`,
    plan: Prisma.sql`p.name`,
    none: Prisma.sql`'All equipment'`,
  }[p.by];
  const filters = [
    scopeSql(ctx),
    Prisma.sql`i.due_on >= ${p.from}::date`,
    Prisma.sql`i.due_on <= ${p.to}::date`,
    Prisma.sql`i.due_on <= t.d`, // only due dates that have arrived
    Prisma.sql`i.status <> 'SKIPPED'`,
    ...(p.hospital ? [Prisma.sql`a.hospital_id = ${p.hospital}::uuid`] : []),
    ...(p.department ? [Prisma.sql`a.department_id = ${p.department}::uuid`] : []),
    ...(p.category ? [Prisma.sql`m.category_id = ${p.category}::uuid`] : []),
    ...(p.location ? [Prisma.sql`a.location_id = ${p.location}::uuid`] : []),
    ...(p.plan ? [Prisma.sql`i.plan_id = ${p.plan}::uuid`] : []),
    ...(p.asset ? [Prisma.sql`a.id = ${p.asset}::uuid`] : []),
    ...(p.assignee ? [Prisma.sql`i.assignee = ${p.assignee}`] : []),
  ];
  const rows = await tx.$queryRaw<MetricRow[]>`
    SELECT ${groupKey} AS key, ${groupLabel} AS label, i.status, i.on_time, count(*) AS n
    FROM (${ITEMS}) i
    JOIN assets a ON a.id = i.asset_id
    JOIN hospitals h ON h.id = a.hospital_id
    JOIN departments d ON d.id = a.department_id
    LEFT JOIN locations l ON l.id = a.location_id
    JOIN equipment_models m ON m.id = a.model_id
    JOIN equipment_categories c ON c.id = m.category_id
    JOIN maintenance_plans p ON p.id = i.plan_id
    JOIN (${todaySql(days)}) t(hospital_id, d) ON t.hospital_id = a.hospital_id
    WHERE ${Prisma.join(filters, " AND ")}
    GROUP BY 1, 2, 3, 4`;
  const total = emptyBucket("all", "All equipment");
  const groups = new Map<string, Bucket>();
  for (const r of rows) {
    const n = Number(r.n);
    const k = r.key ?? "none";
    const g = groups.get(k) ?? emptyBucket(k, r.label ?? (p.by === "assignee" ? "Unassigned" : "None"));
    groups.set(k, g);
    for (const b of [total, g]) {
      b.due += n;
      if (r.status === "COMPLETED") {
        if (r.on_time) b.onTime += n;
        else b.late += n;
      } else if (r.status === "WORK_ORDER_CREATED" || r.status === "SCHEDULED") b.open += n;
      else if (r.status === "MISSED") b.missed += n;
      else if (r.status === "CANCELLED") b.cancelled += n;
      else if (r.status === "FAILED") b.failed += n;
    }
  }
  if (p.by === "assignee") {
    const names = await peopleNames(
      tx,
      [...groups.keys()].filter((k) => k !== "none"),
    );
    for (const [k, g] of groups) if (k !== "none") g.label = names[k] ?? "Unknown";
  }
  const withRates = (b: Bucket) => ({
    ...b,
    compliance: pct(b.onTime, b.due),
    completion: pct(b.onTime + b.late, b.due),
  });
  return {
    total: withRates(total),
    groups: [...groups.values()].map(withRates).sort((a, b) => a.label.localeCompare(b.label)),
  };
}

export type ComplianceBucket = Awaited<ReturnType<typeof metrics>>["total"];

/** Operational counts for the PM overview (right now, hospital dates). */
async function operational(
  ctx: AccessContext,
  tx: Tx,
  now: Date,
  period: { from: string; to: string },
  hospitalId?: string | null,
) {
  const days = await hospitalDays(ctx, tx, now);
  const only = hospitalId ? Prisma.sql`AND a.hospital_id = ${hospitalId}::uuid` : Prisma.empty;
  const open = Prisma.join(OPEN_ITEM.map((s) => Prisma.sql`${s}`));
  const [counts] = await tx.$queryRaw<
    { overdue: bigint; due_today: bigint; upcoming30: bigint; failed: bigint; safety30: bigint }[]
  >`
    SELECT
      count(*) FILTER (WHERE i.status IN (${open}) AND i.due_on < t.d) AS overdue,
      count(*) FILTER (WHERE i.status IN (${open}) AND i.due_on = t.d) AS due_today,
      count(*) FILTER (WHERE i.status IN (${open}) AND i.due_on > t.d AND i.due_on <= t.d + 30) AS upcoming30,
      count(*) FILTER (WHERE i.status = 'FAILED') AS failed,
      count(*) FILTER (WHERE i.status IN (${open}) AND i.due_on <= t.d + 30
        AND (p.work_type = 'SAFETY_TEST' OR r.checklist @> '[{"section":"ELECTRICAL_SAFETY"}]'::jsonb)) AS safety30
    FROM (${ITEMS}) i
    JOIN assets a ON a.id = i.asset_id
    JOIN maintenance_plans p ON p.id = i.plan_id
    LEFT JOIN maintenance_plan_revisions r ON r.id = p.approved_revision_id
    JOIN (${todaySql(days)}) t(hospital_id, d) ON t.hospital_id = a.hospital_id
    WHERE ${scopeSql(ctx)} ${only}`;
  const scope: Prisma.AssetWhereInput = hospitalId
    ? { AND: [assetScopeWhere(ctx), { hospitalId }] }
    : assetScopeWhere(ctx);
  const [activePlans, generated, completed, openHolds] = await Promise.all([
    tx.maintenancePlan.count({
      where: {
        status: "ACTIVE",
        ...(ctx.orgWide ? {} : { OR: [{ hospitalId: null }, { hospitalId: { in: ctx.hospitals.map((h) => h.id) } }] }),
      },
    }),
    tx.workOrder.count({
      where: {
        AND: [
          { pmOccurrenceId: { not: null }, asset: scope },
          {
            createdAt: {
              gte: new Date(`${period.from}T00:00:00.000Z`),
              lt: new Date(`${addDays(period.to, 1)}T00:00:00.000Z`),
            },
          },
        ],
      },
    }),
    tx.pmOccurrence.count({
      where: {
        status: "COMPLETED",
        asset: scope,
        completedOn: { gte: new Date(`${period.from}T00:00:00.000Z`), lte: new Date(`${period.to}T00:00:00.000Z`) },
      },
    }),
    tx.safetyHold.count({ where: { status: { not: "RELEASED" }, asset: scope } }),
  ]);
  return {
    activePlans,
    overdue: Number(counts.overdue),
    dueToday: Number(counts.due_today),
    upcoming30: Number(counts.upcoming30),
    failedGeneration: Number(counts.failed),
    safetyTestsDue30: Number(counts.safety30),
    generatedInPeriod: generated,
    completedInPeriod: completed,
    openHolds,
  };
}

export async function getPmOverview(ctx: AccessContext, opts: { now?: Date } = {}) {
  await requirePermission(ctx, "pm.view", { entityType: "pm_report" });
  const now = opts.now ?? new Date();
  return withTenant(tenant(ctx), async (tx) => {
    const period = await defaultPeriod(ctx, tx, now);
    const [ops, m] = await Promise.all([
      operational(ctx, tx, now, period),
      metrics(ctx, tx, { ...period, by: "category" }, now),
    ]);
    return { period, ...ops, month: m.total };
  });
}

/** PM figures for the main dashboard (replacing the Stage 1 demo figures). */
export async function getDashboardPmKpis(ctx: AccessContext, opts: { now?: Date; hospitalId?: string | null } = {}) {
  if (!can(ctx, "pm.view")) return null;
  const now = opts.now ?? new Date();
  const hospitalId = opts.hospitalId && ctx.hospitals.some((h) => h.id === opts.hospitalId) ? opts.hospitalId : null;
  return withTenant(tenant(ctx), async (tx) => {
    const period = await defaultPeriod(ctx, tx, now);
    const [ops, m] = await Promise.all([
      operational(ctx, tx, now, period, hospitalId),
      metrics(ctx, tx, { ...period, hospital: hospitalId ?? undefined, by: "category" }, now),
    ]);
    return { period, compliance: m.total.compliance, due: m.total.due, onTime: m.total.onTime, ...ops };
  });
}

export async function getPmReport(ctx: AccessContext, rawQuery: unknown, opts: { now?: Date } = {}) {
  await requirePermission(ctx, "pm.report", { entityType: "pm_report" });
  const q = reportQuerySchema.parse(rawQuery ?? {});
  const now = opts.now ?? new Date();
  return withTenant(tenant(ctx), async (tx) => {
    const def = await defaultPeriod(ctx, tx, now);
    let from = q.from ?? def.from;
    let to = q.to ?? def.to;
    if (from > to) [from, to] = [to, from];
    if (q.hospital && !ctx.hospitals.some((h) => h.id === q.hospital)) throw new NotFoundError("Hospital");
    const m = await metrics(ctx, tx, { from, to, hospital: q.hospital, by: q.by }, now);
    return { from, to, by: q.by, hospital: q.hospital ?? null, ...m };
  });
}

const PM_EXPORT_COLUMNS = [
  "Due date",
  "Status",
  "Completed on",
  "On time",
  "Asset ID",
  "Asset",
  "Hospital",
  "Department",
  "Location",
  "Category",
  "Plan",
  "Type",
  "Priority",
  "Assigned to",
  "Work order",
];

/** Every PM due date in the period as CSV, Excel or PDF (same scope and filters as the report). Audited. */
export async function exportPm(ctx: AccessContext, rawQuery: unknown, format: ExportFormat, opts: { now?: Date } = {}) {
  await requirePermission(ctx, "pm.export", { entityType: "pm_report" });
  const r = reportQuerySchema.parse(rawQuery ?? {});
  const now = opts.now ?? new Date();
  const { rows, from, to } = await withTenant(tenant(ctx), async (tx) => {
    const def = await defaultPeriod(ctx, tx, now);
    const from = r.from ?? def.from;
    const to = r.to ?? def.to;
    if (r.hospital && !ctx.hospitals.some((h) => h.id === r.hospital)) throw new NotFoundError("Hospital");
    const q = scheduleQuerySchema.parse({ view: "all", from, to, hospital: r.hospital, sort: "due", dir: "asc" });
    const { rows: found } = await querySchedule(ctx, tx, q, { take: 20_000, skip: 0 }, now);
    const names = await peopleNames(
      tx,
      found.map((x) => x.assignee),
    );
    const rows = present(found, names).map((i) => [
      i.dueOn,
      i.state === "overdue" ? `${i.statusLabel} (overdue)` : i.statusLabel,
      i.completedOn ?? "",
      i.on_time === null ? "" : i.on_time ? "Yes" : "No",
      i.asset_tag,
      i.asset_name,
      i.hospital_code,
      i.department_name,
      i.location_name ?? "",
      i.category_name,
      i.plan_name,
      i.work_type,
      i.priority,
      i.assigneeName ?? "",
      i.wo_number ?? "",
    ]);
    return { rows, from, to };
  });
  const hospital = r.hospital ? (ctx.hospitals.find((h) => h.id === r.hospital)?.name ?? "") : "All your hospitals";
  const doc: ExportDoc = {
    title: "Planned maintenance due dates",
    organization: ctx.organization.name,
    meta: [
      ["Generated (UTC)", now.toISOString()],
      ["Period", `${from} to ${to}`],
      ["Hospital", hospital],
      ["Due dates", String(rows.length)],
    ],
    sections: [{ columns: PM_EXPORT_COLUMNS, rows }],
  };
  const file = await renderExport(ctx, doc, format, { csv: () => tableCsv(PM_EXPORT_COLUMNS, rows), now });
  await withTenant(tenant(ctx), (tx) =>
    audit(tx, {
      organizationId: ctx.organization.id,
      actorUserId: ctx.user.id,
      action: "pm.report_exported",
      entityType: "pm_report",
      metadata: { from, to, hospital: r.hospital ?? null, rows: rows.length, format },
      request: ctx.request,
    }),
  );
  return { ...file, rows: rows.length, from, to };
}

/** CSV of every PM due date in the period (kept for existing callers). */
export async function exportPmCsv(ctx: AccessContext, rawQuery: unknown, opts: { now?: Date } = {}) {
  const r = await exportPm(ctx, rawQuery, "csv", opts);
  return { csv: r.body.toString(), rows: r.rows, from: r.from, to: r.to };
}
