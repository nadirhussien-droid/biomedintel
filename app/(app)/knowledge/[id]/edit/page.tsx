import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireAccess } from "@/server/auth/session";
import { NotFoundError } from "@/server/authz/errors";
import { getDocument, knowledgeOptions } from "@/server/services/knowledge";
import { PageHeader } from "@/components/shell/page-header";
import { Card } from "@/components/ui/card";
import { FieldShell, InputField, SelectField } from "@/components/ui/field";
import { ActionForm } from "@/components/forms/action-form";
import { ACCESS_LABELS, ACCESS_LEVELS, DOC_TYPES, DOC_TYPE_LABELS } from "@/lib/validation/knowledge";
import { updateDocumentAction } from "../../actions";

export const metadata: Metadata = { title: "Edit document details" };
const textarea = "min-h-24 w-full rounded-sm border border-line-strong bg-white px-3 py-2 text-sm text-ink";
const multi = "min-h-28 w-full rounded-sm border border-line-strong bg-white px-2 py-1 text-sm text-ink";

export default async function EditDocumentPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireAccess();
  const { id } = await params;
  let d;
  try {
    d = await getDocument(ctx, id);
  } catch (e) {
    if (e instanceof NotFoundError) notFound();
    throw e;
  }
  if (!d.allowed.edit) notFound();
  const o = await knowledgeOptions(ctx);
  const doc = d.doc;
  const sel = (kind: "model" | "category" | "manufacturer") => d.targets.flatMap((t) => (t[kind] ? [t[kind]!.id] : []));
  return (
    <>
      <PageHeader title="Edit document details" description={doc.title} />
      <Card className="max-w-5xl">
        <ActionForm
          action={updateDocumentAction}
          hidden={{ id: doc.id }}
          label="Save details"
          resetOnSuccess={false}
          className="flex flex-col gap-4"
        >
          <div className="grid gap-4 md:grid-cols-2">
            <InputField label="Title" name="title" id="ke-title" defaultValue={doc.title} required />
            <SelectField label="Document type" name="docType" id="ke-type" defaultValue={doc.docType}>
              {DOC_TYPES.map((t) => (
                <option key={t} value={t}>
                  {DOC_TYPE_LABELS[t]}
                </option>
              ))}
            </SelectField>
            <InputField label="Issued by" name="source" id="ke-source" defaultValue={doc.source ?? ""} />
            <InputField
              label="Reference / document number"
              name="sourceReference"
              id="ke-ref"
              defaultValue={doc.sourceReference ?? ""}
            />
            <InputField label="Revision or version" name="revision" id="ke-rev" defaultValue={doc.revision ?? ""} />
            <InputField
              label="Publication date"
              name="publishedOn"
              id="ke-pub"
              type="date"
              defaultValue={doc.publishedOn ? doc.publishedOn.toISOString().slice(0, 10) : ""}
            />
            <SelectField label="Who may see it" name="accessLevel" id="ke-access" defaultValue={doc.accessLevel}>
              {ACCESS_LEVELS.map((a) => (
                <option key={a} value={a}>
                  {ACCESS_LABELS[a]}
                </option>
              ))}
            </SelectField>
            <SelectField label="Hospitals" name="hospitalId" id="ke-hospital" defaultValue={doc.hospitalId ?? ""}>
              <option value="">Every hospital of the organisation</option>
              {o.hospitals.map((h) => (
                <option key={h.id} value={h.id}>
                  Only {h.code} · {h.name}
                </option>
              ))}
            </SelectField>
          </div>
          <FieldShell label="Summary" name="ke-summary">
            <textarea id="ke-summary" name="summary" className={textarea} defaultValue={doc.summary ?? ""} />
          </FieldShell>
          <fieldset className="grid gap-4 md:grid-cols-3">
            <legend className="mb-1 text-sm font-semibold">Applies to — hold Ctrl or ⌘ to choose several</legend>
            <FieldShell label="Models" name="ke-models">
              <select id="ke-models" name="modelIds" multiple className={multi} defaultValue={sel("model")}>
                {o.models.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
            </FieldShell>
            <FieldShell label="Equipment categories" name="ke-cats">
              <select id="ke-cats" name="categoryIds" multiple className={multi} defaultValue={sel("category")}>
                {o.categories.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
            </FieldShell>
            <FieldShell label="Manufacturers" name="ke-mfrs">
              <select id="ke-mfrs" name="manufacturerIds" multiple className={multi} defaultValue={sel("manufacturer")}>
                {o.manufacturers.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
            </FieldShell>
          </fieldset>
        </ActionForm>
      </Card>
    </>
  );
}
