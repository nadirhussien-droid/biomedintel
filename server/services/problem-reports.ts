// "Report a problem" from the Help panel.
//
// Anyone signed in may send a short report about the page they are on. The
// Organisation Administrator reads and resolves them (Admin → Problem reports)
// and gets an in-app notification for each new one. Reports stay inside the
// organisation (row-level security), are never deleted, and the audit log
// records that a report was made, never its text.
import { withTenant } from "../db/tenant";
import { audit } from "../audit/audit";
import { requirePermission, type AccessContext } from "../authz/access";
import { NotFoundError, ValidationError } from "../authz/errors";
import { parseInput } from "../validation";
import { notify } from "./notifications";
import { peopleNames } from "./work-order-core";
import {
  MAX_REPORTS_PER_DAY,
  PROBLEM_KIND_LABELS,
  problemReportSchema,
  resolveProblemSchema,
} from "@/lib/validation/problem-reports";

const tenant = (ctx: AccessContext) => ({ userId: ctx.user.id, organizationId: ctx.organization.id });

export async function submitProblemReport(ctx: AccessContext, input: unknown) {
  await requirePermission(ctx, "feedback.submit", { entityType: "problem_report" });
  const d = parseInput(problemReportSchema, input);
  return withTenant(tenant(ctx), async (tx) => {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const recent = await tx.problemReport.count({ where: { reporterId: ctx.user.id, createdAt: { gte: since } } });
    if (recent >= MAX_REPORTS_PER_DAY) {
      throw new ValidationError(
        `You have sent ${MAX_REPORTS_PER_DAY} reports in the last 24 hours. Please speak to your administrator directly.`,
      );
    }
    const report = await tx.problemReport.create({
      data: {
        organizationId: ctx.organization.id,
        reporterId: ctx.user.id,
        reporterRole: ctx.role,
        kind: d.kind,
        message: d.message,
        pagePath: d.pagePath,
      },
      select: { id: true },
    });
    await audit(tx, {
      organizationId: ctx.organization.id,
      actorUserId: ctx.user.id,
      action: "problem_report.created",
      entityType: "problem_report",
      entityId: report.id,
      metadata: { kind: d.kind, pagePath: d.pagePath, length: d.message.length },
      request: ctx.request,
    });
    const admins = await tx.membership.findMany({
      where: { status: "ACTIVE", role: "ORG_ADMIN" },
      select: { userId: true },
    });
    await notify(
      tx,
      ctx,
      admins.map((a) => a.userId),
      {
        type: "problem_report.created",
        title: `Problem report: ${PROBLEM_KIND_LABELS[d.kind]}`,
        body: `From ${ctx.user.name}, on ${d.pagePath}`,
        link: "/admin#problem-reports",
        entityType: "problem_report",
        entityId: report.id,
      },
    );
    return report;
  });
}

export async function listProblemReports(ctx: AccessContext) {
  await requirePermission(ctx, "feedback.manage", { entityType: "problem_report" });
  return withTenant(tenant(ctx), async (tx) => {
    const rows = await tx.problemReport.findMany({
      orderBy: [{ status: "asc" }, { createdAt: "desc" }],
      take: 50,
      select: {
        id: true,
        kind: true,
        message: true,
        pagePath: true,
        reporterId: true,
        reporterRole: true,
        status: true,
        createdAt: true,
        resolvedAt: true,
        resolvedById: true,
      },
    });
    const names = await peopleNames(
      tx,
      rows.flatMap((r) => [r.reporterId, r.resolvedById]),
    );
    const open = await tx.problemReport.count({ where: { status: "OPEN" } });
    return { rows, names, open };
  });
}

export async function resolveProblemReport(ctx: AccessContext, input: unknown) {
  await requirePermission(ctx, "feedback.manage", { entityType: "problem_report" });
  const { id } = parseInput(resolveProblemSchema, input);
  return withTenant(tenant(ctx), async (tx) => {
    const r = await tx.problemReport.updateMany({
      where: { id, status: "OPEN" },
      data: { status: "RESOLVED", resolvedAt: new Date(), resolvedById: ctx.user.id },
    });
    if (r.count === 0) {
      const exists = await tx.problemReport.findFirst({ where: { id }, select: { id: true } });
      if (!exists) throw new NotFoundError("Problem report");
      throw new ValidationError("This report is already resolved.");
    }
    await audit(tx, {
      organizationId: ctx.organization.id,
      actorUserId: ctx.user.id,
      action: "problem_report.resolved",
      entityType: "problem_report",
      entityId: id,
      request: ctx.request,
    });
  });
}
