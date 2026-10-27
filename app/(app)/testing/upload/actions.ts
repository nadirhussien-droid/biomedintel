"use server";
// Upload test results: step 1 checks the file (saves nothing), step 2 signs the jobs off.
import { revalidatePath } from "next/cache";
import { requireAccess } from "@/server/auth/session";
import { runAction, type ActionResult } from "@/server/actions/result";
import { ImportFileError, MAX_IMPORT_BYTES, readTable } from "@/lib/asset-import";
import { parseResultsTable, type UploadRow } from "@/lib/test-results-upload";
import {
  previewTestResults,
  uploadTestResults,
  type ResultsPreview,
  type UploadResult,
} from "@/server/services/test-results-upload";
import { ValidationError } from "@/server/authz/errors";

const str = (form: FormData, key: string) => {
  const v = form.get(key);
  return typeof v === "string" ? v : "";
};

export type ResultsPreviewData = {
  fileName: string;
  includeUnassigned: boolean;
  rows: UploadRow[];
  preview: ResultsPreview;
};

export async function previewResultsAction(
  _prev: ActionResult<ResultsPreviewData> | null,
  form: FormData,
): Promise<ActionResult<ResultsPreviewData>> {
  const ctx = await requireAccess();
  const file = form.get("file");
  const includeUnassigned = form.get("includeUnassigned") === "on";
  return runAction(async () => {
    if (!(file instanceof File) || file.size === 0)
      throw new ValidationError("Choose a file to upload.", { file: ["Required"] });
    if (file.size > MAX_IMPORT_BYTES)
      throw new ValidationError("The file is larger than 3 MB.", { file: ["Too large"] });
    let rows: UploadRow[];
    try {
      const table = await readTable(file.name, new Uint8Array(await file.arrayBuffer()));
      rows = parseResultsTable(table).rows;
    } catch (error) {
      if (error instanceof ImportFileError) throw new ValidationError(error.message, { file: [error.message] });
      throw error;
    }
    const preview = await previewTestResults(ctx, { rows, includeUnassigned });
    return { fileName: file.name, includeUnassigned, rows, preview };
  }, "File checked. Nothing has been saved yet.");
}

export async function confirmResultsAction(
  _prev: ActionResult<UploadResult> | null,
  form: FormData,
): Promise<ActionResult<UploadResult>> {
  const ctx = await requireAccess();
  const result = await runAction(async () => {
    let rows: unknown;
    try {
      rows = JSON.parse(str(form, "rows"));
    } catch {
      throw new ValidationError("The checked rows were lost. Please check the file again.");
    }
    return uploadTestResults(ctx, {
      rows,
      includeUnassigned: str(form, "includeUnassigned") === "1",
      testEquipmentId: str(form, "testEquipmentId"),
      declaration: form.get("declaration") === "on",
      fileName: str(form, "fileName"),
    });
  }, "Results uploaded.");
  if (result.ok) {
    revalidatePath("/testing", "layout");
    revalidatePath("/work-orders", "layout");
    revalidatePath("/maintenance", "layout");
  }
  return result;
}
