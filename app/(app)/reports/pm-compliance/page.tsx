import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAccess } from "@/server/auth/session";
import { can } from "@/server/authz/access";
import { NotFoundError } from "@/server/authz/errors";
import { analyticsFilterOptions, getPmComplianceReport } from "@/server/services/analytics";
import { PageHeader } from "@/components/shell/page-header";
import { Card, CardTitle } from "@/components/ui/card";
import { ReportFilters, filterQuery } from "@/components/analytics/filters";
import {
  BarTable,
  Definitions,
  Empty,
  ExportLink,
  Pager,
  ToneTag,
  fmtPct,
  rowCls,
  tableHead,
  td,
  tdr,
  th,
  thr,
} from "@/components/analytics/ui";
import { readReportParams, type SearchParams } from "@/lib/analytics/params";
import { PERIOD_LABELS } from "@/lib/analytics/period";

export const metadata: Metadata = { title: "PM compliance" };

const BY: Record<string, string> = {
  category: "Equipment category",
  department: "Department",
  hospital: "Hospital",
  location: "Location",
  plan: "Maintenance plan",
  asset: "Asset",
  month: "Month due",
};

const monthLabel = (m: string) =>
  new Intl.DateTimeFormat("en-GB", { month: "short", year: "numeric", timeZone: "UTC" }).format(
    new Date(`${m}-01T00:00:00Z`),
  );

export default async function PmCompliancePage({ searchParams }: { searchParams: SearchParams }) {
  const ctx = await requireAccess();
  const raw = await readReportParams(searchParams);
  let data;
  try {
    data = await Promise.all([getPmComplianceReport(ctx, raw), analyticsFilterOptions(ctx)]);
  } catch (e) {
    if (e instanceof NotFoundError) notFound();
    throw e;
  }
  const [r, options] = data;
  const workload = can(ctx, "analytics.workload");
  const choices = workload ? { ...BY, assignee: "Assigned engineer" } : BY;
  const query = filterQuery(r.q, r.period, { by: r.by });
  const groupHref = (key: string) =>
    r.by === "asset" ? `/assets/${key}` : r.by === "plan" ? `/maintenance/plans/${key}` : null;
  const c = r.total;
  // Stage 6 due-date detail export (one line per due date) — same scope and audit.
  const detail = new URLSearchParams({
    from: r.period.from,
    to: r.period.to,
    ...(r.q.hospital ? { hospital: r.q.hospital } : {}),
  });
  return (
    <>
      <PageHeader
        title="Preventive maintenance compliance"
        description={`${PERIOD_LABELS[r.period.preset]}: ${r.period.label}. Uses the due date recorded when each PM was scheduled and the date it was actually signed off — never today's plan settings.`}
        actions={
          can(ctx, "analytics.export") ? (
            <div className="flex flex-wrap gap-2">
              <ExportLink report="pm-compliance" query={query} label="Export summary (CSV)" />
              {can(ctx, "pm.export") ? (
                <a
                  href={`/maintenance/reports/export?${detail.toString()}`}
                  download
                  className="border-line-strong text-navy-900 inline-flex min-h-11 items-center justify-center rounded-md border bg-white px-4 text-sm font-semibold"
                >
                  Export each due date (CSV)
                </a>
              ) : null}
            </div>
          ) : null
        }
      />
      <Card>
        <ReportFilters
          action="/reports/pm-compliance"
          q={r.q}
          period={r.period}
          options={options}
          fields={["period", "hospital", "department", "location", "category", "assignee"]}
          by={{ value: r.by, choices }}
        />
      </Card>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Card>
          <h2 className="text-ink-muted text-sm font-semibold">On-time compliance</h2>
          <p className="text-3xl font-bold">{fmtPct(c.compliance)}</p>
          {c.compliance === null ? (
            <p className="text-ink-muted text-xs">N/A — nothing was due in this period.</p>
          ) : (
            <>
              <ToneTag tone={c.compliance >= 90 ? "ok" : c.compliance >= 70 ? "warn" : "danger"} />
              <p className="text-ink-muted text-xs">
                {c.onTime} of {c.due} due dates signed off on time.
              </p>
            </>
          )}
        </Card>
        <Card>
          <h2 className="text-ink-muted text-sm font-semibold">Completion (on time or late)</h2>
          <p className="text-3xl font-bold">{fmtPct(c.completion)}</p>
          <p className="text-ink-muted text-xs">
            {c.onTime + c.late} of {c.due} due dates signed off; {c.late} late.
          </p>
        </Card>
        <Card>
          <h2 className="text-ink-muted text-sm font-semibold">Still open or overdue</h2>
          <p className="text-3xl font-bold">{c.open}</p>
          {c.open ? <ToneTag tone="danger">Overdue or due — not signed off</ToneTag> : null}
        </Card>
        <Card>
          <h2 className="text-ink-muted text-sm font-semibold">Missed, cancelled or failed to generate</h2>
          <p className="text-3xl font-bold">{c.missed + c.cancelled + c.failed}</p>
          <p className="text-ink-muted text-xs">
            {c.missed} missed · {c.cancelled} cancelled · {c.failed} failed to generate. All count as not done.
          </p>
        </Card>
      </div>
      <Card>
        <CardTitle>On-time compliance by month</CardTitle>
        <BarTable
          caption="On-time PM compliance by month due"
          head={["Month due", "Compliance"]}
          max={100}
          rows={r.months.map((m) => ({
            key: m.month,
            label: monthLabel(m.month),
            value: m.compliance,
            display: m.compliance === null ? "N/A (nothing due)" : `${m.compliance}%`,
            note: m.due ? `${m.onTime} of ${m.due} on time` : undefined,
          }))}
        />
      </Card>
      <Card>
        <CardTitle>
          By {choices[r.by]?.toLowerCase() ?? r.by} {r.groupCount ? `(${r.groupCount})` : ""}
        </CardTitle>
        {r.by === "assignee" ? (
          <p className="text-ink-muted text-xs">
            Shown for workload planning only, in alphabetical order. Compliance depends on how work is assigned, parts
            and access to equipment — it is not a measure of individual performance.
          </p>
        ) : null}
        {c.due === 0 ? (
          <Empty>No planned maintenance was due in this period.</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <caption className="sr-only">Preventive maintenance compliance breakdown</caption>
              <thead className={tableHead}>
                <tr>
                  <th className={th}>{choices[r.by] ?? r.by}</th>
                  <th className={thr}>Due</th>
                  <th className={thr}>On time</th>
                  <th className={thr}>Late</th>
                  <th className={thr}>Open / overdue</th>
                  <th className={thr}>Missed</th>
                  <th className={thr}>Cancelled</th>
                  <th className={thr}>Failed to generate</th>
                  <th className={thr}>Compliance</th>
                  <th className={thr}>Completion</th>
                </tr>
              </thead>
              <tbody>
                {[c, ...r.groups].map((g, i) => {
                  const href = i === 0 ? null : groupHref(g.key);
                  return (
                    <tr key={`${i}-${g.key}`} className={`${rowCls} ${i === 0 ? "font-semibold" : ""}`}>
                      <td className={td}>
                        {href ? (
                          <Link href={href} className="font-semibold text-teal-700 hover:underline">
                            {g.label}
                          </Link>
                        ) : r.by === "month" && i > 0 ? (
                          monthLabel(g.key)
                        ) : (
                          g.label
                        )}
                      </td>
                      <td className={tdr}>{g.due}</td>
                      <td className={tdr}>{g.onTime}</td>
                      <td className={tdr}>{g.late}</td>
                      <td className={tdr}>{g.open}</td>
                      <td className={tdr}>{g.missed}</td>
                      <td className={tdr}>{g.cancelled}</td>
                      <td className={tdr}>{g.failed}</td>
                      <td className={tdr}>{fmtPct(g.compliance)}</td>
                      <td className={tdr}>{fmtPct(g.completion)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <Pager
          page={r.page}
          pageCount={r.pageCount}
          href={(page) => `/reports/pm-compliance?${filterQuery(r.q, r.period, { by: r.by, page })}`}
        />
        <p className="text-sm">
          <Link href="/maintenance/schedule?view=overdue" className="font-semibold text-teal-700 hover:underline">
            Open the overdue maintenance list →
          </Link>
        </p>
      </Card>
      <Card>
        <CardTitle>How these figures are calculated</CardTitle>
        <Definitions
          items={[
            [
              "Due",
              "PM due dates inside the period, up to today (each hospital's date). Dates skipped because the asset was decommissioned or archived are left out; no due dates are created while a plan is paused.",
            ],
            ["On time", "Signed off on or before the due date plus the plan's grace days."],
            ["Late", "Signed off after the due date plus grace days."],
            ["Open / overdue", "The due date has arrived and the work is not signed off."],
            ["Missed", "The due date passed before any work order was created (recorded during catch-up)."],
            ["Cancelled", "The PM work order was cancelled. Counted as not done."],
            [
              "Failed to generate",
              "The work order could not be created; it is retried automatically. Counted as not done.",
            ],
            ["On-time compliance", "On time ÷ Due × 100. Shown as N/A when nothing was due — never as 0% or 100%."],
            [
              "Completion",
              "(On time + Late) ÷ Due × 100. Creating a work order never counts as completing maintenance.",
            ],
            [
              "Historical accuracy",
              "Each due date is stored when it is scheduled, linked to the approved plan revision in force at the time, and on time / late is recorded at sign-off. Changing a plan later does not rewrite past compliance.",
            ],
          ]}
        />
      </Card>
    </>
  );
}
