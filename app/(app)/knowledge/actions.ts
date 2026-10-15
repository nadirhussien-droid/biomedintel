"use server";
// Knowledge base actions. Access is re-resolved on the server; the service
// checks permission, visibility, validation and writes under RLS with audit.
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAccess } from "@/server/auth/session";
import { runAction } from "@/server/actions/result";
import type { FormResult } from "@/components/forms/action-form";
import { formInput } from "@/lib/form-input";
import {
  addErrorCode,
  approveDocument,
  archiveErrorCode,
  reindexVersion,
  setDocumentStatus,
  updateDocument,
} from "@/server/services/knowledge";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function run(work: () => Promise<unknown>, success: string, prev: FormResult | null): Promise<FormResult> {
  const result = await runAction(work, success);
  if (result.ok) {
    revalidatePath("/knowledge", "layout");
    revalidatePath("/assist", "layout");
  }
  return {
    ok: result.ok,
    message: result.message,
    fieldErrors: result.ok ? undefined : result.fieldErrors,
    attempt: (prev?.attempt ?? 0) + 1,
  };
}
function show(r: FormResult, id: unknown, key: string) {
  if (r.ok && typeof id === "string" && UUID.test(id)) redirect(`/knowledge/${id}?saved=${key}`);
  return r;
}

export async function updateDocumentAction(prev: FormResult | null, form: FormData) {
  const ctx = await requireAccess();
  return show(
    await run(
      () => updateDocument(ctx, formInput(form, ["modelIds", "categoryIds", "manufacturerIds"])),
      "Saved.",
      prev,
    ),
    form.get("id"),
    "updated",
  );
}
export async function approveDocumentAction(prev: FormResult | null, form: FormData) {
  const ctx = await requireAccess();
  return show(await run(() => approveDocument(ctx, formInput(form)), "Approved.", prev), form.get("id"), "approved");
}
export async function documentStatusAction(prev: FormResult | null, form: FormData) {
  const ctx = await requireAccess();
  const status = form.get("status");
  return show(
    await run(() => setDocumentStatus(ctx, formInput(form)), "Done.", prev),
    form.get("id"),
    status === "WITHDRAWN" ? "withdrawn" : "superseded",
  );
}
export async function reindexAction(prev: FormResult | null, form: FormData) {
  const ctx = await requireAccess();
  return run(
    () => reindexVersion(ctx, { versionId: form.get("versionId") }),
    "The file was read again and its passages rebuilt.",
    prev,
  );
}
export async function addErrorCodeAction(prev: FormResult | null, form: FormData) {
  const ctx = await requireAccess();
  return run(() => addErrorCode(ctx, formInput(form)), "Error code added.", prev);
}
export async function archiveErrorCodeAction(prev: FormResult | null, form: FormData) {
  const ctx = await requireAccess();
  return run(
    () => archiveErrorCode(ctx, { id: form.get("id") }),
    "Error code removed from searches (kept in the history).",
    prev,
  );
}
