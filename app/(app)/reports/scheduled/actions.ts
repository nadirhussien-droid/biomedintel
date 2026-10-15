"use server";
// Scheduled-report actions. Access is re-resolved on the server; the service
// checks permission, validates, enforces scope and recipient eligibility,
// writes under RLS and audits.
import { revalidatePath } from "next/cache";
import { requireAccess } from "@/server/auth/session";
import { runAction, type ActionResult } from "@/server/actions/result";
import { createReportSchedule, generateReportNow, setReportScheduleActive } from "@/server/services/report-schedules";

export type ReportFormState = ActionResult<unknown> & { attempt?: number };

const str = (form: FormData, key: string) => {
  const v = form.get(key);
  return typeof v === "string" ? v : "";
};

async function run(
  work: () => Promise<unknown>,
  success: string,
  prev: ReportFormState | null,
): Promise<ReportFormState> {
  const result = await runAction(work, success);
  if (result.ok) revalidatePath("/reports/scheduled");
  return { ...result, data: undefined, attempt: (prev?.attempt ?? 0) + 1 } as ReportFormState;
}

export async function createScheduleAction(prev: ReportFormState | null, form: FormData) {
  const ctx = await requireAccess();
  return run(
    () =>
      createReportSchedule(ctx, {
        name: str(form, "name"),
        kind: str(form, "kind"),
        frequency: str(form, "frequency"),
        hospitalId: str(form, "hospitalId"),
        recipientIds: form.getAll("recipientIds").filter((v): v is string => typeof v === "string"),
      }),
    "Scheduled report saved. It runs with the daily jobs after each period ends.",
    prev,
  );
}

export async function pauseScheduleAction(prev: ReportFormState | null, form: FormData) {
  const ctx = await requireAccess();
  return run(() => setReportScheduleActive(ctx, { id: str(form, "id"), active: false }), "Paused.", prev);
}

export async function resumeScheduleAction(prev: ReportFormState | null, form: FormData) {
  const ctx = await requireAccess();
  return run(() => setReportScheduleActive(ctx, { id: str(form, "id"), active: true }), "Resumed.", prev);
}

export async function generateNowAction(prev: ReportFormState | null, form: FormData) {
  const ctx = await requireAccess();
  let outcome = "";
  const result = await run(
    async () => {
      const r = await generateReportNow(ctx, { id: str(form, "id") });
      outcome = r.outcome;
      return r;
    },
    "Report generated for the last complete period. Recipients were notified in the app.",
    prev,
  );
  if (result.ok && outcome === "exists")
    return { ...result, message: "The report for the last complete period already exists — nothing new was created." };
  if (result.ok && outcome === "failed")
    return {
      ...result,
      ok: false,
      message:
        "The report could not be generated. The failure was logged and it will be retried on the next daily run.",
    } as ReportFormState;
  return result;
}
