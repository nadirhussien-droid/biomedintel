import type { Metadata } from "next";
import Link from "next/link";
import { requireAccess } from "@/server/auth/session";
import { can } from "@/server/authz/access";
import { listPurchaseRequests } from "@/server/services/purchasing";
import { PageHeader } from "@/components/shell/page-header";
import { Card } from "@/components/ui/card";
import { Empty, fmtDateTime, recordLink, rowCls, tableHead, td, tdr, th, thr } from "@/components/analytics/ui";
import { PurchaseTag } from "@/components/stage8/badges";
import { PURCHASE_STATUS_LABELS } from "@/lib/validation/inventory";

export const metadata: Metadata = { title: "Purchase requests" };
type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function PurchasingPage({ searchParams }: { searchParams: SearchParams }) {
  const ctx = await requireAccess();
  if (!can(ctx, "purchase.view")) {
    return (
      <Card>
        <p className="text-sm">Your role does not include purchase requests.</p>
      </Card>
    );
  }
  const sp = await searchParams;
  const status = Array.isArray(sp.status) ? sp.status[0] : sp.status;
  const r = await listPurchaseRequests(ctx, { status });
  return (
    <>
      <PageHeader
        title="Purchase requests"
        description="Requests to buy parts. BiomedIntel.ai never sends orders or spends money: an approved request is ordered through your hospital's purchasing process, then marked as ordered here, and stock increases only when the delivery is received."
        actions={
          can(ctx, "purchase.request") ? (
            <Link
              href="/inventory/purchasing/new"
              className="text-navy-900 inline-flex min-h-11 items-center rounded-md border border-teal-400 bg-teal-400 px-4 text-sm font-semibold"
            >
              New request
            </Link>
          ) : null
        }
      />
      <nav aria-label="Filter by status" className="flex flex-wrap gap-2">
        {[["", "All"], ...Object.entries(PURCHASE_STATUS_LABELS)].map(([k, l]) => (
          <Link
            key={k}
            href={k ? `/inventory/purchasing?status=${k}` : "/inventory/purchasing"}
            aria-current={(r.status ?? "") === k ? "page" : undefined}
            className={`rounded-full border px-3 py-1.5 text-sm font-semibold ${(r.status ?? "") === k ? "bg-navy-900 border-navy-900 text-white" : "border-line-strong bg-white"}`}
          >
            {l.split(" —")[0].split(" (")[0]}
          </Link>
        ))}
      </nav>
      <Card>
        {r.rows.length === 0 ? (
          <Empty>No purchase requests.</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <caption className="sr-only">Purchase requests</caption>
              <thead className={tableHead}>
                <tr>
                  <th className={th}>Number</th>
                  <th className={th}>Hospital</th>
                  <th className={th}>Supplier</th>
                  <th className={thr}>Lines</th>
                  <th className={th}>Requested</th>
                  <th className={th}>Status</th>
                </tr>
              </thead>
              <tbody>
                {r.rows.map((p) => (
                  <tr key={p.id} className={rowCls}>
                    <td className={td}>
                      <Link href={`/inventory/purchasing/${p.id}`} className={`${recordLink} font-mono`}>
                        {p.number}
                      </Link>
                    </td>
                    <td className={td}>{p.hospital.code}</td>
                    <td className={td}>{p.supplier?.name ?? "—"}</td>
                    <td className={tdr}>{p._count.lines}</td>
                    <td className={td}>
                      {fmtDateTime(p.createdAt)} · {r.names[p.requestedById] ?? "Unknown"}
                    </td>
                    <td className={td}>
                      <PurchaseTag status={p.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}
