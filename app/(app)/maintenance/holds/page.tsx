import type { Metadata } from "next";
import Link from "next/link";
import { requireAccess } from "@/server/auth/session";
import { listSafetyHolds } from "@/server/services/safety-holds";
import { PageHeader } from "@/components/shell/page-header";
import { Card, CardTitle } from "@/components/ui/card";
import { HoldStatusBadge } from "@/components/pm/badges";
import { DO_NOT_USE_LABEL } from "@/lib/validation/pm";

export const metadata: Metadata = { title: "Safety holds" };

const dateTime = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" });

export default async function HoldsPage({ searchParams }: { searchParams: Promise<{ all?: string }> }) {
  const ctx = await requireAccess();
  const all = (await searchParams).all === "1";
  const holds = await listSafetyHolds(ctx, { open: !all });
  return (
    <>
      <PageHeader
        title="Safety holds"
        description={`Devices flagged “${DO_NOT_USE_LABEL}” after an electrical safety test failed. Each needs repair, a passed retest and approval by a second, authorised person before it can be used again.`}
      />
      <Card>
        <CardTitle
          action={
            <Link
              href={all ? "/maintenance/holds" : "/maintenance/holds?all=1"}
              className="text-sm font-semibold text-teal-700 hover:underline"
            >
              {all ? "Show open holds only" : "Show released holds too"}
            </Link>
          }
        >
          {all ? "All holds" : "Open holds"}
        </CardTitle>
        {holds.length === 0 ? (
          <div className="bg-surface rounded-md px-4 py-10 text-center">
            <p className="font-semibold">No {all ? "" : "open "}safety holds.</p>
          </div>
        ) : (
          <ul className="flex flex-col gap-2">
            {holds.map((h) => (
              <li
                key={h.id}
                className={`rounded-md border p-3 ${h.status === "RELEASED" ? "border-line" : "border-danger/40 bg-danger-bg/40"}`}
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <Link href={`/maintenance/holds/${h.id}`} className="font-semibold text-teal-700 hover:underline">
                    <span className="font-mono">{h.asset.assetTag}</span> · {h.asset.name} · {h.asset.hospital.code}
                  </Link>
                  <HoldStatusBadge status={h.status} />
                </div>
                <div className="text-ink-muted mt-1 text-sm">
                  Failed in {h.failedWorkOrder.number} on {dateTime.format(h.placedAt)} UTC: {h.failureSummary}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
