// Building blocks for the analytics pages (Stage 7).
//
// Accessibility: every chart is a real table — the bar is decoration
// (aria-hidden) and the number is always written out. A warning is never
// shown by colour alone: it carries an icon AND a word.
import Link from "next/link";
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

export const fmtHours = (v: number | null | undefined) =>
  v === null || v === undefined
    ? "N/A"
    : v < 48
      ? `${Math.round(v * 10) / 10} h`
      : `${Math.round((v / 24) * 10) / 10} days`;
export const fmtPct = (v: number | null | undefined) => (v === null || v === undefined ? "N/A" : `${v}%`);
export const fmtInt = (v: number) => v.toLocaleString("en-GB");

const dateFmt = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeZone: "UTC" });
const dateTimeFmt = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" });
export const fmtDate = (d: Date | string | null | undefined) =>
  d ? dateFmt.format(typeof d === "string" ? new Date(d.length === 10 ? `${d}T00:00:00Z` : d) : d) : "—";
export const fmtDateTime = (d: Date | string | null | undefined) =>
  d ? `${dateTimeFmt.format(typeof d === "string" ? new Date(d) : d)} UTC` : "—";

export type Tone = "danger" | "warn" | "ok";

const TONE: Record<Tone, { word: string; className: string; icon: string }> = {
  danger: { word: "Action needed", className: "text-danger bg-danger-bg", icon: "M12 3l9 16H3zM12 10v4M12 17h.01" },
  warn: {
    word: "Review",
    className: "text-warn bg-warn-bg",
    icon: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 8v5M12 16h.01",
  },
  ok: { word: "On target", className: "text-ok bg-ok-bg", icon: "M5 12l4 4 10-10" },
};

/** Icon + word: the status never depends on colour alone. */
export function ToneTag({ tone, children }: { tone: Tone; children?: ReactNode }) {
  const t = TONE[tone];
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-sm px-1.5 py-0.5 text-xs font-semibold", t.className)}>
      <svg
        viewBox="0 0 24 24"
        className="size-3.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.2"
        aria-hidden="true"
      >
        <path d={t.icon} strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      {children ?? t.word}
    </span>
  );
}

export function MetricTile({
  label,
  display,
  definition,
  basis,
  href,
  tone,
}: {
  label: string;
  display: string;
  definition: string;
  basis: "now" | "period";
  href?: string;
  tone?: Tone;
}) {
  const body = (
    <>
      <div className="flex items-start justify-between gap-2">
        <h3 className="text-ink-muted text-sm font-semibold">{label}</h3>
        <span className="text-ink-muted shrink-0 text-[11px] font-semibold tracking-wide uppercase">
          {basis === "now" ? "Right now" : "In period"}
        </span>
      </div>
      <p className="text-ink text-3xl font-bold tracking-tight">{display}</p>
      {tone ? <ToneTag tone={tone} /> : null}
      <p className="text-ink-muted text-xs leading-relaxed">{definition}</p>
    </>
  );
  const cls =
    "border-line flex flex-col gap-2 rounded-md border bg-white p-4 shadow-[0_1px_2px_rgba(16,45,70,0.06)] text-left";
  return href ? (
    <Link href={href} className={cn(cls, "hover:border-teal-400 focus-visible:border-teal-400")} prefetch={false}>
      {body}
      <span className="mt-auto text-xs font-semibold text-teal-700">View records →</span>
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  );
}

/** Horizontal bar chart rendered as a table (numbers always written out). */
export function BarTable({
  caption,
  head,
  rows,
  unit = "",
  max,
}: {
  caption: string;
  head: [string, string];
  rows: { label: ReactNode; value: number | null; display?: string; note?: ReactNode; key: string }[];
  unit?: string;
  max?: number;
}) {
  const top = max ?? Math.max(1, ...rows.map((r) => r.value ?? 0));
  if (!rows.length) return <p className="text-ink-muted text-sm">No records in this period.</p>;
  return (
    <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Table (scroll sideways on small screens)">
      <table className="w-full text-sm">
        <caption className="sr-only">{caption}</caption>
        <thead className="text-ink-muted text-left text-xs uppercase">
          <tr>
            <th className="py-2 pr-3">{head[0]}</th>
            <th className="py-2 pr-3 text-right">{head[1]}</th>
            <th className="w-1/2 py-2" aria-hidden="true" />
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key} className="border-line border-t">
              <td className="py-2 pr-3">
                {r.label}
                {r.note ? <div className="text-ink-muted text-xs">{r.note}</div> : null}
              </td>
              <td className="py-2 pr-3 text-right font-semibold whitespace-nowrap">
                {r.display ?? (r.value === null ? "N/A" : `${fmtInt(r.value)}${unit}`)}
              </td>
              <td className="py-2" aria-hidden="true">
                <div className="bg-surface-sunken h-2.5 rounded-sm">
                  <div
                    className="bg-navy-900 h-2.5 rounded-sm"
                    style={{ width: `${r.value === null ? 0 : Math.max(r.value > 0 ? 2 : 0, (r.value / top) * 100)}%` }}
                  />
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** "How this is calculated" list. */
export function Definitions({ items, footer }: { items: [string, ReactNode][]; footer?: ReactNode }) {
  return (
    <>
      <dl className="grid gap-3 text-sm md:grid-cols-2">
        {items.map(([t, d]) => (
          <div key={t}>
            <dt className="font-semibold">{t}</dt>
            <dd className="text-ink-muted">{d}</dd>
          </div>
        ))}
      </dl>
      <p className="text-ink-muted text-xs">
        {footer ??
          "Operational figures from BiomedIntel.ai records. Durations are calendar time (no working hours or holidays are configured). Reports support audits; they do not certify regulatory compliance."}
      </p>
    </>
  );
}

const linkButton = "inline-flex min-h-11 items-center justify-center rounded-md border px-4 text-sm font-semibold";

/**
 * CSV download. Deliberately a plain <a>, never a prefetching <Link>:
 * viewing a page must never trigger an (audited) export.
 */
export function ExportLink({ report, query, label = "Export CSV" }: { report: string; query: string; label?: string }) {
  return (
    <a
      href={`/reports/export?report=${report}${query ? `&${query}` : ""}`}
      download
      className={`${linkButton} border-line-strong text-navy-900 bg-white`}
    >
      {label}
    </a>
  );
}

export function Pager({ page, pageCount, href }: { page: number; pageCount: number; href: (page: number) => string }) {
  if (pageCount <= 1) return null;
  return (
    <nav aria-label="Pages" className="flex items-center gap-3 text-sm">
      {page > 1 ? (
        <Link href={href(page - 1)} className="font-semibold text-teal-700 hover:underline">
          ← Previous
        </Link>
      ) : null}
      <span className="text-ink-muted">
        Page {page} of {pageCount}
      </span>
      {page < pageCount ? (
        <Link href={href(page + 1)} className="font-semibold text-teal-700 hover:underline">
          Next →
        </Link>
      ) : null}
    </nav>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="text-ink-muted text-sm">{children}</p>;
}

export const th = "py-2 pr-3";
export const thr = "py-2 pr-3 text-right";
export const td = "py-2 pr-3";
export const tdr = "py-2 pr-3 text-right";
export const tableHead = "text-ink-muted text-left text-xs uppercase";
export const rowCls = "border-line border-t";
export const recordLink = "font-semibold text-teal-700 hover:underline";
