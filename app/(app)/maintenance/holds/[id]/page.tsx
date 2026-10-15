import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAccess } from "@/server/auth/session";
import { NotFoundError } from "@/server/authz/errors";
import { getSafetyHold } from "@/server/services/safety-holds";
import { PageHeader } from "@/components/shell/page-header";
import { Card, CardTitle } from "@/components/ui/card";
import { DoNotUseBanner, HoldStatusBadge } from "@/components/pm/badges";
import { WoStatusBadge } from "@/components/work-orders/badges";
import { ANY_OUTCOME_LABELS, CHECK_LABELS } from "@/lib/validation/work-orders";
import { WORK_TYPE_LABELS } from "@/lib/validation/pm";
import { ApproveReleaseForm, CreateRepairForm, RejectReleaseForm } from "../../forms";

export const metadata: Metadata = { title: "Safety hold" };

const dateTime = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" });
const EVENT_LABELS: Record<string, string> = {
  PLACED: "Failed safety test — hold placed",
  FAILURE_ADDED: "Another failure recorded",
  REPAIR_CREATED: "Repair job created",
  REPAIR_COMPLETED: "Repair signed off",
  RETEST_CREATED: "Retest job created",
  RETEST_PASSED: "Retest passed",
  RETEST_FAILED: "Retest failed",
  RETEST_REOPENED: "Retest reopened",
  RELEASE_APPROVED: "Return to service approved (second person)",
  RELEASE_REJECTED: "Return to service NOT approved",
};
const SAVED: Record<string, string> = {
  released: "Return to service approved and recorded.",
  rejected: "Not approved. A new repair job has been created.",
  "repair-created": "Repair job created.",
};

export default async function HoldPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ saved?: string }>;
}) {
  const ctx = await requireAccess();
  const { id } = await params;
  const { saved } = await searchParams;
  const hold = await getSafetyHold(ctx, id).catch((e) => {
    if (e instanceof NotFoundError) notFound();
    throw e;
  });
  const n = (u: string | null) => (u ? (hold.names[u] ?? "Unknown") : "—");
  const latest = hold.retestResults.length ? Math.max(...hold.retestResults.map((r) => r.attempt)) : null;
  return (
    <>
      <PageHeader
        title={`Safety hold · ${hold.asset.assetTag}`}
        description={`${hold.asset.name} · ${hold.asset.hospital.code}`}
        actions={<HoldStatusBadge status={hold.status} />}
      />
      {saved && SAVED[saved] ? (
        <p role="status" className="bg-ok-bg text-ok rounded-md px-4 py-3 text-sm font-medium">
          {SAVED[saved]}
        </p>
      ) : null}
      {hold.status !== "RELEASED" ? <DoNotUseBanner holdId={hold.id} status={hold.status} /> : null}

      <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
        <div className="flex flex-col gap-4">
          <Card>
            <CardTitle>What failed</CardTitle>
            <p className="text-sm">{hold.failureSummary}</p>
            <p className="text-ink-muted text-xs">
              Found in{" "}
              <Link
                href={`/work-orders/${hold.failedWorkOrder.id}`}
                className="font-mono text-teal-700 hover:underline"
              >
                {hold.failedWorkOrder.number}
              </Link>{" "}
              by {n(hold.placedById)} on {dateTime.format(hold.placedAt)} UTC.
            </p>
          </Card>
          <Card>
            <CardTitle>Linked jobs</CardTitle>
            <ul className="flex flex-col gap-2 text-sm">
              {hold.workOrders.map((w) => (
                <li key={w.id} className="flex flex-wrap items-center gap-2">
                  <Link href={`/work-orders/${w.id}`} className="font-mono font-semibold text-teal-700 hover:underline">
                    {w.number}
                  </Link>
                  <span>{w.type === "SAFETY_TEST" ? "Retest" : `Repair (${WORK_TYPE_LABELS[w.type]})`}</span>
                  <WoStatusBadge status={w.status} />
                  {w.outcome ? <span className="text-ink-muted">{ANY_OUTCOME_LABELS[w.outcome]}</span> : null}
                  {w.completedById ? (
                    <span className="text-ink-muted">· signed off by {n(w.completedById)}</span>
                  ) : null}
                </li>
              ))}
            </ul>
            {hold.allowed.createRepair ? <CreateRepairForm id={hold.id} /> : null}
          </Card>
          {hold.retestResults.length ? (
            <Card>
              <CardTitle>Latest retest results</CardTitle>
              <table className="w-full text-sm">
                <caption className="sr-only">Retest results</caption>
                <thead className="text-ink-muted text-left text-xs uppercase">
                  <tr>
                    <th className="py-2 pr-3">Check</th>
                    <th className="py-2 pr-3">Result</th>
                    <th className="py-2 pr-3">Value</th>
                    <th className="py-2 pr-3">Standard</th>
                  </tr>
                </thead>
                <tbody>
                  {hold.retestResults
                    .filter((r) => r.attempt === latest)
                    .map((r) => (
                      <tr key={r.id} className="border-line border-t">
                        <td className="py-2 pr-3">{r.label}</td>
                        <td className="py-2 pr-3 font-semibold">{CHECK_LABELS[r.result]}</td>
                        <td className="py-2 pr-3">{r.value !== null ? `${Number(r.value)} ${r.unit ?? ""}` : "—"}</td>
                        <td className="py-2 pr-3">
                          {r.testStandardCode ? `${r.testStandardCode} ${r.testStandardVersion}` : "—"}
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
              <p className="text-ink-muted text-xs">
                Retest signed off by {n(hold.retestedById)}
                {hold.retestedAt ? ` on ${dateTime.format(hold.retestedAt)} UTC` : ""}.
              </p>
            </Card>
          ) : null}
        </div>
        <div className="flex flex-col gap-4">
          {hold.status === "AWAITING_APPROVAL" ? (
            <Card>
              <CardTitle>Second-person approval</CardTitle>
              {hold.allowed.release ? (
                <>
                  <ApproveReleaseForm id={hold.id} />
                  <RejectReleaseForm id={hold.id} />
                </>
              ) : hold.allowed.selfRetested ? (
                <p className="text-sm">
                  You carried out the retest, so another Engineering Manager must review and approve it.
                </p>
              ) : (
                <p className="text-sm">
                  An Engineering Manager who did not do the retest must review and approve return to service.
                </p>
              )}
            </Card>
          ) : null}
          {hold.status === "RELEASED" ? (
            <Card>
              <CardTitle>Released</CardTitle>
              <p className="text-sm">
                Approved by {n(hold.releasedById)} {hold.releasedAt ? `on ${dateTime.format(hold.releasedAt)} UTC` : ""}{" "}
                after the retest by {n(hold.retestedById)}.
              </p>
              {hold.releaseNote ? <p className="text-sm">“{hold.releaseNote}”</p> : null}
            </Card>
          ) : null}
          <Card>
            <CardTitle>History</CardTitle>
            <ol className="flex flex-col gap-2 text-sm">
              {hold.events.map((e) => (
                <li key={e.id} className="border-line border-l-2 pl-3">
                  <div className="font-semibold">{EVENT_LABELS[e.kind] ?? e.kind}</div>
                  <div className="text-ink-muted text-xs">
                    {n(e.actorId)} · {dateTime.format(e.createdAt)} UTC
                  </div>
                  {e.note ? <div className="text-xs">{e.note}</div> : null}
                </li>
              ))}
            </ol>
            <p className="text-ink-muted text-xs">
              This history cannot be edited or deleted. Exceptions to this process are not available.
            </p>
          </Card>
        </div>
      </div>
    </>
  );
}
