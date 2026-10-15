import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAccess } from "@/server/auth/session";
import { can } from "@/server/authz/access";
import { NotFoundError } from "@/server/authz/errors";
import { analyticsFilterOptions } from "@/server/services/analytics";
import { getCostReport } from "@/server/services/cost-analytics";
import { PageHeader } from "@/components/shell/page-header";
import { Card, CardTitle } from "@/components/ui/card";
import { ReportFilters, filterQuery } from "@/components/analytics/filters";
import {
  BarTable,
  Definitions,
  Empty,
  ExportLink,
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
import {
  CLAIM_STATUS_LABELS,
  MOVEMENT_LABELS,
  STOCK_UNIT_LABELS,
  type ClaimStatusValue,
} from "@/lib/validation/inventory";

export const metadata: Metadata = { title: "Parts, service and cost" };

const money = (amount: string, currency: string | null) => {
  const v = Number(amount);
  if (!currency) return amount;
  try {
    return new Intl.NumberFormat("en-GB", { style: "currency", currency }).format(v);
  } catch {
    return `${currency} ${amount}`;
  }
};

function MoneyList({ rows, empty }: { rows: { currency: string; total: string }[]; empty: string }) {
  if (!rows.length) return <p className="text-ink-muted text-sm">{empty}</p>;
  return (
    <ul className="text-sm">
      {rows.map((r) => (
        <li key={r.currency} className="font-semibold">
          {money(r.total, r.currency)}
        </li>
      ))}
    </ul>
  );
}

export default async function CostReportPage({ searchParams }: { searchParams: SearchParams }) {
  const ctx = await requireAccess();
  const raw = await readReportParams(searchParams);
  let data;
  try {
    data = await Promise.all([getCostReport(ctx, raw), analyticsFilterOptions(ctx)]);
  } catch (e) {
    if (e instanceof NotFoundError) notFound();
    throw e;
  }
  const [c, options] = data;
  const query = filterQuery(c.q, c.period);
  return (
    <>
      <PageHeader
        title="Parts, external service and cost"
        description={`${PERIOD_LABELS[c.period.preset]}: ${c.period.label}. Recorded stock movements, supplier work and warranty claims only — nothing is estimated.`}
        actions={can(ctx, "analytics.export") ? <ExportLink report="costs" query={query} /> : null}
      />
      <Card>
        <ReportFilters
          action="/reports/costs"
          q={c.q}
          period={c.period}
          options={options}
          fields={["period", "hospital"]}
        />
      </Card>

      <Card>
        <CardTitle>What the cost figures include</CardTitle>
        <Definitions
          items={[
            [
              "Parts cost",
              "Units issued to work orders minus units returned, at the unit cost recorded on the part when it was issued. Parts with no unit cost add nothing (and are counted below).",
            ],
            [
              "External service cost",
              "The cost entered on the supplier record when the work was completed (from the supplier's invoice). Whether it includes tax depends on what was entered.",
            ],
            [
              "Maintenance cost by asset",
              "Parts cost + external service cost. In-house labour is NOT included: no labour rates are recorded.",
            ],
            [
              "Currencies",
              "Each currency is shown separately. Amounts in different currencies are never converted or added together.",
            ],
          ]}
          footer="Purchase requests are not costs: only recorded receipts and issues are. Cost figures are restricted to financial roles and each view is audited."
        />
      </Card>

      {c.costs ? (
        <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Card>
              <h2 className="text-ink-muted text-sm font-semibold">Recorded parts cost</h2>
              <MoneyList rows={c.costs.partsByCurrency} empty="No priced parts issued." />
              {c.costs.unpricedIssues ? (
                <p className="text-ink-muted text-xs">
                  {c.costs.unpricedIssues} issue(s) had no unit cost recorded and are not included.
                </p>
              ) : null}
            </Card>
            <Card>
              <h2 className="text-ink-muted text-sm font-semibold">Recorded external service cost</h2>
              <MoneyList rows={c.costs.serviceByCurrency} empty="No completed supplier work with a cost." />
              {c.costs.servicesWithoutCost ? (
                <p className="text-ink-muted text-xs">
                  {c.costs.servicesWithoutCost} completed record(s) have no cost entered.
                </p>
              ) : null}
            </Card>
            <Card>
              <h2 className="text-ink-muted text-sm font-semibold">Value of stock written off</h2>
              <MoneyList rows={c.costs.writeOffValue} empty="No priced write-offs." />
            </Card>
            <Card>
              <h2 className="text-ink-muted text-sm font-semibold">Recovered through warranty claims</h2>
              <MoneyList rows={c.costs.recovered} empty="No recovered amounts recorded." />
            </Card>
          </div>
          <Card>
            <CardTitle>Recorded maintenance cost by asset (parts + external service)</CardTitle>
            {c.costs.byAsset.length === 0 ? (
              <Empty>No recorded costs in this period.</Empty>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <caption className="sr-only">Maintenance cost by asset</caption>
                  <thead className={tableHead}>
                    <tr>
                      <th className={th}>Asset</th>
                      <th className={th}>Currency</th>
                      <th className={thr}>Parts</th>
                      <th className={thr}>External service</th>
                      <th className={thr}>Total recorded</th>
                    </tr>
                  </thead>
                  <tbody>
                    {c.costs.byAsset.map((a) => (
                      <tr key={`${a.asset_id}-${a.currency}`} className={rowCls}>
                        <td className={td}>
                          <Link href={`/assets/${a.asset_id}`} className={recordLink}>
                            {a.asset_tag}
                          </Link>{" "}
                          · {a.name}
                        </td>
                        <td className={td}>{a.currency}</td>
                        <td className={tdr}>{money(a.parts, a.currency)}</td>
                        <td className={tdr}>{money(a.service, a.currency)}</td>
                        <td className={`${tdr} font-semibold`}>{money(a.total, a.currency)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
          <Card>
            <CardTitle>Recorded parts cost by work order</CardTitle>
            {c.costs.byWorkOrder.length === 0 ? (
              <Empty>No priced parts were used on jobs in this period.</Empty>
            ) : (
              <ul className="divide-line divide-y text-sm">
                {c.costs.byWorkOrder.map((w) => (
                  <li key={`${w.work_order_id}-${w.currency}`} className="flex justify-between py-1.5">
                    <Link href={`/work-orders/${w.work_order_id}`} className={recordLink}>
                      {w.number}
                    </Link>
                    <span>{money(w.parts, w.currency)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </>
      ) : (
        <Card>
          <p className="text-ink-muted text-sm">
            Your role does not include financial figures. Quantities and supplier history are shown below.
          </p>
        </Card>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardTitle>Stock movements in the period</CardTitle>
          <BarTable
            caption="Stock movements by type"
            head={["Movement", "Units"]}
            rows={c.movementSummary.map((m) => ({
              key: m.type,
              label: MOVEMENT_LABELS[m.type] ?? m.type,
              value: m.units,
              note: `${m.movements} movement(s)`,
            }))}
          />
        </Card>
        <Card>
          <CardTitle>Warranty claims (by latest date recorded)</CardTitle>
          <BarTable
            caption="Warranty claims by status"
            head={["Status", "Claims"]}
            rows={c.claims.map((x) => ({
              key: x.status,
              label: CLAIM_STATUS_LABELS[x.status as ClaimStatusValue] ?? x.status,
              value: x.claims,
            }))}
          />
        </Card>
      </div>

      <Card>
        <CardTitle>Parts used on work orders (net of returns)</CardTitle>
        {c.consumption.length === 0 ? (
          <Empty>No parts were used on work orders in this period.</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <caption className="sr-only">Parts consumption</caption>
              <thead className={tableHead}>
                <tr>
                  <th className={th}>Part</th>
                  <th className={thr}>Quantity used</th>
                  <th className={thr}>Jobs</th>
                </tr>
              </thead>
              <tbody>
                {c.consumption.map((x) => (
                  <tr key={x.part_id} className={rowCls}>
                    <td className={td}>
                      <Link href={`/inventory/parts/${x.part_id}`} className={`${recordLink} font-mono`}>
                        {x.part_number}
                      </Link>{" "}
                      · {x.name}
                    </td>
                    <td className={tdr}>
                      {x.used} {STOCK_UNIT_LABELS[x.unit as keyof typeof STOCK_UNIT_LABELS] ?? x.unit}
                    </td>
                    <td className={tdr}>{x.jobs}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardTitle>Stock written off</CardTitle>
          {c.writeOffs.length === 0 ? (
            <Empty>Nothing was written off in this period.</Empty>
          ) : (
            <ul className="divide-line divide-y text-sm">
              {c.writeOffs.map((x) => (
                <li key={x.part_id} className="py-1.5">
                  <span className="font-mono">{x.part_number}</span> · {x.name} · <strong>{x.units}</strong>
                  <div className="text-ink-muted text-xs">{x.reasons}</div>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card>
          <CardTitle>Supplier service history (requests in the period)</CardTitle>
          {c.supplierHistory.length === 0 ? (
            <Empty>No external service was requested in this period.</Empty>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <caption className="sr-only">Supplier service history</caption>
                <thead className={tableHead}>
                  <tr>
                    <th className={th}>Supplier</th>
                    <th className={thr}>Requests</th>
                    <th className={thr}>Completed</th>
                    <th className={thr}>Open</th>
                    <th className={thr}>By expected date</th>
                  </tr>
                </thead>
                <tbody>
                  {c.supplierHistory.map((x) => (
                    <tr key={x.supplier_id} className={rowCls}>
                      <td className={td}>
                        <Link href={`/suppliers/${x.supplier_id}`} className={recordLink}>
                          {x.name}
                        </Link>
                      </td>
                      <td className={tdr}>{x.requests}</td>
                      <td className={tdr}>{x.completed}</td>
                      <td className={tdr}>{x.open}</td>
                      <td className={tdr}>{x.withDates ? `${x.onTime} of ${x.withDates}` : "Not assessed"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="text-ink-muted text-xs">
            &quot;By expected date&quot; counts only records with both an expected date and a completion date. A closed
            work order is not evidence that a service-level target was met.
          </p>
        </Card>
      </div>
    </>
  );
}
