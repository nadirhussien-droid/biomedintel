import type { Metadata } from "next";
import Link from "next/link";
import { requireAccess } from "@/server/auth/session";
import { getFoundationSummary } from "@/server/services/dashboard";
import { ROLE_LABELS } from "@/server/authz/roles";
import { Badge, Card, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/shell/page-header";

export const metadata: Metadata = { title: "Dashboard" };

// Fictional figures that preview the equipment modules (Stages 4–7).
// They are NOT read from the database and are labelled as such on screen.
const DEMO_KPIS = [
  { label: "Equipment assets", value: "2,347", note: "2,196 in service · 98 under repair · 53 out of service" },
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
  const summary = await getFoundationSummary(ctx);
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

      <section aria-labelledby="demo-heading" className="flex flex-col gap-4">
        <div className="bg-warn-bg flex flex-wrap items-center gap-3 rounded-md border border-[#e8c98c] px-4 py-3 text-sm text-[#6b3f00]">
          <Badge tone="demo">Fictional demonstration data</Badge>
          <span id="demo-heading">
            The equipment figures below are invented examples to preview later stages. They are not your hospital&apos;s
            data.
          </span>
        </div>
        <div className="grid gap-6 sm:grid-cols-2 xl:grid-cols-4">
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
          Stage 4 adds the{" "}
          <Link href="/assets" className="font-semibold text-teal-700 hover:underline">
            Equipment Asset Register and QR codes
          </Link>
          . Work orders, maintenance, testing, inventory, IntellKnowledge, IntellAssist and reports follow in later
          stages.
        </p>
      </Card>
    </>
  );
}
