"use server";
import { revalidatePath } from "next/cache";
import { getRequestMeta, requirePlatformAdmin } from "@/server/auth/session";
import { runAction, type ActionResult } from "@/server/actions/result";
import { createOrganization } from "@/server/services/platform";

const str = (form: FormData, key: string) => {
  const v = form.get(key);
  return typeof v === "string" ? v : "";
};

export async function createOrganizationAction(
  _prev: ActionResult<{ temporaryPassword: string | null }> | null,
  form: FormData,
): Promise<ActionResult<{ temporaryPassword: string | null }>> {
  const user = await requirePlatformAdmin();
  const request = await getRequestMeta();
  const result = await runAction(
    () =>
      createOrganization(
        user,
        {
          name: str(form, "name"),
          slug: str(form, "slug"),
          country: str(form, "country"),
          adminName: str(form, "adminName"),
          adminEmail: str(form, "adminEmail"),
        },
        request,
      ),
    "Organisation created.",
  );
  if (result.ok) revalidatePath("/platform");
  return result.ok
    ? { ok: true, message: result.message, data: { temporaryPassword: result.data?.temporaryPassword ?? null } }
    : result;
}
