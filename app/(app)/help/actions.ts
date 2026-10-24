"use server";
// Help panel actions. Each re-resolves the user's access on the server; the
// browser never decides the organisation, role or recipient.
import { revalidatePath } from "next/cache";
import { requireAccess } from "@/server/auth/session";
import { runAction, type ActionResult } from "@/server/actions/result";
import { resolveProblemReport, submitProblemReport } from "@/server/services/problem-reports";

const str = (form: FormData, key: string) => {
  const v = form.get(key);
  return typeof v === "string" ? v : "";
};

export async function submitProblemAction(_prev: ActionResult | null, form: FormData): Promise<ActionResult> {
  const ctx = await requireAccess();
  const result = await runAction(
    () =>
      submitProblemReport(ctx, {
        kind: str(form, "kind"),
        message: str(form, "message"),
        pagePath: str(form, "pagePath"),
      }),
    "Thank you. Your report has been sent to your administrator.",
  );
  return { ...result, data: undefined } as ActionResult;
}

export async function resolveProblemAction(form: FormData): Promise<void> {
  const ctx = await requireAccess();
  await runAction(() => resolveProblemReport(ctx, { id: str(form, "id") }), "Marked as resolved.");
  revalidatePath("/admin");
}
