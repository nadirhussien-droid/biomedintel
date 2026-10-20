import type { Metadata } from "next";
import Link from "next/link";
import { requireAccess } from "@/server/auth/session";
import { can } from "@/server/authz/access";
import { listSessions } from "@/server/services/troubleshooting";
import { aiConfig } from "@/server/ai/provider";
import { PageHeader } from "@/components/shell/page-header";
import { Card, CardTitle } from "@/components/ui/card";
import { InputField } from "@/components/ui/field";
import { ActionForm } from "@/components/forms/action-form";
import { Empty, Pager, fmtDateTime, recordLink, rowCls, tableHead, td, th } from "@/components/analytics/ui";
import { SessionTag } from "@/components/stage9/tags";
import { findAssetAction } from "./actions";

export const metadata: Metadata = { title: "IntellAssist" };
type SearchParams = Promise<Record<string, string | string[] | undefined>>;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
const tab = "rounded-md border px-3 py-2 text-sm font-semibold";

export default async function AssistPage({ searchParams }: { searchParams: SearchParams }) {
  const ctx = await requireAccess();
  const sp = await searchParams;
  if (!can(ctx, "troubleshoot.view")) {
    return (
      <Card>
        <p className="text-sm">
          You can manage the AI setting on the{" "}
          <Link href="/assist/settings" className={recordLink}>
            IntellAssist settings
          </Link>{" "}
          page.
        </p>
      </Card>
    );
  }
  const r = await listSessions(ctx, { status: first(sp.status), mine: first(sp.mine), page: first(sp.page) });
  const config = aiConfig();
  const href = (o: Record<string, string>) =>
    `/assist?${new URLSearchParams({ status: r.q.status, ...(r.q.mine ? { mine: "1" } : {}), ...o }).toString()}`;
  return (
    <>
      <PageHeader
        title="IntellAssist troubleshooting"
        description="Structured troubleshooting linked to equipment and work orders. AI suggestions are advisory: they never change a device, a work order or a safety decision."
        actions={
          can(ctx, "ai.usage") || can(ctx, "ai.settings") ? (
            <Link
              href="/assist/settings"
              className="border-line-strong inline-flex min-h-11 items-center rounded-md border bg-white px-4 text-sm font-semibold"
            >
              AI settings and usage
            </Link>
          ) : null
        }
      />
      {can(ctx, "troubleshoot.work") ? (
        <Card>
          <CardTitle>Start troubleshooting</CardTitle>
          <ActionForm
            action={findAssetAction}
            label="Continue"
            className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end"
          >
            <InputField
              label="Scan or type the asset ID"
              name="code"
              id="ts-code"
              autoComplete="off"
              placeholder="e.g. VEN-0001 — a USB or Bluetooth scanner types it for you"
              className="font-mono"
              required
            />
          </ActionForm>
          <p className="text-ink-muted text-xs">
            You can also start from an asset page or a work order. Do not enter patient information.
          </p>
          <p className="text-ink-muted text-xs">
            AI provider:{" "}
            {config.configured
              ? config.provider === "mock"
                ? "Mock AI (testing only — not a real AI)"
                : `${config.provider} · ${config.model}`
              : "not configured"}
            . Manual troubleshooting and the knowledge base work either way.
          </p>
        </Card>
      ) : null}
      <nav aria-label="Session filters" className="flex flex-wrap gap-2">
        {(["open", "resolved", "unresolved", "all"] as const).map((s) => (
          <Link
            key={s}
            href={href({ status: s })}
            aria-current={r.q.status === s ? "page" : undefined}
            className={`${tab} ${r.q.status === s ? "bg-navy-900 border-navy-900 text-white" : "border-line-strong bg-white"}`}
          >
            {s === "open"
              ? "Open"
              : s === "resolved"
                ? "Resolved"
                : s === "unresolved"
                  ? "Closed without cause"
                  : "All"}
          </Link>
        ))}
        <Link
          href={r.q.mine ? `/assist?status=${r.q.status}` : `/assist?status=${r.q.status}&mine=1`}
          className={`${tab} border-line-strong bg-white`}
        >
          {r.q.mine ? "Showing mine — show everyone's" : "Show only mine"}
        </Link>
      </nav>
      <Card>
        <CardTitle>Sessions ({r.total})</CardTitle>
        {r.rows.length === 0 ? (
          <Empty>No troubleshooting sessions here.</Empty>
        ) : (
          <div
            className="overflow-x-auto"
            tabIndex={0}
            role="region"
            aria-label="Table (scroll sideways on small screens)"
          >
            <table className="w-full text-sm">
              <caption className="sr-only">Troubleshooting sessions</caption>
              <thead className={tableHead}>
                <tr>
                  <th className={th}>Session</th>
                  <th className={th}>Device</th>
                  <th className={th}>Fault</th>
                  <th className={th}>Status</th>
                  <th className={th}>Started</th>
                  <th className={th}>Last change</th>
                </tr>
              </thead>
              <tbody>
                {r.rows.map((s) => (
                  <tr key={s.id} className={rowCls}>
                    <td className={td}>
                      <Link href={`/assist/${s.id}`} className={`${recordLink} font-mono`}>
                        {s.number}
                      </Link>
                      {s.workOrder ? <div className="text-ink-muted text-xs">{s.workOrder.number}</div> : null}
                    </td>
                    <td className={td}>
                      <span className="font-mono">{s.asset.assetTag}</span> · {s.asset.name}
                    </td>
                    <td className={`${td} max-w-sm`}>
                      {s.faultDescription.slice(0, 140)}
                      {s.errorCodes.length ? (
                        <div className="text-ink-muted font-mono text-xs">{s.errorCodes.join(", ")}</div>
                      ) : null}
                    </td>
                    <td className={td}>
                      <SessionTag status={s.status} />
                    </td>
                    <td className={td}>
                      {fmtDateTime(s.createdAt)}
                      <div className="text-ink-muted text-xs">{r.names[s.startedById] ?? "Unknown"}</div>
                    </td>
                    <td className={td}>{fmtDateTime(s.updatedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <Pager page={r.page} pageCount={r.pageCount} href={(page) => href({ page: String(page) })} />
      </Card>
    </>
  );
}
