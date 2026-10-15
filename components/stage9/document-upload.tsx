"use client";

// Upload forms for the knowledge base. The file goes to a dedicated route that
// checks permission, size and content on the server; nothing here is trusted.
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { FieldShell, InputField, SelectField } from "@/components/ui/field";
import {
  ACCESS_LABELS,
  ACCESS_LEVELS,
  DOC_TYPES,
  DOC_TYPE_LABELS,
  MAX_DOCUMENT_BYTES,
} from "@/lib/validation/knowledge";

type Option = { id: string; name: string };
const textarea = "min-h-24 w-full rounded-sm border border-line-strong bg-white px-3 py-2 text-sm text-ink";
const multi = "min-h-28 w-full rounded-sm border border-line-strong bg-white px-2 py-1 text-sm text-ink";
type Result = { ok: boolean; message?: string; id?: string; index?: string; fieldErrors?: Record<string, string[]> };

async function send(url: string, body: FormData): Promise<Result> {
  const res = await fetch(url, { method: "POST", body }).catch(() => null);
  if (!res) return { ok: false, message: "The upload could not be sent. Check your connection." };
  return (
    ((await res.json().catch(() => null)) as Result | null) ?? {
      ok: false,
      message: "Unexpected reply from the server.",
    }
  );
}

function checkClientFile(file: File | null): string | null {
  if (!file) return null;
  if (file.size > MAX_DOCUMENT_BYTES) return "Documents must be 20 MB or smaller.";
  if (!/\.(pdf|txt|md|markdown)$/i.test(file.name)) return "Only PDF, .txt and .md files are accepted.";
  return null;
}

function Problems({ result }: { result: Result | null }) {
  if (!result || result.ok) return null;
  return (
    <div role="alert" className="text-danger text-sm font-medium">
      <p>{result.message}</p>
      {result.fieldErrors ? (
        <ul className="list-disc pl-5 text-xs">
          {Object.entries(result.fieldErrors).map(([k, v]) => (
            <li key={k}>
              {k}: {v.join(" ")}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

export function NewDocumentForm({
  manufacturers,
  models,
  categories,
  hospitals,
  defaults = {},
}: {
  manufacturers: Option[];
  models: Option[];
  categories: Option[];
  hospitals: { id: string; code: string; name: string }[];
  defaults?: { modelId?: string };
}) {
  const router = useRouter();
  const [mode, setMode] = useState<"file" | "text">("file");
  const [result, setResult] = useState<Result | null>(null);
  const [pending, start] = useTransition();
  return (
    <form
      className="flex flex-col gap-4"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        const form = new FormData(e.currentTarget);
        const file = form.get("file") instanceof File ? (form.get("file") as File) : null;
        if (mode === "text") form.delete("file");
        else form.delete("body");
        const problem =
          mode === "file" ? (file && file.size ? checkClientFile(file) : "Choose a file to upload.") : null;
        if (problem) return setResult({ ok: false, message: problem });
        start(async () => {
          const r = await send("/knowledge/upload", form);
          setResult(r);
          if (r.ok && r.id) router.push(`/knowledge/${r.id}?saved=created&index=${r.index ?? ""}`);
        });
      }}
    >
      <div className="grid gap-4 md:grid-cols-2">
        <InputField label="Title" name="title" id="kd-title" required maxLength={200} />
        <SelectField label="Document type" name="docType" id="kd-type" defaultValue="SERVICE_MANUAL">
          {DOC_TYPES.map((t) => (
            <option key={t} value={t}>
              {DOC_TYPE_LABELS[t]}
            </option>
          ))}
        </SelectField>
        <InputField
          label="Issued by (optional)"
          name="source"
          id="kd-source"
          hint="e.g. the manufacturer, or your organisation"
        />
        <InputField label="Reference / document number (optional)" name="sourceReference" id="kd-ref" />
        <InputField label="Revision or version (optional)" name="revision" id="kd-rev" />
        <InputField label="Publication date (optional)" name="publishedOn" id="kd-pub" type="date" />
        <SelectField label="Who may see it" name="accessLevel" id="kd-access" defaultValue="ENGINEERING">
          {ACCESS_LEVELS.map((a) => (
            <option key={a} value={a}>
              {ACCESS_LABELS[a]}
            </option>
          ))}
        </SelectField>
        <SelectField label="Hospitals" name="hospitalId" id="kd-hospital" defaultValue="">
          <option value="">Every hospital of the organisation</option>
          {hospitals.map((h) => (
            <option key={h.id} value={h.id}>
              Only {h.code} · {h.name}
            </option>
          ))}
        </SelectField>
      </div>
      <FieldShell label="Summary (optional)" name="kd-summary">
        <textarea id="kd-summary" name="summary" className={textarea} maxLength={2000} />
      </FieldShell>
      <fieldset className="grid gap-4 md:grid-cols-3">
        <legend className="mb-1 text-sm font-semibold">
          Applies to (leave empty for general references) — hold Ctrl or ⌘ to choose several
        </legend>
        <FieldShell label="Models" name="kd-models">
          <select
            id="kd-models"
            name="modelIds"
            multiple
            className={multi}
            defaultValue={defaults.modelId ? [defaults.modelId] : []}
          >
            {models.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </FieldShell>
        <FieldShell label="Equipment categories" name="kd-cats">
          <select id="kd-cats" name="categoryIds" multiple className={multi}>
            {categories.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </FieldShell>
        <FieldShell label="Manufacturers" name="kd-mfrs">
          <select id="kd-mfrs" name="manufacturerIds" multiple className={multi}>
            {manufacturers.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </FieldShell>
      </fieldset>
      <fieldset className="flex flex-col gap-3">
        <legend className="text-sm font-semibold">Content</legend>
        <div className="flex flex-wrap gap-4 text-sm">
          <label className="flex items-center gap-2">
            <input
              type="radio"
              name="mode"
              checked={mode === "file"}
              onChange={() => setMode("file")}
              className="accent-teal-700"
            />{" "}
            Upload a file
          </label>
          <label className="flex items-center gap-2">
            <input
              type="radio"
              name="mode"
              checked={mode === "text"}
              onChange={() => setMode("text")}
              className="accent-teal-700"
            />{" "}
            Type a note
          </label>
        </div>
        {mode === "file" ? (
          <FieldShell label="File (PDF, .txt or .md, up to 20 MB)" name="kd-file">
            <input
              id="kd-file"
              name="file"
              type="file"
              accept=".pdf,.txt,.md,application/pdf,text/plain,text/markdown"
              className="text-sm"
            />
          </FieldShell>
        ) : (
          <FieldShell label="Text (Markdown headings like “# Section” are kept as sections)" name="kd-body">
            <textarea id="kd-body" name="body" className={`${textarea} min-h-48 font-mono`} />
          </FieldShell>
        )}
        <p className="text-ink-muted text-xs">
          Only upload documents your organisation is allowed to use. Do not include patient information. The document is
          saved as a<strong> draft</strong>: an Engineering Manager must review and approve it before IntellAssist uses
          it.
        </p>
      </fieldset>
      <div>
        <Button type="submit" disabled={pending}>
          {pending ? "Uploading and reading…" : "Save as draft"}
        </Button>
      </div>
      <Problems result={result} />
    </form>
  );
}

export function NewVersionForm({ documentId }: { documentId: string }) {
  const router = useRouter();
  const [result, setResult] = useState<Result | null>(null);
  const [pending, start] = useTransition();
  return (
    <form
      className="flex flex-col gap-3"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        const formEl = e.currentTarget;
        const form = new FormData(formEl);
        const file = form.get("file") instanceof File ? (form.get("file") as File) : null;
        const problem = file && file.size ? checkClientFile(file) : null;
        if (problem) return setResult({ ok: false, message: problem });
        if ((!file || !file.size) && !String(form.get("body") ?? "").trim())
          return setResult({ ok: false, message: "Choose a file or type the new text." });
        if (file && !file.size) form.delete("file");
        start(async () => {
          const r = await send(`/knowledge/${documentId}/versions`, form);
          setResult(
            r.ok ? { ok: true, message: "New version saved. The document is a draft again until it is approved." } : r,
          );
          if (r.ok) {
            formEl.reset();
            router.refresh();
          }
        });
      }}
    >
      <FieldShell label="New file (PDF, .txt or .md, up to 20 MB)" name="kv-file">
        <input
          id="kv-file"
          name="file"
          type="file"
          accept=".pdf,.txt,.md,application/pdf,text/plain,text/markdown"
          className="text-sm"
        />
      </FieldShell>
      <FieldShell label="…or the new text" name="kv-body">
        <textarea id="kv-body" name="body" className={`${textarea} font-mono`} />
      </FieldShell>
      <InputField label="What changed (optional)" name="note" id="kv-note" maxLength={500} />
      <div>
        <Button type="submit" variant="secondary" disabled={pending}>
          {pending ? "Uploading and reading…" : "Upload new version"}
        </Button>
      </div>
      {result ? (
        result.ok ? (
          <p role="status" className="text-ok text-sm font-medium">
            {result.message}
          </p>
        ) : (
          <Problems result={result} />
        )
      ) : null}
    </form>
  );
}
