import type { Metadata } from "next";
import Link from "next/link";
import { requireAccess } from "@/server/auth/session";
import { can } from "@/server/authz/access";
import { listPlans } from "@/server/services/pm-plans";
import { PageHeader } from "@/components/shell/page-header";
import { Badge, Card, CardTitle } from "@/components/ui/card";
import { PlanStatusBadge } from "@/components/pm/badges";
import { formatDateOnly, fromDbDate, intervalLabel } from "@/lib/pm/dates";
import {
  INTERVAL_SOURCE_LABELS,
  PLAN_STATUSES,
  PLAN_STATUS_LABELS,
  PLAN_WORK_TYPES,
  WORK_TYPE_LABELS,
} from "@/lib/validation/pm";

export const metadata: Metadata = { title: "Maintenance plans" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
const control = "min-h-11 w-full rounded-sm border border-line-strong bg-white px-3 text-sm text-ink";
const linkButton = "inline-flex min-h-11 items-center justify-center rounded-md border px-4 text-sm font-semibold";

export default async function PlansPage({ searchParams }: { searchParams: SearchParams }) {
  const ctx = await requireAccess();
  const sp = await searchParams;
  const result = await listPlans(ctx, {
    q: first(sp.q),
    status: first(sp.status),
    type: first(sp.type),
    page: first(sp.page),
  });
  const q = result.query;
  const href = (page: number) => {
    const p = new URLSearchParams();
    if (q.q) p.set("q", q.q);
    if (q.status) p.set("status", q.status);
    if (q.type) p.set("type", q.type);
    if (page > 1) p.set("page", String(page));
    return `/maintenance/plans?${p.toString()}`;
  };
  return (
    <>
      <PageHeader
        title="Maintenance plans"
        description="Reusable procedures with an approved interval and checklist. A plan creates work only after an Engineering Manager approves it."
        actions={
          can(ctx, "pm.manage") ? (
            <Link
              href="/maintenance/plans/new"
              className={`${linkButton} text-navy-900 border-teal-400 bg-teal-400 hover:bg-teal-500`}
            >
              New plan
            </Link>
          ) : null
        }
      />
      <Card>
        <form
          method="get"
          action="/maintenance/plans"
          role="search"
          aria-label="Search plans"
          className="grid gap-3 md:grid-cols-[2fr_1fr_1fr_auto] md:items-end"
        >
          <div>
            <label htmlFor="plan-q" className="text-sm font-semibold">
              Search
            </label>
            <input
              id="plan-q"
              name="q"
              type="search"
              defaultValue={q.q ?? ""}
              maxLength={80}
              className={`${control} mt-1.5`}
              placeholder="Plan name"
            />
          </div>
          <div>
            <label htmlFor="plan-status" className="text-sm font-semibold">
              Status
            </label>
            <select id="plan-status" name="status" defaultValue={q.status ?? ""} className={`${control} mt-1.5`}>
              <option value="">Not archived</option>
              {PLAN_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {PLAN_STATUS_LABELS[s]}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="plan-type" className="text-sm font-semibold">
              Type
            </label>
            <select id="plan-type" name="type" defaultValue={q.type ?? ""} className={`${control} mt-1.5`}>
              <option value="">Any type</option>
              {PLAN_WORK_TYPES.map((t) => (
                <option key={t} value={t}>
                  {WORK_TYPE_LABELS[t]}
                </option>
              ))}
            </select>
          </div>
          <button type="submit" className={`${linkButton} text-navy-900 border-teal-400 bg-teal-400`}>
            Apply
          </button>
        </form>
      </Card>
      <Card>
        <CardTitle
          action={
            <span className="text-ink-muted text-sm">
              {result.total} plan{result.total === 1 ? "" : "s"}
            </span>
          }
        >
          Plans
        </CardTitle>
        {result.rows.length === 0 ? (
          <div className="bg-surface rounded-md px-4 py-10 text-center">
            <p className="font-semibold">No maintenance plans yet.</p>
            <p className="text-ink-muted mt-1 text-sm">Create one for a device model, a category or a single asset.</p>
          </div>
        ) : (
          <ul className="flex flex-col gap-3">
            {result.rows.map((p) => (
              <li key={p.id} className="border-line rounded-md border p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <Link href={`/maintenance/plans/${p.id}`} className="font-semibold text-teal-700 hover:underline">
                    {p.name}
                  </Link>
                  <span className="flex flex-wrap gap-1">
                    {p.hasUnapprovedChanges && p.status !== "DRAFT" && p.status !== "ARCHIVED" ? (
                      <Badge tone="warn">Changes awaiting approval</Badge>
                    ) : null}
                    <PlanStatusBadge status={p.status} />
                  </span>
                </div>
                <div className="mt-1 text-sm">
                  {WORK_TYPE_LABELS[p.workType]} · {p.target} · {intervalLabel(p.intervalCount, p.intervalUnit)}
                </div>
                <div className="text-ink-muted mt-1 text-xs">
                  Source: {INTERVAL_SOURCE_LABELS[p.intervalSource].replace(/^\d · /, "")} ·{" "}
                  {p.hospital ? p.hospital.code : "Every hospital"} · {p._count.schedules} asset
                  {p._count.schedules === 1 ? "" : "s"} enrolled
                  {p.nextReviewOn ? ` · interval review due ${formatDateOnly(fromDbDate(p.nextReviewOn))}` : ""}
                </div>
              </li>
            ))}
          </ul>
        )}
        {result.pageCount > 1 ? (
          <nav aria-label="Pages" className="flex items-center justify-between text-sm">
            <span className="text-ink-muted">
              Page {result.page} of {result.pageCount}
            </span>
            <span className="flex gap-2">
              {result.page > 1 ? (
                <Link href={href(result.page - 1)} className={`${linkButton} border-line-strong bg-white`}>
                  Previous
                </Link>
              ) : null}
              {result.page < result.pageCount ? (
                <Link href={href(result.page + 1)} className={`${linkButton} border-line-strong bg-white`}>
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
