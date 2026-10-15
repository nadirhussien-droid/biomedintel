import type { Metadata } from "next";
import Link from "next/link";
import { requireAccess } from "@/server/auth/session";
import { getFoundationSummary } from "@/server/services/dashboard";
import { getAssetStatusCounts } from "@/server/services/assets";
import { getWorkOrderCounts } from "@/server/services/work-orders";
import { getDashboardPmKpis } from "@/server/services/pm-schedule";
import { formatDateOnly } from "@/lib/pm/dates";
import { ROLE_LABELS } from "@/server/authz/roles";
import { Badge, Card, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/shell/page-header";

export const metadata: Metadata = { title: "Dashboard" };

function Stat({ label, value, note }: { label: string; value: string | number; note?: string }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-ink-muted text-xs font-semibold tracking-wide uppercase">{label}</span>
      <span className="text-[28px] leading-8 font-bold tracking-tight">{value}</span>
      {note ? <span className="text-ink-muted text-xs">{note}</span> : null}
    </div>
  );
}

export default async function DashboardPage() {
  const ctx = await requireAccess();
  const [summary, assets, jobs, pm] = await Promise.all([
    getFoundationSummary(ctx),
    getAssetStatusCounts(ctx, ctx.selection.hospitalId),
    getWorkOrderCounts(ctx, ctx.selection.hospitalId),
    getDashboardPmKpis(ctx, { hospitalId: ctx.selection.hospitalId }),
  ]);
  const selectedHospital = ctx.hospitals.find((h) => h.id === ctx.selection.hospitalId);

  return (
    <>
      <PageHeader
        title="Engineering dashboard"
        description={`${selectedHospital ? selectedHospital.name : "All your hospitals"} · signed in as ${ROLE_LABELS[ctx.role]}`}
      />

      <Card>
        <CardTitle action={<Badge tone="ok">Live data</Badge>}>Your organisation</CardTitle>
        <div className="grid grid-cols-2 gap-6 md:grid-cols-4">
          <Stat label="Hospitals you can access" value={summary.hospitals} />
          <Stat label="Departments you can access" value={summary.departments} />
          {summary.members !== null ? <Stat label="Active members" value={summary.members} /> : null}
          {summary.auditEvents !== null ? (
            <Stat
              label="Audit events (7 days)"
              value={summary.auditEvents}
              note={`${summary.deniedEvents ?? 0} denied attempts`}
            />
          ) : null}
        </div>
        <ul className="flex flex-wrap gap-2" aria-label="Your hospitals">
          {ctx.hospitals.map((h) => (
            <li key={h.id} className="border-line rounded-sm border px-2.5 py-1 text-sm">
              {h.name}{" "}
              <span className="text-ink-muted">
                ·{" "}
                {h.departments === "ALL"
                  ? "all departments"
                  : `${h.departments.length} department${h.departments.length === 1 ? "" : "s"}`}
              </span>
            </li>
          ))}
        </ul>
      </Card>

      {jobs ? (
        <Card>
          <CardTitle
            action={
              <span className="flex items-center gap-3">
                <Badge tone="ok">Live data</Badge>
                <Link href="/work-orders" className="text-sm font-semibold text-teal-700 hover:underline">
                  Open work orders
                </Link>
              </span>
            }
          >
            Work orders
          </CardTitle>
          <div className="grid grid-cols-2 gap-6 md:grid-cols-3 xl:grid-cols-6">
            <Stat label="Open jobs" value={jobs.open} note={`${jobs.mine} assigned to you`} />
            <Stat label="Overdue" value={jobs.overdue} />
            <Stat label="Waiting for a technician" value={jobs.triage} />
            <Stat label="Safety-critical open" value={jobs.safety} />
            <Stat label="Safety-critical to review" value={jobs.review} />
            <Stat label="Completed this month" value={jobs.completedThisMonth} />
          </div>
        </Card>
      ) : null}

      {assets ? (
        <Card>
          <CardTitle
            action={
              <span className="flex items-center gap-3">
                <Badge tone="ok">Live data</Badge>
                <Link href="/assets" className="text-sm font-semibold text-teal-700 hover:underline">
                  Open register
                </Link>
              </span>
            }
          >
            Equipment
          </CardTitle>
          <div className="grid grid-cols-2 gap-6 md:grid-cols-5">
            <Stat label="Registered assets" value={assets.total} note={`${assets.highRisk} high risk`} />
            <Stat label="In service" value={assets.IN_SERVICE} />
            <Stat label="Under repair" value={assets.UNDER_REPAIR} />
            <Stat label="Out of service" value={assets.OUT_OF_SERVICE} />
            <Stat label="Decommissioned" value={assets.DECOMMISSIONED} />
          </div>
        </Card>
      ) : null}

      {pm ? (
        <Card>
          <CardTitle
            action={
              <span className="flex items-center gap-3">
                <Badge tone="ok">Live data</Badge>
                <Link href="/maintenance" className="text-sm font-semibold text-teal-700 hover:underline">
                  Open maintenance
                </Link>
              </span>
            }
          >
            Preventive maintenance
          </CardTitle>
          <div className="grid grid-cols-2 gap-6 md:grid-cols-5">
            <Stat
              label={`PM compliance · ${formatDateOnly(pm.period.from)} to today`}
              value={pm.compliance === null ? "—" : `${pm.compliance}%`}
              note={pm.due ? `${pm.onTime} of ${pm.due} due done on time` : "Nothing due yet this month"}
            />
            <Stat label="PM overdue" value={pm.overdue} note={`${pm.dueToday} due today`} />
            <Stat
              label="Safety tests due (30 days)"
              value={pm.safetyTestsDue30}
              note="Electrical safety items, incl. overdue"
            />
            <Stat label="Failed Safety Test holds" value={pm.openHolds} note="Do Not Use until approved" />
            <Stat label="Generation failures" value={pm.failedGeneration} note="Work orders not yet created" />
          </div>
          <p className="text-ink-muted text-xs">
            Compliance = maintenance due this month (up to today) and signed off by its due date plus grace days,
            divided by all maintenance due. A generated work order does not count as done.
          </p>
        </Card>
      ) : null}
    </>
  );
}
