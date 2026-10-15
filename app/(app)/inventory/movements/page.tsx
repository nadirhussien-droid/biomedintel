import type { Metadata } from "next";
import Link from "next/link";
import { requireAccess } from "@/server/auth/session";
import { listMovements } from "@/server/services/inventory";
import { PageHeader } from "@/components/shell/page-header";
import { Card } from "@/components/ui/card";
import { Empty, fmtDateTime, Pager, recordLink, rowCls, tableHead, td, tdr, th, thr } from "@/components/analytics/ui";
import { MOVEMENT_LABELS } from "@/lib/validation/inventory";

export const metadata: Metadata = { title: "Stock movements" };
type SearchParams = Promise<Record<string, string | string[] | undefined>>;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
const control = "min-h-11 w-full rounded-sm border border-line-strong bg-white px-3 text-sm text-ink";

export default async function MovementsPage({ searchParams }: { searchParams: SearchParams }) {
  const ctx = await requireAccess();
  const sp = await searchParams;
  const r = await listMovements(ctx, { type: first(sp.type), location: first(sp.location), page: first(sp.page) });
  const href = (page: number) =>
    `/inventory/movements?${new URLSearchParams({ ...(r.type ? { type: r.type } : {}), ...(r.location ? { location: r.location } : {}), page: String(page) })}`;
  return (
    <>
      <PageHeader
        title="Stock movements"
        description="Every change in stock in your hospitals' stores, newest first. Movements are never edited or deleted."
      />
      <Card>
        <form
          method="get"
          action="/inventory/movements"
          className="grid gap-3 md:grid-cols-[1fr_1fr_auto] md:items-end"
          aria-label="Filter movements"
        >
          <div>
            <label htmlFor="type" className="text-sm font-semibold">
              Movement
            </label>
            <select id="type" name="type" defaultValue={r.type ?? ""} className={`${control} mt-1.5`}>
              <option value="">All movements</option>
              {Object.entries(MOVEMENT_LABELS).map(([k, l]) => (
                <option key={k} value={k}>
                  {l}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="location" className="text-sm font-semibold">
              Store
            </label>
            <select id="location" name="location" defaultValue={r.location ?? ""} className={`${control} mt-1.5`}>
              <option value="">All my stores</option>
              {r.stores.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.code} — {s.name}
                </option>
              ))}
            </select>
          </div>
          <button
            type="submit"
            className="text-navy-900 inline-flex min-h-11 items-center rounded-md border border-teal-400 bg-teal-400 px-4 text-sm font-semibold"
          >
            Show
          </button>
        </form>
        {r.rows.length === 0 ? (
          <Empty>No movements recorded.</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <caption className="sr-only">Stock movements</caption>
              <thead className={tableHead}>
                <tr>
                  <th className={th}>When</th>
                  <th className={th}>Part</th>
                  <th className={th}>Movement</th>
                  <th className={th}>Store / lot</th>
                  <th className={thr}>Quantity</th>
                  <th className={thr}>Balance after</th>
                  <th className={th}>Reference / reason</th>
                  <th className={th}>By</th>
                </tr>
              </thead>
              <tbody>
                {r.rows.map((m) => (
                  <tr key={m.id} className={rowCls}>
                    <td className={td}>{fmtDateTime(m.createdAt)}</td>
                    <td className={td}>
                      <Link href={`/inventory/parts/${m.part.id}`} className={`${recordLink} font-mono`}>
                        {m.part.partNumber}
                      </Link>
                      <div className="text-xs">{m.part.name}</div>
                    </td>
                    <td className={td}>
                      {MOVEMENT_LABELS[m.type]}
                      {m.workOrder ? (
                        <>
                          {" "}
                          <Link href={`/work-orders/${m.workOrder.id}`} className={recordLink}>
                            {m.workOrder.number}
                          </Link>
                        </>
                      ) : null}
                    </td>
                    <td className={td}>
                      {m.location.code}
                      {m.lotNumber ? ` / ${m.lotNumber}` : ""}
                    </td>
                    <td className={`${tdr} font-semibold`}>{m.quantity > 0 ? `+${m.quantity}` : m.quantity}</td>
                    <td className={tdr}>{m.balanceAfter}</td>
                    <td className={`${td} max-w-xs`}>{[m.reference, m.reason].filter(Boolean).join(" · ") || "—"}</td>
                    <td className={td}>{r.names[m.performedById] ?? "Unknown"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <Pager page={r.page} pageCount={r.pageCount} href={href} />
      </Card>
    </>
  );
}
