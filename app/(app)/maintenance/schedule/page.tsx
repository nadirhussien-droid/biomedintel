import type { Metadata } from "next";
import Link from "next/link";
import { requireAccess } from "@/server/auth/session";
import { listSchedule, scheduleFilterOptions } from "@/server/services/pm-schedule";
import { PageHeader } from "@/components/shell/page-header";
import { Card, CardTitle } from "@/components/ui/card";
import { DueStateBadge, OccurrenceBadge } from "@/components/pm/badges";
import { PriorityBadge } from "@/components/work-orders/badges";
import { formatDateOnly } from "@/lib/pm/dates";
import { OCCURRENCE_STATUS_LABELS, SCHEDULE_STATUSES, WORK_TYPE_LABELS } from "@/lib/validation/pm";
import { PRIORITIES, PRIORITY_LABELS, type PriorityValue } from "@/lib/validation/work-orders";

export const metadata: Metadata = { title: "Maintenance schedule" };

const control =
  "min-h-11 w-full min-w-0 max-w-full rounded-sm border border-line-strong bg-white px-3 text-sm text-ink";
const linkButton = "inline-flex min-h-11 items-center justify-center rounded-md border px-4 text-sm font-semibold";
type SearchParams = Promise<Record<string, string | string[] | undefined>>;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
const KEYS = [
  "view",
  "q",
  "from",
  "to",
  "within",
  "hospital",
  "department",
  "category",
  "location",
  "asset",
  "plan",
  "assignee",
  "status",
  "priority",
  "sort",
  "dir",
  "page",
];

const TABS = [
  { key: "upcoming", label: "Upcoming" },
  { key: "today", label: "Due today" },
  { key: "overdue", label: "Overdue" },
  { key: "history", label: "Completed and history" },
  { key: "all", label: "All" },
];

export default async function SchedulePage({ searchParams }: { searchParams: SearchParams }) {
  const ctx = await requireAccess();
  const sp = await searchParams;
  const raw: Record<string, string | undefined> = {};
  for (const k of KEYS) raw[k] = first(sp[k]);
  const [result, options] = await Promise.all([listSchedule(ctx, raw), scheduleFilterOptions(ctx)]);
  const q = result.query;
  const href = (over: Record<string, string | number | undefined>) => {
    const p = new URLSearchParams();
    const merged: Record<string, string | number | undefined> = { ...q, ...over } as Record<
      string,
      string | number | undefined
    >;
    for (const [k, v] of Object.entries(merged)) {
      if (
        v === undefined ||
        v === "" ||
        (k === "page" && v === 1) ||
        (k === "sort" && v === "due") ||
        (k === "dir" && v === "asc")
      )
        continue;
      p.set(k, String(v));
    }
    return `/maintenance/schedule?${p.toString()}`;
  };
  const filtered = Boolean(
    q.q ||
      q.from ||
      q.to ||
      q.within ||
      q.hospital ||
      q.department ||
      q.category ||
      q.location ||
      q.asset ||
      q.plan ||
      q.assignee ||
      q.status ||
      q.priority,
  );

  return (
    <>
      <PageHeader
        title="Maintenance schedule"
        description="Due, upcoming and overdue planned maintenance, and its history. Dates are the hospital's own date."
        actions={
          <Link href="/assets/scan?then=pm" className={`${linkButton} border-line-strong text-navy-900 bg-white`}>
            Scan barcode
          </Link>
        }
      />
      <nav aria-label="Schedule views" className="flex flex-wrap gap-2">
        {TABS.map((t) => (
          <Link
            key={t.key}
            href={href({ view: t.key, page: 1 })}
            aria-current={q.view === t.key ? "page" : undefined}
            className={`rounded-md border px-3 py-2 text-sm font-semibold ${q.view === t.key ? "text-navy-900 border-teal-400 bg-teal-400" : "border-line-strong text-navy-900 bg-white"}`}
          >
            {t.label}
          </Link>
        ))}
      </nav>

      <Card>
        <form
          method="get"
          action="/maintenance/schedule"
          role="search"
          aria-label="Filter the maintenance schedule"
          className="grid gap-3 md:grid-cols-4 md:items-end"
        >
          <input type="hidden" name="view" value={q.view} />
          {q.asset ? <input type="hidden" name="asset" value={q.asset} /> : null}
          <div className="md:col-span-2">
            <label htmlFor="pm-q" className="text-sm font-semibold">
              Search
            </label>
            <input
              id="pm-q"
              name="q"
              type="search"
              defaultValue={q.q ?? ""}
              maxLength={80}
              placeholder="Asset ID (or scan its barcode), device, plan or WO number"
              className={`${control} mt-1.5`}
            />
          </div>
          <div>
            <label htmlFor="pm-within" className="text-sm font-semibold">
              Due within
            </label>
            <select
              id="pm-within"
              name="within"
              defaultValue={q.within ? String(q.within) : ""}
              className={`${control} mt-1.5`}
            >
              <option value="">Any time</option>
              {[7, 14, 30, 60, 90].map((d) => (
                <option key={d} value={d}>
                  {d} days
                </option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="min-w-0">
              <label htmlFor="pm-from" className="text-sm font-semibold">
                From
              </label>
              <input id="pm-from" name="from" type="date" defaultValue={q.from ?? ""} className={`${control} mt-1.5`} />
            </div>
            <div className="min-w-0">
              <label htmlFor="pm-to" className="text-sm font-semibold">
                To
              </label>
              <input id="pm-to" name="to" type="date" defaultValue={q.to ?? ""} className={`${control} mt-1.5`} />
            </div>
          </div>
          <Select
            id="pm-hospital"
            label="Hospital"
            name="hospital"
            value={q.hospital}
            options={options.hospitals.map((h) => [h.id, `${h.code} · ${h.name}`])}
          />
          <Select
            id="pm-department"
            label="Department"
            name="department"
            value={q.department}
            options={options.departments.map((d) => [d.id, `${d.hospital.code} · ${d.name}`])}
          />
          <Select
            id="pm-location"
            label="Location"
            name="location"
            value={q.location}
            options={options.locations.map((l) => [l.id, l.name])}
          />
          <Select
            id="pm-category"
            label="Equipment category"
            name="category"
            value={q.category}
            options={options.categories.map((c) => [c.id, c.name])}
          />
          <Select
            id="pm-plan"
            label="Plan"
            name="plan"
            value={q.plan}
            options={options.plans.map((p) => [p.id, p.name])}
          />
          <Select
            id="pm-assignee"
            label="Assigned engineer"
            name="assignee"
            value={q.assignee}
            options={options.assignees.map((a) => [a.id, a.name])}
          />
          <Select
            id="pm-status"
            label="Status"
            name="status"
            value={q.status}
            options={SCHEDULE_STATUSES.map((s) => [s, OCCURRENCE_STATUS_LABELS[s]])}
          />
          <Select
            id="pm-priority"
            label="Priority"
            name="priority"
            value={q.priority}
            options={PRIORITIES.map((p) => [p, PRIORITY_LABELS[p]])}
          />
          <div className="grid grid-cols-2 gap-3">
            <div className="min-w-0">
              <label htmlFor="pm-sort" className="text-sm font-semibold">
                Sort by
              </label>
              <select id="pm-sort" name="sort" defaultValue={q.sort} className={`${control} mt-1.5`}>
                <option value="due">Due date</option>
                <option value="asset">Asset ID</option>
                <option value="plan">Plan</option>
                <option value="priority">Priority</option>
              </select>
            </div>
            <div className="min-w-0">
              <label htmlFor="pm-dir" className="text-sm font-semibold">
                Order
              </label>
              <select id="pm-dir" name="dir" defaultValue={q.dir} className={`${control} mt-1.5`}>
                <option value="asc">Ascending</option>
                <option value="desc">Descending</option>
              </select>
            </div>
          </div>
          <div className="flex gap-2 md:col-span-3">
            <button
              type="submit"
              className={`${linkButton} text-navy-900 border-teal-400 bg-teal-400 hover:bg-teal-500`}
            >
              Apply
            </button>
            {filtered ? (
              <Link
                href={`/maintenance/schedule?view=${q.view}`}
                className={`${linkButton} border-line-strong bg-white`}
              >
                Clear filters
              </Link>
            ) : null}
          </div>
        </form>
      </Card>

      <Card>
        <CardTitle
          action={
            <span className="text-ink-muted text-sm">
              {result.total === 0 ? "Nothing" : `${result.total} item${result.total === 1 ? "" : "s"}`}
            </span>
          }
        >
          {TABS.find((t) => t.key === q.view)?.label}
        </CardTitle>
        {result.rows.length === 0 ? (
          <div className="bg-surface rounded-md px-4 py-10 text-center">
            <p className="font-semibold">
              {q.view === "overdue"
                ? "Nothing is overdue."
                : q.view === "today"
                  ? "Nothing is due today."
                  : "No planned maintenance here."}
            </p>
            <p className="text-ink-muted mt-1 text-sm">
              {filtered
                ? "Try clearing the filters."
                : "Plans create these entries once they are approved and assets are enrolled."}
            </p>
          </div>
        ) : (
          <div
            className="overflow-x-auto"
            tabIndex={0}
            role="region"
            aria-label="Table (scroll sideways on small screens)"
          >
            <table className="w-full text-sm">
              <caption className="sr-only">Planned maintenance</caption>
              <thead className="text-ink-muted text-left text-xs uppercase">
                <tr>
                  <th className="py-2 pr-3">Due</th>
                  <th className="py-2 pr-3">Status</th>
                  <th className="py-2 pr-3">Asset</th>
                  <th className="py-2 pr-3">Plan</th>
                  <th className="py-2 pr-3">Where</th>
                  <th className="py-2 pr-3">Assigned</th>
                  <th className="py-2 pr-3">Work order</th>
                </tr>
              </thead>
              <tbody>
                {result.rows.map((r) => (
                  <tr key={`${r.kind}-${r.id}`} className="border-line border-t align-top">
                    <td className="py-2.5 pr-3 whitespace-nowrap">
                      <div className="font-semibold">{formatDateOnly(r.dueOn)}</div>
                      <DueStateBadge state={r.state} />
                    </td>
                    <td className="py-2.5 pr-3">
                      <div className="flex flex-col items-start gap-1">
                        <OccurrenceBadge status={r.status} />
                        <PriorityBadge priority={r.priority as PriorityValue} />
                      </div>
                      {r.completedOn ? (
                        <div className="text-ink-muted mt-1 text-xs">
                          Done {formatDateOnly(r.completedOn)} · {r.on_time ? "on time" : "late"}
                        </div>
                      ) : null}
                      {r.status === "FAILED" && r.last_error ? (
                        <div className="text-danger mt-1 max-w-56 text-xs">{r.last_error}</div>
                      ) : null}
                      {r.note && r.status !== "FAILED" ? (
                        <div className="text-ink-muted mt-1 max-w-56 text-xs">{r.note}</div>
                      ) : null}
                    </td>
                    <td className="py-2.5 pr-3">
                      <Link
                        href={`/assets/${r.asset_id}#pm`}
                        className="font-mono font-semibold text-teal-700 hover:underline"
                      >
                        {r.asset_tag}
                      </Link>
                      <div>{r.asset_name}</div>
                      <div className="text-ink-muted text-xs">{r.category_name}</div>
                    </td>
                    <td className="py-2.5 pr-3">
                      <Link href={`/maintenance/plans/${r.plan_id}`} className="hover:underline">
                        {r.plan_name}
                      </Link>
                      <div className="text-ink-muted text-xs">{WORK_TYPE_LABELS[r.work_type]}</div>
                    </td>
                    <td className="py-2.5 pr-3">
                      {r.hospital_code} · {r.department_name}
                      {r.location_name ? <div className="text-ink-muted text-xs">{r.location_name}</div> : null}
                    </td>
                    <td className="py-2.5 pr-3">
                      {r.assigneeName ?? <span className="text-ink-muted">Not assigned</span>}
                    </td>
                    <td className="py-2.5 pr-3">
                      {r.wo_id ? (
                        <Link
                          href={`/work-orders/${r.wo_id}`}
                          className="font-mono font-semibold text-teal-700 hover:underline"
                        >
                          {r.wo_number}
                        </Link>
                      ) : r.kind === "scheduled" ? (
                        <span className="text-ink-muted text-xs">Created automatically before the due date</span>
                      ) : (
                        "—"
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {result.pageCount > 1 ? (
          <nav aria-label="Pages" className="flex items-center justify-between text-sm">
            <span className="text-ink-muted">
              Page {result.page} of {result.pageCount}
            </span>
            <span className="flex gap-2">
              {result.page > 1 ? (
                <Link href={href({ page: result.page - 1 })} className={`${linkButton} border-line-strong bg-white`}>
                  Previous
                </Link>
              ) : null}
              {result.page < result.pageCount ? (
                <Link href={href({ page: result.page + 1 })} className={`${linkButton} border-line-strong bg-white`}>
                  Next
                </Link>
              ) : null}
            </span>
          </nav>
        ) : null}
      </Card>
    </>
  );
}

function Select({
  id,
  label,
  name,
  value,
  options,
}: {
  id: string;
  label: string;
  name: string;
  value?: string;
  options: [string, string][];
}) {
  return (
    <div>
      <label htmlFor={id} className="text-sm font-semibold">
        {label}
      </label>
      <select id={id} name={name} defaultValue={value ?? ""} className={`${control} mt-1.5`}>
        <option value="">Any</option>
        {options.map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </select>
    </div>
  );
}
