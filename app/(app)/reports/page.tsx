import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireAccess } from "@/server/auth/session";
import { can } from "@/server/authz/access";
import { NotFoundError } from "@/server/authz/errors";
import { analyticsFilterOptions, getAnalyticsOverview } from "@/server/services/analytics";
import { PageHeader } from "@/components/shell/page-header";
import { Card, CardTitle } from "@/components/ui/card";
import { ReportFilters, filterQuery } from "@/components/analytics/filters";
import { ChartGrid } from "@/components/analytics/charts";
import { overviewCharts } from "@/lib/analytics/charts";
import { ExportLink, MetricTile } from "@/components/analytics/ui";
import { readReportParams, type SearchParams } from "@/lib/analytics/params";
import { PERIOD_LABELS } from "@/lib/analytics/period";

export const metadata: Metadata = { title: "Reports and Analytics" };

const SECTIONS: { title: string; keys: string[] }[] = [
  { title: "Equipment", keys: ["registered", "in_service", "unavailable"] },
  { title: "Work orders", keys: ["open_wo", "awaiting_review", "backlog", "avg_completion"] },
  { title: "Planned maintenance", keys: ["pm_due_soon", "pm_overdue", "pm_compliance"] },
  { title: "Electrical safety and return to service", keys: ["failed_tests", "awaiting_retest", "awaiting_approval"] },
  { title: "Reliability", keys: ["recurring"] },
];

export default async function AnalyticsDashboard({ searchParams }: { searchParams: SearchParams }) {
  const ctx = await requireAccess();
  const raw = await readReportParams(searchParams);
  let data;
  try {
    data = await Promise.all([getAnalyticsOverview(ctx, raw), analyticsFilterOptions(ctx)]);
  } catch (e) {
    if (e instanceof NotFoundError) notFound();
    throw e;
  }
  const [o, options] = data;
  const byKey = new Map(o.metrics.map((m) => [m.key, m]));
  return (
    <>
      <PageHeader
        title="Engineering analytics"
        description={`${PERIOD_LABELS[o.period.preset]}: ${o.period.label}${o.period.endsInFuture ? " (period not finished: figures count up to today)" : ""}. Calculated from recorded work orders, maintenance and test results only.`}
        actions={
          can(ctx, "analytics.export") ? <ExportLink report="overview" query={filterQuery(o.q, o.period)} /> : null
        }
      />
      <Card>
        <ReportFilters
          action="/reports"
          q={o.q}
          period={o.period}
          options={options}
          fields={["period", "hospital", "department", "location", "category", "priority"]}
        />
      </Card>
      <ChartGrid charts={overviewCharts(o.metrics, o.pm)} />
      {SECTIONS.map((s) => (
        <section key={s.title} aria-labelledby={`sec-${s.title}`} className="flex flex-col gap-3">
          <h2 id={`sec-${s.title}`} className="text-ink text-base font-semibold">
            {s.title}
          </h2>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {s.keys.map((k) => {
              const m = byKey.get(k);
              return m ? <MetricTile {...m} key={k} /> : null;
            })}
          </div>
        </section>
      ))}
      <Card>
        <CardTitle>About these figures</CardTitle>
        <ul className="text-ink-muted list-disc space-y-1 pl-5 text-sm">
          <li>
            <strong className="text-ink">Right now</strong> figures describe the current state.{" "}
            <strong className="text-ink">In period</strong> figures count only records dated inside the chosen period,
            using each hospital&apos;s local calendar date.
          </li>
          <li>Durations are calendar time. No working hours or public holidays are configured, so none are assumed.</li>
          <li>Figures only include hospitals and departments you have access to, and respect the filters above.</li>
          <li>
            These are operational figures, not a certification of compliance with IEC 62353, AS/NZS 3551 or any other
            standard.
          </li>
        </ul>
      </Card>
    </>
  );
}
