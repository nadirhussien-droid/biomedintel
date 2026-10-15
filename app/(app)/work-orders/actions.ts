"use server";
// Work order actions. Each one re-resolves access on the server and hands the
// raw form values to a service that checks permission, validates, enforces
// scope (and "only the assigned technician" where it applies), writes under
// RLS and audits. Nothing the browser sends decides organisation, role,
// scope or who the assignee is.
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAccess } from "@/server/auth/session";
import { runAction, type ActionResult } from "@/server/actions/result";
import {
  addWorkOrderNote,
  assignWorkOrder,
  cancelWorkOrder,
  completeWorkOrder,
  holdWorkOrder,
  logWork,
  reopenWorkOrder,
  reportFault,
  reviewWorkOrder,
  setWorkOrderPriority,
  startWorkOrder,
  takeWorkOrder,
} from "@/server/services/work-orders";
import { markRead } from "@/server/services/notifications";

export type WoFormState = ActionResult<{ id?: string; number?: string }> & { attempt?: number };

const str = (form: FormData, key: string) => {
  const v = form.get(key);
  return typeof v === "string" ? v : "";
};

async function run(work: () => Promise<unknown>, success: string, prev: WoFormState | null): Promise<WoFormState> {
  const result = await runAction(work, success);
  if (result.ok) {
    revalidatePath("/work-orders", "layout");
    revalidatePath("/assets", "layout");
    revalidatePath("/dashboard");
  }
  return { ...result, data: undefined, attempt: (prev?.attempt ?? 0) + 1 } as WoFormState;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * For actions after which their own form disappears (take, start, hold, sign
 * off, review, reopen, cancel): reopen the job page with a confirmation
 * banner so the person always sees that it worked.
 */
async function runThenShow(
  work: () => Promise<unknown>,
  id: string,
  saved: string,
  prev: WoFormState | null,
): Promise<WoFormState> {
  const result = await run(work, "Done.", prev);
  if (result.ok && UUID.test(id)) redirect(`/work-orders/${id}?saved=${saved}`);
  return result;
}

/** Returns the new job's id so the browser can upload photos to it, then open it. */
export async function reportFaultAction(input: {
  assetId: string;
  faultDescription: string;
  outOfUse: boolean;
  confirmDuplicate: boolean;
}): Promise<WoFormState> {
  const ctx = await requireAccess();
  const result = await runAction(
    () =>
      reportFault(ctx, {
        assetId: String(input?.assetId ?? ""),
        faultDescription: String(input?.faultDescription ?? ""),
        outOfUse: input?.outOfUse === true,
        confirmDuplicate: input?.confirmDuplicate === true,
      }),
    "Fault reported.",
  );
  if (result.ok) {
    revalidatePath("/work-orders", "layout");
    revalidatePath("/assets", "layout");
  }
  return result;
}

export async function assignAction(prev: WoFormState | null, form: FormData) {
  const ctx = await requireAccess();
  return run(
    () => assignWorkOrder(ctx, { id: str(form, "id"), assigneeId: str(form, "assigneeId") }),
    "Job assigned.",
    prev,
  );
}

export async function takeAction(prev: WoFormState | null, form: FormData) {
  const ctx = await requireAccess();
  return runThenShow(() => takeWorkOrder(ctx, { id: str(form, "id") }), str(form, "id"), "taken", prev);
}

export async function priorityAction(prev: WoFormState | null, form: FormData) {
  const ctx = await requireAccess();
  return run(
    () => setWorkOrderPriority(ctx, { id: str(form, "id"), priority: str(form, "priority") }),
    "Priority updated.",
    prev,
  );
}

export async function startAction(prev: WoFormState | null, form: FormData) {
  const ctx = await requireAccess();
  return runThenShow(() => startWorkOrder(ctx, { id: str(form, "id") }), str(form, "id"), "started", prev);
}

export async function holdAction(prev: WoFormState | null, form: FormData) {
  const ctx = await requireAccess();
  return runThenShow(
    () => holdWorkOrder(ctx, { id: str(form, "id"), reason: str(form, "reason") }),
    str(form, "id"),
    "on-hold",
    prev,
  );
}

export async function logWorkAction(prev: WoFormState | null, form: FormData) {
  const ctx = await requireAccess();
  return run(
    () => logWork(ctx, { id: str(form, "id"), description: str(form, "description"), minutes: str(form, "minutes") }),
    "Work logged.",
    prev,
  );
}

export async function noteAction(prev: WoFormState | null, form: FormData) {
  const ctx = await requireAccess();
  return run(() => addWorkOrderNote(ctx, { id: str(form, "id"), note: str(form, "note") }), "Note added.", prev);
}

export async function completeAction(prev: WoFormState | null, form: FormData) {
  const ctx = await requireAccess();
  return runThenShow(
    () =>
      completeWorkOrder(ctx, {
        id: str(form, "id"),
        diagnosis: str(form, "diagnosis"),
        resolution: str(form, "resolution"),
        outcome: str(form, "outcome"),
        functionalCheck: str(form, "functionalCheck"),
        electricalSafetyCheck: str(form, "electricalSafetyCheck"),
        checkNotes: str(form, "checkNotes"),
        failureCategory: str(form, "failureCategory"),
        declaration: form.get("declaration") === "on",
      }),
    str(form, "id"),
    "signed-off",
    prev,
  );
}

/** Stage 6: sign-off of a planned job, with an answer for every checklist item. */
export async function pmCompleteAction(prev: WoFormState | null, form: FormData) {
  const ctx = await requireAccess();
  const keys = form
    .getAll("itemKey")
    .filter((k): k is string => typeof k === "string")
    .slice(0, 60);
  const answers = keys.map((key) => ({
    key,
    result: str(form, `result_${key}`),
    value: str(form, `value_${key}`),
    notes: str(form, `notes_${key}`),
  }));
  return runThenShow(
    () =>
      completeWorkOrder(ctx, {
        id: str(form, "id"),
        resolution: str(form, "resolution"),
        diagnosis: str(form, "diagnosis"),
        answers,
        declaration: form.get("declaration") === "on",
      }),
    str(form, "id"),
    "signed-off",
    prev,
  );
}

export async function reviewAction(prev: WoFormState | null, form: FormData) {
  const ctx = await requireAccess();
  return runThenShow(() => reviewWorkOrder(ctx, { id: str(form, "id") }), str(form, "id"), "reviewed", prev);
}

export async function reopenAction(prev: WoFormState | null, form: FormData) {
  const ctx = await requireAccess();
  return runThenShow(
    () => reopenWorkOrder(ctx, { id: str(form, "id"), reason: str(form, "reason") }),
    str(form, "id"),
    "reopened",
    prev,
  );
}

export async function cancelAction(prev: WoFormState | null, form: FormData) {
  const ctx = await requireAccess();
  return runThenShow(
    () => cancelWorkOrder(ctx, { id: str(form, "id"), reason: str(form, "reason") }),
    str(form, "id"),
    "cancelled",
    prev,
  );
}

export async function markNotificationsReadAction(form: FormData): Promise<void> {
  const ctx = await requireAccess();
  await runAction(() => markRead(ctx, { id: str(form, "id") || "all" }), "Marked as read.");
  revalidatePath("/", "layout");
}
