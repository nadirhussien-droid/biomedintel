import type { Metadata } from "next";
import Link from "next/link";
import { requireAccess } from "@/server/auth/session";
import { can } from "@/server/authz/access";
import { getPlanGovernance } from "@/server/services/analytics";
import { PageHeader } from "@/components/shell/page-header";
import { Card, CardTitle } from "@/components/ui/card";
import {
  BarTable,
  Definitions,
  Empty,
  ExportLink,
  ToneTag,
  fmtDate,
  fmtDateTime,
  recordLink,
  rowCls,
  tableHead,
  td,
  th,
} from "@/components/analytics/ui";

export const metadata: Metadata = { title: "Plan governance" };

const SOURCE: Record<string, string> = {
  REGULATORY_REQUIREMENT: "Regulatory requirement",
  ORGANIZATIONAL_REQUIREMENT: "Organisational requirement",
  MANUFACTURER: "Manufacturer",
  ORGANIZATION_DEFINED: "Organisation-defined",
};

export default async function GovernancePage() {
  const ctx = await requireAccess();
  const g = await getPlanGovernance(ctx);
  return (
    <>
      <PageHeader
        title="Maintenance plan governance"
        description={`As of ${fmtDate(g.today)}. Shows where maintenance intervals rest on manufacturer, regulatory or organisational requirements, and where they need attention. This report never changes a plan or a schedule.`}
        actions={can(ctx, "analytics.export") ? <ExportLink report="governance" query="" /> : null}
      />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Card>
          <h2 className="text-ink-muted text-sm font-semibold">Assets without an approved PM plan</h2>
          <p className="text-3xl font-bold">{g.withoutPlan.total}</p>
          {g.withoutPlan.total ? <ToneTag tone="warn">Needs a plan or a documented decision</ToneTag> : null}
        </Card>
        <Card>
          <h2 className="text-ink-muted text-sm font-semibold">Models in use without a manufacturer interval</h2>
          <p className="text-3xl font-bold">{g.modelsWithoutInterval.length}</p>
        </Card>
        <Card>
          <h2 className="text-ink-muted text-sm font-semibold">Plan changes awaiting approval</h2>
          <p className="text-3xl font-bold">{g.awaiting.length}</p>
        </Card>
        <Card>
          <h2 className="text-ink-muted text-sm font-semibold">Interval reviews due within 60 days</h2>
          <p className="text-3xl font-bold">{g.reviews.length}</p>
          {g.reviews.some((r) => r.overdue) ? <ToneTag tone="danger">Some reviews are overdue</ToneTag> : null}
        </Card>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardTitle>Assets without an approved plan, by category</CardTitle>
          <BarTable
            caption="Assets without an approved PM plan by category"
            head={["Category", "Assets"]}
            rows={g.withoutPlan.byCategory.map((c) => ({ key: c.category, label: c.category, value: c.count }))}
          />
          <p className="text-sm">
            <Link href="/maintenance/review" className={recordLink}>
              Open Needs review →
            </Link>
          </p>
        </Card>
        <Card>
          <CardTitle>Models without a recorded manufacturer interval</CardTitle>
          {g.modelsWithoutInterval.length === 0 ? (
            <Empty>Every model in use has a manufacturer interval recorded.</Empty>
          ) : (
            <ul className="divide-line divide-y text-sm">
              {g.modelsWithoutInterval.map((m) => (
                <li key={m.id} className="py-2">
                  {m.manufacturer.name} {m.modelName} <span className="text-ink-muted">· {m.category.name}</span>
                </li>
              ))}
            </ul>
          )}
          <p className="text-ink-muted text-xs">
            Record the interval from the manufacturer&apos;s service manual in Preventive Maintenance → Settings. No
            interval is ever assumed.
          </p>
        </Card>
      </div>
      <Card>
        <CardTitle>Interval exceptions ({g.exceptions.length})</CardTitle>
        <p className="text-ink-muted text-xs">
          Active plans whose interval is organisation-defined, or set by a requirement and different from the
          manufacturer&apos;s. Each shows its documented basis and approver.
        </p>
        {g.exceptions.length === 0 ? (
          <Empty>No exceptions.</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <caption className="sr-only">Interval exceptions</caption>
              <thead className={tableHead}>
                <tr>
                  <th className={th}>Plan</th>
                  <th className={th}>Interval</th>
                  <th className={th}>Manufacturer</th>
                  <th className={th}>Source</th>
                  <th className={th}>Justification or reference</th>
                  <th className={th}>Approved</th>
                </tr>
              </thead>
              <tbody>
                {g.exceptions.map((e) => (
                  <tr key={e.id} className={rowCls}>
                    <td className={td}>
                      <Link href={`/maintenance/plans/${e.id}`} className={recordLink}>
                        {e.name}
                      </Link>
                    </td>
                    <td className={td}>{e.interval}</td>
                    <td className={td}>{e.manufacturer ?? <span className="text-ink-muted">None recorded</span>}</td>
                    <td className={td}>{SOURCE[e.source] ?? e.source}</td>
                    <td className={`${td} max-w-xs`}>{e.basis ?? "—"}</td>
                    <td className={td}>
                      {g.names[e.approvedById] ?? "Unknown"} · {fmtDateTime(e.approvedAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardTitle>Plan changes awaiting approval</CardTitle>
          {g.awaiting.length === 0 ? (
            <Empty>None.</Empty>
          ) : (
            <ul className="divide-line divide-y text-sm">
              {g.awaiting.map((p) => (
                <li key={p.id} className="flex justify-between gap-2 py-2">
                  <Link href={`/maintenance/plans/${p.id}`} className={recordLink}>
                    {p.name}
                  </Link>
                  <span className="text-ink-muted">changed {fmtDateTime(p.updatedAt)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card>
          <CardTitle>Interval reviews due</CardTitle>
          {g.reviews.length === 0 ? (
            <Empty>No reviews due in the next 60 days.</Empty>
          ) : (
            <ul className="divide-line divide-y text-sm">
              {g.reviews.map((p) => (
                <li key={p.id} className="flex flex-wrap justify-between gap-2 py-2">
                  <Link href={`/maintenance/plans/${p.id}`} className={recordLink}>
                    {p.name}
                  </Link>
                  <span className="flex items-center gap-2">
                    {fmtDate(p.nextReviewOn)}
                    {p.overdue ? <ToneTag tone="danger">Overdue</ToneTag> : null}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
      <Card>
        <CardTitle>Interval priority</CardTitle>
        <Definitions
          items={[
            [
              "1. Regulatory or organisational requirement",
              "Takes precedence. The requirement reference is stored on the approved plan revision.",
            ],
            ["2. Manufacturer interval", "From the model's service documentation, recorded per model."],
            ["3. Organisation-defined", "Only with a written justification and Engineering Manager approval."],
            [
              "No approved interval",
              "The asset is flagged for review. BiomedIntel.ai never assigns an arbitrary schedule.",
            ],
          ]}
          footer="Plan approval, source, effective date and review history are kept on each plan's page."
        />
      </Card>
    </>
  );
}
