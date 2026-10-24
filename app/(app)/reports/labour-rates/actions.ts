"use server";
import { revalidatePath } from "next/cache";
import { requireAccess } from "@/server/auth/session";
import { runAction, type ActionResult } from "@/server/actions/result";
import { addLabourRate } from "@/server/services/labour-rates";

export type RateFormState = ActionResult & { attempt?: number };

const str = (form: FormData, key: string) => {
  const v = form.get(key);
  return typeof v === "string" ? v : "";
};

export async function addRateAction(prev: RateFormState | null, form: FormData): Promise<RateFormState> {
  const ctx = await requireAccess();
  const result = await runAction(
    () =>
      addLabourRate(ctx, {
        userId: str(form, "userId"),
        hourlyRate: str(form, "hourlyRate"),
        currency: str(form, "currency"),
        effectiveFrom: str(form, "effectiveFrom"),
        note: str(form, "note"),
      }),
    "Rate saved.",
  );
  if (result.ok) revalidatePath("/reports/labour-rates");
  return { ...result, data: undefined, attempt: (prev?.attempt ?? 0) + 1 } as RateFormState;
}
