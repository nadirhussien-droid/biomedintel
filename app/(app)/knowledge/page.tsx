import type { Metadata } from "next";
import Link from "next/link";
import { requireAccess } from "@/server/auth/session";
import { can } from "@/server/authz/access";
import { HIT_END, HIT_START, knowledgeOptions, searchKnowledge } from "@/server/services/knowledge";
import { PageHeader } from "@/components/shell/page-header";
import { Card, CardTitle } from "@/components/ui/card";
import { Empty, Pager, fmtDate, recordLink, rowCls, tableHead, td, th } from "@/components/analytics/ui";
import { DocTag } from "@/components/stage9/tags";
import { DOC_TYPES, DOC_TYPE_LABELS } from "@/lib/validation/knowledge";

export const metadata: Metadata = { title: "Technical Knowledge" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
const control = "min-h-11 w-full rounded-sm border border-line-strong bg-white px-3 text-sm text-ink";
const linkButton = "inline-flex min-h-11 items-center justify-center rounded-md border px-4 text-sm font-semibold";

/** Search hits are marked with private-use characters, then rendered as <mark> — never as HTML. */
function Snippet({ text }: { text: string }) {
  const parts = text.split(new RegExp(`(${HIT_START}[^${HIT_END}]*${HIT_END})`));
  return (
    <>
      {parts.map((p, i) =>
        p.startsWith(HIT_START) ? (
          <mark key={i} className="text-ink rounded-sm bg-teal-400/40 px-0.5">
            {p.slice(1, -1)}
          </mark>
        ) : (
          <span key={i}>{p}</span>
        ),
      )}
    </>
  );
}

export default async function KnowledgePage({ searchParams }: { searchParams: SearchParams }) {
  const ctx = await requireAccess();
  const sp = await searchParams;
  const raw: Record<string, string | undefined> = {};
  for (const k of ["q", "type", "manufacturer", "model", "category", "code", "review", "status", "page"])
    raw[k] = first(sp[k]);
  const [r, options] = await Promise.all([searchKnowledge(ctx, raw), knowledgeOptions(ctx)]);
  const q = r.q;
  const href = (page: number) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries({ ...raw, page: String(page) })) if (v) p.set(k, v);
    return `/knowledge?${p.toString()}`;
  };
  return (
    <>
      <PageHeader
        title="Technical Knowledge"
        description="IntellKnowledge: your organisation's manuals, procedures, error codes, bulletins and engineering notes. Draft documents are labelled and are never used by IntellAssist until an Engineering Manager approves them."
        actions={
          can(ctx, "knowledge.contribute") ? (
            <Link href="/knowledge/new" className={`${linkButton} text-navy-900 border-teal-400 bg-teal-400`}>
              Add document
            </Link>
          ) : null
        }
      />
      <Card>
        <form
          method="get"
          action="/knowledge"
          aria-label="Search the knowledge base"
          className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"
        >
          <div className="sm:col-span-2">
            <label htmlFor="k-q" className="text-sm font-semibold">
              Keywords
            </label>
            <input
              id="k-q"
              name="q"
              defaultValue={q.q ?? ""}
              placeholder='e.g. occlusion alarm, "flow sensor"'
              className={`${control} mt-1.5`}
            />
          </div>
          <div>
            <label htmlFor="k-code" className="text-sm font-semibold">
              Error or alarm code
            </label>
            <input
              id="k-code"
              name="code"
              defaultValue={q.code ?? ""}
              placeholder="e.g. E-207"
              className={`${control} mt-1.5 font-mono`}
            />
          </div>
          <div>
            <label htmlFor="k-type" className="text-sm font-semibold">
              Document type
            </label>
            <select id="k-type" name="type" defaultValue={q.type ?? ""} className={`${control} mt-1.5`}>
              <option value="">Any type</option>
              {DOC_TYPES.map((t) => (
                <option key={t} value={t}>
                  {DOC_TYPE_LABELS[t]}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="k-mfr" className="text-sm font-semibold">
              Manufacturer
            </label>
            <select id="k-mfr" name="manufacturer" defaultValue={q.manufacturer ?? ""} className={`${control} mt-1.5`}>
              <option value="">Any</option>
              {options.manufacturers.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="k-model" className="text-sm font-semibold">
              Model
            </label>
            <select id="k-model" name="model" defaultValue={q.model ?? ""} className={`${control} mt-1.5`}>
              <option value="">Any</option>
              {options.models.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="k-cat" className="text-sm font-semibold">
              Equipment category
            </label>
            <select id="k-cat" name="category" defaultValue={q.category ?? ""} className={`${control} mt-1.5`}>
              <option value="">Any</option>
              {options.categories.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="k-review" className="text-sm font-semibold">
              Review
            </label>
            <select id="k-review" name="review" defaultValue={q.review} className={`${control} mt-1.5`}>
              <option value="any">Approved and drafts</option>
              <option value="approved">Approved only</option>
              <option value="draft">Drafts only</option>
            </select>
          </div>
          <div>
            <label htmlFor="k-status" className="text-sm font-semibold">
              Status
            </label>
            <select id="k-status" name="status" defaultValue={q.status} className={`${control} mt-1.5`}>
              <option value="active">Current</option>
              <option value="superseded">Superseded</option>
              <option value="withdrawn">Withdrawn</option>
              <option value="all">All</option>
            </select>
          </div>
          <div className="flex items-end gap-2">
            <button type="submit" className={`${linkButton} text-navy-900 border-teal-400 bg-teal-400`}>
              Search
            </button>
            <Link href="/knowledge" className="text-sm font-semibold text-teal-700 hover:underline">
              Reset
            </Link>
          </div>
        </form>
      </Card>

      {r.codes.length ? (
        <Card>
          <CardTitle>Documented error codes</CardTitle>
          <ul className="divide-line divide-y text-sm">
            {r.codes.map((c) => (
              <li key={c.id} className="flex flex-col gap-1 py-2">
                <span className="flex flex-wrap items-center gap-2">
                  <strong className="font-mono">{c.code}</strong> <DocTag review={c.review_status} status={c.status} />
                </span>
                <span>{c.meaning}</span>
                <span className="text-ink-muted text-xs">
                  Source:{" "}
                  <Link href={`/knowledge/${c.document_id}`} className={recordLink}>
                    {c.title}
                  </Link>
                  {c.page ? `, page ${c.page}` : ""}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      ) : q.code ? (
        <Card>
          <Empty>
            No documented meaning for {q.code} in documents you can see. Check the manufacturer&apos;s service manual.
          </Empty>
        </Card>
      ) : null}

      {r.passages.length ? (
        <Card>
          <CardTitle>{r.partial ? "Passages with some of your words" : "Matching passages"}</CardTitle>
          {r.partial ? (
            <p role="status" className="bg-info-bg text-info mb-3 rounded-md px-3 py-2 text-sm">
              No passage contains all of the words in &ldquo;{q.q}&rdquo;. These contain some of them, best match first.
              Check that each one really applies.
            </p>
          ) : null}
          <ul className="flex flex-col gap-3 text-sm">
            {r.passages.map((p) => (
              <li key={p.id} className="border-line rounded-md border p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Link href={`/knowledge/${p.document_id}`} className={recordLink}>
                    {p.title}
                  </Link>
                  <DocTag review={p.review_status} status={p.status} />
                  {p.page_from ? (
                    <a
                      href={`/knowledge/files/${p.version_id}#page=${p.page_from}`}
                      target="_blank"
                      rel="noopener"
                      className="text-xs font-semibold text-teal-700 hover:underline"
                    >
                      Open page {p.page_from}
                    </a>
                  ) : p.heading ? (
                    <span className="text-ink-muted text-xs">Section: {p.heading}</span>
                  ) : null}
                </div>
                <p className="mt-1">
                  <Snippet text={p.snippet} />
                </p>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      <Card>
        <CardTitle>Documents ({r.total})</CardTitle>
        {r.documents.length === 0 ? (
          <Empty>No documents match. Try fewer words or clear the filters.</Empty>
        ) : (
          <div
            className="overflow-x-auto"
            tabIndex={0}
            role="region"
            aria-label="Table (scroll sideways on small screens)"
          >
            <table className="w-full text-sm">
              <caption className="sr-only">Knowledge documents</caption>
              <thead className={tableHead}>
                <tr>
                  <th className={th}>Title</th>
                  <th className={th}>Type</th>
                  <th className={th}>Applies to</th>
                  <th className={th}>Source</th>
                  <th className={th}>Status</th>
                  <th className={th}>Updated</th>
                </tr>
              </thead>
              <tbody>
                {r.documents.map((d) => (
                  <tr key={d.id} className={rowCls}>
                    <td className={td}>
                      <Link href={`/knowledge/${d.id}`} className={recordLink}>
                        {d.title}
                      </Link>
                      {d.access_level === "MANAGERS" ? (
                        <div className="text-ink-muted text-xs">Managers only</div>
                      ) : null}
                    </td>
                    <td className={td}>{DOC_TYPE_LABELS[d.doc_type as keyof typeof DOC_TYPE_LABELS] ?? d.doc_type}</td>
                    <td className={`${td} max-w-xs`}>{d.targets ?? <span className="text-ink-muted">General</span>}</td>
                    <td className={td}>
                      {[
                        d.source,
                        d.source_reference,
                        d.revision ? (/^rev/i.test(d.revision) ? d.revision : `rev. ${d.revision}`) : null,
                      ]
                        .filter(Boolean)
                        .join(" · ") || "—"}
                    </td>
                    <td className={td}>
                      <DocTag review={d.review_status} status={d.status} />
                    </td>
                    <td className={td}>{fmtDate(d.updated_at)}</td>
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
