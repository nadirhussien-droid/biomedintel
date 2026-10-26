import type { Metadata } from "next";
import Link from "next/link";
import { requireAccess } from "@/server/auth/session";
import { can } from "@/server/authz/access";
import { listWorkOrders } from "@/server/services/work-orders";
import { Card, CardTitle } from "@/components/ui/card";
import { ClosedList } from "@/components/ui/closed-list";
import { PageHeader } from "@/components/shell/page-header";
import { OverdueBadge, PriorityBadge, SafetyBadge, WoStatusBadge } from "@/components/work-orders/badges";
import { PRIORITIES, PRIORITY_LABELS } from "@/lib/validation/work-orders";

export const metadata: Metadata = { title: "Work Orders" };

const dateTime = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" });
const linkButton =
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-md border px-4 text-sm font-semibold transition-colors";
const control = "min-h-11 w-full rounded-sm border border-line-strong bg-white px-3 text-sm text-ink";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default async function WorkOrdersPage({ searchParams }: { searchParams: SearchParams }) {
  const ctx = await requireAccess();
  const sp = await searchParams;
  const raw: Record<string, string | undefined> = {};
  for (const k of ["q", "view", "status", "priority", "hospital", "department", "safety", "sort", "dir", "page"]) {
    raw[k] = first(sp[k]);
  }
  const manage = can(ctx, "workorder.manage");
  const worker = can(ctx, "workorder.work");
  // The list stays closed until someone searches, filters or asks for the full list. Picking a tab only changes which jobs are counted.
  const open = first(sp.all) === "1" || ["q", "status", "priority", "safety", "page"].some((k) => first(sp[k]));
  if (!raw.view) raw.view = worker && !manage ? "mine" : manage ? "open" : "open";
  const result = await listWorkOrders(ctx, raw);
  const q = result.query;

  const tabs = [
    ...(worker ? [{ key: "mine", label: "My jobs" }] : []),
    { key: "open", label: "Open" },
    ...(manage || worker ? [{ key: "triage", label: "Waiting for a technician" }] : []),
    ...(manage ? [{ key: "review", label: "Safety-critical to review" }] : []),
    { key: "completed", label: "Completed" },
    { key: "all", label: "All" },
  ];
  const href = (over: Record<string, string | number | undefined>) => {
    const p = new URLSearchParams();
    const merged: Record<string, string | number | undefined> = {
      view: q.view,
      q: q.q,
      priority: q.priority,
      safety: q.safety,
      page: q.page,
      ...over,
    };
    for (const [k, v] of Object.entries(merged))
      if (v !== undefined && v !== "" && !(k === "page" && v === 1)) p.set(k, String(v));
    return `/work-orders?${p.toString()}`;
  };

  return (
    <>
      <PageHeader
        title="Work Orders"
        description={
          ctx.role === "FAULT_REPORTER"
            ? "Faults you have reported and their progress."
            : "Fault reports and repair jobs for your hospitals and departments."
        }
        actions={
          can(ctx, "workorder.report") ? (
            <div className="flex flex-wrap gap-2">
              <Link
                href="/assets/scan?then=report"
                className={`${linkButton} border-line-strong text-navy-900 hover:bg-surface-sunken bg-white`}
              >
                Scan barcode to report
              </Link>
              <Link
                href="/work-orders/new"
                className={`${linkButton} text-navy-900 border-teal-400 bg-teal-400 hover:bg-teal-500`}
              >
                Report a fault
              </Link>
            </div>
          ) : null
        }
      />

      <nav aria-label="Work order views" className="flex flex-wrap gap-2">
        {tabs.map((t) => (
          <Link
            key={t.key}
            href={href({ view: t.key, page: 1 })}
            aria-current={q.view === t.key ? "page" : undefined}
            className={`rounded-md border px-3 py-2 text-sm font-semibold ${q.view === t.key ? "bg-navy-900 border-navy-900 text-white" : "border-line-strong text-navy-900 bg-white"}`}
          >
            {t.label}
          </Link>
        ))}
      </nav>

      <Card>
        <form
          method="get"
          action="/work-orders"
          role="search"
          aria-label="Search work orders"
          className="grid gap-3 md:grid-cols-[2fr_1fr_1fr_auto] md:items-end"
        >
          <input type="hidden" name="view" value={q.view} />
          <div>
            <label htmlFor="wo-q" className="text-sm font-semibold">
              Search
            </label>
            <input
              id="wo-q"
              name="q"
              type="search"
              defaultValue={q.q ?? ""}
              maxLength={80}
              placeholder="WO number, asset ID (or scan its barcode), device or fault"
              className={`${control} mt-1.5`}
            />
          </div>
          <div>
            <label htmlFor="wo-priority" className="text-sm font-semibold">
              Priority
            </label>
            <select id="wo-priority" name="priority" defaultValue={q.priority ?? ""} className={`${control} mt-1.5`}>
              <option value="">Any priority</option>
              {PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {PRIORITY_LABELS[p]}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="wo-safety" className="text-sm font-semibold">
              Devices
            </label>
            <select id="wo-safety" name="safety" defaultValue={q.safety ?? ""} className={`${control} mt-1.5`}>
              <option value="">All devices</option>
              <option value="only">Safety-critical only</option>
            </select>
          </div>
          <button type="submit" className={`${linkButton} text-navy-900 border-teal-400 bg-teal-400 hover:bg-teal-500`}>
            Apply
          </button>
        </form>
      </Card>

      <Card>
        <CardTitle
          action={
            <span className="text-ink-muted text-sm">
              {result.total === 0 ? "No jobs" : `${result.total} job${result.total === 1 ? "" : "s"}`}
            </span>
          }
        >
          {tabs.find((t) => t.key === q.view)?.label ?? "Work orders"}
        </CardTitle>
        {!open ? (
          <ClosedList
            title="Search or show the full list to see work orders."
            detail={`${result.total} ${result.total === 1 ? "job is" : "jobs are"} in this view. Search above, or`}
            showAllHref={`/work-orders?view=${q.view}&all=1`}
          />
        ) : result.rows.length === 0 ? (
          <div className="bg-surface rounded-md px-4 py-10 text-center">
            <p className="font-semibold">No work orders here.</p>
            <p className="text-ink-muted mt-1 text-sm">Try another view, or clear the search.</p>
          </div>
        ) : (
          <ul className="flex flex-col gap-3">
            {result.rows.map((w) => (
              <li key={w.id} className="border-line rounded-md border p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <Link href={`/work-orders/${w.id}`} className="font-mono font-semibold text-teal-700 hover:underline">
                    {w.number}
                  </Link>
                  <span className="flex flex-wrap gap-1">
                    {w.safetyCritical ? <SafetyBadge /> : null}
                    {w.overdue ? <OverdueBadge /> : null}
                    <PriorityBadge priority={w.priority} />
                    <WoStatusBadge status={w.status} />
                  </span>
                </div>
                <div className="mt-1 text-sm">
                  <span className="font-mono font-semibold">{w.asset.assetTag}</span> · {w.asset.name} ·{" "}
                  <span className="text-ink-muted">
                    {w.hospital.code} · {w.department.name}
                  </span>
                </div>
                <p className="text-ink-muted mt-1 line-clamp-2 text-sm">{w.faultDescription}</p>
                <div className="text-ink-muted mt-1 text-xs">
                  Reported {dateTime.format(w.createdAt)} UTC
                  {w.assignedTo ? ` · assigned to ${w.assignedTo}` : " · not yet assigned"}
                  {w.dueAt && w.status !== "COMPLETED" && w.status !== "CANCELLED"
                    ? ` · due ${dateTime.format(w.dueAt)} UTC`
                    : ""}
                </div>
              </li>
            ))}
          </ul>
        )}
        {open && result.pageCount > 1 ? (
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
