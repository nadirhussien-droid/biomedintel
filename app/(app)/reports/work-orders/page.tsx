import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAccess } from "@/server/auth/session";
import { can } from "@/server/authz/access";
import { NotFoundError } from "@/server/authz/errors";
import { analyticsFilterOptions, getWorkOrderAnalytics } from "@/server/services/analytics";
import { PageHeader } from "@/components/shell/page-header";
import { Card, CardTitle } from "@/components/ui/card";
import { ReportFilters, filterQuery } from "@/components/analytics/filters";
import {
  BarTable,
  Definitions,
  Empty,
  ExportLink,
  ToneTag,
  fmtHours,
  fmtPct,
  recordLink,
  rowCls,
  tableHead,
  td,
  tdr,
  th,
  thr,
} from "@/components/analytics/ui";
import { readReportParams, type SearchParams } from "@/lib/analytics/params";
import { PERIOD_LABELS } from "@/lib/analytics/period";
import { WORK_TYPE_LABELS } from "@/lib/validation/pm";
import {
  PRIORITY_LABELS,
  PRIORITY_TARGET_HOURS,
  WO_STATUS_LABELS,
  type PriorityValue,
  type WorkOrderStatusValue,
} from "@/lib/validation/work-orders";

export const metadata: Metadata = { title: "Work order performance" };

const BACKLOG_LABELS: Record<string, string> = {
  "0-7": "Up to 7 days",
  "8-30": "8 to 30 days",
  "31-90": "31 to 90 days",
  "90+": "More than 90 days",
};

function Stat({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="border-line rounded-md border bg-white p-4">
      <h3 className="text-ink-muted text-sm font-semibold">{label}</h3>
      <p className="text-2xl font-bold">{value}</p>
      {note ? <p className="text-ink-muted text-xs">{note}</p> : null}
    </div>
  );
}

export default async function WorkOrderAnalyticsPage({ searchParams }: { searchParams: SearchParams }) {
  const ctx = await requireAccess();
  const raw = await readReportParams(searchParams);
  let data;
  try {
    data = await Promise.all([getWorkOrderAnalytics(ctx, raw), analyticsFilterOptions(ctx)]);
  } catch (e) {
    if (e instanceof NotFoundError) notFound();
    throw e;
  }
  const [w, options] = data;
  const d = w.durations;
  const query = filterQuery(w.q, w.period);
  const backlogOld = w.backlog
    .filter((b) => b.bucket !== "0-7" && b.bucket !== "8-30")
    .reduce((s, b) => s + b.count, 0);
  return (
    <>
      <PageHeader
        title="Work order performance"
        description={`${PERIOD_LABELS[w.period.preset]}: ${w.period.label}. All times are calendar time from the timestamps BiomedIntel.ai recorded.`}
        actions={can(ctx, "analytics.export") ? <ExportLink report="work-orders" query={query} /> : null}
      />
      <Card>
        <ReportFilters
          action="/reports/work-orders"
          q={w.q}
          period={w.period}
          options={options}
          fields={["period", "hospital", "department", "location", "category", "priority", "status", "assignee"]}
        />
      </Card>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat
          label="Created in period"
          value={String(w.counts.created)}
          note={`${w.counts.corrective} corrective · ${w.counts.planned} planned`}
        />
        <Stat label="Completed in period" value={String(w.counts.completed)} />
        <Stat label="Open right now" value={String(w.counts.open)} />
        <Stat label="Cancelled / reopened in period" value={`${w.counts.cancelled} / ${w.counts.reopened}`} />
      </div>
      <Card>
        <CardTitle>Time taken (jobs signed off in the period: {d.jobs})</CardTitle>
        {d.jobs === 0 ? (
          <Empty>No jobs were signed off in this period, so no times can be calculated.</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <caption className="sr-only">Work order durations</caption>
              <thead className={tableHead}>
                <tr>
                  <th className={th}>Stage</th>
                  <th className={thr}>Mean</th>
                  <th className={thr}>Median</th>
                  <th className={th}>Measured from → to</th>
                </tr>
              </thead>
              <tbody>
                <tr className={rowCls}>
                  <td className={td}>Completion time</td>
                  <td className={tdr}>{fmtHours(d.completion.avg)}</td>
                  <td className={tdr}>{fmtHours(d.completion.median)}</td>
                  <td className={`${td} text-ink-muted`}>Reported → signed off</td>
                </tr>
                <tr className={rowCls}>
                  <td className={td}>Time to assignment</td>
                  <td className={tdr}>{fmtHours(d.toAssignment.avg)}</td>
                  <td className={tdr}>{fmtHours(d.toAssignment.median)}</td>
                  <td className={`${td} text-ink-muted`}>Reported → first assigned or taken</td>
                </tr>
                <tr className={rowCls}>
                  <td className={td}>Assignment to start</td>
                  <td className={tdr}>{fmtHours(d.assignmentToStart.avg)}</td>
                  <td className={tdr}>{fmtHours(d.assignmentToStart.median)}</td>
                  <td className={`${td} text-ink-muted`}>First assigned → work started</td>
                </tr>
                <tr className={rowCls}>
                  <td className={td}>Repair / work duration</td>
                  <td className={tdr}>{fmtHours(d.repair.avg)}</td>
                  <td className={tdr}>{fmtHours(d.repair.median)}</td>
                  <td className={`${td} text-ink-muted`}>Work started → signed off (includes time on hold)</td>
                </tr>
                <tr className={rowCls}>
                  <td className={td}>Time on hold</td>
                  <td className={tdr}>{fmtHours(d.onHold.avg)}</td>
                  <td className={tdr}>—</td>
                  <td className={`${td} text-ink-muted`}>
                    Put on hold → resumed, for the {d.onHold.jobs} job{d.onHold.jobs === 1 ? "" : "s"} that were on hold
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardTitle>Completed within target</CardTitle>
          {w.target.withTarget === 0 ? (
            <Empty>No signed-off job in this period had a target date.</Empty>
          ) : (
            <>
              <p className="text-sm">
                <strong className="text-2xl">{fmtPct(w.target.rate)}</strong> — {w.target.within} of{" "}
                {w.target.withTarget} jobs signed off by their target date.
              </p>
              <BarTable
                caption="Completed within target by priority"
                head={["Priority", "Within target"]}
                max={100}
                rows={w.target.byPriority.map((t) => ({
                  key: t.priority,
                  label: PRIORITY_LABELS[t.priority as PriorityValue] ?? t.priority,
                  value: t.rate,
                  display: fmtPct(t.rate),
                  note: `${t.within} of ${t.withTarget} · default target ${PRIORITY_TARGET_HOURS[t.priority as PriorityValue] ?? "?"} h after reporting`,
                }))}
              />
            </>
          )}
        </Card>
        <Card>
          <CardTitle>Open backlog by age</CardTitle>
          {backlogOld ? <ToneTag tone="warn">{backlogOld} open jobs older than 30 days</ToneTag> : null}
          <BarTable
            caption="Open work orders by age"
            head={["Age since reported", "Open jobs"]}
            rows={w.backlog.map((b) => ({ key: b.bucket, label: BACKLOG_LABELS[b.bucket], value: b.count }))}
          />
          <p className="text-sm">
            <Link href="/work-orders?view=open&sort=createdAt&dir=asc" className={recordLink}>
              Open the oldest open jobs →
            </Link>
          </p>
        </Card>
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardTitle>By type (created)</CardTitle>
          <BarTable
            caption="Work orders created by type"
            head={["Type", "Jobs"]}
            rows={w.byType.map((x) => ({ key: x.value, label: WORK_TYPE_LABELS[x.value] ?? x.value, value: x.count }))}
          />
        </Card>
        <Card>
          <CardTitle>By current status (created)</CardTitle>
          <BarTable
            caption="Work orders created by current status"
            head={["Status", "Jobs"]}
            rows={w.byStatus.map((x) => ({
              key: x.value,
              label: WO_STATUS_LABELS[x.value as WorkOrderStatusValue] ?? x.value,
              value: x.count,
            }))}
          />
        </Card>
        <Card>
          <CardTitle>By priority (created)</CardTitle>
          <BarTable
            caption="Work orders created by priority"
            head={["Priority", "Jobs"]}
            rows={w.byPriority.map((x) => ({
              key: x.value,
              label: PRIORITY_LABELS[x.value as PriorityValue] ?? x.value,
              value: x.count,
            }))}
          />
        </Card>
      </div>
      <Card>
        <CardTitle>Repeat repairs (fault reported again within 30 days of a repair)</CardTitle>
        <p className="text-sm">
          <strong>{w.repeats.list.length}</strong> of {w.repeats.corrective} fault reports in the period (
          {fmtPct(w.repeats.rate)}).
        </p>
        {w.repeats.list.length ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <caption className="sr-only">Repeat repairs</caption>
              <thead className={tableHead}>
                <tr>
                  <th className={th}>Asset</th>
                  <th className={th}>New fault report</th>
                  <th className={th}>Previous repair</th>
                  <th className={thr}>Days after repair</th>
                </tr>
              </thead>
              <tbody>
                {w.repeats.list.map((x) => (
                  <tr key={x.new_id} className={rowCls}>
                    <td className={td}>
                      <Link href={`/assets/${x.asset_id}`} className={recordLink}>
                        {x.asset_tag}
                      </Link>
                    </td>
                    <td className={td}>
                      <Link href={`/work-orders/${x.new_id}`} className={recordLink}>
                        {x.new_number}
                      </Link>
                    </td>
                    <td className={td}>
                      <Link href={`/work-orders/${x.prev_id}`} className={recordLink}>
                        {x.prev_number}
                      </Link>
                    </td>
                    <td className={tdr}>{x.days}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </Card>
      {w.workload ? (
        <Card>
          <CardTitle>Workload by engineer (managers only)</CardTitle>
          <p className="text-ink-muted text-xs">
            For planning and balancing work. Listed alphabetically, not ranked. Job mix, equipment, parts and assignment
            decisions all affect these numbers, so they are not a measure of individual performance.
          </p>
          {w.workload.length === 0 ? (
            <Empty>No assigned work in this period.</Empty>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <caption className="sr-only">Workload by engineer</caption>
                <thead className={tableHead}>
                  <tr>
                    <th className={th}>Engineer</th>
                    <th className={thr}>Open assigned now</th>
                    <th className={thr}>Signed off in period</th>
                    <th className={thr}>Time logged in period</th>
                    <th className={thr}>Mean completion time</th>
                  </tr>
                </thead>
                <tbody>
                  {w.workload.map((x) => (
                    <tr key={x.userId} className={rowCls}>
                      <td className={td}>{x.name}</td>
                      <td className={tdr}>{x.open}</td>
                      <td className={tdr}>{x.completed}</td>
                      <td className={tdr}>{fmtHours(x.minutes / 60)}</td>
                      <td className={tdr}>{fmtHours(x.avgCompletionH)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      ) : null}
      <Card>
        <CardTitle>How these figures are calculated</CardTitle>
        <Definitions
          items={[
            [
              "Created / completed / cancelled in period",
              "Counted by the date the job was reported, signed off or cancelled, in the hospital's local calendar.",
            ],
            ["Open right now", "Reported, Assigned, In progress or On hold at this moment, whatever the period."],
            [
              "Mean and median",
              "Median is the middle value, so one very long job does not distort it. Both are shown.",
            ],
            [
              "Completed within target",
              "Signed off on or before the job's target date. Jobs without a target date are left out.",
            ],
            [
              "Repeat repair",
              "A new fault report on the same asset within 30 calendar days after a corrective job was signed off as Repaired.",
            ],
            [
              "Calendar time",
              "No working hours, shifts or public holidays are configured, so durations include nights and weekends.",
            ],
          ]}
        />
      </Card>
    </>
  );
}
