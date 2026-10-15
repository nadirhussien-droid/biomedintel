import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAccess } from "@/server/auth/session";
import { can } from "@/server/authz/access";
import { NotFoundError } from "@/server/authz/errors";
import { analyticsFilterOptions, getReliabilityReport } from "@/server/services/analytics";
import { PageHeader } from "@/components/shell/page-header";
import { Card, CardTitle } from "@/components/ui/card";
import { ReportFilters, filterQuery } from "@/components/analytics/filters";
import {
  BarTable,
  Definitions,
  Empty,
  ExportLink,
  ToneTag,
  fmtDate,
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

export const metadata: Metadata = { title: "Equipment reliability" };

const monthLabel = (m: string) =>
  new Intl.DateTimeFormat("en-GB", { month: "short", year: "numeric", timeZone: "UTC" }).format(
    new Date(`${m}-01T00:00:00Z`),
  );

export default async function ReliabilityPage({ searchParams }: { searchParams: SearchParams }) {
  const ctx = await requireAccess();
  const raw = await readReportParams(searchParams);
  let data;
  try {
    data = await Promise.all([getReliabilityReport(ctx, raw), analyticsFilterOptions(ctx)]);
  } catch (e) {
    if (e instanceof NotFoundError) notFound();
    throw e;
  }
  const [r, options] = data;
  const groupName = r.by === "model" ? "Model" : "Equipment category";
  const query = filterQuery(r.q, r.period, { by: r.by });
  return (
    <>
      <PageHeader
        title="Equipment reliability and failures"
        description={`${PERIOD_LABELS[r.period.preset]}: ${r.period.label}. Based on fault reports (corrective work orders) and recorded downtime.`}
        actions={can(ctx, "analytics.export") ? <ExportLink report="reliability" query={query} /> : null}
      />
      <Card>
        <ReportFilters
          action="/reports/reliability"
          q={r.q}
          period={r.period}
          options={options}
          fields={["period", "hospital", "department", "location", "category", "priority"]}
          by={{ value: r.by, choices: { category: "Equipment category", model: "Model" } }}
        />
      </Card>
      <Card className="border-info bg-info-bg/40">
        <CardTitle>Why MTBF and MTTR are not shown</CardTitle>
        <p className="text-sm">
          Mean time between failures needs each device&apos;s <strong>operating hours</strong>, and BiomedIntel.ai does
          not record them. Instead this page shows clearly labelled measures from data that is recorded: fault reports
          per asset, mean <strong>calendar</strong> days between fault reports (a proxy, not MTBF), mean downtime per
          event, and mean repair duration from work start to sign-off.
        </p>
      </Card>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Card>
          <h2 className="text-ink-muted text-sm font-semibold">Fault reports</h2>
          <p className="text-3xl font-bold">{r.failures.reduce((s, f) => s + f.reports, 0)}</p>
          <p className="text-ink-muted text-xs">Corrective jobs reported in the period (not cancelled).</p>
        </Card>
        <Card>
          <h2 className="text-ink-muted text-sm font-semibold">Mean downtime per event</h2>
          <p className="text-3xl font-bold">{fmtHours(r.durations.downtimePerEventH)}</p>
          <p className="text-ink-muted text-xs">
            {r.durations.downtimeEvents} downtime periods that ended in the period.
          </p>
        </Card>
        <Card>
          <h2 className="text-ink-muted text-sm font-semibold">Mean repair duration</h2>
          <p className="text-3xl font-bold">{fmtHours(r.durations.repairDurationH)}</p>
          <p className="text-ink-muted text-xs">
            Work started → signed off as Repaired ({r.durations.repairs} repairs). Includes any time on hold.
          </p>
        </Card>
        <Card>
          <h2 className="text-ink-muted text-sm font-semibold">Out of service for more than 7 days</h2>
          <p className="text-3xl font-bold">{r.prolonged.length}</p>
          {r.prolonged.length ? <ToneTag tone="warn">Prolonged downtime</ToneTag> : null}
        </Card>
      </div>
      <Card>
        <CardTitle>Fault reports by {groupName.toLowerCase()}</CardTitle>
        {r.failures.length === 0 ? (
          <Empty>No fault reports in this period.</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <caption className="sr-only">Fault reports by {groupName}</caption>
              <thead className={tableHead}>
                <tr>
                  <th className={th}>{groupName}</th>
                  <th className={thr}>Fault reports</th>
                  <th className={thr}>Assets affected</th>
                  <th className={thr}>Assets in register</th>
                  <th className={thr}>Reports per asset</th>
                  <th className={thr}>Repaired</th>
                  <th className={thr}>No fault found</th>
                </tr>
              </thead>
              <tbody>
                {r.failures.map((f) => (
                  <tr key={f.key} className={rowCls}>
                    <td className={td}>{f.label}</td>
                    <td className={tdr}>{f.reports}</td>
                    <td className={tdr}>{f.assetsAffected}</td>
                    <td className={tdr}>{f.assetsInRegister}</td>
                    <td className={tdr}>{f.reportsPerAsset ?? "N/A"}</td>
                    <td className={tdr}>{f.repaired}</td>
                    <td className={tdr}>{f.noFaultFound}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="text-ink-muted text-xs">
          Reports per asset = fault reports ÷ assets of that {groupName.toLowerCase()} currently in the register (within
          your filters). Small groups give unstable rates — compare with care.
        </p>
      </Card>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardTitle>Fault categories (repairs signed off in the period)</CardTitle>
          {r.faultCategories.total === 0 ? (
            <Empty>No faults were signed off in this period.</Empty>
          ) : (
            <>
              <p className="text-ink-muted text-xs">
                {fmtPct(r.faultCategories.classifiedShare)} of {r.faultCategories.total} signed-off faults have a
                category. The category is chosen by the engineer at sign-off; older jobs show as Not classified.
              </p>
              <BarTable
                caption="Faults by category"
                head={["Fault category", "Faults"]}
                rows={r.faultCategories.rows.map((c) => ({
                  key: c.category ?? "none",
                  label: c.label,
                  value: c.count,
                }))}
              />
            </>
          )}
        </Card>
        <Card>
          <CardTitle>Fault reports by month</CardTitle>
          <BarTable
            caption="Fault reports by month"
            head={["Month reported", "Fault reports"]}
            rows={r.monthly.map((m) => ({ key: m.month, label: monthLabel(m.month), value: m.count }))}
          />
        </Card>
      </div>
      <Card>
        <CardTitle>Equipment with repeat faults (2 or more reports in the period)</CardTitle>
        {r.repeatAssets.length === 0 ? (
          <Empty>No asset had more than one fault report in this period.</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <caption className="sr-only">Equipment with repeat faults</caption>
              <thead className={tableHead}>
                <tr>
                  <th className={th}>Asset</th>
                  <th className={thr}>Fault reports</th>
                  <th className={thr}>Mean calendar days between reports (proxy, not MTBF)</th>
                </tr>
              </thead>
              <tbody>
                {r.repeatAssets.map((a) => (
                  <tr key={a.asset_id} className={rowCls}>
                    <td className={td}>
                      <Link href={`/assets/${a.asset_id}`} className={recordLink}>
                        {a.asset_tag}
                      </Link>{" "}
                      · {a.name}
                    </td>
                    <td className={tdr}>{a.reports}</td>
                    <td className={tdr}>{a.meanGapDays ?? "N/A"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardTitle>Downtime in the period by {groupName.toLowerCase()}</CardTitle>
          <BarTable
            caption="Downtime hours by group"
            head={[groupName, "Downtime"]}
            rows={r.downtime.map((x) => ({
              key: x.key,
              label: x.label,
              value: x.hours,
              display: fmtHours(x.hours),
              note: `${x.events} period${x.events === 1 ? "" : "s"}${x.ongoing ? ` · ${x.ongoing} still ongoing (counted up to now)` : ""}`,
            }))}
          />
        </Card>
        <Card>
          <CardTitle>Highest maintenance workload (assets)</CardTitle>
          {r.highWorkload.length === 0 ? (
            <Empty>No asset had two or more jobs in this period.</Empty>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <caption className="sr-only">Assets with the most maintenance work</caption>
                <thead className={tableHead}>
                  <tr>
                    <th className={th}>Asset</th>
                    <th className={thr}>Jobs</th>
                    <th className={thr}>Corrective</th>
                    <th className={thr}>Time logged</th>
                  </tr>
                </thead>
                <tbody>
                  {r.highWorkload.map((a) => (
                    <tr key={a.asset_id} className={rowCls}>
                      <td className={td}>
                        <Link href={`/assets/${a.asset_id}`} className={recordLink}>
                          {a.asset_tag}
                        </Link>{" "}
                        · {a.name}
                      </td>
                      <td className={tdr}>{a.jobs}</td>
                      <td className={tdr}>{a.corrective}</td>
                      <td className={tdr}>{fmtHours(a.minutes / 60)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>
      {r.prolonged.length ? (
        <Card>
          <CardTitle>Out of service for more than 7 days (right now)</CardTitle>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <caption className="sr-only">Prolonged downtime</caption>
              <thead className={tableHead}>
                <tr>
                  <th className={th}>Asset</th>
                  <th className={th}>Hospital</th>
                  <th className={th}>Down since</th>
                  <th className={thr}>Days</th>
                </tr>
              </thead>
              <tbody>
                {r.prolonged.map((a) => (
                  <tr key={a.asset_id} className={rowCls}>
                    <td className={td}>
                      <Link href={`/assets/${a.asset_id}`} className={recordLink}>
                        {a.asset_tag}
                      </Link>{" "}
                      · {a.name}
                    </td>
                    <td className={td}>{a.hospital}</td>
                    <td className={td}>{fmtDate(a.since)}</td>
                    <td className={tdr}>{a.days}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      ) : null}
      <Card>
        <CardTitle>How these figures are calculated</CardTitle>
        <Definitions
          items={[
            ["Fault report", "A corrective work order reported in the period that was not cancelled."],
            [
              "No fault found",
              "Signed off with the outcome No fault found. Still counted as a report, not as a failure category.",
            ],
            [
              "Mean days between reports",
              "Calendar days between consecutive fault reports on the same asset, inside the period. A proxy only: it ignores how many hours the device was used, so it is NOT mean time between failures.",
            ],
            [
              "Downtime",
              "Recorded out-of-service periods overlapping the chosen period, clipped to it. A period still open counts up to now.",
            ],
            ["Mean downtime per event", "Mean length of downtime periods that ended in the period."],
            [
              "Mean repair duration",
              "Work started → signed off as Repaired, calendar time. Not MTTR, because it includes waiting and time on hold.",
            ],
          ]}
        />
      </Card>
    </>
  );
}
