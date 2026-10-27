"use server";
// Checklist template actions. Each one re-resolves access on the server and hands the raw form
// values to a service that checks permission, validates, writes under RLS and audits.
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAccess } from "@/server/auth/session";
import { runAction, type ActionResult } from "@/server/actions/result";
import { createTemplate, setTemplateArchived, updateTemplate } from "@/server/services/checklist-templates";

export type TemplateFormState = ActionResult<unknown> & { attempt?: number };

const str = (form: FormData, key: string) => {
  const v = form.get(key);
  return typeof v === "string" ? v : "";
};
const fromForm = (form: FormData) => ({
  name: str(form, "name"),
  deviceType: str(form, "deviceType"),
  description: str(form, "description"),
  checklist: str(form, "checklist"),
});

export async function createTemplateAction(prev: TemplateFormState | null, form: FormData): Promise<TemplateFormState> {
  const ctx = await requireAccess();
  const result = await runAction(() => createTemplate(ctx, fromForm(form)), "Template saved.");
  if (result.ok) {
    revalidatePath("/maintenance", "layout");
    redirect("/maintenance/templates?saved=created");
  }
  return { ...result, data: undefined, attempt: (prev?.attempt ?? 0) + 1 } as TemplateFormState;
}

export async function updateTemplateAction(prev: TemplateFormState | null, form: FormData): Promise<TemplateFormState> {
  const ctx = await requireAccess();
  const result = await runAction(() => updateTemplate(ctx, str(form, "id"), fromForm(form)), "Template saved.");
  if (result.ok) {
    revalidatePath("/maintenance", "layout");
    redirect("/maintenance/templates?saved=updated");
  }
  return { ...result, data: undefined, attempt: (prev?.attempt ?? 0) + 1 } as TemplateFormState;
}

export async function archiveTemplateAction(form: FormData): Promise<void> {
  const ctx = await requireAccess();
  await runAction(() => setTemplateArchived(ctx, str(form, "id"), true), "Template archived.");
  revalidatePath("/maintenance", "layout");
  redirect("/maintenance/templates?saved=archived");
}

export async function restoreTemplateAction(form: FormData): Promise<void> {
  const ctx = await requireAccess();
  await runAction(() => setTemplateArchived(ctx, str(form, "id"), false), "Template restored.");
  revalidatePath("/maintenance", "layout");
  redirect("/maintenance/templates?saved=restored");
}
