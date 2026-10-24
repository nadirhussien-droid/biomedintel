import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireAccess } from "@/server/auth/session";
import { can } from "@/server/authz/access";
import { NotFoundError } from "@/server/authz/errors";
import { analyticsFilterOptions } from "@/server/services/analytics";
import { getStaffEffectiveness } from "@/server/services/staff-effectiveness";
import { PageHeader } from "@/components/shell/page-header";
import { Card, CardTitle } from "@/components/ui/card";
import { ChartGrid } from "@/components/analytics/charts";
import { ReportFilters, filterQuery } from "@/components/analytics/filters";
import { Definitions, Empty, ExportLink, rowCls, tableHead, td, tdr, th, thr } from "@/components/analytics/ui";
import { staffCharts } from "@/lib/analytics/charts";
import { readReportParams, type SearchParams } from "@/lib/analytics/params";
import { PERIOD_LABELS } from "@/lib/analytics/period";

export const metadata: Metadata = { title: "Staff effectiveness" };

const dash = (v: number | null) => (v === null ? "—" : String(v));

export default async function StaffEffectivenessPage({ searchParams }: { searchParams: SearchParams }) {
  const ctx = await requireAccess();
  if (!can(ctx, "analytics.workload")) {
    return (
      <Card>
        <p className="text-sm">
          Staff figures are only available to Engineering Managers and Organization Administrators.
        </p>
      </Card>
    );
  }
  const raw = await readReportParams(searchParams);
  let data;
  try {
    data = await Promise.all([getStaffEffectiveness(ctx, raw), analyticsFilterOptions(ctx)]);
  } catch (e) {
    if (e instanceof NotFoundError) notFound();
    throw e;
  }
  const [s, options] = data;
  const query = filterQuery(s.q, s.period);
  return (
    <>
      <PageHeader
        title="Staff effectiveness"
        description={`${PERIOD_LABELS[s.period.preset]}: ${s.period.label}. Recorded work and results for each engineer: context for a conversation, not a ranking.`}
        actions={can(ctx, "analytics.export") ? <ExportLink report="staff-effectiveness" query={query} /> : null}
      />
      <Card>
        <ReportFilters
          action="/reports/staff"
          q={s.q}
          period={s.period}
          options={options}
          fields={["period", "hospital", "department"]}
        />
      </Card>

      <ChartGrid charts={staffCharts(s.rows)} />

      <Card>
        <CardTitle>Results by engineer</CardTitle>
        {s.rows.length === 0 ? (
          <Empty>No assigned jobs, logged hours or planned maintenance for these filters.</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <caption className="sr-only">Recorded work and results for each engineer</caption>
              <thead className={tableHead}>
                <tr>
                  <th className={th}>Engineer</th>
                  <th className={thr}>Jobs completed</th>
                  <th className={thr}>Repairs</th>
                  <th className={thr}>Planned</th>
                  <th className={thr}>Hours logged</th>
                  <th className={thr}>Hours per job</th>
                  <th className={thr}>Mean repair time (h)</th>
                  <th className={thr}>Repeat faults</th>
                  <th className={thr}>Reopened</th>
                  <th className={thr}>Open now</th>
                  <th className={thr}>Overdue now</th>
                  <th className={thr}>PM on time</th>
                </tr>
              </thead>
              <tbody>
                {s.rows.map((r) => (
                  <tr key={r.userId} className={rowCls}>
                    <td className={td}>{r.name}</td>
                    <td className={tdr}>{r.completed}</td>
                    <td className={tdr}>{r.corrective}</td>
                    <td className={tdr}>{r.planned}</td>
                    <td className={tdr}>{r.hours}</td>
                    <td className={tdr}>{dash(r.hoursPerJob)}</td>
                    <td className={tdr}>{dash(r.meanCompletionH)}</td>
                    <td className={tdr}>{r.repeatFaults}</td>
                    <td className={tdr}>{r.reopened}</td>
                    <td className={tdr}>{r.openNow}</td>
                    <td className={tdr}>{r.overdueNow}</td>
                    <td className={tdr}>{r.pmDue ? `${r.pmOnTime} of ${r.pmDue} (${dash(r.pmOnTimePct)}%)` : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card>
        <CardTitle>How to read these figures</CardTitle>
        <Definitions
          items={[
            ["Jobs completed", "Jobs assigned to the person and signed off in the period (repairs and planned work)."],
            [
              "Hours logged",
              "Minutes the person logged on jobs in the period. Only as complete as people's time entries.",
            ],
            [
              "Hours per job",
              "Hours logged divided by jobs completed. Jobs differ a lot in size, so compare like with like.",
            ],
            [
              "Mean repair time",
              "Calendar time from fault reported to sign-off, repair jobs only (includes waiting for parts).",
            ],
            ["Repeat faults", "Their completed repairs where the same device was reported again within 30 days."],
            ["Reopened", "Their jobs that someone reopened in the period."],
            ["Open now, overdue now", "Assigned jobs not yet finished, and those past their due date."],
            [
              "PM on time",
              "Planned maintenance assigned to them, due in the period, signed off by the due date plus grace days.",
            ],
          ]}
          footer="Use these figures together with the type and difficulty of the work. There is no single score on purpose. Visible to Engineering Managers and Organization Administrators only; each view is audited."
        />
      </Card>
    </>
  );
}
