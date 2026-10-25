import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireAccess } from "@/server/auth/session";
import { can } from "@/server/authz/access";
import { NotFoundError } from "@/server/authz/errors";
import { findPartByCode, listParts, listStores } from "@/server/services/inventory";
import { PageHeader } from "@/components/shell/page-header";
import { Card } from "@/components/ui/card";
import { ClosedList } from "@/components/ui/closed-list";
import { Empty, Pager, recordLink, rowCls, tableHead, td, tdr, th, thr } from "@/components/analytics/ui";
import { StockTag } from "@/components/stage8/badges";
import { INVENTORY_VIEW_LABELS, INVENTORY_VIEWS, STOCK_UNIT_LABELS } from "@/lib/validation/inventory";

export const metadata: Metadata = { title: "Spare Parts Inventory" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
const control = "min-h-11 w-full rounded-sm border border-line-strong bg-white px-3 text-sm text-ink";
const linkButton = "inline-flex min-h-11 items-center justify-center rounded-md border px-4 text-sm font-semibold";

export default async function InventoryPage({ searchParams }: { searchParams: SearchParams }) {
  const ctx = await requireAccess();
  const sp = await searchParams;
  // Barcode / typed look-up: a handheld scanner types the code and presses Enter.
  const code = first(sp.code)?.trim();
  let lookupMessage: string | null = null;
  if (code) {
    const found = await findPartByCode(ctx, code);
    if (found.kind === "part") redirect(`/inventory/parts/${found.partId}`);
    lookupMessage =
      found.kind === "archived"
        ? `Part ${found.partNumber} is archived (no longer stocked).`
        : found.kind === "several"
          ? `Several parts have manufacturer number "${code}": ${found.parts.map((p) => p.partNumber).join(", ")}. Scan or type the internal part number.`
          : `No part with the number "${code}" in your organisation's catalogue.`;
  }
  const raw: Record<string, string | undefined> = {};
  for (const k of ["view", "q", "location", "sort", "dir", "page"]) raw[k] = first(sp[k]);
  // The list stays closed until someone searches, picks a view or filter, or asks for the full list.
  const open = first(sp.all) === "1" || ["view", "q", "location", "sort", "dir", "page"].some((k) => first(sp[k]));
  let data;
  try {
    data = await Promise.all([listParts(ctx, raw), listStores(ctx)]);
  } catch (e) {
    if (e instanceof NotFoundError) notFound();
    throw e;
  }
  const [r, stores] = data;
  const q = r.query;
  const href = (over: Record<string, string | number | undefined>) => {
    const p = new URLSearchParams();
    const merged = {
      view: q.view,
      q: q.q ?? undefined,
      location: q.location ?? undefined,
      sort: q.sort,
      dir: q.dir,
      page: q.page,
      ...over,
    };
    for (const [k, v] of Object.entries(merged))
      if (v !== undefined && v !== "" && !(k === "page" && v === 1)) p.set(k, String(v));
    return `/inventory?${p.toString()}`;
  };
  return (
    <>
      <PageHeader
        title="Spare Parts Inventory"
        description="Parts in your hospitals' stores. Available = usable stock (not expired) minus what is reserved for work orders. Every change in stock is a recorded movement."
        actions={
          can(ctx, "inventory.manage") ? (
            <Link href="/inventory/parts/new" className={`${linkButton} text-navy-900 border-teal-400 bg-teal-400`}>
              Add part
            </Link>
          ) : null
        }
      />
      <Card>
        <form
          method="get"
          action="/inventory"
          className="grid gap-3 md:grid-cols-[2fr_auto] md:items-end"
          aria-label="Find a part by barcode or number"
        >
          <div>
            <label htmlFor="code" className="text-sm font-semibold">
              Scan or type a part number
            </label>
            <input
              id="code"
              name="code"
              autoComplete="off"
              placeholder="e.g. BAT-0001 — a USB or Bluetooth scanner types it for you"
              className={`${control} mt-1.5 font-mono`}
            />
          </div>
          <button type="submit" className={`${linkButton} border-line-strong text-navy-900 bg-white`}>
            Open part
          </button>
        </form>
        {lookupMessage ? (
          <p role="alert" className="text-danger text-sm font-medium">
            {lookupMessage}
          </p>
        ) : null}
      </Card>
      <nav aria-label="Inventory views" className="flex flex-wrap gap-2">
        {INVENTORY_VIEWS.map((v) => (
          <Link
            key={v}
            href={href({ view: v, page: 1 })}
            aria-current={q.view === v ? "page" : undefined}
            className={`rounded-full border px-3 py-1.5 text-sm font-semibold ${q.view === v ? "bg-navy-900 border-navy-900 text-white" : "border-line-strong bg-white"}`}
          >
            {INVENTORY_VIEW_LABELS[v]}
          </Link>
        ))}
      </nav>
      <Card>
        <form
          method="get"
          action="/inventory"
          className="grid gap-3 md:grid-cols-[2fr_1.5fr_1fr_1fr_auto] md:items-end"
          aria-label="Filter parts"
        >
          <input type="hidden" name="view" value={q.view} />
          <div>
            <label htmlFor="q" className="text-sm font-semibold">
              Search
            </label>
            <input
              id="q"
              name="q"
              defaultValue={q.q ?? ""}
              placeholder="Part number, name or manufacturer number"
              className={`${control} mt-1.5`}
            />
          </div>
          <div>
            <label htmlFor="location" className="text-sm font-semibold">
              Store
            </label>
            <select id="location" name="location" defaultValue={q.location ?? ""} className={`${control} mt-1.5`}>
              <option value="">All my stores</option>
              {stores.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.hospital.code} · {s.code} — {s.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="sort" className="text-sm font-semibold">
              Sort by
            </label>
            <select id="sort" name="sort" defaultValue={q.sort} className={`${control} mt-1.5`}>
              <option value="partNumber">Part number</option>
              <option value="name">Name</option>
              <option value="available">Available</option>
            </select>
          </div>
          <div>
            <label htmlFor="dir" className="text-sm font-semibold">
              Order
            </label>
            <select id="dir" name="dir" defaultValue={q.dir} className={`${control} mt-1.5`}>
              <option value="asc">Ascending</option>
              <option value="desc">Descending</option>
            </select>
          </div>
          <button type="submit" className={`${linkButton} text-navy-900 border-teal-400 bg-teal-400`}>
            Show
          </button>
        </form>
        {!open ? (
          <ClosedList
            title="Search or choose a view to see parts."
            detail={`Your stores hold ${r.total} ${r.total === 1 ? "part" : "parts"}. Type a part number or name above, pick a view such as Low stock, or`}
            showAllHref="/inventory?all=1"
          />
        ) : r.parts.length === 0 ? (
          <Empty>
            {stores.length === 0
              ? "No stores yet. An Inventory Manager or Engineering Manager adds stores under Stores, then parts and initial stock."
              : "No parts match this view."}
          </Empty>
        ) : (
          <div
            className="overflow-x-auto"
            tabIndex={0}
            role="region"
            aria-label="Table (scroll sideways on small screens)"
          >
            <table className="w-full text-sm">
              <caption className="sr-only">Spare parts — {INVENTORY_VIEW_LABELS[q.view]}</caption>
              <thead className={tableHead}>
                <tr>
                  <th className={th}>Part</th>
                  <th className={thr}>On hand</th>
                  <th className={thr}>Reserved</th>
                  <th className={thr}>Available</th>
                  <th className={thr}>Minimum</th>
                  <th className={th}>Status</th>
                  <th className={th}>Reorder suggestion</th>
                </tr>
              </thead>
              <tbody>
                {r.parts.map((p) => (
                  <tr key={p.id} className={rowCls}>
                    <td className={td}>
                      <Link href={`/inventory/parts/${p.id}`} className={`${recordLink} font-mono`}>
                        {p.partNumber}
                      </Link>
                      <div>{p.name}</div>
                      <div className="text-ink-muted text-xs">
                        {[p.manufacturer, p.manufacturerPartNumber && `MPN ${p.manufacturerPartNumber}`]
                          .filter(Boolean)
                          .join(" · ")}
                      </div>
                    </td>
                    <td className={tdr}>
                      {p.onHand} {STOCK_UNIT_LABELS[p.unit as keyof typeof STOCK_UNIT_LABELS]}
                      {p.expired ? <div className="text-danger text-xs">{p.expired} expired</div> : null}
                    </td>
                    <td className={tdr}>{p.reserved}</td>
                    <td className={`${tdr} font-semibold`}>{Math.max(0, p.available)}</td>
                    <td className={tdr}>{p.minLevel}</td>
                    <td className={td}>
                      {p.status === "ARCHIVED" ? "Archived" : <StockTag state={p.stockState} />}
                      {p.expiring > p.expired ? (
                        <div className="text-warn mt-1 text-xs">Some stock expires by {r.warnUntil}</div>
                      ) : null}
                    </td>
                    <td className={td}>
                      {p.suggestedReorder === null ? (
                        <span className="text-ink-muted text-xs">
                          {p.stockState === "ok" ? "—" : "No target level set"}
                        </span>
                      ) : (
                        <span className="text-xs">
                          <strong>{p.suggestedReorder}</strong> (target {p.targetLevel} − available{" "}
                          {Math.max(0, p.available)} − already requested {p.onOrder})
                          {can(ctx, "purchase.request") && p.suggestedReorder > 0 ? (
                            <>
                              {" "}
                              <Link
                                href={`/inventory/purchasing/new?part=${p.id}&qty=${p.suggestedReorder}`}
                                className={recordLink}
                              >
                                Request more
                              </Link>
                            </>
                          ) : null}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {open ? <Pager page={q.page} pageCount={r.pageCount} href={(page) => href({ page })} /> : null}
        <p className="text-ink-muted text-xs">
          {r.total} part{r.total === 1 ? "" : "s"}. Low stock = available at or below the minimum; out of stock =
          nothing available. Figures cover {q.location ? "the selected store" : "all stores in your hospitals"}. A
          suggestion is only a starting point: nothing is ordered automatically.
        </p>
      </Card>
    </>
  );
}
