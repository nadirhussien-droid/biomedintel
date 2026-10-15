"use server";
// Organisation administration actions. Each one:
//   • re-resolves the user's access on the server (requireAccess),
//   • passes the raw form values to a service that checks permission, validates
//     input, enforces scope, writes under RLS and records an audit event.
// Nothing sent by the browser decides the organisation, role or scope.
import { revalidatePath } from "next/cache";
import { requireAccess } from "@/server/auth/session";
import { runAction, type ActionResult } from "@/server/actions/result";
import {
  addMember,
  archiveDepartment,
  archiveHospital,
  changeMemberRole,
  createDepartment,
  createHospital,
  resetMemberMfa,
} from "@/server/services/organization-admin";

const str = (form: FormData, key: string) => {
  const v = form.get(key);
  return typeof v === "string" ? v : "";
};

export async function createHospitalAction(_prev: ActionResult | null, form: FormData): Promise<ActionResult> {
  const ctx = await requireAccess();
  const result = await runAction(
    () => createHospital(ctx, { name: str(form, "name"), code: str(form, "code"), timezone: str(form, "timezone") }),
    "Hospital created.",
  );
  if (result.ok) revalidatePath("/", "layout");
  return { ...result, data: undefined } as ActionResult;
}

export async function createDepartmentAction(_prev: ActionResult | null, form: FormData): Promise<ActionResult> {
  const ctx = await requireAccess();
  const result = await runAction(
    () =>
      createDepartment(ctx, { hospitalId: str(form, "hospitalId"), name: str(form, "name"), code: str(form, "code") }),
    "Department created.",
  );
  if (result.ok) revalidatePath("/", "layout");
  return { ...result, data: undefined } as ActionResult;
}

export async function archiveHospitalAction(form: FormData): Promise<void> {
  const ctx = await requireAccess();
  await runAction(() => archiveHospital(ctx, { id: str(form, "id") }), "Hospital archived.");
  revalidatePath("/", "layout");
}

export async function archiveDepartmentAction(form: FormData): Promise<void> {
  const ctx = await requireAccess();
  await runAction(() => archiveDepartment(ctx, { id: str(form, "id") }), "Department archived.");
  revalidatePath("/", "layout");
}

export async function changeMemberRoleAction(_prev: ActionResult | null, form: FormData): Promise<ActionResult> {
  const ctx = await requireAccess();
  const result = await runAction(
    () => changeMemberRole(ctx, { membershipId: str(form, "membershipId"), role: str(form, "role") }),
    "Role updated.",
  );
  if (result.ok) revalidatePath("/admin");
  return { ...result, data: undefined } as ActionResult;
}

/** Stage 6: MFA recovery — remove a member's authenticator after verifying who they are. */
export async function resetMemberMfaAction(_prev: ActionResult | null, form: FormData): Promise<ActionResult> {
  const ctx = await requireAccess();
  const result = await runAction(
    () => resetMemberMfa(ctx, { membershipId: str(form, "membershipId"), reason: str(form, "reason") }),
    "Two-step verification reset. They must set up a new authenticator at their next sign-in.",
  );
  if (result.ok) revalidatePath("/admin");
  return { ...result, data: undefined } as ActionResult;
}

export async function addMemberAction(
  _prev: ActionResult<{ temporaryPassword: string | null }> | null,
  form: FormData,
): Promise<ActionResult<{ temporaryPassword: string | null }>> {
  const ctx = await requireAccess();
  const orgWide = form.get("orgWide") === "on";
  const result = await runAction(
    () =>
      addMember(ctx, {
        email: str(form, "email"),
        name: str(form, "name"),
        role: str(form, "role"),
        orgWide,
        hospitalId: orgWide ? null : str(form, "hospitalId") || null,
        departmentId: orgWide ? null : str(form, "departmentId") || null,
      }),
    "Member added.",
  );
  if (result.ok) revalidatePath("/admin");
  return result.ok
    ? { ok: true, message: result.message, data: { temporaryPassword: result.data?.temporaryPassword ?? null } }
    : result;
}
