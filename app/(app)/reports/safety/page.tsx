import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAccess } from "@/server/auth/session";
import { can } from "@/server/authz/access";
import { NotFoundError } from "@/server/authz/errors";
import { analyticsFilterOptions, getSafetyReport } from "@/server/services/analytics";
import { PageHeader } from "@/components/shell/page-header";
import { Card, CardTitle } from "@/components/ui/card";
import { ReportFilters, filterQuery } from "@/components/analytics/filters";
import {
  Definitions,
  Empty,
  ExportLink,
  Pager,
  ToneTag,
  fmtDate,
  fmtDateTime,
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
import { PERIOD_LABELS, percent } from "@/lib/analytics/period";
import { DO_NOT_USE_LABEL, WORK_TYPE_LABELS } from "@/lib/validation/pm";

export const metadata: Metadata = { title: "Electrical safety" };

type HoldRow = {
  id: string;
  placedAt: Date;
  retestedAt: Date | null;
  retestedById: string | null;
  asset: { id: string; assetTag: string; name: string; hospital: { code: string } };
  failedWorkOrder: { id: string; number: string } | null;
};

function HoldTable({
  title,
  rows,
  names,
  retest,
}: {
  title: string;
  rows: HoldRow[];
  names: Record<string, string>;
  retest?: boolean;
}) {
  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-sm font-semibold">
        {title} ({rows.length})
      </h3>
      {rows.length === 0 ? (
        <Empty>None.</Empty>
      ) : (
        <div
          className="overflow-x-auto"
          tabIndex={0}
          role="region"
          aria-label="Table (scroll sideways on small screens)"
        >
          <table className="w-full text-sm">
            <caption className="sr-only">{title}</caption>
            <thead className={tableHead}>
              <tr>
                <th className={th}>Asset</th>
                <th className={th}>Hospital</th>
                <th className={th}>Failed test</th>
                <th className={th}>Hold placed</th>
                {retest ? <th className={th}>Retest passed by</th> : null}
                <th className={th}>Hold</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((h) => (
                <tr key={h.id} className={rowCls}>
                  <td className={td}>
                    <Link href={`/assets/${h.asset.id}`} className={recordLink}>
                      {h.asset.assetTag}
                    </Link>{" "}
                    · {h.asset.name}
                  </td>
                  <td className={td}>{h.asset.hospital.code}</td>
                  <td className={td}>
                    {h.failedWorkOrder ? (
                      <Link href={`/work-orders/${h.failedWorkOrder.id}`} className={recordLink}>
                        {h.failedWorkOrder.number}
                      </Link>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className={td}>{fmtDateTime(h.placedAt)}</td>
                  {retest ? (
                    <td className={td}>
                      {h.retestedById ? (names[h.retestedById] ?? "Unknown") : "—"} · {fmtDateTime(h.retestedAt)}
                    </td>
                  ) : null}
                  <td className={td}>
                    <Link href={`/maintenance/holds/${h.id}`} className={recordLink}>
                      Open hold
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default async function SafetyReportPage({ searchParams }: { searchParams: SearchParams }) {
  const ctx = await requireAccess();
  const raw = await readReportParams(searchParams);
  let data;
  try {
    data = await Promise.all([getSafetyReport(ctx, raw), analyticsFilterOptions(ctx)]);
  } catch (e) {
    if (e instanceof NotFoundError) notFound();
    throw e;
  }
  const [s, options] = data;
  const query = filterQuery(s.q, s.period);
  const onHold = s.holds.awaitingRepair.length + s.holds.awaitingRetest.length + s.holds.awaitingApproval.length;
  return (
    <>
      <PageHeader
        title="Electrical safety and return to service"
        description={`${PERIOD_LABELS[s.period.preset]}: ${s.period.label}. Test results as recorded at sign-off, with the test standard and version stored on each record.`}
        actions={
          can(ctx, "analytics.export") ? (
            <ExportLink report="safety" query={query} label="Export test history (CSV)" />
          ) : null
        }
      />
      <Card>
        <ReportFilters
          action="/reports/safety"
          q={s.q}
          period={s.period}
          options={options}
          fields={["period", "hospital", "department", "category"]}
        />
      </Card>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Card>
          <h2 className="text-ink-muted text-sm font-semibold">Tests performed</h2>
          <p className="text-3xl font-bold">{s.tests.performed}</p>
          <p className="text-ink-muted text-xs">Jobs signed off with an electrical safety Pass or Fail.</p>
        </Card>
        <Card>
          <h2 className="text-ink-muted text-sm font-semibold">Passed</h2>
          <p className="text-3xl font-bold">{s.tests.passed}</p>
          <p className="text-ink-muted text-xs">
            {fmtPct(percent(s.tests.passed, s.tests.performed))} of tests performed.
          </p>
        </Card>
        <Card>
          <h2 className="text-ink-muted text-sm font-semibold">Failed</h2>
          <p className="text-3xl font-bold">{s.tests.failed}</p>
          {s.tests.failed ? <ToneTag tone="danger">Failed safety test</ToneTag> : null}
        </Card>
        <Card>
          <h2 className="text-ink-muted text-sm font-semibold">Devices on a safety hold now</h2>
          <p className="text-3xl font-bold">{onHold}</p>
          {onHold ? <ToneTag tone="danger">{DO_NOT_USE_LABEL}</ToneTag> : null}
        </Card>
      </div>
      <Card>
        <CardTitle>Devices that failed a safety test and are not back in service</CardTitle>
        <p className="text-ink-muted text-xs">
          A failed device stays out of service until it is repaired, passes a retest, and a second authorised person —
          not the retester — approves return to service. This report only lists holds; approvals happen on each
          hold&apos;s page.
        </p>
        <HoldTable title="Awaiting repair" rows={s.holds.awaitingRepair} names={s.names} />
        <HoldTable title="Awaiting retest" rows={s.holds.awaitingRetest} names={s.names} />
        <HoldTable
          title="Retest passed — awaiting return-to-service approval"
          rows={s.holds.awaitingApproval}
          names={s.names}
          retest
        />
      </Card>
      <Card>
        <CardTitle>Returned to service in the period ({s.released.length})</CardTitle>
        {s.released.length === 0 ? (
          <Empty>No device was returned to service after a failed test in this period.</Empty>
        ) : (
          <div
            className="overflow-x-auto"
            tabIndex={0}
            role="region"
            aria-label="Table (scroll sideways on small screens)"
          >
            <table className="w-full text-sm">
              <caption className="sr-only">Devices returned to service after a failed test</caption>
              <thead className={tableHead}>
                <tr>
                  <th className={th}>Asset</th>
                  <th className={th}>Hold placed</th>
                  <th className={th}>Retest passed by</th>
                  <th className={th}>Approved by (second person)</th>
                </tr>
              </thead>
              <tbody>
                {s.released.map((x) => (
                  <tr key={x.id} className={rowCls}>
                    <td className={td}>
                      <Link href={`/maintenance/holds/${x.id}`} className={recordLink}>
                        {x.asset_tag}
                      </Link>
                    </td>
                    <td className={td}>{fmtDateTime(x.placed_at)}</td>
                    <td className={td}>
                      {s.names[x.retested_by] ?? "Unknown"} · {fmtDateTime(x.retested_at)}
                    </td>
                    <td className={td}>
                      {s.names[x.released_by] ?? "Unknown"} · {fmtDateTime(x.released_at)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <Card>
        <CardTitle>Overdue safety testing ({s.overdue.length})</CardTitle>
        {s.overdue.length ? <ToneTag tone="danger">Overdue</ToneTag> : null}
        {s.overdue.length === 0 ? (
          <Empty>No safety test or PM with electrical safety checks is overdue.</Empty>
        ) : (
          <div
            className="overflow-x-auto"
            tabIndex={0}
            role="region"
            aria-label="Table (scroll sideways on small screens)"
          >
            <table className="w-full text-sm">
              <caption className="sr-only">Overdue safety testing</caption>
              <thead className={tableHead}>
                <tr>
                  <th className={th}>Asset</th>
                  <th className={th}>Plan</th>
                  <th className={th}>Due</th>
                  <th className={th}>Work order</th>
                </tr>
              </thead>
              <tbody>
                {s.overdue.map((o) => (
                  <tr key={`${o.kind}-${o.id}`} className={rowCls}>
                    <td className={td}>
                      <Link href={`/assets/${o.asset_id}`} className={recordLink}>
                        {o.asset_tag}
                      </Link>
                    </td>
                    <td className={td}>{o.plan_name}</td>
                    <td className={td}>{fmtDate(o.due_on)}</td>
                    <td className={td}>
                      {o.wo_id ? (
                        <Link href={`/work-orders/${o.wo_id}`} className={recordLink}>
                          {o.wo_number}
                        </Link>
                      ) : (
                        "Not yet created"
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <Card>
        <CardTitle>Test history ({s.history.total})</CardTitle>
        {s.history.rows.length === 0 ? (
          <Empty>No electrical safety results were recorded in this period.</Empty>
        ) : (
          <div
            className="overflow-x-auto"
            tabIndex={0}
            role="region"
            aria-label="Table (scroll sideways on small screens)"
          >
            <table className="w-full text-sm">
              <caption className="sr-only">Electrical safety test history</caption>
              <thead className={tableHead}>
                <tr>
                  <th className={th}>Signed off</th>
                  <th className={th}>Work order</th>
                  <th className={th}>Asset</th>
                  <th className={th}>Type</th>
                  <th className={th}>Standard</th>
                  <th className={thr}>Items</th>
                  <th className={thr}>Failed items</th>
                  <th className={th}>Result</th>
                  <th className={th}>Tester</th>
                </tr>
              </thead>
              <tbody>
                {s.history.rows.map((h) => (
                  <tr key={h.id} className={rowCls}>
                    <td className={td}>{fmtDateTime(h.completed_at)}</td>
                    <td className={td}>
                      <Link href={`/work-orders/${h.id}`} className={recordLink}>
                        {h.number}
                      </Link>
                    </td>
                    <td className={td}>
                      <Link href={`/assets/${h.asset_id}`} className={recordLink}>
                        {h.asset_tag}
                      </Link>{" "}
                      · {h.model} · {h.hospital}
                    </td>
                    <td className={td}>{WORK_TYPE_LABELS[h.type] ?? h.type}</td>
                    <td className={td}>{h.standard ?? <span className="text-ink-muted">Not recorded</span>}</td>
                    <td className={tdr}>{h.measurements}</td>
                    <td className={tdr}>{h.failedItems}</td>
                    <td className={td}>
                      {h.result === "FAIL" ? <ToneTag tone="danger">Fail</ToneTag> : <ToneTag tone="ok">Pass</ToneTag>}
                    </td>
                    <td className={td}>{s.names[h.completed_by] ?? "Unknown"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <Pager
          page={s.history.page}
          pageCount={s.history.pageCount}
          href={(page) => `/reports/safety?${filterQuery(s.q, s.period, { page })}`}
        />
      </Card>
      <Card>
        <CardTitle>How these figures are calculated</CardTitle>
        <Definitions
          items={[
            [
              "Test performed",
              "A job signed off in the period whose electrical safety result was recorded as Pass or Fail. Not applicable is not counted.",
            ],
            [
              "Standard",
              "The test standard and version stored on the work order when it was signed off (IEC 62353 by default; AS/NZS 3551 where configured). Older jobs may show Not recorded.",
            ],
            ["Items / failed items", "Electrical safety checklist results recorded on the latest attempt of that job."],
            [
              "Overdue safety testing",
              "Safety test plans, or PM plans containing electrical safety checks, whose due date has passed without sign-off.",
            ],
            [
              "Return to service",
              "Only after repair, a passed retest and approval by a second authorised person. The software never returns a failed device to service automatically.",
            ],
          ]}
        />
      </Card>
    </>
  );
}
