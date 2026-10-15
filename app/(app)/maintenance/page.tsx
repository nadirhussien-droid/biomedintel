import type { Metadata } from "next";
import Link from "next/link";
import { requireAccess } from "@/server/auth/session";
import { can } from "@/server/authz/access";
import { getPmOverview } from "@/server/services/pm-schedule";
import { listGenerationRuns } from "@/server/services/pm-generation";
import { PageHeader } from "@/components/shell/page-header";
import { Badge, Card, CardTitle } from "@/components/ui/card";
import { formatDateOnly } from "@/lib/pm/dates";
import { RunGenerationForm } from "./forms";

export const metadata: Metadata = { title: "Preventive Maintenance" };

const dateTime = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" });

function Kpi({
  label,
  value,
  href,
  tone,
  note,
}: {
  label: string;
  value: string | number;
  href?: string;
  tone?: "danger" | "warn" | "ok";
  note?: string;
}) {
  const color =
    tone === "danger" ? "text-danger" : tone === "warn" ? "text-warn" : tone === "ok" ? "text-ok" : "text-ink";
  const body = (
    <>
      <div className="text-ink-muted text-xs font-semibold tracking-wide uppercase">{label}</div>
      <div className={`mt-1 text-3xl font-bold ${color}`}>{value}</div>
      {note ? <div className="text-ink-muted mt-1 text-xs">{note}</div> : null}
    </>
  );
  return href ? (
    <Link href={href} className="border-line rounded-md border bg-white p-4 hover:border-teal-400">
      {body}
    </Link>
  ) : (
    <div className="border-line rounded-md border bg-white p-4">{body}</div>
  );
}

export default async function MaintenanceOverview() {
  const ctx = await requireAccess();
  const [o, runs] = await Promise.all([getPmOverview(ctx), listGenerationRuns(ctx, 8)]);
  const month = `${formatDateOnly(o.period.from)} – ${formatDateOnly(o.period.to)}`;
  return (
    <>
      <PageHeader
        title="Preventive Maintenance"
        description="Planned maintenance, inspections and electrical safety tests for your hospitals. Dates are each hospital's own calendar date."
        actions={
          <div className="flex flex-wrap gap-2">
            <Link
              href="/assets/scan?then=pm"
              className="border-line-strong text-navy-900 inline-flex min-h-11 items-center rounded-md border bg-white px-4 text-sm font-semibold"
            >
              Scan barcode
            </Link>
            {can(ctx, "pm.manage") ? (
              <Link
                href="/maintenance/plans/new"
                className="text-navy-900 inline-flex min-h-11 items-center rounded-md border border-teal-400 bg-teal-400 px-4 text-sm font-semibold hover:bg-teal-500"
              >
                New maintenance plan
              </Link>
            ) : null}
          </div>
        }
      />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Kpi
          label="Overdue"
          value={o.overdue}
          tone={o.overdue ? "danger" : undefined}
          href="/maintenance/schedule?view=overdue"
        />
        <Kpi
          label="Due today"
          value={o.dueToday}
          tone={o.dueToday ? "warn" : undefined}
          href="/maintenance/schedule?view=today"
        />
        <Kpi label="Upcoming (30 days)" value={o.upcoming30} href="/maintenance/schedule?view=upcoming&within=30" />
        <Kpi
          label="Safety tests due (30 days)"
          value={o.safetyTestsDue30}
          href="/maintenance/schedule?view=upcoming&within=30"
          note="Including overdue"
        />
        <Kpi label="Active plans" value={o.activePlans} href="/maintenance/plans" />
        <Kpi
          label="Compliance this month"
          value={o.month.compliance === null ? "—" : `${o.month.compliance}%`}
          tone={
            o.month.compliance === null
              ? undefined
              : o.month.compliance >= 90
                ? "ok"
                : o.month.compliance >= 70
                  ? "warn"
                  : "danger"
          }
          note={`${o.month.onTime} on time of ${o.month.due} due · ${month}`}
          href={can(ctx, "pm.report") ? "/maintenance/reports" : undefined}
        />
        <Kpi label="PM work orders generated" value={o.generatedInPeriod} note={month} />
        <Kpi label="PM completed" value={o.completedInPeriod} note={month} />
        <Kpi
          label="Generation failed"
          value={o.failedGeneration}
          tone={o.failedGeneration ? "danger" : undefined}
          href="/maintenance/review"
        />
        <Kpi
          label="Failed Safety Test holds"
          value={o.openHolds}
          tone={o.openHolds ? "danger" : undefined}
          href="/maintenance/holds"
        />
      </div>
      <p className="text-ink-muted text-xs">
        Compliance = PM due this month (up to today) and signed off by its due date plus grace days, divided by all PM
        due in that time. A generated work order is never counted as done. See Reports for every definition.
      </p>

      <Card>
        <CardTitle>Automatic work orders</CardTitle>
        <p className="text-sm">
          Work orders are created automatically when a due date comes within the plan&apos;s lead time, once a day by
          the scheduler (see the setup guide). Running it again is always safe: each due date can only ever have one
          work order.
        </p>
        {can(ctx, "pm.generate") ? <RunGenerationForm /> : null}
        {runs.length ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <caption className="sr-only">Recent generation runs</caption>
              <thead className="text-ink-muted text-left text-xs uppercase">
                <tr>
                  <th className="py-2 pr-3">Started (UTC)</th>
                  <th className="py-2 pr-3">How</th>
                  <th className="py-2 pr-3">Created</th>
                  <th className="py-2 pr-3">Missed</th>
                  <th className="py-2 pr-3">Failed</th>
                  <th className="py-2 pr-3">Reminders</th>
                </tr>
              </thead>
              <tbody>
                {runs.map((r) => (
                  <tr key={r.id} className="border-line border-t">
                    <td className="py-2 pr-3">{dateTime.format(r.startedAt)}</td>
                    <td className="py-2 pr-3">{r.trigger === "MANUAL" ? "Run now" : "Scheduler"}</td>
                    <td className="py-2 pr-3">{r.created}</td>
                    <td className="py-2 pr-3">{r.missed}</td>
                    <td className="py-2 pr-3">{r.failed ? <Badge tone="danger">{r.failed}</Badge> : 0}</td>
                    <td className="py-2 pr-3">{r.remindersSent}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-ink-muted text-sm">No generation has run yet.</p>
        )}
      </Card>
    </>
  );
}
