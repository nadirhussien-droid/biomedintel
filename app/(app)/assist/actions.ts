"use server";
// IntellAssist actions. Access is re-resolved on the server; services check
// permission, scope and validation, write under RLS and audit. None of these
// actions can change a device, a work order or a safety hold.
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAccess } from "@/server/auth/session";
import { runAction } from "@/server/actions/result";
import type { FormResult } from "@/components/forms/action-form";
import { formInput } from "@/lib/form-input";
import { findAssetByCode } from "@/server/services/assets";
import {
  addEntry,
  askAi,
  closeSession,
  recordFeedback,
  recordRootCause,
  reopenSession,
  setAiEnabled,
  startSession,
  updateDetails,
} from "@/server/services/troubleshooting";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function run(work: () => Promise<unknown>, success: string, prev: FormResult | null): Promise<FormResult> {
  const result = await runAction(work, success);
  if (result.ok) {
    revalidatePath("/assist", "layout");
    revalidatePath("/work-orders", "layout");
    revalidatePath("/assets", "layout");
  }
  return {
    ok: result.ok,
    message: result.message,
    fieldErrors: result.ok ? undefined : result.fieldErrors,
    attempt: (prev?.attempt ?? 0) + 1,
  };
}
const back = (r: FormResult, id: unknown, key: string) => {
  if (r.ok && typeof id === "string" && UUID.test(id)) redirect(`/assist/${id}?saved=${key}`);
  return r;
};

/** Typed or scanned asset ID → the new-session form for that asset (scope checked by the service). */
export async function findAssetAction(prev: FormResult | null, form: FormData): Promise<FormResult> {
  const ctx = await requireAccess();
  const code = String(form.get("code") ?? "");
  const found = await findAssetByCode(ctx, code).catch(() => null);
  if (found && found.kind === "asset") redirect(`/assist/new?asset=${found.assetId}`);
  return {
    ok: false,
    message: "No asset with that ID in your hospitals and departments.",
    attempt: (prev?.attempt ?? 0) + 1,
  };
}

export async function startSessionAction(prev: FormResult | null, form: FormData): Promise<FormResult> {
  const ctx = await requireAccess();
  let id = "";
  const r = await run(async () => (id = (await startSession(ctx, formInput(form))).id), "Session started.", prev);
  return back(r, id, "started");
}
export async function detailsAction(prev: FormResult | null, form: FormData) {
  const ctx = await requireAccess();
  return run(
    () => updateDetails(ctx, formInput(form)),
    "Details updated. The previous wording is kept in the history.",
    prev,
  );
}
export async function entryAction(prev: FormResult | null, form: FormData) {
  const ctx = await requireAccess();
  return run(() => addEntry(ctx, formInput(form)), "Recorded.", prev);
}
export async function askAction(prev: FormResult | null, form: FormData): Promise<FormResult> {
  const ctx = await requireAccess();
  let message = "";
  let ok = true;
  const r = await run(
    async () => {
      const res = await askAi(ctx, formInput(form));
      message = res.message;
      ok = res.status === "SUCCEEDED";
    },
    "",
    prev,
  );
  return r.ok ? { ...r, ok, message } : r;
}
export async function feedbackAction(prev: FormResult | null, form: FormData) {
  const ctx = await requireAccess();
  return back(
    await run(() => recordFeedback(ctx, formInput(form)), "Assessment recorded.", prev),
    form.get("sessionId"),
    "feedback",
  );
}
export async function rootCauseAction(prev: FormResult | null, form: FormData) {
  const ctx = await requireAccess();
  return run(() => recordRootCause(ctx, formInput(form)), "Root cause recorded.", prev);
}
export async function closeAction(prev: FormResult | null, form: FormData) {
  const ctx = await requireAccess();
  return back(await run(() => closeSession(ctx, formInput(form)), "Session closed.", prev), form.get("id"), "closed");
}
export async function reopenAction(prev: FormResult | null, form: FormData) {
  const ctx = await requireAccess();
  return back(await run(() => reopenSession(ctx, formInput(form)), "Reopened.", prev), form.get("id"), "reopened");
}
export async function aiSettingsAction(prev: FormResult | null, form: FormData) {
  const ctx = await requireAccess();
  return run(
    () => setAiEnabled(ctx, { enabled: form.get("enabled") === "on" }),
    form.get("enabled") === "on" ? "AI suggestions switched on." : "AI suggestions switched off.",
    prev,
  );
}
