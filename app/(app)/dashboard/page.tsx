import type { Metadata } from "next";
import Link from "next/link";
import { requireAccess } from "@/server/auth/session";
import { getFoundationSummary } from "@/server/services/dashboard";
import { getAssetStatusCounts } from "@/server/services/assets";
import { ROLE_LABELS } from "@/server/authz/roles";
import { Badge, Card, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/shell/page-header";

export const metadata: Metadata = { title: "Dashboard" };

// Fictional figures that preview the maintenance modules (Stages 5–7).
// They are NOT read from the database and are labelled as such on screen.
const DEMO_KPIS = [
  { label: "PM completion · October", value: "90%", note: "371 of 412 done · 29 overdue" },
  { label: "Safety tests due (30 days)", value: "186", note: "4 failed tests need action" },
  { label: "Open work orders", value: "64", note: "11 overdue · 142 completed this month" },
];

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
  const [summary, assets] = await Promise.all([
    getFoundationSummary(ctx),
    getAssetStatusCounts(ctx, ctx.selection.hospitalId),
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

      <section aria-labelledby="demo-heading" className="flex flex-col gap-4">
        <div className="bg-warn-bg flex flex-wrap items-center gap-3 rounded-md border border-[#e8c98c] px-4 py-3 text-sm text-[#6b3f00]">
          <Badge tone="demo">Fictional demonstration data</Badge>
          <span id="demo-heading">
            The maintenance figures below are invented examples to preview later stages. They are not your
            hospital&apos;s data.
          </span>
        </div>
        <div className="grid gap-6 sm:grid-cols-2 xl:grid-cols-3">
          {DEMO_KPIS.map((k) => (
            <Card key={k.label}>
              <div className="flex items-start justify-between gap-2">
                <Stat label={k.label} value={k.value} note={k.note} />
                <Badge tone="warn">Demo</Badge>
              </div>
            </Card>
          ))}
        </div>
      </section>

      <Card>
        <CardTitle>Coming next</CardTitle>
        <p className="text-ink-muted text-sm">
          Stage 5 adds Work Order Management: fault reports from a scanned asset, assignment, repair records and
          sign-off. Maintenance, testing, inventory, IntellKnowledge, IntellAssist and reports follow in later stages.
        </p>
      </Card>
    </>
  );
}
