"use server";
// Suppliers, warranties and claims, external service, and asset lifecycle.
// Access is re-resolved on the server; services check permission, validate,
// enforce scope, write under RLS and audit.
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAccess } from "@/server/auth/session";
import { runAction } from "@/server/actions/result";
import type { FormResult } from "@/components/forms/action-form";
import { formInput } from "@/lib/form-input";
import { saveSupplier, setSupplierArchived } from "@/server/services/suppliers";
import { archiveWarranty, createClaim, updateClaimStatus, updateWarranty } from "@/server/services/warranties";
import { createExternalService, updateExternalService } from "@/server/services/external-services";
import { recordDisposal, recordReplacementReview, setAssetSupplier } from "@/server/services/lifecycle";
import { addWarranty } from "@/server/services/assets";

async function run(work: () => Promise<unknown>, success: string, prev: FormResult | null): Promise<FormResult> {
  const result = await runAction(work, success);
  if (result.ok) {
    revalidatePath("/suppliers", "layout");
    revalidatePath("/assets", "layout");
    revalidatePath("/work-orders", "layout");
  }
  return {
    ok: result.ok,
    message: result.message,
    fieldErrors: result.ok ? undefined : result.fieldErrors,
    attempt: (prev?.attempt ?? 0) + 1,
  };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Reopens a page with a confirmation banner when the form disappears after success. */
function showOn(r: FormResult, base: "/assets" | "/work-orders", id: unknown, key: string, hash: string) {
  if (r.ok && typeof id === "string" && UUID.test(id)) redirect(`${base}/${id}?saved=${key}#${hash}`);
  return r;
}

export async function saveSupplierAction(prev: FormResult | null, form: FormData): Promise<FormResult> {
  const ctx = await requireAccess();
  let id = "";
  const r = await run(
    async () => (id = (await saveSupplier(ctx, formInput(form, ["kinds", "manufacturerIds"]))).id),
    "Supplier saved.",
    prev,
  );
  if (r.ok) redirect(`/suppliers/${id}?saved=1`);
  return r;
}
export async function archiveSupplierAction(prev: FormResult | null, form: FormData) {
  const ctx = await requireAccess();
  return run(
    () => setSupplierArchived(ctx, { id: form.get("id"), archived: form.get("archived") === "1" }),
    "Done.",
    prev,
  );
}
export async function addWarrantyAction(prev: FormResult | null, form: FormData) {
  const ctx = await requireAccess();
  return run(() => addWarranty(ctx, formInput(form)), "Warranty or contract recorded.", prev);
}
export async function updateWarrantyAction(prev: FormResult | null, form: FormData) {
  const ctx = await requireAccess();
  return run(() => updateWarranty(ctx, formInput(form)), "Changes saved.", prev);
}
export async function archiveWarrantyAction(prev: FormResult | null, form: FormData) {
  const ctx = await requireAccess();
  return run(() => archiveWarranty(ctx, { id: form.get("id") }), "Archived.", prev);
}
export async function createClaimAction(prev: FormResult | null, form: FormData) {
  const ctx = await requireAccess();
  return run(
    () => createClaim(ctx, formInput(form)),
    "Claim recorded as a draft. Update it when you send it to the supplier.",
    prev,
  );
}
export async function claimStatusAction(prev: FormResult | null, form: FormData) {
  const ctx = await requireAccess();
  const input = formInput(form);
  const assetId = input.assetId;
  delete input.assetId;
  return showOn(
    await run(() => updateClaimStatus(ctx, input), "Claim updated.", prev),
    "/assets",
    assetId,
    "claim-updated",
    "warranties",
  );
}
export async function createServiceAction(prev: FormResult | null, form: FormData) {
  const ctx = await requireAccess();
  return run(() => createExternalService(ctx, formInput(form)), "External service recorded on this job.", prev);
}
export async function updateServiceAction(prev: FormResult | null, form: FormData) {
  const ctx = await requireAccess();
  const input = formInput(form);
  const workOrderId = input.workOrderId;
  delete input.workOrderId;
  return showOn(
    await run(() => updateExternalService(ctx, input), "External service updated.", prev),
    "/work-orders",
    workOrderId,
    "service-updated",
    "external-service",
  );
}
export async function reviewAction(prev: FormResult | null, form: FormData) {
  const ctx = await requireAccess();
  return run(
    () => recordReplacementReview(ctx, formInput(form)),
    "Review recorded. The device status is unchanged.",
    prev,
  );
}
export async function disposalAction(prev: FormResult | null, form: FormData) {
  const ctx = await requireAccess();
  return showOn(
    await run(() => recordDisposal(ctx, formInput(form)), "Disposal recorded.", prev),
    "/assets",
    form.get("assetId"),
    "disposal",
    "lifecycle",
  );
}
export async function assetSupplierAction(prev: FormResult | null, form: FormData) {
  const ctx = await requireAccess();
  return run(() => setAssetSupplier(ctx, formInput(form)), "Supplier recorded.", prev);
}
