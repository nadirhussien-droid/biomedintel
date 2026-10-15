import type { Metadata } from "next";
import { requireAccess } from "@/server/auth/session";
import { can } from "@/server/authz/access";
import { getPmReport } from "@/server/services/pm-schedule";
import { PageHeader } from "@/components/shell/page-header";
import { Card, CardTitle } from "@/components/ui/card";
import { formatDateOnly } from "@/lib/pm/dates";

export const metadata: Metadata = { title: "Maintenance reports" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
const control = "min-h-11 w-full rounded-sm border border-line-strong bg-white px-3 text-sm text-ink";
const linkButton = "inline-flex min-h-11 items-center justify-center rounded-md border px-4 text-sm font-semibold";
const BY = {
  category: "Equipment category",
  department: "Department",
  hospital: "Hospital",
  location: "Location",
  assignee: "Assigned engineer",
} as const;
const p = (v: number | null) => (v === null ? "—" : `${v}%`);

export default async function ReportsPage({ searchParams }: { searchParams: SearchParams }) {
  const ctx = await requireAccess();
  if (!can(ctx, "pm.report")) {
    return (
      <Card>
        <p className="text-sm">Your role does not include maintenance reports.</p>
      </Card>
    );
  }
  const sp = await searchParams;
  const r = await getPmReport(ctx, {
    from: first(sp.from),
    to: first(sp.to),
    hospital: first(sp.hospital),
    by: first(sp.by),
  });
  // Rendered as a plain <a>, never a prefetching <Link>: viewing the page must
  // never trigger an (audited) export.
  const exportHref = `/maintenance/reports/export?${new URLSearchParams({ from: r.from, to: r.to, ...(r.hospital ? { hospital: r.hospital } : {}) }).toString()}`;
  const rows = [r.total, ...r.groups];
  return (
    <>
      <PageHeader
        title="Maintenance reports"
        description={`${formatDateOnly(r.from)} – ${formatDateOnly(r.to)}. Calculated from recorded due dates and signed-off work orders only.`}
        actions={
          can(ctx, "pm.export") ? (
            <a href={exportHref} download className={`${linkButton} border-line-strong text-navy-900 bg-white`}>
              Export CSV
            </a>
          ) : null
        }
      />
      <Card>
        <form
          method="get"
          action="/maintenance/reports"
          className="grid gap-3 md:grid-cols-[1fr_1fr_1.5fr_1.5fr_auto] md:items-end"
          aria-label="Report period"
        >
          <div>
            <label htmlFor="r-from" className="text-sm font-semibold">
              From
            </label>
            <input id="r-from" name="from" type="date" defaultValue={r.from} className={`${control} mt-1.5`} />
          </div>
          <div>
            <label htmlFor="r-to" className="text-sm font-semibold">
              To
            </label>
            <input id="r-to" name="to" type="date" defaultValue={r.to} className={`${control} mt-1.5`} />
          </div>
          <div>
            <label htmlFor="r-hospital" className="text-sm font-semibold">
              Hospital
            </label>
            <select id="r-hospital" name="hospital" defaultValue={r.hospital ?? ""} className={`${control} mt-1.5`}>
              <option value="">All my hospitals</option>
              {ctx.hospitals.map((h) => (
                <option key={h.id} value={h.id}>
                  {h.code} · {h.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="r-by" className="text-sm font-semibold">
              Break down by
            </label>
            <select id="r-by" name="by" defaultValue={r.by} className={`${control} mt-1.5`}>
              {Object.entries(BY).map(([k, l]) => (
                <option key={k} value={k}>
                  {l}
                </option>
              ))}
            </select>
          </div>
          <button type="submit" className={`${linkButton} text-navy-900 border-teal-400 bg-teal-400`}>
            Show
          </button>
        </form>
      </Card>
      <Card>
        <CardTitle>Compliance by {BY[r.by].toLowerCase()}</CardTitle>
        {r.total.due === 0 ? (
          <p className="text-ink-muted text-sm">No planned maintenance was due in this period.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <caption className="sr-only">Preventive maintenance compliance</caption>
              <thead className="text-ink-muted text-left text-xs uppercase">
                <tr>
                  <th className="py-2 pr-3">{BY[r.by]}</th>
                  <th className="py-2 pr-3 text-right">Due</th>
                  <th className="py-2 pr-3 text-right">On time</th>
                  <th className="py-2 pr-3 text-right">Late</th>
                  <th className="py-2 pr-3 text-right">Open / overdue</th>
                  <th className="py-2 pr-3 text-right">Missed</th>
                  <th className="py-2 pr-3 text-right">Cancelled</th>
                  <th className="py-2 pr-3 text-right">Failed to generate</th>
                  <th className="py-2 pr-3 text-right">Compliance</th>
                  <th className="py-2 pr-3 text-right">Completion</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((g, i) => (
                  <tr key={g.key} className={`border-line border-t ${i === 0 ? "font-semibold" : ""}`}>
                    <td className="py-2 pr-3">{g.label}</td>
                    <td className="py-2 pr-3 text-right">{g.due}</td>
                    <td className="py-2 pr-3 text-right">{g.onTime}</td>
                    <td className="py-2 pr-3 text-right">{g.late}</td>
                    <td className="py-2 pr-3 text-right">{g.open}</td>
                    <td className="py-2 pr-3 text-right">{g.missed}</td>
                    <td className="py-2 pr-3 text-right">{g.cancelled}</td>
                    <td className="py-2 pr-3 text-right">{g.failed}</td>
                    <td className="py-2 pr-3 text-right">{p(g.compliance)}</td>
                    <td className="py-2 pr-3 text-right">{p(g.completion)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <Card>
        <CardTitle>How these figures are calculated</CardTitle>
        <dl className="grid gap-2 text-sm md:grid-cols-2">
          <div>
            <dt className="font-semibold">Due</dt>
            <dd className="text-ink-muted">
              Maintenance with a due date in the period, up to today (hospital date). Skipped dates (asset
              decommissioned or archived) are left out; due dates during a pause are never created.
            </dd>
          </div>
          <div>
            <dt className="font-semibold">On time</dt>
            <dd className="text-ink-muted">
              Signed off by the assigned engineer on or before the due date plus the plan&apos;s grace days.
            </dd>
          </div>
          <div>
            <dt className="font-semibold">Late</dt>
            <dd className="text-ink-muted">Signed off after the due date plus grace days.</dd>
          </div>
          <div>
            <dt className="font-semibold">Open / overdue</dt>
            <dd className="text-ink-muted">
              The due date has arrived and the work is not signed off (work order open, or not yet created).
            </dd>
          </div>
          <div>
            <dt className="font-semibold">Missed</dt>
            <dd className="text-ink-muted">
              The due date passed before any work order was created (recorded during catch-up).
            </dd>
          </div>
          <div>
            <dt className="font-semibold">Cancelled</dt>
            <dd className="text-ink-muted">The PM work order was cancelled. Counted as not done.</dd>
          </div>
          <div>
            <dt className="font-semibold">Compliance</dt>
            <dd className="text-ink-muted">On time ÷ Due.</dd>
          </div>
          <div>
            <dt className="font-semibold">Completion</dt>
            <dd className="text-ink-muted">
              (On time + Late) ÷ Due. Creating a work order never counts as completing maintenance.
            </dd>
          </div>
        </dl>
        <p className="text-ink-muted text-xs">
          These are operational figures from BiomedIntel.ai records, not a certification of regulatory compliance.
        </p>
      </Card>
    </>
  );
}
