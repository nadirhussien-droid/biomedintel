import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAccess } from "@/server/auth/session";
import { can } from "@/server/authz/access";
import { NotFoundError } from "@/server/authz/errors";
import { analyticsFilterOptions } from "@/server/services/analytics";
import { getDepartmentSpend } from "@/server/services/department-spend";
import { PageHeader } from "@/components/shell/page-header";
import { Card, CardTitle } from "@/components/ui/card";
import { ChartGrid } from "@/components/analytics/charts";
import { ReportFilters, filterQuery } from "@/components/analytics/filters";
import { Definitions, Empty, ExportLink, rowCls, tableHead, td, tdr, th, thr } from "@/components/analytics/ui";
import { spendCharts } from "@/lib/analytics/charts";
import { readReportParams, type SearchParams } from "@/lib/analytics/params";
import { PERIOD_LABELS } from "@/lib/analytics/period";

export const metadata: Metadata = { title: "Department spend" };

const money = (amount: number, currency: string | null) => {
  if (!currency) return "—";
  try {
    return new Intl.NumberFormat("en-GB", { style: "currency", currency }).format(amount);
  } catch {
    return `${currency} ${amount.toFixed(2)}`;
  }
};

export default async function DepartmentSpendPage({ searchParams }: { searchParams: SearchParams }) {
  const ctx = await requireAccess();
  if (!can(ctx, "analytics.financial")) {
    return (
      <Card>
        <p className="text-sm">Cost figures are only available to managers, administrators and auditors.</p>
      </Card>
    );
  }
  const raw = await readReportParams(searchParams);
  let data;
  try {
    data = await Promise.all([getDepartmentSpend(ctx, raw), analyticsFilterOptions(ctx)]);
  } catch (e) {
    if (e instanceof NotFoundError) notFound();
    throw e;
  }
  const [d, options] = data;
  const query = filterQuery(d.q, d.period);
  return (
    <>
      <PageHeader
        title="Department spend by month"
        description={`${PERIOD_LABELS[d.period.preset]}: ${d.period.label}. Parts, in-house labour and external service for each department, from recorded figures only.`}
        actions={can(ctx, "analytics.export") ? <ExportLink report="department-spend" query={query} /> : null}
      />
      <Card>
        <ReportFilters
          action="/reports/department-spend"
          q={d.q}
          period={d.period}
          options={options}
          fields={["period", "hospital", "department"]}
        />
      </Card>

      {d.totals.length ? (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {d.totals.map((t) => (
            <Card key={t.currency}>
              <h2 className="text-ink-muted text-sm font-semibold">Total in {t.currency}</h2>
              <p className="text-ink text-2xl font-semibold">{money(t.total, t.currency)}</p>
              <p className="text-ink-muted text-xs">
                Parts {money(t.parts, t.currency)} · Labour {money(t.labour, t.currency)} · External service{" "}
                {money(t.service, t.currency)}
              </p>
            </Card>
          ))}
          <Card>
            <h2 className="text-ink-muted text-sm font-semibold">Labour hours logged</h2>
            <p className="text-ink text-2xl font-semibold">{d.totalHours} h</p>
            {d.unratedHours ? (
              <p className="text-ink-muted text-xs">
                {d.unratedHours} h by people with no hourly rate: counted as hours, no money value.{" "}
                {can(ctx, "labour.rates") ? (
                  <Link href="/reports/labour-rates" className="font-semibold text-teal-700 underline">
                    Set labour rates
                  </Link>
                ) : null}
              </p>
            ) : null}
          </Card>
        </div>
      ) : null}

      <ChartGrid charts={spendCharts(d.rows, d.totals)} />

      <Card>
        <CardTitle>Department by month</CardTitle>
        {d.rows.length === 0 ? (
          <Empty>No recorded parts, labour or service cost in this period.</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <caption className="sr-only">Parts, labour and external service by department and month</caption>
              <thead className={tableHead}>
                <tr>
                  <th className={th}>Month</th>
                  <th className={th}>Department</th>
                  <th className={thr}>Labour hours</th>
                  <th className={th}>Currency</th>
                  <th className={thr}>Parts</th>
                  <th className={thr}>Labour cost</th>
                  <th className={thr}>External service</th>
                  <th className={thr}>Total</th>
                </tr>
              </thead>
              <tbody>
                {d.rows.map((r) => (
                  <tr key={`${r.month}-${r.departmentId}-${r.currency}`} className={rowCls}>
                    <td className={td}>{r.month}</td>
                    <td className={td}>{r.department}</td>
                    <td className={tdr}>{r.hours || ""}</td>
                    <td className={td}>{r.currency ?? "—"}</td>
                    <td className={tdr}>{r.currency ? money(r.parts, r.currency) : "—"}</td>
                    <td className={tdr}>{r.currency ? money(r.labour, r.currency) : "—"}</td>
                    <td className={tdr}>{r.currency ? money(r.service, r.currency) : "—"}</td>
                    <td className={tdr}>{r.currency ? money(r.total, r.currency) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card>
        <CardTitle>What these figures include</CardTitle>
        <Definitions
          items={[
            ["Parts", "Units issued to jobs minus units returned, at the unit cost recorded when issued."],
            [
              "Labour hours",
              "Minutes people logged on jobs, shown as hours. A corrected line replaces the line it fixes.",
            ],
            [
              "Labour cost",
              "Hours times the person's hourly rate on the day the work was logged. No rate means hours only.",
            ],
            ["External service", "The cost on the supplier record, in the month the work was completed."],
            [
              "Which department",
              "A job belongs to the department it was raised for. Months follow each hospital's time zone.",
            ],
            ["Currencies", "Each currency is shown separately and never converted or added together."],
          ]}
          footer="Cost figures are restricted to financial roles and each view is audited."
        />
      </Card>
    </>
  );
}
