import type { Metadata } from "next";
import Link from "next/link";
import { requireAccess } from "@/server/auth/session";
import { can } from "@/server/authz/access";
import { outstandingServices } from "@/server/services/external-services";
import { PageHeader } from "@/components/shell/page-header";
import { Card } from "@/components/ui/card";
import { Empty, fmtDate, recordLink, rowCls, tableHead, td, th, ToneTag } from "@/components/analytics/ui";
import { ServiceTag } from "@/components/stage8/badges";

export const metadata: Metadata = { title: "Supplier work in progress" };

export default async function ServicesPage() {
  const ctx = await requireAccess();
  if (!can(ctx, "supplier.view")) {
    return (
      <Card>
        <p className="text-sm">Your role does not include supplier records.</p>
      </Card>
    );
  }
  const r = await outstandingServices(ctx);
  const today = new Date().toISOString().slice(0, 10);
  return (
    <>
      <PageHeader
        title="Supplier work in progress"
        description="External service requested on work orders and not yet completed or cancelled. Each is part of an existing work order; the job keeps its own status and sign-off."
      />
      <Card>
        {r.rows.length === 0 ? (
          <Empty>No supplier work outstanding.</Empty>
        ) : (
          <div
            className="overflow-x-auto"
            tabIndex={0}
            role="region"
            aria-label="Table (scroll sideways on small screens)"
          >
            <table className="w-full text-sm">
              <caption className="sr-only">Outstanding supplier work</caption>
              <thead className={tableHead}>
                <tr>
                  <th className={th}>Work order</th>
                  <th className={th}>Supplier</th>
                  <th className={th}>Supplier reference</th>
                  <th className={th}>Requested</th>
                  <th className={th}>Expected by</th>
                  <th className={th}>Status</th>
                </tr>
              </thead>
              <tbody>
                {r.rows.map((x) => {
                  const late = x.expectedBy && x.expectedBy.toISOString().slice(0, 10) < today;
                  return (
                    <tr key={x.id} className={rowCls}>
                      <td className={td}>
                        <Link href={`/work-orders/${x.workOrder.id}#external-service`} className={recordLink}>
                          {x.workOrder.number}
                        </Link>{" "}
                        · {x.asset.assetTag}
                      </td>
                      <td className={td}>
                        <Link href={`/suppliers/${x.supplier.id}`} className={recordLink}>
                          {x.supplier.name}
                        </Link>
                      </td>
                      <td className={td}>{x.supplierReference ?? "—"}</td>
                      <td className={td}>
                        {fmtDate(x.requestedOn)} · {r.names[x.createdById] ?? "Unknown"}
                      </td>
                      <td className={td}>
                        {fmtDate(x.expectedBy)} {late ? <ToneTag tone="danger">Past expected date</ToneTag> : null}
                        {!x.expectedBy ? <span className="text-ink-muted text-xs">No date recorded</span> : null}
                      </td>
                      <td className={td}>
                        <ServiceTag status={x.status} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}
