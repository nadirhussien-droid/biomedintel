// The signed-in application shell. Every page inside (app) is protected:
// requireAccess() validates the session on the server, resolves the user's
// organisation, role and hospitals, and enforces MFA where required.
import { requireAccess } from "@/server/auth/session";
import { can } from "@/server/authz/access";
import { ROLE_LABELS } from "@/server/authz/roles";
import { withTenant } from "@/server/db/tenant";
import { Sidebar } from "@/components/shell/sidebar";
import { ContextSelectors } from "@/components/shell/context-selectors";
import { UserMenu } from "@/components/shell/user-menu";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireAccess();

  const hospital = ctx.hospitals.find((h) => h.id === ctx.selection.hospitalId);
  const departments = hospital
    ? await withTenant({ userId: ctx.user.id, organizationId: ctx.organization.id }, (tx) =>
        tx.department.findMany({
          where: {
            hospitalId: hospital.id,
            status: "ACTIVE",
            ...(hospital.departments === "ALL" ? {} : { id: { in: hospital.departments } }),
          },
          orderBy: { name: "asc" },
          select: { id: true, name: true },
        }),
      )
    : [];

  return (
    <div className="flex min-h-screen flex-col lg:flex-row">
      <Sidebar canAdmin={can(ctx, "admin.view")} />
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="border-line flex flex-wrap items-end justify-between gap-4 border-b bg-white px-6 py-4 print:hidden">
          <div className="flex flex-col">
            <span className="text-ink-muted text-xs font-semibold tracking-wide uppercase">
              {ctx.organization.name}
            </span>
            <ContextSelectors
              organizations={ctx.organizations.map((o) => ({ id: o.id, name: o.name }))}
              organizationId={ctx.organization.id}
              hospitals={ctx.hospitals.map((h) => ({ id: h.id, name: h.name }))}
              hospitalId={ctx.selection.hospitalId}
              departments={departments}
              departmentId={
                departments.some((d) => d.id === ctx.selection.departmentId) ? ctx.selection.departmentId : null
              }
            />
          </div>
          <UserMenu
            name={ctx.user.name}
            email={ctx.user.email}
            roleLabel={ROLE_LABELS[ctx.role]}
            mfaEnabled={ctx.user.twoFactorEnabled}
          />
        </header>
        <main className="flex flex-1 flex-col gap-6 p-6 print:p-0">{children}</main>
        <footer className="border-line text-ink-muted border-t px-6 py-3 text-xs print:hidden">
          BiomedIntel.ai · Smarter Maintenance. Safer Healthcare. · Development build — not for clinical or production
          use.
        </footer>
      </div>
    </div>
  );
}
