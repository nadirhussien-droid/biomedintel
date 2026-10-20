import type { Metadata } from "next";
import Link from "next/link";
import { requireAccess } from "@/server/auth/session";
import { partsOnOpenWorkOrders } from "@/server/services/inventory";
import { PageHeader } from "@/components/shell/page-header";
import { Card, CardTitle } from "@/components/ui/card";
import { Empty, fmtDateTime, recordLink, rowCls, tableHead, td, tdr, th, thr } from "@/components/analytics/ui";
import { WO_STATUS_LABELS, type WorkOrderStatusValue } from "@/lib/validation/work-orders";

export const metadata: Metadata = { title: "Parts on work orders" };

export default async function PartsOnJobsPage() {
  const ctx = await requireAccess();
  const r = await partsOnOpenWorkOrders(ctx);
  return (
    <>
      <PageHeader
        title="Parts on open work orders"
        description="Parts reserved for jobs (still on the shelf, not available to others) and parts issued to jobs that are still open."
      />
      <Card>
        <CardTitle>Reserved ({r.reservations.length})</CardTitle>
        {r.reservations.length === 0 ? (
          <Empty>No active reservations.</Empty>
        ) : (
          <div
            className="overflow-x-auto"
            tabIndex={0}
            role="region"
            aria-label="Table (scroll sideways on small screens)"
          >
            <table className="w-full text-sm">
              <caption className="sr-only">Reserved parts</caption>
              <thead className={tableHead}>
                <tr>
                  <th className={th}>Work order</th>
                  <th className={th}>Part</th>
                  <th className={th}>Store</th>
                  <th className={thr}>Quantity</th>
                  <th className={th}>Reserved</th>
                </tr>
              </thead>
              <tbody>
                {r.reservations.map((x) => (
                  <tr key={x.id} className={rowCls}>
                    <td className={td}>
                      <Link href={`/work-orders/${x.workOrder.id}#parts`} className={recordLink}>
                        {x.workOrder.number}
                      </Link>{" "}
                      · {x.workOrder.asset.assetTag} · {WO_STATUS_LABELS[x.workOrder.status as WorkOrderStatusValue]}
                    </td>
                    <td className={td}>
                      <Link href={`/inventory/parts/${x.part.id}`} className={`${recordLink} font-mono`}>
                        {x.part.partNumber}
                      </Link>{" "}
                      {x.part.name}
                    </td>
                    <td className={td}>{x.location.code}</td>
                    <td className={tdr}>{x.quantity}</td>
                    <td className={td}>{fmtDateTime(x.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <Card>
        <CardTitle>Issued to open jobs</CardTitle>
        {r.issued.length === 0 ? (
          <Empty>No parts issued to open jobs.</Empty>
        ) : (
          <div
            className="overflow-x-auto"
            tabIndex={0}
            role="region"
            aria-label="Table (scroll sideways on small screens)"
          >
            <table className="w-full text-sm">
              <caption className="sr-only">Parts issued to open jobs</caption>
              <thead className={tableHead}>
                <tr>
                  <th className={th}>Work order</th>
                  <th className={th}>Part</th>
                  <th className={thr}>Issued (net of returns)</th>
                </tr>
              </thead>
              <tbody>
                {r.issued.map((x) => (
                  <tr key={`${x.work_order_id}-${x.part_id}`} className={rowCls}>
                    <td className={td}>
                      <Link href={`/work-orders/${x.work_order_id}#parts`} className={recordLink}>
                        {x.number}
                      </Link>{" "}
                      · {WO_STATUS_LABELS[x.status as WorkOrderStatusValue]}
                    </td>
                    <td className={td}>
                      <span className="font-mono">{x.part_number}</span> {x.name}
                    </td>
                    <td className={tdr}>{x.net}</td>
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
