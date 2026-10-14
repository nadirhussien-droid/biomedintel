"use server";
// Server actions for the header: switching organisation, hospital, department,
// and signing out. The ids come from the browser, so each one is checked
// against the user's server-side access before it is stored in a cookie.
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { auth } from "@/server/auth/auth";
import { DEPARTMENT_COOKIE, HOSPITAL_COOKIE, ORG_COOKIE, requireAccess, requireUser } from "@/server/auth/session";
import { canAccessDepartment, listUserOrganizations } from "@/server/authz/access";
import { withTenant } from "@/server/db/tenant";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const cookieOptions = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  path: "/",
  maxAge: 60 * 60 * 24 * 30,
};

export async function switchOrganization(organizationId: string) {
  const user = await requireUser();
  const allowed = await listUserOrganizations(user.id);
  if (!allowed.some((o) => o.id === organizationId)) return { ok: false as const };
  const jar = await cookies();
  jar.set(ORG_COOKIE, organizationId, cookieOptions);
  jar.delete(HOSPITAL_COOKIE);
  jar.delete(DEPARTMENT_COOKIE);
  revalidatePath("/", "layout");
  return { ok: true as const };
}

export async function selectHospital(hospitalId: string | null) {
  const ctx = await requireAccess();
  const jar = await cookies();
  jar.delete(DEPARTMENT_COOKIE);
  if (!hospitalId) {
    jar.delete(HOSPITAL_COOKIE);
  } else if (ctx.hospitals.some((h) => h.id === hospitalId)) {
    jar.set(HOSPITAL_COOKIE, hospitalId, cookieOptions);
  } else {
    return { ok: false as const };
  }
  revalidatePath("/", "layout");
  return { ok: true as const };
}

export async function selectDepartment(departmentId: string | null) {
  const ctx = await requireAccess();
  const jar = await cookies();
  if (!departmentId) {
    jar.delete(DEPARTMENT_COOKIE);
  } else {
    const hospitalId = ctx.selection.hospitalId;
    if (!UUID.test(departmentId)) return { ok: false as const };
    if (!hospitalId || !canAccessDepartment(ctx, hospitalId, departmentId)) return { ok: false as const };
    // The department must really belong to the selected hospital (checked under RLS).
    const exists = await withTenant({ userId: ctx.user.id, organizationId: ctx.organization.id }, (tx) =>
      tx.department.count({ where: { id: departmentId, hospitalId, status: "ACTIVE" } }),
    );
    if (exists !== 1) return { ok: false as const };
    jar.set(DEPARTMENT_COOKIE, departmentId, cookieOptions);
  }
  revalidatePath("/", "layout");
  return { ok: true as const };
}

export async function signOut() {
  await auth.api.signOut({ headers: await headers() });
  const jar = await cookies();
  jar.delete(ORG_COOKIE);
  jar.delete(HOSPITAL_COOKIE);
  jar.delete(DEPARTMENT_COOKIE);
  redirect("/sign-in");
}
