import type { Metadata } from "next";
import Link from "next/link";
import { requireAccess } from "@/server/auth/session";
import { can } from "@/server/authz/access";
import { listWarranties, WARRANTY_VIEWS, type WarrantyView } from "@/server/services/warranties";
import { PageHeader } from "@/components/shell/page-header";
import { Card } from "@/components/ui/card";
import { Empty, fmtDate, Pager, recordLink, rowCls, tableHead, td, th } from "@/components/analytics/ui";
import { ClaimTag, recorded, WarrantyTag } from "@/components/stage8/badges";

export const metadata: Metadata = { title: "Warranties and contracts" };
type SearchParams = Promise<Record<string, string | string[] | undefined>>;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

const VIEW_LABELS: Record<WarrantyView, string> = {
  expiring: "Expiring soon",
  active: "Active",
  expired: "Expired",
  missing: "No warranty or contract recorded",
  contracts: "Service contracts in force",
  claims: "Open claims",
};

export default async function WarrantiesPage({ searchParams }: { searchParams: SearchParams }) {
  const ctx = await requireAccess();
  if (!can(ctx, "warranty.view")) {
    return (
      <Card>
        <p className="text-sm">Your role does not include warranty records.</p>
      </Card>
    );
  }
  const sp = await searchParams;
  const r = await listWarranties(ctx, { view: first(sp.view), page: first(sp.page) });
  const count = (v: WarrantyView) => r.counts[v];
  return (
    <>
      <PageHeader
        title="Warranties and service contracts"
        description={`State comes only from the recorded dates (expiring = ends within ${r.warnDays} days, the largest reminder setting). Whether a particular repair is covered is decided by the supplier, never assumed here.`}
      />
      <nav aria-label="Warranty views" className="flex flex-wrap gap-2">
        {WARRANTY_VIEWS.map((v) => (
          <Link
            key={v}
            href={`/suppliers/warranties?view=${v}`}
            aria-current={r.view === v ? "page" : undefined}
            className={`rounded-full border px-3 py-1.5 text-sm font-semibold ${r.view === v ? "bg-navy-900 border-navy-900 text-white" : "border-line-strong bg-white"}`}
          >
            {VIEW_LABELS[v]} ({count(v)})
          </Link>
        ))}
      </nav>
      <Card>
        {r.view === "missing" ? (
          r.missing.length === 0 ? (
            <Empty>Every asset in use has a warranty or contract recorded.</Empty>
          ) : (
            <>
              <p className="text-ink-muted text-xs">
                Assets in use (not decommissioned) with no warranty or service contract on record. This may simply mean
                none was entered.
              </p>
              <ul className="divide-line divide-y text-sm">
                {r.missing.map((a) => (
                  <li key={a.id} className="py-2">
                    <Link href={`/assets/${a.id}#warranty`} className={recordLink}>
                      {a.assetTag}
                    </Link>{" "}
                    {a.name} · {a.hospital.code}
                  </li>
                ))}
              </ul>
            </>
          )
        ) : r.view === "claims" ? (
          r.claims.filter((c) => c.status === "DRAFT" || c.status === "SUBMITTED").length === 0 ? (
            <Empty>No open claims.</Empty>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <caption className="sr-only">Open warranty claims</caption>
                <thead className={tableHead}>
                  <tr>
                    <th className={th}>Asset</th>
                    <th className={th}>Warranty</th>
                    <th className={th}>Claim</th>
                    <th className={th}>Submitted</th>
                    <th className={th}>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {r.claims
                    .filter((c) => c.status === "DRAFT" || c.status === "SUBMITTED")
                    .map((c) => (
                      <tr key={c.id} className={rowCls}>
                        <td className={td}>
                          <Link href={`/assets/${c.asset.id}#warranty`} className={recordLink}>
                            {c.asset.assetTag}
                          </Link>
                        </td>
                        <td className={td}>{c.warranty.provider}</td>
                        <td className={td}>
                          {c.claimReference ?? "No reference yet"}
                          <div className="text-ink-muted text-xs">{c.description}</div>
                        </td>
                        <td className={td}>{fmtDate(c.submittedOn)}</td>
                        <td className={td}>
                          <ClaimTag status={c.status} />
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          )
        ) : r.rows.length === 0 ? (
          <Empty>None in this view.</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <caption className="sr-only">{VIEW_LABELS[r.view]}</caption>
              <thead className={tableHead}>
                <tr>
                  <th className={th}>Asset</th>
                  <th className={th}>Type and provider</th>
                  <th className={th}>Period</th>
                  <th className={th}>Parts / labour (as recorded)</th>
                  <th className={th}>State</th>
                </tr>
              </thead>
              <tbody>
                {r.rows.map((w) => (
                  <tr key={w.id} className={rowCls}>
                    <td className={td}>
                      <Link href={`/assets/${w.asset.id}#warranty`} className={recordLink}>
                        {w.asset.assetTag}
                      </Link>{" "}
                      {w.asset.name} · {w.asset.hospital.code}
                    </td>
                    <td className={td}>
                      {w.kind === "WARRANTY" ? "Warranty" : "Service contract"} ·{" "}
                      {w.supplier ? (
                        <Link href={`/suppliers/${w.supplier.id}`} className={recordLink}>
                          {w.supplier.name}
                        </Link>
                      ) : (
                        w.provider
                      )}
                      {w.reference ? <div className="text-ink-muted text-xs">Ref. {w.reference}</div> : null}
                      {w.responseTargetHours ? (
                        <div className="text-ink-muted text-xs">
                          Response target {w.responseTargetHours} h (as contracted)
                        </div>
                      ) : null}
                    </td>
                    <td className={td}>
                      {fmtDate(w.startsOn)} – {fmtDate(w.endsOn)}
                    </td>
                    <td className={td}>
                      Parts: {recorded(w.coversParts)}
                      <br />
                      Labour: {recorded(w.coversLabour)}
                    </td>
                    <td className={td}>
                      <WarrantyTag state={w.state} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <Pager
          page={r.page}
          pageCount={r.pageCount}
          href={(page) => `/suppliers/warranties?view=${r.view}&page=${page}`}
        />
      </Card>
    </>
  );
}
