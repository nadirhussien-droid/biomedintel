"use server";
// Preventive maintenance actions. Each one re-resolves access on the server
// and hands the raw form values to a service that checks permission,
// validates, enforces scope, writes under RLS and audits. Nothing the browser
// sends decides organisation, role, scope, assignee eligibility or approval.
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAccess } from "@/server/auth/session";
import { runAction, type ActionResult } from "@/server/actions/result";
import {
  approvePlan,
  archivePlan,
  createPlan,
  endSchedule,
  enrolAssets,
  pausePlan,
  resumePlan,
  reviewPlanInterval,
  setModelInterval,
  updatePlan,
} from "@/server/services/pm-plans";
import { runPmGenerationNow } from "@/server/services/pm-generation";
import { approveRelease, createRepairForHold, rejectRelease } from "@/server/services/safety-holds";
import {
  addStandard,
  addStandardRule,
  archiveStandard,
  removeStandardRule,
  verifyStandard,
} from "@/server/services/test-standards";

export type PmFormState = ActionResult<unknown> & { attempt?: number };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const str = (form: FormData, key: string) => {
  const v = form.get(key);
  return typeof v === "string" ? v : "";
};

function refresh() {
  revalidatePath("/maintenance", "layout");
  revalidatePath("/assets", "layout");
  revalidatePath("/work-orders", "layout");
  revalidatePath("/dashboard");
}

async function run(work: () => Promise<unknown>, success: string, prev: PmFormState | null): Promise<PmFormState> {
  const result = await runAction(work, success);
  if (result.ok) refresh();
  return { ...result, data: undefined, attempt: (prev?.attempt ?? 0) + 1 } as PmFormState;
}

/** For actions after which the form disappears: reopen the page with a confirmation banner. */
async function runThenShow(
  work: () => Promise<unknown>,
  path: string,
  saved: string,
  prev: PmFormState | null,
): Promise<PmFormState> {
  const result = await run(work, "Done.", prev);
  if (result.ok) redirect(`${path}?saved=${saved}`);
  return result;
}

function planFromForm(form: FormData) {
  return {
    name: str(form, "name"),
    description: str(form, "description"),
    hospitalId: str(form, "hospitalId"),
    workType: str(form, "workType"),
    targetKind: str(form, "targetKind"),
    targetId: str(form, `target_${str(form, "targetKind")}`),
    intervalCount: str(form, "intervalCount"),
    intervalUnit: str(form, "intervalUnit"),
    intervalSource: str(form, "intervalSource"),
    sourceReference: str(form, "sourceReference"),
    justification: str(form, "justification"),
    startsOn: str(form, "startsOn"),
    endsOn: str(form, "endsOn"),
    leadDays: str(form, "leadDays"),
    graceDays: str(form, "graceDays"),
    estimatedMinutes: str(form, "estimatedMinutes"),
    defaultAssigneeId: str(form, "defaultAssigneeId"),
    requiredCompetency: str(form, "requiredCompetency"),
    priority: str(form, "priority"),
    documentReference: str(form, "documentReference"),
    instructions: str(form, "instructions"),
    checklist: str(form, "checklist"),
  };
}

// ─── Plans ───────────────────────────────────────────────────────────────────

export async function createPlanAction(prev: PmFormState | null, form: FormData): Promise<PmFormState> {
  const ctx = await requireAccess();
  const result = await runAction(() => createPlan(ctx, planFromForm(form)), "Plan saved as a draft.");
  if (result.ok && result.data && typeof result.data === "object" && "id" in result.data) {
    refresh();
    redirect(`/maintenance/plans/${(result.data as { id: string }).id}?saved=created`);
  }
  return { ...result, data: undefined, attempt: (prev?.attempt ?? 0) + 1 } as PmFormState;
}

export async function updatePlanAction(prev: PmFormState | null, form: FormData): Promise<PmFormState> {
  const ctx = await requireAccess();
  const id = str(form, "id");
  if (!UUID.test(id)) return { ok: false, message: "Plan not found." };
  return runThenShow(() => updatePlan(ctx, id, planFromForm(form)), `/maintenance/plans/${id}`, "updated", prev);
}

export async function approvePlanAction(prev: PmFormState | null, form: FormData) {
  const ctx = await requireAccess();
  const id = str(form, "id");
  return runThenShow(
    () =>
      approvePlan(ctx, {
        id,
        effectiveFrom: str(form, "effectiveFrom"),
        nextReviewOn: str(form, "nextReviewOn"),
        note: str(form, "note"),
        confirm: form.get("confirm") === "on",
      }),
    `/maintenance/plans/${id}`,
    "approved",
    prev,
  );
}

export async function reviewPlanAction(prev: PmFormState | null, form: FormData) {
  const ctx = await requireAccess();
  const id = str(form, "id");
  return runThenShow(
    () => reviewPlanInterval(ctx, { id, nextReviewOn: str(form, "nextReviewOn"), note: str(form, "note") }),
    `/maintenance/plans/${id}`,
    "reviewed",
    prev,
  );
}

export async function pausePlanAction(prev: PmFormState | null, form: FormData) {
  const ctx = await requireAccess();
  const id = str(form, "id");
  return runThenShow(
    () => pausePlan(ctx, { id, reason: str(form, "reason") }),
    `/maintenance/plans/${id}`,
    "paused",
    prev,
  );
}

export async function resumePlanAction(prev: PmFormState | null, form: FormData) {
  const ctx = await requireAccess();
  const id = str(form, "id");
  return runThenShow(() => resumePlan(ctx, { id }), `/maintenance/plans/${id}`, "resumed", prev);
}

export async function archivePlanAction(prev: PmFormState | null, form: FormData) {
  const ctx = await requireAccess();
  const id = str(form, "id");
  return runThenShow(
    () => archivePlan(ctx, { id, reason: str(form, "reason") }),
    `/maintenance/plans/${id}`,
    "archived",
    prev,
  );
}

export async function enrolAction(prev: PmFormState | null, form: FormData): Promise<PmFormState> {
  const ctx = await requireAccess();
  const id = str(form, "id");
  const assetIds = form.getAll("assetIds").filter((v): v is string => typeof v === "string" && UUID.test(v));
  const result = await runAction(
    () => enrolAssets(ctx, { id, firstDueOn: str(form, "firstDueOn"), assetIds }),
    "Assets enrolled.",
  );
  if (result.ok) {
    refresh();
    const r = result.data as { enrolled: number; skipped: { assetTag: string; reason: string }[] };
    const skipped = r.skipped.length
      ? ` Not enrolled: ${r.skipped.map((s) => `${s.assetTag} (${s.reason})`).join("; ")}.`
      : "";
    return { ok: true, message: `${r.enrolled} asset(s) enrolled.${skipped}`, attempt: (prev?.attempt ?? 0) + 1 };
  }
  return { ...result, data: undefined, attempt: (prev?.attempt ?? 0) + 1 } as PmFormState;
}

export async function endScheduleAction(prev: PmFormState | null, form: FormData) {
  const ctx = await requireAccess();
  return run(() => endSchedule(ctx, { id: str(form, "id"), reason: str(form, "reason") }), "Schedule ended.", prev);
}

// ─── Generation ──────────────────────────────────────────────────────────────

export async function runGenerationAction(prev: PmFormState | null): Promise<PmFormState> {
  const ctx = await requireAccess();
  const result = await runAction(() => runPmGenerationNow(ctx), "Done.");
  if (!result.ok) return { ...result, attempt: (prev?.attempt ?? 0) + 1 };
  refresh();
  const s = result.data!;
  const parts = [
    `${s.created} work order(s) created`,
    s.missed ? `${s.missed} missed due date(s) recorded` : null,
    s.skipped ? `${s.skipped} skipped` : null,
    `${s.remindersSent} reminder(s) sent`,
  ].filter(Boolean);
  return {
    ok: s.failed === 0,
    message:
      s.failed === 0
        ? `${parts.join(" · ")}.`
        : `${parts.join(" · ")}. ${s.failed} could not be created — see Needs review.`,
    attempt: (prev?.attempt ?? 0) + 1,
  };
}

// ─── Safety holds ────────────────────────────────────────────────────────────

export async function approveReleaseAction(prev: PmFormState | null, form: FormData) {
  const ctx = await requireAccess();
  const id = str(form, "id");
  return runThenShow(
    () => approveRelease(ctx, { id, note: str(form, "note"), confirm: form.get("confirm") === "on" }),
    `/maintenance/holds/${id}`,
    "released",
    prev,
  );
}

export async function rejectReleaseAction(prev: PmFormState | null, form: FormData) {
  const ctx = await requireAccess();
  const id = str(form, "id");
  return runThenShow(
    () => rejectRelease(ctx, { id, note: str(form, "note") }),
    `/maintenance/holds/${id}`,
    "rejected",
    prev,
  );
}

export async function createRepairAction(prev: PmFormState | null, form: FormData) {
  const ctx = await requireAccess();
  const id = str(form, "id");
  return runThenShow(() => createRepairForHold(ctx, { id }), `/maintenance/holds/${id}`, "repair-created", prev);
}

// ─── Settings ────────────────────────────────────────────────────────────────

export async function addStandardAction(prev: PmFormState | null, form: FormData) {
  const ctx = await requireAccess();
  return run(
    () =>
      addStandard(ctx, {
        code: str(form, "code"),
        version: str(form, "version"),
        title: str(form, "title"),
        jurisdictionNote: str(form, "jurisdictionNote"),
      }),
    "Standard added. An Engineering Manager must verify it before use.",
    prev,
  );
}

export async function verifyStandardAction(prev: PmFormState | null, form: FormData) {
  const ctx = await requireAccess();
  return run(() => verifyStandard(ctx, { id: str(form, "id"), note: str(form, "note") }), "Standard verified.", prev);
}

export async function archiveStandardAction(prev: PmFormState | null, form: FormData) {
  const ctx = await requireAccess();
  return run(() => archiveStandard(ctx, { id: str(form, "id") }), "Standard archived.", prev);
}

export async function addRuleAction(prev: PmFormState | null, form: FormData) {
  const ctx = await requireAccess();
  return run(
    () =>
      addStandardRule(ctx, {
        standardId: str(form, "standardId"),
        hospitalId: str(form, "hospitalId"),
        country: str(form, "country"),
        categoryId: str(form, "categoryId"),
      }),
    "Rule saved.",
    prev,
  );
}

export async function removeRuleAction(prev: PmFormState | null, form: FormData) {
  const ctx = await requireAccess();
  return run(() => removeStandardRule(ctx, { id: str(form, "id") }), "Rule removed.", prev);
}

export async function setModelIntervalAction(prev: PmFormState | null, form: FormData) {
  const ctx = await requireAccess();
  return run(
    () =>
      setModelInterval(ctx, {
        modelId: str(form, "modelId"),
        count: str(form, "count"),
        unit: str(form, "unit"),
        reference: str(form, "reference"),
      }),
    "Manufacturer interval saved.",
    prev,
  );
}
