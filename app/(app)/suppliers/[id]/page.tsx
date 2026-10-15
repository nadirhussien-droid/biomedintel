import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAccess } from "@/server/auth/session";
import { can } from "@/server/authz/access";
import { NotFoundError } from "@/server/authz/errors";
import { getSupplier } from "@/server/services/suppliers";
import { PageHeader } from "@/components/shell/page-header";
import { Card, CardTitle } from "@/components/ui/card";
import { ActionForm } from "@/components/forms/action-form";
import { Empty, fmtDate, recordLink, rowCls, tableHead, td, th } from "@/components/analytics/ui";
import { PurchaseTag, ServiceTag } from "@/components/stage8/badges";
import { SUPPLIER_KIND_LABELS } from "@/lib/validation/inventory";
import { archiveSupplierAction } from "../actions";

export const metadata: Metadata = { title: "Supplier" };
const linkButton = "inline-flex min-h-11 items-center justify-center rounded-md border px-4 text-sm font-semibold";

export default async function SupplierPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const ctx = await requireAccess();
  const { id } = await params;
  const saved = (await searchParams).saved;
  let data;
  try {
    data = await getSupplier(ctx, id);
  } catch (e) {
    if (e instanceof NotFoundError) notFound();
    throw e;
  }
  const { supplier: s, warranties, services, parts, purchases, assetCount } = data;
  const active = s.status === "ACTIVE";
  const today = new Date().toISOString().slice(0, 10);
  const contracts = warranties.filter((w) => w.kind === "SERVICE_CONTRACT");
  const plain = warranties.filter((w) => w.kind === "WARRANTY");
  const withDates = services.filter((x) => x.expectedBy && x.completedOn);
  const onTime = withDates.filter((x) => x.completedOn! <= x.expectedBy!).length;
  return (
    <>
      <PageHeader
        title={s.name}
        description={s.kinds.map((k) => SUPPLIER_KIND_LABELS[k]).join(", ")}
        actions={
          can(ctx, "supplier.manage") && active ? (
            <Link
              href={`/suppliers/${s.id}/edit`}
              className={`${linkButton} text-navy-900 border-teal-400 bg-teal-400`}
            >
              Edit supplier
            </Link>
          ) : null
        }
      />
      {saved ? (
        <p role="status" className="bg-ok-bg text-ok rounded-md px-4 py-3 text-sm font-semibold">
          Supplier saved.
        </p>
      ) : null}
      {!active ? (
        <p className="bg-warn-bg rounded-md px-4 py-3 text-sm text-[#6b3f00]">
          This supplier is archived. Its history is kept.
        </p>
      ) : null}
      <div className="grid gap-6 xl:grid-cols-2">
        <Card>
          <CardTitle>Business details</CardTitle>
          <dl className="grid gap-2 text-sm sm:grid-cols-2">
            <div>
              <dt className="font-semibold">Contact person</dt>
              <dd>{s.contactName ?? "—"}</dd>
            </div>
            <div>
              <dt className="font-semibold">Email</dt>
              <dd>{s.email ?? "—"}</dd>
            </div>
            <div>
              <dt className="font-semibold">Phone</dt>
              <dd>{s.phone ?? "—"}</dd>
            </div>
            <div>
              <dt className="font-semibold">Address</dt>
              <dd className="whitespace-pre-line">{s.address ?? "—"}</dd>
            </div>
            <div>
              <dt className="font-semibold">Manufacturers supported</dt>
              <dd>{s.manufacturers.map((m) => m.manufacturer.name).join(", ") || "—"}</dd>
            </div>
            <div>
              <dt className="font-semibold">Parts and service categories</dt>
              <dd>{s.serviceCategories.join(", ") || "—"}</dd>
            </div>
            <div>
              <dt className="font-semibold">Equipment bought from this supplier</dt>
              <dd>
                {assetCount} asset{assetCount === 1 ? "" : "s"} in your hospitals
              </dd>
            </div>
          </dl>
          {s.notes ? <p className="text-sm whitespace-pre-line">{s.notes}</p> : null}
          {can(ctx, "supplier.manage") ? (
            <ActionForm
              action={archiveSupplierAction}
              hidden={{ id: s.id, archived: active ? "1" : "0" }}
              label={active ? "Archive supplier" : "Restore supplier"}
              variant="secondary"
              confirm={active ? "Archive this supplier? Its history is kept." : undefined}
            />
          ) : null}
        </Card>
        <Card>
          <CardTitle>Service performance (recorded dates only)</CardTitle>
          <p className="text-sm">
            {services.length} external service request{services.length === 1 ? "" : "s"} on jobs you can see;{" "}
            {withDates.length} have both an expected date and a completion date
            {withDates.length ? `, of which ${onTime} were completed by the expected date` : ""}.
          </p>
          <p className="text-ink-muted text-xs">
            Performance is shown only where both dates were recorded. A closed work order is not treated as proof that a
            service-level agreement was met.
          </p>
        </Card>
      </div>
      <Card>
        <CardTitle>
          Service contracts ({contracts.length}) and warranties ({plain.length})
        </CardTitle>
        {warranties.length === 0 ? (
          <Empty>None linked to this supplier in your hospitals.</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <caption className="sr-only">Contracts and warranties</caption>
              <thead className={tableHead}>
                <tr>
                  <th className={th}>Type</th>
                  <th className={th}>Asset</th>
                  <th className={th}>Reference</th>
                  <th className={th}>Period</th>
                  <th className={th}>Response target</th>
                </tr>
              </thead>
              <tbody>
                {warranties.map((w) => {
                  const end = w.endsOn.toISOString().slice(0, 10);
                  return (
                    <tr key={w.id} className={rowCls}>
                      <td className={td}>{w.kind === "WARRANTY" ? "Warranty" : "Service contract"}</td>
                      <td className={td}>
                        <Link href={`/assets/${w.asset.id}#warranty`} className={recordLink}>
                          {w.asset.assetTag}
                        </Link>{" "}
                        {w.asset.name}
                      </td>
                      <td className={td}>{w.reference ?? "—"}</td>
                      <td className={td}>
                        {fmtDate(w.startsOn)} – {fmtDate(w.endsOn)} {end < today ? "(expired)" : ""}
                      </td>
                      <td className={td}>
                        {w.responseTargetHours ? `${w.responseTargetHours} h (as contracted)` : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <Card>
        <CardTitle>External service history</CardTitle>
        {services.length === 0 ? (
          <Empty>No external service recorded with this supplier.</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <caption className="sr-only">External service history</caption>
              <thead className={tableHead}>
                <tr>
                  <th className={th}>Work order</th>
                  <th className={th}>Supplier reference</th>
                  <th className={th}>Requested</th>
                  <th className={th}>Expected by</th>
                  <th className={th}>Completed</th>
                  <th className={th}>Status</th>
                </tr>
              </thead>
              <tbody>
                {services.map((x) => (
                  <tr key={x.id} className={rowCls}>
                    <td className={td}>
                      <Link href={`/work-orders/${x.workOrder.id}#external-service`} className={recordLink}>
                        {x.workOrder.number}
                      </Link>{" "}
                      · {x.asset.assetTag}
                    </td>
                    <td className={td}>{x.supplierReference ?? "—"}</td>
                    <td className={td}>{fmtDate(x.requestedOn)}</td>
                    <td className={td}>{fmtDate(x.expectedBy)}</td>
                    <td className={td}>{fmtDate(x.completedOn)}</td>
                    <td className={td}>
                      <ServiceTag status={x.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <div className="grid gap-6 xl:grid-cols-2">
        <Card>
          <CardTitle>Parts supplied</CardTitle>
          {parts.length === 0 ? (
            <Empty>No parts linked.</Empty>
          ) : (
            <ul className="divide-line divide-y text-sm">
              {parts.map((p) => (
                <li key={p.part.id} className="py-2">
                  <Link href={`/inventory/parts/${p.part.id}`} className={`${recordLink} font-mono`}>
                    {p.part.partNumber}
                  </Link>{" "}
                  {p.part.name}
                  {p.supplierPartNumber ? (
                    <span className="text-ink-muted"> · supplier no. {p.supplierPartNumber}</span>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </Card>
        {can(ctx, "purchase.view") ? (
          <Card>
            <CardTitle>Purchase requests</CardTitle>
            {purchases.length === 0 ? (
              <Empty>None.</Empty>
            ) : (
              <ul className="divide-line divide-y text-sm">
                {purchases.map((p) => (
                  <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                    <Link href={`/inventory/purchasing/${p.id}`} className={`${recordLink} font-mono`}>
                      {p.number}
                    </Link>
                    <PurchaseTag status={p.status} />
                  </li>
                ))}
              </ul>
            )}
          </Card>
        ) : null}
      </div>
    </>
  );
}
