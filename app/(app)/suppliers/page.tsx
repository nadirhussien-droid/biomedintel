import type { Metadata } from "next";
import Link from "next/link";
import { requireAccess } from "@/server/auth/session";
import { can } from "@/server/authz/access";
import { listSuppliers } from "@/server/services/suppliers";
import { PageHeader } from "@/components/shell/page-header";
import { Card } from "@/components/ui/card";
import { Empty, recordLink, rowCls, tableHead, td, tdr, th, thr } from "@/components/analytics/ui";
import { SUPPLIER_KIND_LABELS } from "@/lib/validation/inventory";

export const metadata: Metadata = { title: "Suppliers" };
type SearchParams = Promise<Record<string, string | string[] | undefined>>;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
const control = "min-h-11 w-full rounded-sm border border-line-strong bg-white px-3 text-sm text-ink";

export default async function SuppliersPage({ searchParams }: { searchParams: SearchParams }) {
  const ctx = await requireAccess();
  if (!can(ctx, "supplier.view")) {
    return (
      <Card>
        <p className="text-sm">
          Your role does not include the supplier register.{" "}
          <Link href="/suppliers/warranties" className={recordLink}>
            Open warranties and contracts
          </Link>
          .
        </p>
      </Card>
    );
  }
  const sp = await searchParams;
  const r = await listSuppliers(ctx, { q: first(sp.q), archived: first(sp.archived) });
  return (
    <>
      <PageHeader
        title="Suppliers and service providers"
        description="Manufacturers, distributors, parts suppliers and service companies your organisation deals with. Contact details are business contacts only."
        actions={
          can(ctx, "supplier.manage") ? (
            <Link
              href="/suppliers/new"
              className="text-navy-900 inline-flex min-h-11 items-center rounded-md border border-teal-400 bg-teal-400 px-4 text-sm font-semibold"
            >
              Add supplier
            </Link>
          ) : null
        }
      />
      <Card>
        <form
          method="get"
          action="/suppliers"
          className="grid gap-3 md:grid-cols-[2fr_1fr_auto] md:items-end"
          aria-label="Search suppliers"
        >
          <div>
            <label htmlFor="q" className="text-sm font-semibold">
              Search
            </label>
            <input
              id="q"
              name="q"
              defaultValue={r.q}
              placeholder="Name, contact or category"
              className={`${control} mt-1.5`}
            />
          </div>
          <div>
            <label htmlFor="archived" className="text-sm font-semibold">
              Show
            </label>
            <select id="archived" name="archived" defaultValue={r.archived ? "1" : ""} className={`${control} mt-1.5`}>
              <option value="">Active suppliers</option>
              <option value="1">Archived suppliers</option>
            </select>
          </div>
          <button
            type="submit"
            className="text-navy-900 inline-flex min-h-11 items-center rounded-md border border-teal-400 bg-teal-400 px-4 text-sm font-semibold"
          >
            Show
          </button>
        </form>
        {r.suppliers.length === 0 ? (
          <Empty>No suppliers {r.q ? "match your search" : "recorded yet"}.</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <caption className="sr-only">Suppliers</caption>
              <thead className={tableHead}>
                <tr>
                  <th className={th}>Supplier</th>
                  <th className={th}>Type</th>
                  <th className={th}>Contact</th>
                  <th className={th}>Manufacturers supported</th>
                  <th className={thr}>Active service contracts</th>
                </tr>
              </thead>
              <tbody>
                {r.suppliers.map((s) => (
                  <tr key={s.id} className={rowCls}>
                    <td className={td}>
                      <Link href={`/suppliers/${s.id}`} className={recordLink}>
                        {s.name}
                      </Link>
                      {s.serviceCategories.length ? (
                        <div className="text-ink-muted text-xs">{s.serviceCategories.join(", ")}</div>
                      ) : null}
                    </td>
                    <td className={td}>{s.kinds.map((k) => SUPPLIER_KIND_LABELS[k]).join(", ")}</td>
                    <td className={td}>{[s.contactName, s.phone, s.email].filter(Boolean).join(" · ") || "—"}</td>
                    <td className={td}>{s.manufacturers.join(", ") || "—"}</td>
                    <td className={tdr}>{s.activeContracts}</td>
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
