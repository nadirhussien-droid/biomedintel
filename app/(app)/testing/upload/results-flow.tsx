"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { Badge, Card, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { SelectField } from "@/components/ui/field";
import { confirmResultsAction, previewResultsAction, type ResultsPreviewData } from "./actions";

type Tool = { id: string; label: string; state: string; dueOn: string | null };

export function ResultsFlow({ tools }: { tools: Tool[] }) {
  const [unassigned, setUnassigned] = useState(true);
  const [previewState, previewAction, checking] = useActionState(previewResultsAction, null);
  const [doneState, confirmAction, saving] = useActionState(confirmResultsAction, null);
  const data: ResultsPreviewData | undefined = previewState?.ok ? previewState.data : undefined;
  const done = doneState?.ok ? doneState.data : undefined;

  if (done) {
    return (
      <Card className="max-w-5xl">
        <CardTitle>Upload finished</CardTitle>
        <p role="status" className="text-ok text-sm font-semibold">
          {done.signedOff} {done.signedOff === 1 ? "job was" : "jobs were"} signed off.
        </p>
        <ul className="text-ink-muted mt-2 list-disc pl-5 text-sm">
          <li>{done.withFailures} had at least one failed item</li>
          <li>{done.holds} devices were put on a Do Not Use hold after an electrical safety fail</li>
          <li>{done.failed.length} rows were not signed off</li>
        </ul>
        {done.failed.length ? (
          <div className="mt-4">
            <p className="text-sm font-semibold">Rows that were not signed off</p>
            <ul className="mt-1 space-y-1 text-sm">
              {done.failed.map((f) => (
                <li key={`${f.line}-${f.assetTag}`}>
                  Row {f.line} {f.assetTag ? `(${f.assetTag})` : ""}: <span className="text-danger">{f.reason}</span>
                </li>
              ))}
            </ul>
            <p className="text-ink-muted mt-2 text-xs">
              Fix these rows and upload the sheet again. Jobs already signed off are no longer waiting, so they are
              skipped.
            </p>
          </div>
        ) : null}
        <div className="mt-5 flex gap-3">
          <Link
            href="/maintenance/schedule"
            className="text-navy-900 inline-flex min-h-11 items-center rounded-md border border-teal-400 bg-teal-400 px-4 text-sm font-semibold hover:bg-teal-500"
          >
            See the schedule
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
        <CardTitle>1. Get the sheet and choose the file</CardTitle>
        <label className="mb-3 flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            checked={unassigned}
            onChange={(e) => setUnassigned(e.target.checked)}
            className="mt-1 size-4 accent-teal-700"
          />
          <span>Also include test jobs nobody has taken yet (you take them when you upload).</span>
        </label>
        <p className="mb-4 text-sm">
          <a
            href={`/testing/upload/template${unassigned ? "?unassigned=1" : ""}`}
            className="font-semibold text-teal-700 underline"
          >
            Download the results sheet
          </a>
        </p>
        <form action={previewAction} className="grid gap-3 md:grid-cols-2 md:items-end">
          {unassigned ? <input type="hidden" name="includeUnassigned" value="on" /> : null}
          <div className="flex flex-col gap-1.5">
            <label htmlFor="res-file" className="text-ink text-sm font-semibold">
              Filled-in sheet (.xlsx or .csv)
            </label>
            <input
              id="res-file"
              name="file"
              type="file"
              required
              accept=".xlsx,.csv"
              className="border-line-strong min-h-11 w-full rounded-sm border bg-white px-3 py-2 text-sm"
            />
          </div>
          <div>
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
          {data.preview.noOpenJobs ? (
            <p className="text-danger text-sm">
              You have no open planned test jobs, so there is nothing to sign off. Tick the box above to include jobs
              nobody has taken.
            </p>
          ) : null}
          <p className="text-sm">
            <strong>{data.preview.counts.ready}</strong> ready to sign off ({data.preview.counts.fail} with a failed
            item), <strong>{data.preview.counts.problem}</strong> with a problem (skipped).
          </p>
          <div
            className="mt-3 max-h-[28rem] overflow-auto"
            tabIndex={0}
            role="region"
            aria-label="Preview of the results (scrolls)"
          >
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="bg-surface-sunken text-ink-muted text-left text-xs tracking-wide uppercase">
                  <th className="px-3 py-2">Row</th>
                  <th className="px-3 py-2">Asset ID</th>
                  <th className="px-3 py-2">Job</th>
                  <th className="px-3 py-2">Result</th>
                </tr>
              </thead>
              <tbody>
                {data.preview.rows.map((r) => (
                  <tr key={r.line} className="border-line border-b align-top">
                    <td className="text-ink-muted px-3 py-2">{r.line}</td>
                    <td className="px-3 py-2 font-mono font-semibold whitespace-nowrap">{r.assetTag || "—"}</td>
                    <td className="px-3 py-2 whitespace-nowrap">{r.workOrder ?? "—"}</td>
                    <td className="px-3 py-2">
                      {r.outcome === "PROBLEM" ? (
                        <Badge tone="danger">Problem</Badge>
                      ) : r.counts.fail > 0 ? (
                        <Badge tone="danger">Fail</Badge>
                      ) : (
                        <Badge tone="ok">Pass</Badge>
                      )}
                      {r.outcome === "READY" ? (
                        <div className="text-ink-muted mt-1 text-xs">
                          {r.counts.pass} pass, {r.counts.fail} fail, {r.counts.na} not applicable
                          {r.electricalFail ? ". The device will be put on a Do Not Use hold." : ""}
                          {r.willTake ? ". You take this job." : ""}
                        </div>
                      ) : null}
                      {r.problems.map((m) => (
                        <div key={m} className="text-danger mt-1 text-xs">
                          {m}
                        </div>
                      ))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <form action={confirmAction} className="mt-5 flex flex-col gap-3 border-t pt-4">
            <input type="hidden" name="fileName" value={data.fileName} />
            <input type="hidden" name="includeUnassigned" value={data.includeUnassigned ? "1" : "0"} />
            <input type="hidden" name="rows" value={JSON.stringify(data.rows)} />
            {data.preview.needsTestEquipment ? (
              <SelectField
                label="Test tool used for the electrical safety checks"
                name="testEquipmentId"
                id="res-tool"
                required
                defaultValue=""
              >
                <option value="">Choose…</option>
                {tools.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.label}
                    {t.state === "OVERDUE" ? " (calibration overdue)" : ""}
                  </option>
                ))}
              </SelectField>
            ) : null}
            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" name="declaration" required className="mt-1 size-4 accent-teal-700" />
              <span>
                I carried out these tests and confirm the results are accurate. They are recorded as signed off by me
                today.
              </span>
            </label>
            <div>
              <Button type="submit" disabled={saving || data.preview.counts.ready === 0}>
                {saving ? "Saving…" : `Sign off ${data.preview.counts.ready} jobs`}
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
