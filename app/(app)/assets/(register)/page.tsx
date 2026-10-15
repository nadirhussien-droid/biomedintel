import type { Metadata } from "next";
import Link from "next/link";
import { requireAccess } from "@/server/auth/session";
import { can } from "@/server/authz/access";
import { getRegisterFilterOptions, listAssets, listPendingDecommissions } from "@/server/services/assets";
import { Card, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/shell/page-header";
import { RiskBadge, StatusBadge } from "@/components/assets/status-badge";
import { ASSET_STATUSES, RISK_CLASSES, RISK_LABELS, STATUS_LABELS } from "@/lib/validation/assets";
import { DecisionForm } from "../[assetId]/detail-forms";

export const metadata: Metadata = { title: "Equipment Assets" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const SORT_LABELS = {
  assetTag: "Asset ID",
  name: "Name",
  status: "Status",
  updatedAt: "Last updated",
  createdAt: "Date registered",
} as const;

const selectClass = "min-h-11 w-full rounded-sm border border-line-strong bg-white px-3 text-sm text-ink";
const linkButton =
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-md border px-4 text-sm font-semibold transition-colors";

function first(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

export default async function AssetRegisterPage({ searchParams }: { searchParams: SearchParams }) {
  const ctx = await requireAccess();
  const sp = await searchParams;
  const raw: Record<string, string | undefined> = {};
  for (const key of [
    "q",
    "hospital",
    "department",
    "category",
    "manufacturer",
    "status",
    "risk",
    "archived",
    "sort",
    "dir",
    "page",
  ]) {
    raw[key] = first(sp[key]);
  }
  // The header's hospital/department choice is the default filter; "all" clears it.
  if (raw.hospital === undefined && ctx.selection.hospitalId) raw.hospital = ctx.selection.hospitalId;
  if (raw.department === undefined && ctx.selection.departmentId) raw.department = ctx.selection.departmentId;

  const [result, options, pending] = await Promise.all([
    listAssets(ctx, raw),
    getRegisterFilterOptions(ctx),
    listPendingDecommissions(ctx),
  ]);
  const q = result.query;
  const canPrint = can(ctx, "asset.labelPrint");

  const params = (overrides: Record<string, string | number | undefined>) => {
    const p = new URLSearchParams();
    const merged: Record<string, string | number | undefined> = {
      q: q.q,
      // "all" (rather than nothing) so the header's default selection is not re-applied.
      hospital: q.hospital ?? "all",
      department: q.department ?? "all",
      category: q.category,
      manufacturer: q.manufacturer,
      status: q.status,
      risk: q.risk,
      archived: q.archived === "exclude" ? undefined : q.archived,
      sort: q.sort === "assetTag" ? undefined : q.sort,
      dir: q.dir === "asc" ? undefined : q.dir,
      page: q.page,
      ...overrides,
    };
    for (const [k, v] of Object.entries(merged))
      if (v !== undefined && v !== "" && !(k === "page" && v === 1)) p.set(k, String(v));
    const s = p.toString();
    return s ? `/assets?${s}` : "/assets";
  };

  const from = result.total === 0 ? 0 : (result.page - 1) * result.pageSize + 1;
  const to = Math.min(result.page * result.pageSize, result.total);
  const departments = q.hospital ? options.departments.filter((d) => d.hospitalId === q.hospital) : options.departments;
  const exportHref = params({ page: undefined }).replace("/assets", "/assets/export");

  return (
    <>
      <PageHeader
        title="Equipment Assets"
        description={`The equipment register for ${ctx.organization.name}. You see assets in your hospitals and departments only.`}
        actions={
          <div className="flex flex-wrap gap-2">
            <Link
              href="/assets/scan"
              className={`${linkButton} border-line-strong text-navy-900 hover:bg-surface-sunken bg-white`}
            >
              Scan barcode
            </Link>
            {can(ctx, "asset.export") ? (
              <a
                href={exportHref}
                className={`${linkButton} border-line-strong text-navy-900 hover:bg-surface-sunken bg-white`}
              >
                Export CSV
              </a>
            ) : null}
            <Link
              href="/assets/catalog"
              className={`${linkButton} border-line-strong text-navy-900 hover:bg-surface-sunken bg-white`}
            >
              Equipment catalog
            </Link>
            {can(ctx, "asset.create") ? (
              <Link
                href="/assets/new"
                className={`${linkButton} text-navy-900 border-teal-400 bg-teal-400 hover:bg-teal-500`}
              >
                Register asset
              </Link>
            ) : null}
          </div>
        }
      />

      {pending.length ? (
        <Card>
          <CardTitle>Decommissioning requests waiting for your approval</CardTitle>
          <ul className="flex flex-col gap-4">
            {pending.map((p) => (
              <li key={p.id} className="border-line rounded-md border p-4">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <Link href={`/assets/${p.asset.id}`} className="font-semibold text-teal-700 hover:underline">
                    {p.asset.assetTag} · {p.asset.name}
                  </Link>
                  <span className="text-ink-muted text-xs">
                    {p.asset.department.name} · requested by {p.requestedBy}
                  </span>
                </div>
                <p className="mt-1 text-sm">{p.reason}</p>
                <DecisionForm requestId={p.id} />
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      <Card>
        <form
          method="get"
          action="/assets"
          className="grid gap-3 md:grid-cols-4"
          role="search"
          aria-label="Search and filter assets"
        >
          <div className="md:col-span-2">
            <label htmlFor="q" className="text-ink text-sm font-semibold">
              Search
            </label>
            <input
              id="q"
              name="q"
              type="search"
              defaultValue={q.q ?? ""}
              maxLength={80}
              placeholder="Asset ID, name, manufacturer, model, serial or inventory number"
              className={`${selectClass} mt-1.5`}
            />
          </div>
          <Filter label="Hospital" name="hospital" value={q.hospital ?? "all"}>
            <option value="all">All my hospitals</option>
            {options.hospitals.map((h) => (
              <option key={h.id} value={h.id}>
                {h.name}
              </option>
            ))}
          </Filter>
          <Filter label="Department" name="department" value={q.department ?? "all"}>
            <option value="all">All departments</option>
            {departments.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </Filter>
          <Filter label="Category" name="category" value={q.category ?? ""}>
            <option value="">All categories</option>
            {options.categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Filter>
          <Filter label="Manufacturer" name="manufacturer" value={q.manufacturer ?? ""}>
            <option value="">All manufacturers</option>
            {options.manufacturers.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </Filter>
          <Filter label="Status" name="status" value={q.status ?? ""}>
            <option value="">All statuses</option>
            {ASSET_STATUSES.map((s) => (
              <option key={s} value={s}>
                {STATUS_LABELS[s]}
              </option>
            ))}
          </Filter>
          <Filter label="Risk" name="risk" value={q.risk ?? ""}>
            <option value="">Any risk</option>
            {RISK_CLASSES.map((r) => (
              <option key={r} value={r}>
                {RISK_LABELS[r]}
              </option>
            ))}
          </Filter>
          <Filter label="Archived" name="archived" value={q.archived}>
            <option value="exclude">Hide archived</option>
            <option value="include">Include archived</option>
            <option value="only">Archived only</option>
          </Filter>
          <Filter label="Sort by" name="sort" value={q.sort}>
            {Object.entries(SORT_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </Filter>
          <Filter label="Order" name="dir" value={q.dir}>
            <option value="asc">Ascending</option>
            <option value="desc">Descending</option>
          </Filter>
          <div className="flex items-end gap-2">
            <button
              type="submit"
              className={`${linkButton} text-navy-900 border-teal-400 bg-teal-400 hover:bg-teal-500`}
            >
              Apply
            </button>
            <Link
              href="/assets?hospital=all&department=all"
              className={`${linkButton} hover:bg-surface-sunken border-transparent text-teal-700`}
            >
              Reset
            </Link>
          </div>
        </form>
      </Card>

      <Card>
        <CardTitle
          action={
            <span className="text-ink-muted text-sm" aria-live="polite">
              {result.total === 0 ? "No assets" : `Showing ${from}–${to} of ${result.total}`}
            </span>
          }
        >
          Register
        </CardTitle>

        {result.total === 0 ? (
          <div className="bg-surface rounded-md px-4 py-10 text-center">
            <p className="font-semibold">No equipment matches these filters.</p>
            <p className="text-ink-muted mt-1 text-sm">
              Try clearing the search or filters
              {can(ctx, "asset.create") ? (
                <>
                  , or{" "}
                  <Link href="/assets/new" className="font-semibold text-teal-700 hover:underline">
                    register a new asset
                  </Link>
                </>
              ) : null}
              .
            </p>
          </div>
        ) : (
          <form method="get" action="/assets/labels" className="flex flex-col gap-3">
            {canPrint ? (
              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="submit"
                  className={`${linkButton} border-line-strong text-navy-900 hover:bg-surface-sunken bg-white`}
                >
                  Print labels for selected
                </button>
                <span className="text-ink-muted text-xs">Tick assets below, then print. Up to 100 at a time.</span>
              </div>
            ) : null}
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="bg-surface-sunken text-ink-muted text-left text-xs tracking-wide uppercase">
                    {canPrint ? (
                      <th scope="col" className="w-10 px-3 py-2">
                        <span className="sr-only">Select for labels</span>
                      </th>
                    ) : null}
                    <th scope="col" className="px-3 py-2">
                      Asset ID
                    </th>
                    <th scope="col" className="px-3 py-2">
                      Name and model
                    </th>
                    <th scope="col" className="hidden px-3 py-2 md:table-cell">
                      Serial
                    </th>
                    <th scope="col" className="px-3 py-2">
                      Location
                    </th>
                    <th scope="col" className="px-3 py-2">
                      Status
                    </th>
                    <th scope="col" className="hidden px-3 py-2 sm:table-cell">
                      Risk
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {result.rows.map((a) => (
                    <tr key={a.id} className="border-line border-b align-top">
                      {canPrint ? (
                        <td className="px-3 py-2.5">
                          <input
                            type="checkbox"
                            name="id"
                            value={a.id}
                            aria-label={`Select ${a.assetTag} for label printing`}
                            className="size-4 accent-teal-700"
                            disabled={a.archivedAt !== null}
                          />
                        </td>
                      ) : null}
                      <td className="px-3 py-2.5 font-mono font-semibold whitespace-nowrap">
                        <Link href={`/assets/${a.id}`} className="text-teal-700 hover:underline">
                          {a.assetTag}
                        </Link>
                      </td>
                      <td className="px-3 py-2.5">
                        <div className="font-medium">{a.name}</div>
                        <div className="text-ink-muted text-xs">
                          {a.model.manufacturer.name} {a.model.modelName} · {a.model.category.name}
                        </div>
                      </td>
                      <td className="text-ink-muted hidden px-3 py-2.5 font-mono text-xs whitespace-nowrap md:table-cell">
                        {a.serialNumber ?? "—"}
                      </td>
                      <td className="px-3 py-2.5">
                        <div>{a.department.name}</div>
                        <div className="text-ink-muted text-xs">
                          {a.hospital.code}
                          {a.location ? ` · ${a.location.name}` : ""}
                        </div>
                      </td>
                      <td className="px-3 py-2.5">
                        <StatusBadge status={a.status} archived={a.archivedAt !== null} />
                      </td>
                      <td className="hidden px-3 py-2.5 sm:table-cell">
                        <RiskBadge risk={a.riskClass} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </form>
        )}

        {result.pageCount > 1 ? (
          <nav aria-label="Pages" className="flex flex-wrap items-center justify-between gap-3 text-sm">
            <span className="text-ink-muted">
              Page {result.page} of {result.pageCount}
            </span>
            <div className="flex gap-2">
              {result.page > 1 ? (
                <Link href={params({ page: result.page - 1 })} className={`${linkButton} border-line-strong bg-white`}>
                  Previous
                </Link>
              ) : null}
              {result.page < result.pageCount ? (
                <Link href={params({ page: result.page + 1 })} className={`${linkButton} border-line-strong bg-white`}>
                  Next
                </Link>
              ) : null}
            </div>
          </nav>
        ) : null}
      </Card>
    </>
  );
}

function Filter({
  label,
  name,
  value,
  children,
}: {
  label: string;
  name: string;
  value: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label htmlFor={`f-${name}`} className="text-ink text-sm font-semibold">
        {label}
      </label>
      <select id={`f-${name}`} name={name} defaultValue={value} className={`${selectClass} mt-1.5`}>
        {children}
      </select>
    </div>
  );
}
