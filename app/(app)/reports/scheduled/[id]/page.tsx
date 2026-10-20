import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAccess } from "@/server/auth/session";
import { NotFoundError } from "@/server/authz/errors";
import { getReportSnapshot } from "@/server/services/report-schedules";
import { PageHeader } from "@/components/shell/page-header";
import { Card, CardTitle } from "@/components/ui/card";
import {
  BarTable,
  Empty,
  MetricTile,
  fmtDate,
  fmtDateTime,
  fmtHours,
  fmtPct,
  rowCls,
  tableHead,
  td,
  tdr,
  th,
  thr,
  type Tone,
} from "@/components/analytics/ui";
import { REPORT_KIND_LABELS } from "@/lib/validation/analytics";

export const metadata: Metadata = { title: "Generated report" };

type Bucket = {
  key: string;
  label: string;
  due: number;
  onTime: number;
  late: number;
  open: number;
  missed: number;
  cancelled: number;
  failed: number;
  compliance: number | null;
  completion: number | null;
};
type Data = Record<string, unknown>;

function Row({ label, value }: { label: string; value: string | number }) {
  return (
    <tr className={rowCls}>
      <td className={td}>{label}</td>
      <td className={tdr}>{value}</td>
    </tr>
  );
}

function SimpleTable({ caption, children }: { caption: string; children: React.ReactNode }) {
  return (
    <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Table (scroll sideways on small screens)">
      <table className="w-full text-sm">
        <caption className="sr-only">{caption}</caption>
        <thead className={tableHead}>
          <tr>
            <th className={th}>Measure</th>
            <th className={thr}>Value</th>
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

function Body({ kind, d }: { kind: string; d: Data }) {
  if (kind === "OVERVIEW") {
    const metrics = (d.metrics ?? []) as {
      key: string;
      label: string;
      display: string;
      definition: string;
      basis: "now" | "period";
      tone?: Tone;
    }[];
    return (
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {metrics.map((m) => (
          <MetricTile
            key={m.key}
            label={m.label}
            display={m.display}
            definition={m.definition}
            basis={m.basis}
            tone={m.tone}
          />
        ))}
      </div>
    );
  }
  if (kind === "PM_COMPLIANCE") {
    const total = d.total as Bucket;
    const groups = (d.groups ?? []) as Bucket[];
    return (
      <Card>
        <CardTitle>PM compliance by department</CardTitle>
        {total.due === 0 ? (
          <Empty>No planned maintenance was due in this period (compliance N/A).</Empty>
        ) : (
          <div
            className="overflow-x-auto"
            tabIndex={0}
            role="region"
            aria-label="Table (scroll sideways on small screens)"
          >
            <table className="w-full text-sm">
              <caption className="sr-only">PM compliance by department</caption>
              <thead className={tableHead}>
                <tr>
                  <th className={th}>Department</th>
                  <th className={thr}>Due</th>
                  <th className={thr}>On time</th>
                  <th className={thr}>Late</th>
                  <th className={thr}>Open</th>
                  <th className={thr}>Missed</th>
                  <th className={thr}>Cancelled</th>
                  <th className={thr}>Compliance</th>
                  <th className={thr}>Completion</th>
                </tr>
              </thead>
              <tbody>
                {[total, ...groups].map((g, i) => (
                  <tr key={`${i}-${g.key}`} className={`${rowCls} ${i === 0 ? "font-semibold" : ""}`}>
                    <td className={td}>{g.label}</td>
                    <td className={tdr}>{g.due}</td>
                    <td className={tdr}>{g.onTime}</td>
                    <td className={tdr}>{g.late}</td>
                    <td className={tdr}>{g.open}</td>
                    <td className={tdr}>{g.missed}</td>
                    <td className={tdr}>{g.cancelled}</td>
                    <td className={tdr}>{fmtPct(g.compliance)}</td>
                    <td className={tdr}>{fmtPct(g.completion)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    );
  }
  if (kind === "WORK_ORDERS") {
    const c = d.counts as Record<string, number>;
    const du = d.durations as {
      jobs: number;
      completion: { avg: number | null; median: number | null };
      repair: { avg: number | null };
    };
    const t = d.target as { rate: number | null; within: number; withTarget: number };
    const backlog = (d.backlog ?? []) as { bucket: string; count: number }[];
    const rep = d.repeats as { count: number; rate: number | null };
    return (
      <Card>
        <CardTitle>Work order performance</CardTitle>
        <SimpleTable caption="Work order performance">
          <Row label="Created in period" value={c.created} />
          <Row label="Completed in period" value={c.completed} />
          <Row label="Open at generation" value={c.open} />
          <Row label="Cancelled / reopened" value={`${c.cancelled} / ${c.reopened}`} />
          <Row
            label="Completion time (mean / median)"
            value={`${fmtHours(du.completion.avg)} / ${fmtHours(du.completion.median)}`}
          />
          <Row label="Repair duration, start to sign-off (mean)" value={fmtHours(du.repair.avg)} />
          <Row
            label="Completed within target"
            value={t.withTarget ? `${fmtPct(t.rate)} (${t.within} of ${t.withTarget})` : "N/A"}
          />
          <Row label="Repeat repairs within 30 days" value={`${rep.count} (${fmtPct(rep.rate)})`} />
          {backlog.map((b) => (
            <Row key={b.bucket} label={`Open backlog aged ${b.bucket} days`} value={b.count} />
          ))}
        </SimpleTable>
      </Card>
    );
  }
  if (kind === "RELIABILITY") {
    const failures = (d.failures ?? []) as {
      key: string;
      label: string;
      reports: number;
      reportsPerAsset: number | null;
    }[];
    const du = d.durations as { downtimePerEventH: number | null; repairDurationH: number | null };
    return (
      <Card>
        <CardTitle>Fault reports by equipment category</CardTitle>
        <BarTable
          caption="Fault reports by category"
          head={["Category", "Fault reports"]}
          rows={failures.map((f) => ({
            key: f.key,
            label: f.label,
            value: f.reports,
            note: f.reportsPerAsset === null ? undefined : `${f.reportsPerAsset} per asset`,
          }))}
        />
        <SimpleTable caption="Durations">
          <Row label="Mean downtime per event" value={fmtHours(du.downtimePerEventH)} />
          <Row label="Mean repair duration (not MTTR)" value={fmtHours(du.repairDurationH)} />
        </SimpleTable>
        <p className="text-ink-muted text-xs">MTBF is not calculated: operating hours are not recorded.</p>
      </Card>
    );
  }
  const tests = d.tests as { performed: number; passed: number; failed: number };
  const holds = d.holds as { awaitingRepair: number; awaitingRetest: number; awaitingApproval: number };
  return (
    <Card>
      <CardTitle>Electrical safety</CardTitle>
      <SimpleTable caption="Electrical safety">
        <Row label="Tests performed" value={tests.performed} />
        <Row label="Passed" value={tests.passed} />
        <Row label="Failed" value={tests.failed} />
        <Row label="On hold — awaiting repair (at generation)" value={holds.awaitingRepair} />
        <Row label="On hold — awaiting retest (at generation)" value={holds.awaitingRetest} />
        <Row label="On hold — awaiting return-to-service approval (at generation)" value={holds.awaitingApproval} />
        <Row label="Returned to service in period" value={String(d.released ?? 0)} />
        <Row label="Overdue safety testing (at generation)" value={String(d.overdue ?? 0)} />
      </SimpleTable>
    </Card>
  );
}

export default async function SnapshotPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireAccess();
  const { id } = await params;
  let snap;
  try {
    snap = await getReportSnapshot(ctx, id);
  } catch (e) {
    if (e instanceof NotFoundError) notFound();
    throw e;
  }
  const d = (snap.data ?? {}) as Data;
  return (
    <>
      <PageHeader
        title={snap.schedule?.name ?? REPORT_KIND_LABELS[snap.kind] ?? "Report"}
        description={`${REPORT_KIND_LABELS[snap.kind] ?? snap.kind} · ${snap.hospital ? `${snap.hospital.code} · ${snap.hospital.name}` : "Whole organisation"} · ${fmtDate(snap.periodFrom)} – ${fmtDate(snap.periodTo)}`}
      />
      <Card>
        <p className="text-sm">
          Generated {fmtDateTime(snap.generatedAt)}. This is a read-only snapshot: the figures are as they were when it
          was generated and will not change. Figures marked &quot;right now&quot; describe that moment.
        </p>
        <p className="text-ink-muted text-xs">
          Durations are calendar time. These operational figures do not certify regulatory compliance.{" "}
          <Link href="/reports/scheduled" className="font-semibold text-teal-700 hover:underline">
            All scheduled reports
          </Link>
        </p>
      </Card>
      <Body kind={snap.kind} d={d} />
    </>
  );
}
