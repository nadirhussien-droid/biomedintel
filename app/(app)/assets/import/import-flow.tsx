"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { Badge, Card, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { SelectField } from "@/components/ui/field";
import { confirmImportAction, previewImportAction, type PreviewData } from "./actions";

type Hospital = { id: string; name: string };
type Department = { id: string; name: string; hospitalId: string };

const SHOW_ROWS = 300;
const tone = { NEW: "ok", EXISTS: "neutral", ERROR: "danger" } as const;
const word = { NEW: "Will be added", EXISTS: "Already there", ERROR: "Problem" } as const;

export function ImportFlow({ hospitals, departments }: { hospitals: Hospital[]; departments: Department[] }) {
  const [hospitalId, setHospitalId] = useState(hospitals.length === 1 ? hospitals[0]!.id : "");
  const [previewState, previewAction, checking] = useActionState(previewImportAction, null);
  const [doneState, confirmAction, saving] = useActionState(confirmImportAction, null);
  const deptOptions = departments.filter((d) => d.hospitalId === hospitalId);
  const data: PreviewData | undefined = previewState?.ok ? previewState.data : undefined;
  const done = doneState?.ok ? doneState.data : undefined;

  if (done) {
    return (
      <Card className="max-w-5xl">
        <CardTitle>Upload finished</CardTitle>
        <p role="status" className="text-ok text-sm font-semibold">
          {done.created} {done.created === 1 ? "asset was" : "assets were"} added to the register.
        </p>
        <ul className="text-ink-muted mt-2 list-disc pl-5 text-sm">
          <li>{done.skippedExisting} already in the register (skipped)</li>
          <li>{done.failed.length} not added</li>
          <li>
            Created in the catalog: {done.createdCatalog.manufacturers} manufacturers, {done.createdCatalog.categories}{" "}
            categories, {done.createdCatalog.models} models, {done.createdCatalog.locations} rooms
          </li>
        </ul>
        {done.failed.length ? (
          <div className="mt-4">
            <p className="text-sm font-semibold">Rows that were not added</p>
            <ul className="mt-1 space-y-1 text-sm">
              {done.failed.map((f) => (
                <li key={`${f.line}-${f.assetTag}`}>
                  Row {f.line} {f.assetTag ? `(${f.assetTag})` : ""}: <span className="text-danger">{f.reason}</span>
                </li>
              ))}
            </ul>
            <p className="text-ink-muted mt-2 text-xs">
              Fix these rows in your file and upload it again. Assets already added are skipped.
            </p>
          </div>
        ) : null}
        <div className="mt-5 flex gap-3">
          <Link
            href="/assets?all=1&hospital=all&department=all"
            className="text-navy-900 inline-flex min-h-11 items-center rounded-md border border-teal-400 bg-teal-400 px-4 text-sm font-semibold hover:bg-teal-500"
          >
            See the register
          </Link>
          <Button variant="secondary" onClick={() => window.location.reload()}>
            Upload another file
          </Button>
        </div>
      </Card>
    );
  }

  return (
    <>
      <Card className="max-w-5xl">
        <CardTitle>1. Choose the file</CardTitle>
        <form action={previewAction} className="grid gap-3 md:grid-cols-3 md:items-end">
          <SelectField
            label="Hospital"
            name="hospitalId"
            id="imp-hospital"
            required
            value={hospitalId}
            onChange={(e) => setHospitalId(e.target.value)}
          >
            <option value="">Choose…</option>
            {hospitals.map((h) => (
              <option key={h.id} value={h.id}>
                {h.name}
              </option>
            ))}
          </SelectField>
          <SelectField label="Department" name="departmentId" id="imp-department" required defaultValue="">
            <option value="">Choose…</option>
            {deptOptions.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </SelectField>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="imp-file" className="text-ink text-sm font-semibold">
              File (.xlsx or .csv, up to 1,000 assets)
            </label>
            <input
              id="imp-file"
              name="file"
              type="file"
              required
              accept=".xlsx,.csv"
              className="border-line-strong min-h-11 w-full rounded-sm border bg-white px-3 py-2 text-sm"
            />
          </div>
          <div className="md:col-span-3">
            <Button type="submit" disabled={checking}>
              {checking ? "Checking…" : "Check the file"}
            </Button>
          </div>
        </form>
        {previewState && !previewState.ok ? (
          <p role="alert" className="text-danger mt-3 text-sm font-medium">
            {previewState.message}
          </p>
        ) : null}
      </Card>

      {data ? (
        <Card className="max-w-5xl">
          <CardTitle>2. Check the preview</CardTitle>
          <p className="text-sm">
            <strong>{data.preview.counts.new}</strong> will be added, <strong>{data.preview.counts.exists}</strong>{" "}
            already in the register (skipped), <strong>{data.preview.counts.error}</strong> have a problem
            {data.preview.warningRows ? (
              <>
                , and <strong>{data.preview.warningRows}</strong> added rows have a note to read
              </>
            ) : null}
            .
          </p>
          <p className="text-ink-muted mt-1 text-sm">
            New in the catalog: {data.preview.create.manufacturers} manufacturers, {data.preview.create.categories}{" "}
            categories, {data.preview.create.models} models, {data.preview.create.locations} rooms.
            {data.repeatRows ? ` ${data.repeatRows} repeated lines for the same asset were combined.` : ""}
          </p>
          {data.preview.notes.map((n) => (
            <p key={n} className="text-ink-muted mt-1 text-sm">
              {n}
            </p>
          ))}
          <p className="text-ink-muted mt-1 text-xs">
            Columns used: {data.recognised.map((r) => r.column).join(", ")}.
            {data.ignoredColumns.length ? ` Ignored: ${data.ignoredColumns.join(", ")}.` : ""}
          </p>

          <div
            className="mt-3 max-h-[28rem] overflow-auto"
            tabIndex={0}
            role="region"
            aria-label="Preview of the file (scrolls)"
          >
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="bg-surface-sunken text-ink-muted text-left text-xs tracking-wide uppercase">
                  <th className="px-3 py-2">Row</th>
                  <th className="px-3 py-2">Asset ID</th>
                  <th className="px-3 py-2">Name and model</th>
                  <th className="px-3 py-2">Result</th>
                </tr>
              </thead>
              <tbody>
                {data.preview.rows.slice(0, SHOW_ROWS).map((r) => (
                  <tr key={r.line} className="border-line border-b align-top">
                    <td className="text-ink-muted px-3 py-2">{r.line}</td>
                    <td className="px-3 py-2 font-mono font-semibold whitespace-nowrap">{r.assetTag || "—"}</td>
                    <td className="px-3 py-2">
                      <div className="font-medium">{r.name}</div>
                      <div className="text-ink-muted text-xs">
                        {r.manufacturer} {r.model} · {r.category}
                        {r.location ? ` · ${r.location}` : ""}
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      <Badge tone={tone[r.outcome]}>{word[r.outcome]}</Badge>
                      {[...r.problems, ...r.warnings].map((m) => (
                        <div
                          key={m}
                          className={`mt-1 text-xs ${r.problems.includes(m) ? "text-danger" : "text-ink-muted"}`}
                        >
                          {m}
                        </div>
                      ))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {data.preview.rows.length > SHOW_ROWS ? (
            <p className="text-ink-muted mt-1 text-xs">Showing the first {SHOW_ROWS} rows. All rows are checked.</p>
          ) : null}

          <form action={confirmAction} className="mt-5 flex flex-col gap-3 border-t pt-4">
            <input type="hidden" name="hospitalId" value={data.hospitalId} />
            <input type="hidden" name="departmentId" value={data.departmentId} />
            <input type="hidden" name="fileName" value={data.fileName} />
            <input type="hidden" name="rows" value={JSON.stringify(data.rows)} />
            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" name="authorisationConfirmed" required className="mt-1 size-4 accent-teal-700" />
              <span>
                I confirm I am authorised to upload this equipment data into BiomedIntel.ai. (This is recorded in the
                audit log.)
              </span>
            </label>
            <div>
              <Button type="submit" disabled={saving || data.preview.counts.new === 0}>
                {saving ? "Saving…" : `Add ${data.preview.counts.new} assets to the register`}
              </Button>
            </div>
            {doneState && !doneState.ok ? (
              <p role="alert" className="text-danger text-sm font-medium">
                {doneState.message}
              </p>
            ) : null}
          </form>
        </Card>
      ) : null}
    </>
  );
}
