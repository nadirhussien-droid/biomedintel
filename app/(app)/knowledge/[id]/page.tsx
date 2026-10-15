import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAccess } from "@/server/auth/session";
import { NotFoundError } from "@/server/authz/errors";
import { getDocument } from "@/server/services/knowledge";
import { PageHeader } from "@/components/shell/page-header";
import { Card, CardTitle } from "@/components/ui/card";
import { InputField, SelectField } from "@/components/ui/field";
import { ActionForm } from "@/components/forms/action-form";
import { Empty, fmtDate, fmtDateTime, recordLink, rowCls, tableHead, td, th, ToneTag } from "@/components/analytics/ui";
import { DocTag, IndexTag } from "@/components/stage9/tags";
import { NewVersionForm } from "@/components/stage9/document-upload";
import { ACCESS_LABELS, DOC_TYPE_LABELS } from "@/lib/validation/knowledge";
import {
  addErrorCodeAction,
  approveDocumentAction,
  archiveErrorCodeAction,
  documentStatusAction,
  reindexAction,
} from "../actions";

export const metadata: Metadata = { title: "Knowledge document" };

const SAVED: Record<string, string> = {
  created: "Document saved as a draft. An Engineering Manager must approve it before IntellAssist uses it.",
  updated: "Changes saved.",
  approved: "Approved. IntellAssist can now cite this version.",
  withdrawn: "Withdrawn. It is no longer searchable for engineers or used by IntellAssist; it stays in the history.",
  superseded: "Marked as superseded. IntellAssist no longer uses it.",
};
const textarea = "min-h-20 w-full rounded-sm border border-line-strong bg-white px-3 py-2 text-sm text-ink";
const linkButton = "inline-flex min-h-11 items-center justify-center rounded-md border px-4 text-sm font-semibold";
const size = (n: number) =>
  n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`;

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-ink-muted text-xs font-semibold uppercase">{label}</dt>
      <dd className="text-sm">{children}</dd>
    </div>
  );
}

export default async function DocumentPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await requireAccess();
  const { id } = await params;
  const sp = await searchParams;
  let d;
  try {
    d = await getDocument(ctx, id);
  } catch (e) {
    if (e instanceof NotFoundError) notFound();
    throw e;
  }
  const { doc, current, allowed, names } = d;
  const saved = typeof sp.saved === "string" ? SAVED[sp.saved] : undefined;
  const indexNote = sp.index === "FAILED" || sp.index === "NO_TEXT";
  return (
    <>
      <PageHeader
        title={doc.title}
        description={`${DOC_TYPE_LABELS[doc.docType]}${doc.revision ? ` · revision ${doc.revision}` : ""}${current ? ` · version ${current.versionNo}` : ""}`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <DocTag review={doc.reviewStatus} status={doc.status} />
            {allowed.edit ? (
              <Link href={`/knowledge/${doc.id}/edit`} className={`${linkButton} border-line-strong bg-white`}>
                Edit details
              </Link>
            ) : null}
          </div>
        }
      />
      {saved ? (
        <p role="status" className="bg-ok-bg text-ok rounded-md px-4 py-3 text-sm font-semibold">
          {saved}
          {indexNote ? " The file could not be read as text — see the version list below." : ""}
        </p>
      ) : null}
      {doc.status === "WITHDRAWN" ? (
        <p role="alert" className="bg-danger-bg text-danger rounded-md px-4 py-3 text-sm font-semibold">
          Withdrawn — do not use. Reason: {doc.statusReason}
        </p>
      ) : doc.status === "SUPERSEDED" ? (
        <p role="alert" className="bg-warn-bg rounded-md px-4 py-3 text-sm text-[#6b3f00]">
          Superseded
          {d.supersededBy ? (
            <>
              {" "}
              by{" "}
              <Link href={`/knowledge/${d.supersededBy.id}`} className={recordLink}>
                {d.supersededBy.title}
              </Link>
            </>
          ) : null}
          . Reason: {doc.statusReason}
        </p>
      ) : doc.reviewStatus === "DRAFT" ? (
        <p className="bg-warn-bg rounded-md px-4 py-3 text-sm text-[#6b3f00]">
          Draft — not reviewed. This is not an approved procedure, and IntellAssist does not use it until an Engineering
          Manager approves it.
        </p>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-[2fr_1fr]">
        <Card>
          <CardTitle>Details</CardTitle>
          {doc.summary ? <p className="text-sm whitespace-pre-line">{doc.summary}</p> : null}
          <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <Row label="Issued by">{doc.source ?? "—"}</Row>
            <Row label="Reference">{doc.sourceReference ?? "—"}</Row>
            <Row label="Revision">{doc.revision ?? "—"}</Row>
            <Row label="Published">{fmtDate(doc.publishedOn)}</Row>
            <Row label="Registered">
              {fmtDateTime(doc.createdAt)} · {names[doc.createdById] ?? "Unknown"}
            </Row>
            <Row label="Who may see it">
              {ACCESS_LABELS[doc.accessLevel]}
              {d.hospital ? ` · only ${d.hospital.code}` : " · every hospital"}
            </Row>
            <Row label="Applies to">
              {d.targets.length
                ? d.targets
                    .map((t) =>
                      t.model
                        ? `${t.model.manufacturer.name} ${t.model.modelName}`
                        : t.category
                          ? `All ${t.category.name}`
                          : `All ${t.manufacturer?.name}`,
                    )
                    .join(", ")
                : "General reference"}
            </Row>
            <Row label="Review">
              {doc.reviewStatus === "APPROVED" && doc.reviewedAt ? (
                <>
                  Approved by {names[doc.reviewedById ?? ""] ?? "Unknown"} on {fmtDateTime(doc.reviewedAt)}
                  {doc.reviewNote ? ` — ${doc.reviewNote}` : ""}
                </>
              ) : (
                "Not reviewed"
              )}
            </Row>
            <Row label="Why the organisation may use it">{doc.authorisation ?? "—"}</Row>
            <Row label="Cited by AI answers">{d.citedBy}</Row>
          </dl>
        </Card>
        <Card>
          <CardTitle>Current file</CardTitle>
          {current ? (
            <>
              <p className="text-sm">
                {current.filename} · {size(current.sizeBytes)}
                {current.pageCount ? ` · ${current.pageCount} pages` : ""}
              </p>
              <IndexTag status={current.indexStatus} />
              {current.indexNote ? <p className="text-ink-muted text-xs">{current.indexNote}</p> : null}
              <div className="flex flex-wrap gap-2">
                <a
                  href={`/knowledge/files/${current.id}`}
                  target="_blank"
                  rel="noopener"
                  className={`${linkButton} border-line-strong bg-white`}
                >
                  Open
                </a>
                <a
                  href={`/knowledge/files/${current.id}?download=1`}
                  className={`${linkButton} border-line-strong bg-white`}
                >
                  Download
                </a>
              </div>
              <p className="text-ink-muted text-xs">
                SHA-256 {current.sha256.slice(0, 16)}… · every opening and download is recorded in the audit log.
              </p>
            </>
          ) : (
            <Empty>No file.</Empty>
          )}
        </Card>
      </div>

      {allowed.approve ? (
        <Card>
          <CardTitle>Review and approve (Engineering Manager)</CardTitle>
          <p className="text-ink-muted text-xs">
            Approving confirms that you reviewed this version and that the organisation is allowed to use it.
            IntellAssist will then cite it.
          </p>
          <ActionForm
            action={approveDocumentAction}
            hidden={{ id: doc.id }}
            label="Approve this version"
            className="grid gap-3 md:grid-cols-2"
          >
            <div className="md:col-span-2">
              <label htmlFor="ap-auth" className="text-sm font-semibold">
                Why the organisation may use it (licence, supplied by the manufacturer, written in-house…)
              </label>
              <textarea
                id="ap-auth"
                name="authorisation"
                required
                className={`${textarea} mt-1.5`}
                defaultValue={doc.authorisation ?? ""}
              />
            </div>
            <InputField label="Review note (optional)" name="reviewNote" id="ap-note" className="md:col-span-2" />
            <label className="flex items-start gap-2 text-sm md:col-span-2">
              <input type="checkbox" name="confirm" className="mt-0.5 size-4 accent-teal-700" />I reviewed the content
              of version {current?.versionNo}.
            </label>
          </ActionForm>
        </Card>
      ) : null}

      <Card>
        <CardTitle>Documented error codes ({d.codes.length})</CardTitle>
        {d.codes.length === 0 ? (
          <Empty>No error codes recorded from this document.</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <caption className="sr-only">Error codes</caption>
              <thead className={tableHead}>
                <tr>
                  <th className={th}>Code</th>
                  <th className={th}>Documented meaning</th>
                  <th className={th}>Page</th>
                  <th className={th}>Added by</th>
                  {allowed.archiveCode ? <th className={th}>Remove</th> : null}
                </tr>
              </thead>
              <tbody>
                {d.codes.map((c) => (
                  <tr key={c.id} className={rowCls}>
                    <td className={`${td} font-mono font-semibold`}>{c.code}</td>
                    <td className={td}>{c.meaning}</td>
                    <td className={td}>
                      {c.page && current?.mime === "application/pdf" ? (
                        <a
                          href={`/knowledge/files/${current.id}#page=${c.page}`}
                          target="_blank"
                          rel="noopener"
                          className={recordLink}
                        >
                          {c.page}
                        </a>
                      ) : (
                        (c.page ?? "—")
                      )}
                    </td>
                    <td className={td}>{names[c.createdById] ?? "Unknown"}</td>
                    {allowed.archiveCode ? (
                      <td className={td}>
                        <ActionForm
                          action={archiveErrorCodeAction}
                          hidden={{ id: c.id }}
                          label="Remove"
                          variant="secondary"
                          confirm="Remove this code from searches? It stays in the history."
                        />
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {allowed.addCode ? (
          <details>
            <summary className="cursor-pointer text-sm font-semibold text-teal-700">
              Add an error code from this document
            </summary>
            <ActionForm
              action={addErrorCodeAction}
              hidden={{ documentId: doc.id }}
              label="Add code"
              className="mt-2 grid gap-3 md:grid-cols-4"
            >
              <InputField label="Code" name="code" id="ec-code" required maxLength={40} className="font-mono" />
              <InputField label="Page (optional)" name="page" id="ec-page" type="number" min={1} />
              <div className="md:col-span-2">
                <label htmlFor="ec-meaning" className="text-sm font-semibold">
                  Meaning exactly as documented
                </label>
                <textarea id="ec-meaning" name="meaning" required className={`${textarea} mt-1.5`} />
              </div>
            </ActionForm>
            <p className="text-ink-muted mt-1 text-xs">
              Copy the meaning from the document; do not interpret it. It is trusted only once the document is approved.
            </p>
          </details>
        ) : null}
      </Card>

      <Card>
        <CardTitle>Versions ({d.versions.length})</CardTitle>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <caption className="sr-only">Versions</caption>
            <thead className={tableHead}>
              <tr>
                <th className={th}>Version</th>
                <th className={th}>File</th>
                <th className={th}>Readable</th>
                <th className={th}>Uploaded</th>
                <th className={th}>Note</th>
                <th className={th}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {d.versions.map((v) => (
                <tr key={v.id} className={`${rowCls} align-top`}>
                  <td className={td}>
                    {v.versionNo}
                    {v.id === doc.currentVersionId ? <div className="text-xs font-semibold">Current</div> : null}
                  </td>
                  <td className={td}>
                    {v.filename} · {size(v.sizeBytes)}
                    {v.pageCount ? ` · ${v.pageCount} p.` : ""}
                  </td>
                  <td className={td}>
                    <IndexTag status={v.indexStatus} />
                    <div className="text-ink-muted text-xs">
                      {v._count.chunks} passages{v._count.citations ? ` · cited ${v._count.citations}×` : ""}
                    </div>
                    {v.indexNote ? <div className="text-ink-muted text-xs">{v.indexNote}</div> : null}
                  </td>
                  <td className={td}>
                    {fmtDateTime(v.createdAt)}
                    <div className="text-ink-muted text-xs">{names[v.uploadedById] ?? "Unknown"}</div>
                  </td>
                  <td className={td}>{v.note ?? "—"}</td>
                  <td className={td}>
                    <div className="flex flex-col gap-1">
                      <a href={`/knowledge/files/${v.id}?download=1`} className={recordLink}>
                        Download
                      </a>
                      {allowed.reindex && v._count.citations === 0 ? (
                        <ActionForm
                          action={reindexAction}
                          hidden={{ versionId: v.id }}
                          label="Read again"
                          variant="secondary"
                        />
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {allowed.newVersion ? (
          <details>
            <summary className="cursor-pointer text-sm font-semibold text-teal-700">Upload a new version</summary>
            <p className="text-ink-muted mt-1 text-xs">
              Older versions are kept. The document returns to draft until it is approved again.
            </p>
            <div className="mt-2">
              <NewVersionForm documentId={doc.id} />
            </div>
          </details>
        ) : null}
      </Card>

      {allowed.changeStatus ? (
        <Card>
          <CardTitle>Supersede or withdraw (Engineering Manager)</CardTitle>
          <p className="text-ink-muted text-xs">
            Nothing is deleted. Superseded and withdrawn documents stop being used by IntellAssist; older AI answers
            still show what they cited.
          </p>
          <ActionForm
            action={documentStatusAction}
            hidden={{ id: doc.id }}
            label="Save"
            variant="danger"
            confirm="Change the status of this document? This cannot be undone."
            className="grid gap-3 md:grid-cols-3"
          >
            <SelectField label="New status" name="status" id="st-status" defaultValue="SUPERSEDED">
              <option value="SUPERSEDED">Superseded by another document</option>
              <option value="WITHDRAWN">Withdrawn (wrong, unsafe or not allowed)</option>
            </SelectField>
            <SelectField label="Replaced by (when superseded)" name="supersededById" id="st-next" defaultValue="">
              <option value="">—</option>
              {d.replacements.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.title}
                  {r.revision ? ` (rev ${r.revision})` : ""}
                </option>
              ))}
            </SelectField>
            <InputField label="Reason" name="reason" id="st-reason" required />
          </ActionForm>
        </Card>
      ) : doc.status !== "ACTIVE" ? (
        <Card>
          <ToneTag tone="warn">
            {doc.status === "WITHDRAWN" ? "Withdrawn" : "Superseded"} on {fmtDateTime(doc.statusChangedAt)} by{" "}
            {names[doc.statusChangedById ?? ""] ?? "Unknown"}
          </ToneTag>
        </Card>
      ) : null}
    </>
  );
}
