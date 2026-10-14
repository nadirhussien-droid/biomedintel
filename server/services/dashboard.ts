// Real figures for the dashboard foundation (Stage 3).
// Equipment, work order and maintenance figures arrive with their modules;
// until then the dashboard shows them as clearly labelled fictional samples.
import { withTenant } from "../db/tenant";
import { can, requirePermission, type AccessContext } from "../authz/access";

export async function getFoundationSummary(ctx: AccessContext) {
  await requirePermission(ctx, "dashboard.view");
  const hospitalIds = ctx.hospitals.map((h) => h.id);
  const restricted = ctx.hospitals.filter((h) => h.departments !== "ALL").flatMap((h) => h.departments as string[]);
  const allDeptHospitals = ctx.hospitals.filter((h) => h.departments === "ALL").map((h) => h.id);

  return withTenant({ userId: ctx.user.id, organizationId: ctx.organization.id }, async (tx) => {
    const departments = await tx.department.count({
      where: {
        status: "ACTIVE",
        OR: [{ hospitalId: { in: allDeptHospitals } }, { id: { in: restricted } }],
      },
    });
    const members = can(ctx, "member.view") ? await tx.membership.count({ where: { status: "ACTIVE" } }) : null;
    const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const auditEvents = can(ctx, "audit.view")
      ? await tx.auditLog.count({ where: { organizationId: ctx.organization.id, createdAt: { gte: since } } })
      : null;
    const deniedEvents = can(ctx, "audit.view")
      ? await tx.auditLog.count({
          where: { organizationId: ctx.organization.id, outcome: "DENIED", createdAt: { gte: since } },
        })
      : null;
    return { hospitals: hospitalIds.length, departments, members, auditEvents, deniedEvents };
  });
}
