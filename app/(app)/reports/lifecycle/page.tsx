import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAccess } from "@/server/auth/session";
import { can } from "@/server/authz/access";
import { NotFoundError } from "@/server/authz/errors";
import { analyticsFilterOptions, getLifecycleReport } from "@/server/services/analytics";
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
  recordLink,
  rowCls,
  tableHead,
  td,
  tdr,
  th,
  thr,
} from "@/components/analytics/ui";
import { readReportParams, type SearchParams } from "@/lib/analytics/params";
import { percent } from "@/lib/analytics/period";

export const metadata: Metadata = { title: "Lifecycle and cost" };

const AGE: Record<string, string> = {
  "0-2": "Under 2 years",
  "2-5": "2 to 5 years",
  "5-8": "5 to 8 years",
  "8-10": "8 to 10 years",
  "10+": "10 years or more",
  unknown: "Unknown (no purchase or commissioning date)",
};
const WARRANTY: Record<string, string> = {
  active: "Under warranty",
  expiring: "Warranty ends within 90 days",
  expired: "Warranty expired",
  none: "No warranty recorded",
};

const money = (amount: string, currency: string) => {
  const v = Number(amount);
  if (!Number.isFinite(v)) return amount;
  try {
    return new Intl.NumberFormat("en-GB", { style: "currency", currency, maximumFractionDigits: 0 }).format(v);
  } catch {
    return `${currency} ${v.toLocaleString("en-GB")}`;
  }
};

export default async function LifecyclePage({ searchParams }: { searchParams: SearchParams }) {
  const ctx = await requireAccess();
  const raw = await readReportParams(searchParams);
  let data;
  try {
    data = await Promise.all([getLifecycleReport(ctx, raw), analyticsFilterOptions(ctx)]);
  } catch (e) {
    if (e instanceof NotFoundError) notFound();
    throw e;
  }
  const [l, options] = data;
  const query = filterQuery(l.q, undefined, { period: undefined, threshold: l.q.threshold });
  return (
    <>
      <PageHeader
        title="Equipment lifecycle and cost"
        description={`As of ${fmtDate(l.today)}. Uses only the dates, warranty records and costs entered in the asset register — nothing is estimated.`}
        actions={can(ctx, "analytics.export") ? <ExportLink report="lifecycle" query={query} /> : null}
      />
      <Card>
        <ReportFilters
          action="/reports/lifecycle"
          q={l.q}
          options={options}
          fields={["hospital", "department", "location", "category"]}
          extra={
            <div>
              <label htmlFor="f-threshold" className="text-sm font-semibold">
                Replacement review window (months)
              </label>
              <input
                id="f-threshold"
                name="threshold"
                type="number"
                min={0}
                max={120}
                defaultValue={l.q.threshold}
                className="border-line-strong text-ink mt-1.5 min-h-11 w-full rounded-sm border bg-white px-3 text-sm"
              />
            </div>
          }
        />
      </Card>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardTitle>Equipment age</CardTitle>
          <BarTable
            caption="Equipment by age"
            head={["Age", "Assets"]}
            rows={l.ages.map((a) => ({ key: a.bucket, label: AGE[a.bucket], value: a.count }))}
          />
          <p className="text-ink-muted text-xs">
            Age from the purchase date, or the commissioning date when no purchase date is recorded.
          </p>
        </Card>
        <Card>
          <CardTitle>Warranty status</CardTitle>
          <BarTable
            caption="Equipment by warranty status"
            head={["Warranty", "Assets"]}
            rows={l.warranty.map((w) => ({ key: w.state, label: WARRANTY[w.state], value: w.count }))}
          />
        </Card>
      </div>
      <Card>
        <CardTitle>Candidates for replacement review ({l.review.length})</CardTitle>
        <p className="text-ink-muted text-xs">
          Assets whose recorded end-of-life date, or the model&apos;s expected life from acquisition, falls within{" "}
          {l.q.threshold} months. This is a prompt for review by the engineering team, not a replacement decision.
        </p>
        {l.review.length === 0 ? (
          <Empty>No asset reaches its recorded end of life or expected life within this window.</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <caption className="sr-only">Candidates for replacement review</caption>
              <thead className={tableHead}>
                <tr>
                  <th className={th}>Asset</th>
                  <th className={th}>Hospital</th>
                  <th className={th}>Acquired</th>
                  <th className={thr}>Expected life</th>
                  <th className={th}>End-of-life date</th>
                  <th className={th}>Why listed</th>
                </tr>
              </thead>
              <tbody>
                {l.review.map((a) => (
                  <tr key={a.id} className={rowCls}>
                    <td className={td}>
                      <Link href={`/assets/${a.id}`} className={recordLink}>
                        {a.asset_tag}
                      </Link>{" "}
                      · {a.name}
                    </td>
                    <td className={td}>{a.hospital}</td>
                    <td className={td}>{fmtDate(a.acquired)}</td>
                    <td className={tdr}>{a.expected_life ? `${a.expected_life} years` : "—"}</td>
                    <td className={td}>{fmtDate(a.eol_date)}</td>
                    <td className={td}>
                      <ToneTag tone="warn">
                        {a.reason === "eol_date" ? "End-of-life date" : "Expected life reached"}
                      </ToneTag>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <Card>
        <CardTitle>Acquisition cost</CardTitle>
        {!l.financial || !l.costs || !l.costCoverage ? (
          <p className="text-ink-muted text-sm">Your role does not include financial figures.</p>
        ) : (
          <>
            <p className="text-ink-muted text-xs">
              Purchase cost as entered in the asset register, per currency (currencies are never converted or added
              together). {l.costCoverage.withCost} of {l.costCoverage.total} assets (
              {percent(l.costCoverage.withCost, l.costCoverage.total) ?? "N/A"}%) have a cost recorded; the rest are not
              included. Viewing this section is recorded in the audit log.
            </p>
            {l.costs.length === 0 ? (
              <Empty>No purchase costs are recorded for these assets.</Empty>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <caption className="sr-only">Acquisition cost by category</caption>
                  <thead className={tableHead}>
                    <tr>
                      <th className={th}>Category</th>
                      <th className={th}>Currency</th>
                      <th className={thr}>Assets with a cost</th>
                      <th className={thr}>Total acquisition cost</th>
                    </tr>
                  </thead>
                  <tbody>
                    {l.costs.map((c) => (
                      <tr key={`${c.currency}-${c.group}`} className={rowCls}>
                        <td className={td}>{c.group}</td>
                        <td className={td}>{c.currency}</td>
                        <td className={tdr}>{c.assets}</td>
                        <td className={tdr}>{money(c.total, c.currency)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </Card>
      <Card>
        <CardTitle>What is not included yet</CardTitle>
        <Definitions
          items={[
            [
              "Maintenance cost",
              "Labour rates, parts and contractor invoices are not recorded yet, so no maintenance or repair cost is shown. Time logged on work orders is reported in hours only.",
            ],
            [
              "Total cost of ownership",
              "Needs maintenance, parts and service-contract costs. Planned with spare parts and supplier management.",
            ],
            [
              "Replacement planning",
              "Listed assets are review prompts based on recorded dates. Clinical need, condition and parts support are decided by the team.",
            ],
          ]}
          footer="Figures come from the asset register. Nothing on this page is estimated or forecast."
        />
      </Card>
    </>
  );
}
