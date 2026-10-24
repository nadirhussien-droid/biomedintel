"use server";
// Bulk upload of assets: step 1 checks the file (writes nothing), step 2 saves it.
// The browser only carries the rows between the two steps; the server checks
// them all again, so a changed value gains nothing.
import { revalidatePath } from "next/cache";
import { requireAccess } from "@/server/auth/session";
import { runAction, type ActionResult } from "@/server/actions/result";
import { ImportFileError, MAX_IMPORT_BYTES, parseImportFile, type ImportRow } from "@/lib/asset-import";
import {
  importAssets,
  previewAssetImport,
  type ImportPreview,
  type ImportResult,
} from "@/server/services/asset-import";
import { ValidationError } from "@/server/authz/errors";

const str = (form: FormData, key: string) => {
  const v = form.get(key);
  return typeof v === "string" ? v : "";
};

export type PreviewData = {
  fileName: string;
  hospitalId: string;
  departmentId: string;
  rows: ImportRow[];
  preview: ImportPreview;
  recognised: { field: string; column: string }[];
  ignoredColumns: string[];
  repeatRows: number;
};

export async function previewImportAction(
  _prev: ActionResult<PreviewData> | null,
  form: FormData,
): Promise<ActionResult<PreviewData>> {
  const ctx = await requireAccess();
  const file = form.get("file");
  const hospitalId = str(form, "hospitalId");
  const departmentId = str(form, "departmentId");
  return runAction(async () => {
    if (!(file instanceof File) || file.size === 0)
      throw new ValidationError("Choose a file to upload.", { file: ["Required"] });
    if (file.size > MAX_IMPORT_BYTES)
      throw new ValidationError("The file is larger than 3 MB.", { file: ["Too large"] });
    let parsed;
    try {
      parsed = await parseImportFile(file.name, new Uint8Array(await file.arrayBuffer()));
    } catch (error) {
      if (error instanceof ImportFileError) throw new ValidationError(error.message, { file: [error.message] });
      throw error;
    }
    const preview = await previewAssetImport(ctx, { hospitalId, departmentId, rows: parsed.rows });
    return {
      fileName: file.name,
      hospitalId,
      departmentId,
      rows: parsed.rows,
      preview,
      recognised: parsed.recognised,
      ignoredColumns: parsed.ignoredColumns,
      repeatRows: parsed.repeatRows,
    };
  }, "File checked. Nothing has been saved yet.");
}

export async function confirmImportAction(
  _prev: ActionResult<ImportResult> | null,
  form: FormData,
): Promise<ActionResult<ImportResult>> {
  const ctx = await requireAccess();
  const result = await runAction(async () => {
    let rows: unknown;
    try {
      rows = JSON.parse(str(form, "rows"));
    } catch {
      throw new ValidationError("The checked rows were lost. Please check the file again.");
    }
    return importAssets(ctx, {
      hospitalId: str(form, "hospitalId"),
      departmentId: str(form, "departmentId"),
      rows,
      fileName: str(form, "fileName"),
      authorisationConfirmed: form.get("authorisationConfirmed") === "on",
    });
  }, "Upload finished.");
  if (result.ok) revalidatePath("/assets", "layout");
  return result;
}
