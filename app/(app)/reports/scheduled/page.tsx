import type { Metadata } from "next";
import Link from "next/link";
import { requireAccess } from "@/server/auth/session";
import { can } from "@/server/authz/access";
import { listReportSchedules } from "@/server/services/report-schedules";
import { PageHeader } from "@/components/shell/page-header";
import { Card, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/card";
import { Empty, fmtDate, fmtDateTime, recordLink, rowCls, tableHead, td, th } from "@/components/analytics/ui";
import { REPORT_KIND_LABELS } from "@/lib/validation/analytics";
import { CreateScheduleForm, ScheduleButton } from "./forms";

export const metadata: Metadata = { title: "Scheduled reports" };

export default async function ScheduledReportsPage() {
  const ctx = await requireAccess();
  const data = await listReportSchedules(ctx);
  const manage = can(ctx, "reports.schedule");
  const scheduleName = new Map(data.schedules.map((s) => [s.id, s.name]));
  return (
    <>
      <PageHeader
        title="Scheduled reports"
        description="Reports generated automatically after each week or month ends, kept as read-only snapshots. Recipients are told in BiomedIntel.ai — no email provider is connected, so nothing is sent outside the application."
      />
      <Card>
        <CardTitle>Schedules ({data.schedules.length})</CardTitle>
        {data.schedules.length === 0 ? (
          <Empty>No scheduled reports yet.</Empty>
        ) : (
          <div
            className="overflow-x-auto"
            tabIndex={0}
            role="region"
            aria-label="Table (scroll sideways on small screens)"
          >
            <table className="w-full text-sm">
              <caption className="sr-only">Scheduled reports</caption>
              <thead className={tableHead}>
                <tr>
                  <th className={th}>Name</th>
                  <th className={th}>Report</th>
                  <th className={th}>How often</th>
                  <th className={th}>Covers</th>
                  <th className={th}>Recipients</th>
                  <th className={th}>Status</th>
                  {manage ? <th className={th}>Actions</th> : null}
                </tr>
              </thead>
              <tbody>
                {data.schedules.map((s) => (
                  <tr key={s.id} className={`${rowCls} align-top`}>
                    <td className={td}>
                      <div className="font-semibold">{s.name}</div>
                      <div className="text-ink-muted text-xs">by {data.names[s.createdById] ?? "Unknown"}</div>
                    </td>
                    <td className={td}>{REPORT_KIND_LABELS[s.kind] ?? s.kind}</td>
                    <td className={td}>{s.frequency === "WEEKLY" ? "Weekly" : "Monthly"}</td>
                    <td className={td}>
                      {s.hospital ? `${s.hospital.code} · ${s.hospital.name}` : "Whole organisation"}
                    </td>
                    <td className={`${td} max-w-xs`}>
                      {s.recipientIds.map((id) => data.names[id] ?? "Unknown").join(", ")}
                    </td>
                    <td className={td}>
                      {s.active ? <Badge tone="ok">Active</Badge> : <Badge tone="neutral">Paused</Badge>}
                    </td>
                    {manage ? (
                      <td className={td}>
                        <div className="flex flex-col gap-2">
                          {s.active ? (
                            <>
                              <ScheduleButton
                                action="generate"
                                id={s.id}
                                label="Generate now"
                                confirm="Generate this report for the last complete period now? If it already exists, nothing new is created."
                              />
                              <ScheduleButton action="pause" id={s.id} label="Pause" />
                            </>
                          ) : (
                            <ScheduleButton action="resume" id={s.id} label="Resume" />
                          )}
                        </div>
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <Card>
        <CardTitle>Generated reports</CardTitle>
        {data.snapshots.length === 0 ? (
          <Empty>No report has been generated yet. Reports are created by the daily jobs after each period ends.</Empty>
        ) : (
          <div
            className="overflow-x-auto"
            tabIndex={0}
            role="region"
            aria-label="Table (scroll sideways on small screens)"
          >
            <table className="w-full text-sm">
              <caption className="sr-only">Generated reports</caption>
              <thead className={tableHead}>
                <tr>
                  <th className={th}>Report</th>
                  <th className={th}>Schedule</th>
                  <th className={th}>Period</th>
                  <th className={th}>Generated</th>
                </tr>
              </thead>
              <tbody>
                {data.snapshots.map((s) => (
                  <tr key={s.id} className={rowCls}>
                    <td className={td}>
                      <Link href={`/reports/scheduled/${s.id}`} className={recordLink}>
                        {REPORT_KIND_LABELS[s.kind] ?? s.kind}
                      </Link>
                    </td>
                    <td className={td}>{s.scheduleId ? (scheduleName.get(s.scheduleId) ?? "—") : "—"}</td>
                    <td className={td}>
                      {fmtDate(s.periodFrom)} – {fmtDate(s.periodTo)}
                    </td>
                    <td className={td}>{fmtDateTime(s.generatedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      {manage ? (
        <Card>
          <CardTitle>New scheduled report</CardTitle>
          <CreateScheduleForm
            hospitals={ctx.hospitals
              .filter((h) => h.departments === "ALL")
              .map((h) => ({ id: h.id, code: h.code, name: h.name }))}
            people={data.people}
            orgWide={ctx.orgWide}
          />
        </Card>
      ) : null}
    </>
  );
}
