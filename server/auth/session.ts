// Data Access Layer for pages and server actions.
//
// Every protected page and server action starts by calling `requireAccess()`.
// It validates the session against the database (not just the cookie), resolves
// the user's organisation, role and hospitals on the server, and enforces MFA
// for privileged roles. The proxy (proxy.ts) only does a quick cookie check to
// redirect signed-out visitors; this is the real security check.
import "server-only";
import { cache } from "react";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "./auth";
import { resolveAccess, type AccessContext, type AuthUser } from "../authz/access";
import type { RequestMeta } from "../audit/audit";
import { serverEnv } from "../env";

export const ORG_COOKIE = "bi_org";
export const HOSPITAL_COOKIE = "bi_hospital";
export const DEPARTMENT_COOKIE = "bi_department";

export const getSession = cache(async () => auth.api.getSession({ headers: await headers() }));

export const getRequestMeta = cache(async (): Promise<RequestMeta> => {
  const h = await headers();
  return {
    requestId: h.get("x-request-id"),
    ipAddress: h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
    userAgent: h.get("user-agent"),
  };
});

/** Signed-in user, or redirect to sign-in. */
export const requireUser = cache(async (): Promise<AuthUser> => {
  const session = await getSession();
  if (!session) redirect("/sign-in");
  const u = session.user as typeof session.user & { platformRole?: string | null; twoFactorEnabled?: boolean | null };
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    twoFactorEnabled: Boolean(u.twoFactorEnabled),
    isPlatformAdmin: u.platformRole === "SUPER_ADMIN",
  };
});

export type Selection = { hospitalId: string | null; departmentId: string | null };

export type PageAccess = AccessContext & { selection: Selection };

/**
 * Signed-in user WITH an active membership and, where required, MFA set up.
 * Otherwise redirects to sign-in, the no-access page or MFA setup.
 */
export const requireAccess = cache(async (): Promise<PageAccess> => {
  const user = await requireUser();
  const jar = await cookies();
  const ctx = await resolveAccess(user, jar.get(ORG_COOKIE)?.value ?? null, await getRequestMeta());
  if (!ctx) redirect(user.isPlatformAdmin ? "/platform" : "/no-access");

  if (ctx.mfaRequired && !user.twoFactorEnabled && serverEnv().REQUIRE_MFA_FOR_PRIVILEGED_ROLES) {
    redirect("/account/security?required=1");
  }

  // Hospital and department selection: cookies are a preference only, accepted
  // only if the server-side scope allows them.
  const wantedHospital = jar.get(HOSPITAL_COOKIE)?.value ?? null;
  const hospital = ctx.hospitals.find((h) => h.id === wantedHospital) ?? null;
  const wantedDepartment = jar.get(DEPARTMENT_COOKIE)?.value ?? null;
  const departmentOk =
    hospital && wantedDepartment && (hospital.departments === "ALL" || hospital.departments.includes(wantedDepartment));

  return {
    ...ctx,
    // When MFA enforcement is switched off for local troubleshooting, treat
    // the user as enrolled so permission checks still run normally.
    user: serverEnv().REQUIRE_MFA_FOR_PRIVILEGED_ROLES ? ctx.user : { ...ctx.user, twoFactorEnabled: true },
    selection: { hospitalId: hospital?.id ?? null, departmentId: departmentOk ? wantedDepartment : null },
  };
});

/** Signed-in Platform Super Administrator with MFA, or redirect. */
export const requirePlatformAdmin = cache(async (): Promise<AuthUser> => {
  const user = await requireUser();
  if (!user.isPlatformAdmin) redirect("/dashboard");
  if (!user.twoFactorEnabled && serverEnv().REQUIRE_MFA_FOR_PRIVILEGED_ROLES) redirect("/account/security?required=1");
  return user;
});
