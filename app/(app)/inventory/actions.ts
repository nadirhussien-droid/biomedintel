"use server";
// Spare parts, stock, work-order parts, purchase requests and reminder settings.
// Each action re-resolves access on the server and hands the raw form values
// to a service that checks permission, validates, enforces scope, writes
// under RLS and audits. Nothing the browser sends decides organisation,
// hospital, role or quantities on hand.
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAccess } from "@/server/auth/session";
import { runAction } from "@/server/actions/result";
import type { FormResult } from "@/components/forms/action-form";
import { formInput } from "@/lib/form-input";
import {
  adjustStock,
  createStore,
  receiveStock,
  saveInventorySettings,
  savePart,
  setPartArchived,
  setStoreArchived,
  transferStock,
  type StockResult,
} from "@/server/services/inventory";
import {
  issueParts,
  recordPartUnavailable,
  releaseReservation,
  reserveParts,
  returnParts,
} from "@/server/services/work-order-parts";
import {
  cancelPurchaseRequest,
  createPurchaseRequest,
  decidePurchaseRequest,
  markPurchaseOrdered,
  submitPurchaseRequest,
} from "@/server/services/purchasing";

function refresh() {
  revalidatePath("/inventory", "layout");
  revalidatePath("/work-orders", "layout");
}

async function run(work: () => Promise<unknown>, success: string, prev: FormResult | null): Promise<FormResult> {
  let duplicate = false;
  const result = await runAction(async () => {
    const r = await work();
    duplicate = Boolean(r && typeof r === "object" && (r as StockResult).duplicate);
    return r;
  }, success);
  if (result.ok) refresh();
  return {
    ok: result.ok,
    message:
      result.ok && duplicate
        ? "Already recorded: this submission was received once, so nothing was added twice."
        : result.message,
    fieldErrors: result.ok ? undefined : result.fieldErrors,
    attempt: (prev?.attempt ?? 0) + 1,
  };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * For actions after which the form disappears (the job or request moves on):
 * reopen the page with a confirmation banner. A duplicate submission is not
 * redirected, so its "already recorded" message stays visible.
 */
async function runThenShow(
  work: () => Promise<unknown>,
  success: string,
  prev: FormResult | null,
  base: "/work-orders" | "/inventory/purchasing",
  id: unknown,
  key: string,
): Promise<FormResult> {
  const r = await run(work, success, prev);
  const duplicate = r.message?.startsWith("Already recorded");
  if (r.ok && !duplicate && typeof id === "string" && UUID.test(id)) {
    redirect(`${base}/${id}?saved=${key}${base === "/work-orders" ? "#parts" : ""}`);
  }
  return r;
}

const PART_ARRAYS = ["modelIds", "categoryIds", "compatManufacturerIds", "supplierIds"];

export async function savePartAction(prev: FormResult | null, form: FormData): Promise<FormResult> {
  const ctx = await requireAccess();
  let id = "";
  const r = await run(async () => (id = (await savePart(ctx, formInput(form, PART_ARRAYS))).id), "Part saved.", prev);
  if (r.ok) redirect(`/inventory/parts/${id}?saved=1`);
  return r;
}
export async function archivePartAction(prev: FormResult | null, form: FormData) {
  const ctx = await requireAccess();
  return run(() => setPartArchived(ctx, { id: form.get("id"), archived: form.get("archived") === "1" }), "Done.", prev);
}
export async function createStoreAction(prev: FormResult | null, form: FormData) {
  const ctx = await requireAccess();
  return run(() => createStore(ctx, formInput(form)), "Store added.", prev);
}
export async function archiveStoreAction(prev: FormResult | null, form: FormData) {
  const ctx = await requireAccess();
  return run(
    () => setStoreArchived(ctx, { id: form.get("id"), archived: form.get("archived") === "1" }),
    "Done.",
    prev,
  );
}
export async function receiveAction(prev: FormResult | null, form: FormData) {
  const ctx = await requireAccess();
  const input = formInput(form);
  const requestId = input.purchaseRequestId;
  delete input.purchaseRequestId; // only used to reopen the request page
  if (requestId) {
    return runThenShow(
      () => receiveStock(ctx, input),
      "Stock received and recorded.",
      prev,
      "/inventory/purchasing",
      requestId,
      "received",
    );
  }
  return run(() => receiveStock(ctx, input), "Stock received and recorded.", prev);
}
export async function transferAction(prev: FormResult | null, form: FormData) {
  const ctx = await requireAccess();
  return run(() => transferStock(ctx, formInput(form)), "Transfer recorded.", prev);
}
export async function adjustAction(prev: FormResult | null, form: FormData) {
  const ctx = await requireAccess();
  return run(
    () => adjustStock(ctx, formInput(form)),
    form.get("writeOff") ? "Write-off recorded." : "Adjustment recorded.",
    prev,
  );
}
export async function reserveAction(prev: FormResult | null, form: FormData) {
  const ctx = await requireAccess();
  return runThenShow(
    () => reserveParts(ctx, formInput(form)),
    "Reserved for this job.",
    prev,
    "/work-orders",
    form.get("workOrderId"),
    "parts-reserved",
  );
}
export async function releaseAction(prev: FormResult | null, form: FormData) {
  const ctx = await requireAccess();
  return runThenShow(
    () => releaseReservation(ctx, formInput(form)),
    "Reservation released.",
    prev,
    "/work-orders",
    form.get("workOrderId"),
    "parts-released",
  );
}
export async function issueAction(prev: FormResult | null, form: FormData) {
  const ctx = await requireAccess();
  return runThenShow(
    () => issueParts(ctx, formInput(form)),
    "Issued to this job. Stock updated.",
    prev,
    "/work-orders",
    form.get("workOrderId"),
    "parts-issued",
  );
}
export async function returnAction(prev: FormResult | null, form: FormData) {
  const ctx = await requireAccess();
  return runThenShow(
    () => returnParts(ctx, formInput(form)),
    "Return recorded. Stock updated.",
    prev,
    "/work-orders",
    form.get("workOrderId"),
    "parts-returned",
  );
}
export async function unavailableAction(prev: FormResult | null, form: FormData) {
  const ctx = await requireAccess();
  return run(() => recordPartUnavailable(ctx, formInput(form)), "Recorded in the job timeline.", prev);
}
export async function saveSettingsAction(prev: FormResult | null, form: FormData) {
  const ctx = await requireAccess();
  return run(() => saveInventorySettings(ctx, formInput(form)), "Settings saved.", prev);
}

// ─── Purchase requests ───────────────────────────────────────────────────────

export async function createPurchaseAction(prev: FormResult | null, form: FormData): Promise<FormResult> {
  const ctx = await requireAccess();
  const raw = formInput(form, ["linePart", "lineQuantity", "lineCost", "lineCurrency"]);
  const parts = raw.linePart as string[];
  const lines = parts
    .map((partId, i) => ({
      partId,
      quantity: (raw.lineQuantity as string[])[i] ?? "",
      estimatedUnitCost: (raw.lineCost as string[])[i] ?? "",
      currency: (raw.lineCurrency as string[])[i] ?? "",
    }))
    .filter((l) => l.partId);
  let id = "";
  const r = await run(
    async () =>
      (id = (
        await createPurchaseRequest(ctx, {
          hospitalId: raw.hospitalId,
          supplierId: raw.supplierId,
          justification: raw.justification,
          lines,
        })
      ).id),
    "Draft saved.",
    prev,
  );
  if (r.ok) redirect(`/inventory/purchasing/${id}?saved=1`);
  return r;
}
export async function submitPurchaseAction(prev: FormResult | null, form: FormData) {
  const ctx = await requireAccess();
  return runThenShow(
    () => submitPurchaseRequest(ctx, formInput(form)),
    "Submitted for approval.",
    prev,
    "/inventory/purchasing",
    form.get("id"),
    "submitted",
  );
}
export async function decidePurchaseAction(prev: FormResult | null, form: FormData) {
  const ctx = await requireAccess();
  return runThenShow(
    () => decidePurchaseRequest(ctx, formInput(form)),
    form.get("approve") ? "Approved." : "Rejected.",
    prev,
    "/inventory/purchasing",
    form.get("id"),
    form.get("approve") ? "approved" : "rejected",
  );
}
export async function orderedPurchaseAction(prev: FormResult | null, form: FormData) {
  const ctx = await requireAccess();
  return runThenShow(
    () => markPurchaseOrdered(ctx, formInput(form)),
    "Marked as ordered.",
    prev,
    "/inventory/purchasing",
    form.get("id"),
    "ordered",
  );
}
export async function cancelPurchaseAction(prev: FormResult | null, form: FormData) {
  const ctx = await requireAccess();
  return runThenShow(
    () => cancelPurchaseRequest(ctx, formInput(form)),
    "Request cancelled.",
    prev,
    "/inventory/purchasing",
    form.get("id"),
    "cancelled",
  );
}
