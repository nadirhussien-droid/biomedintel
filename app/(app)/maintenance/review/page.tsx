import type { Metadata } from "next";
import Link from "next/link";
import { requireAccess } from "@/server/auth/session";
import { getNeedsReview } from "@/server/services/pm-plans";
import { PageHeader } from "@/components/shell/page-header";
import { Badge, Card, CardTitle } from "@/components/ui/card";
import { formatDateOnly, fromDbDate, intervalLabel, type IntervalUnitValue } from "@/lib/pm/dates";

export const metadata: Metadata = { title: "Needs review" };

const dateTime = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" });

export default async function ReviewPage() {
  const ctx = await requireAccess();
  const r = await getNeedsReview(ctx);
  return (
    <>
      <PageHeader
        title="Needs review"
        description="Items that need a decision by engineering staff. BiomedIntel.ai never invents a schedule for equipment without an approved interval."
      />

      <Card>
        <CardTitle
          action={r.failed.length ? <Badge tone="danger">{r.failed.length}</Badge> : <Badge tone="ok">None</Badge>}
        >
          Work orders that could not be created
        </CardTitle>
        {r.failed.length === 0 ? (
          <p className="text-ink-muted text-sm">Every due work order has been created.</p>
        ) : (
          <ul className="flex flex-col gap-2 text-sm">
            {r.failed.map((f) => (
              <li key={f.id} className="border-danger/30 bg-danger-bg rounded-sm border p-3">
                <Link href={`/assets/${f.asset.id}#pm`} className="font-mono font-semibold hover:underline">
                  {f.asset.assetTag}
                </Link>{" "}
                · {f.plan.name} · due {formatDateOnly(fromDbDate(f.dueOn))}
                <div className="text-danger mt-1">{f.lastError}</div>
                <div className="text-ink-muted text-xs">
                  {f.attempts} attempt(s){f.lastAttemptAt ? `, last ${dateTime.format(f.lastAttemptAt)} UTC` : ""}. Fix
                  the cause; the next run retries automatically.
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card>
        <CardTitle action={<Badge tone={r.assetsTotal ? "warn" : "ok"}>{r.assetsTotal}</Badge>}>
          Equipment without an approved maintenance plan
        </CardTitle>
        <p className="text-ink-muted text-sm">
          Create or extend a plan with an approved interval (requirement, manufacturer, or organisation-defined with
          justification), then enrol the asset.
        </p>
        {r.assets.length ? (
          <div
            className="overflow-x-auto"
            tabIndex={0}
            role="region"
            aria-label="Table (scroll sideways on small screens)"
          >
            <table className="w-full text-sm">
              <caption className="sr-only">Assets without an approved plan</caption>
              <thead className="text-ink-muted text-left text-xs uppercase">
                <tr>
                  <th className="py-2 pr-3">Asset</th>
                  <th className="py-2 pr-3">Where</th>
                  <th className="py-2 pr-3">Model</th>
                  <th className="py-2 pr-3">Interval guidance on record</th>
                </tr>
              </thead>
              <tbody>
                {r.assets.map((a) => (
                  <tr key={a.id} className="border-line border-t">
                    <td className="py-2 pr-3">
                      <Link
                        href={`/assets/${a.id}#pm`}
                        className="font-mono font-semibold text-teal-700 hover:underline"
                      >
                        {a.assetTag}
                      </Link>{" "}
                      {a.name}
                    </td>
                    <td className="py-2 pr-3">
                      {a.hospital.code} · {a.department.name}
                    </td>
                    <td className="py-2 pr-3">
                      {a.model.modelName} <span className="text-ink-muted">({a.model.category.name})</span>
                    </td>
                    <td className="py-2 pr-3">
                      {a.model.manufacturerPmIntervalCount ? (
                        <>
                          Manufacturer:{" "}
                          {intervalLabel(
                            a.model.manufacturerPmIntervalCount,
                            a.model.manufacturerPmIntervalUnit as IntervalUnitValue,
                          )}
                        </>
                      ) : (
                        <span className="text-ink-muted">
                          No manufacturer interval
                          {a.model.category.defaultPmIntervalMonths
                            ? ` · category hint ${a.model.category.defaultPmIntervalMonths} months (not approved)`
                            : ""}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {r.assetsTotal > r.assets.length ? (
              <p className="text-ink-muted mt-2 text-xs">Showing the first {r.assets.length}.</p>
            ) : null}
          </div>
        ) : null}
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardTitle>Plans awaiting approval</CardTitle>
          {r.unapproved.length === 0 ? (
            <p className="text-ink-muted text-sm">None.</p>
          ) : (
            <ul className="flex flex-col gap-1 text-sm">
              {r.unapproved.map((p) => (
                <li key={p.id}>
                  <Link href={`/maintenance/plans/${p.id}`} className="text-teal-700 hover:underline">
                    {p.name}
                  </Link>{" "}
                  <span className="text-ink-muted">· {p.status === "DRAFT" ? "draft" : "changes waiting"}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card>
          <CardTitle>Interval reviews due (next 30 days)</CardTitle>
          {r.reviewDue.length === 0 ? (
            <p className="text-ink-muted text-sm">None.</p>
          ) : (
            <ul className="flex flex-col gap-1 text-sm">
              {r.reviewDue.map((p) => (
                <li key={p.id}>
                  <Link href={`/maintenance/plans/${p.id}`} className="text-teal-700 hover:underline">
                    {p.name}
                  </Link>{" "}
                  <span className="text-ink-muted">
                    · review {p.nextReviewOn ? formatDateOnly(fromDbDate(p.nextReviewOn)) : ""}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}
