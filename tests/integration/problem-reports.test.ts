// "Report a problem" from the Help panel: anyone sends, the Organisation
// Administrator is notified, reads and resolves; validation, a daily limit,
// isolation between organisations, and reports that can never be deleted.
import { afterAll, describe, expect, it } from "vitest";
import { db } from "@/server/db/client";
import { AuthorizationError, NotFoundError, ValidationError } from "@/server/authz/errors";
import { listProblemReports, resolveProblemReport, submitProblemReport } from "@/server/services/problem-reports";
import { MAX_REPORTS_PER_DAY } from "@/lib/validation/problem-reports";
import { addTestMember, contextFor, orgId, owner, singleConnectionAppDb, userByEmail } from "../helpers";

afterAll(async () => {
  await db.$disconnect();
  await owner.$disconnect();
});

const C = "coastal-health";
const lucy = () => contextFor("lucy.achieng@coastal.example"); // Fault reporter
const amina = () => contextFor("amina.warsame@coastal.example"); // Technician
const hodan = () => contextFor("hodan.ali@coastal.example", C); // Org admin
const fatuma = () => contextFor("fatuma.hassan@coastal.example"); // Auditor
const david = () => contextFor("david.mutua@highland.example"); // Highland admin

describe("report a problem", () => {
  it("anyone can send one; the administrator is notified and the audit log never holds the text", async () => {
    const ctx = await lucy();
    const admin = await userByEmail("hodan.ali@coastal.example");
    const before = await owner.notification.count({ where: { userId: admin.id, type: "problem_report.created" } });
    const r = await submitProblemReport(ctx, {
      kind: "NOT_WORKING",
      message: "The Report fault button does nothing after I add a photo (fictional).",
      pagePath: "/work-orders/new?asset=X#top",
    });
    const row = await owner.problemReport.findUniqueOrThrow({ where: { id: r.id } });
    expect(row.pagePath).toBe("/work-orders/new"); // query and fragment dropped
    expect(row.reporterRole).toBe("FAULT_REPORTER");
    expect(row.status).toBe("OPEN");
    expect(await owner.notification.count({ where: { userId: admin.id, type: "problem_report.created" } })).toBe(
      before + 1,
    );
    const log = await owner.auditLog.findFirstOrThrow({ where: { action: "problem_report.created", entityId: r.id } });
    expect(JSON.stringify(log.metadata)).not.toContain("button does nothing");
  });

  it("validates the kind, the message and the page", async () => {
    const ctx = await amina();
    await expect(
      submitProblemReport(ctx, { kind: "OTHER", message: "Hello there", pagePath: "/" }),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(submitProblemReport(ctx, { kind: "UNCLEAR", message: "  hi ", pagePath: "/" })).rejects.toBeInstanceOf(
      ValidationError,
    );
    await expect(
      submitProblemReport(ctx, { kind: "UNCLEAR", message: "x".repeat(2001), pagePath: "/" }),
    ).rejects.toBeInstanceOf(ValidationError);
    const odd = await submitProblemReport(ctx, {
      kind: "UNCLEAR",
      message: "Which button approves the plan? (fictional)",
      pagePath: "https://evil.example/<script>",
    });
    expect((await owner.problemReport.findUniqueOrThrow({ where: { id: odd.id } })).pagePath).toBe("/");
  });

  it(`a person can send at most ${MAX_REPORTS_PER_DAY} reports in 24 hours`, async () => {
    const email = await addTestMember(C, "TECHNICIAN", [{ hospital: "RGH" }]);
    const ctx = await contextFor(email, C);
    for (let i = 0; i < MAX_REPORTS_PER_DAY; i++) {
      await submitProblemReport(ctx, {
        kind: "SUGGESTION",
        message: `Suggestion number ${i} (fictional)`,
        pagePath: "/",
      });
    }
    await expect(
      submitProblemReport(ctx, { kind: "SUGGESTION", message: "One more (fictional)", pagePath: "/" }),
    ).rejects.toThrow(/in the last 24 hours/);
  });

  it("only the Organisation Administrator reads and resolves them; refusals are audited", async () => {
    for (const ctx of [await amina(), await fatuma(), await lucy()]) {
      await expect(listProblemReports(ctx)).rejects.toBeInstanceOf(AuthorizationError);
    }
    const admin = await hodan();
    const list = await listProblemReports(admin);
    expect(list.rows.length).toBeGreaterThan(0);
    expect(list.open).toBeGreaterThan(0);
    const target = list.rows.find((r) => r.status === "OPEN")!;
    expect(list.names[target.reporterId]).toBeTruthy();
    await expect(resolveProblemReport(await amina(), { id: target.id })).rejects.toBeInstanceOf(AuthorizationError);
    await resolveProblemReport(admin, { id: target.id });
    const row = await owner.problemReport.findUniqueOrThrow({ where: { id: target.id } });
    expect(row.status).toBe("RESOLVED");
    expect(row.resolvedById).toBe(admin.user.id);
    await expect(resolveProblemReport(admin, { id: target.id })).rejects.toThrow(/already resolved/);
  });

  it("another organisation can neither see nor resolve Coastal's reports", async () => {
    const coastal = await orgId(C);
    const report = await owner.problemReport.findFirstOrThrow({ where: { organizationId: coastal, status: "OPEN" } });
    const ctx = await david();
    const list = await listProblemReports(ctx);
    expect(list.rows.some((r) => r.id === report.id)).toBe(false);
    await expect(resolveProblemReport(ctx, { id: report.id })).rejects.toBeInstanceOf(NotFoundError);
  });

  it("reports are never deleted and the database enforces the rules", async () => {
    const coastal = await orgId(C);
    const user = await userByEmail("lucy.achieng@coastal.example");
    const [r] = await owner.$queryRaw<{ del: boolean; rls: boolean; forced: boolean; updMsg: boolean }[]>`
      SELECT has_table_privilege('biomedintel_app', 'problem_reports', 'DELETE') AS del,
             has_column_privilege('biomedintel_app', 'problem_reports', 'message', 'UPDATE') AS "updMsg",
             (SELECT relrowsecurity FROM pg_class WHERE relname = 'problem_reports') AS rls,
             (SELECT relforcerowsecurity FROM pg_class WHERE relname = 'problem_reports') AS forced`;
    expect(r).toEqual({ del: false, updMsg: false, rls: true, forced: true });
    await expect(owner.problemReport.deleteMany({ where: { organizationId: coastal } })).rejects.toThrow();
    const base = { organizationId: coastal, reporterId: user.id, reporterRole: "FAULT_REPORTER", pagePath: "/" };
    await expect(
      owner.problemReport.create({ data: { ...base, kind: "OTHER", message: "Hello there" } }),
    ).rejects.toThrow();
    await expect(
      owner.problemReport.create({ data: { ...base, kind: "UNCLEAR", message: "Hello there", pagePath: "/../etc" } }),
    ).rejects.toThrow();
    await expect(
      owner.problemReport.create({ data: { ...base, kind: "UNCLEAR", message: "Hello there", status: "RESOLVED" } }),
    ).rejects.toThrow();
    // Highland's context cannot write a report into Coastal.
    const single = singleConnectionAppDb();
    try {
      const d = await userByEmail("david.mutua@highland.example");
      const highland = await orgId("highland-medical");
      await expect(
        single.$transaction(async (tx) => {
          await tx.$executeRaw`SELECT set_config('app.user_id', ${d.id}, true), set_config('app.org_id', ${highland}, true)`;
          await tx.problemReport.create({ data: { ...base, kind: "UNCLEAR", message: "Cross-tenant write" } });
        }),
      ).rejects.toThrow();
    } finally {
      await single.$disconnect();
    }
  });
});
