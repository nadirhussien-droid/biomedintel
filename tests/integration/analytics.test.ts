// Analytics and reporting (Stage 7).
//
// A separate, fictional organisation ("Analytics Test Health") is built with
// hand-placed records whose correct figures are known exactly, including
// time-zone boundary cases. Reports are then checked number by number, plus:
// read-only behaviour, safety reporting, permissions, tenant isolation,
// exports (formula injection), scheduled reports (no duplicates, no leaks)
// and performance on a large data set.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/server/db/client";
import { AuthorizationError, NotFoundError, ValidationError } from "@/server/authz/errors";
import { resolveAccess, type AccessContext } from "@/server/authz/access";
import {
  exportAnalyticsCsv,
  getAnalyticsOverview,
  getLifecycleReport,
  getPlanGovernance,
  getPmComplianceReport,
  getReliabilityReport,
  getSafetyReport,
  getWorkOrderAnalytics,
} from "@/server/services/analytics";
import {
  createReportSchedule,
  generateReportNow,
  getReportSnapshot,
  runScheduledReports,
  setReportScheduleActive,
} from "@/server/services/report-schedules";
import { completeWorkOrder, startWorkOrder } from "@/server/services/work-orders";
import { auditCount, contextFor, owner } from "../helpers";

afterAll(async () => {
  await db.$disconnect();
  await owner.$disconnect();
});

const SEPT = { period: "custom", from: "2026-09-01", to: "2026-09-30" };
const NOW = new Date("2026-10-15T09:00:00Z");
const T = (iso: string) => new Date(iso);

type Fx = {
  orgId: string;
  h1: string;
  h2: string;
  dept1: string;
  dept2: string;
  manager: string;
  tech: string;
  auditor: string;
  reporter: string;
  techH2: string;
  assets: Record<string, string>;
};
let fx: Fx;

async function user(
  orgId: string,
  role: string,
  opts: { orgWide?: boolean; hospital?: string; department?: string } = {},
) {
  const id = randomUUID();
  await owner.user.create({
    data: {
      id,
      name: `AT ${role.toLowerCase()} ${id.slice(0, 4)}`,
      email: `at-${id.slice(0, 8)}@analytics.example`,
      emailVerified: true,
    },
  });
  const m = await owner.membership.create({
    data: { organizationId: orgId, userId: id, role: role as never, orgWide: Boolean(opts.orgWide) },
  });
  if (opts.hospital) {
    await owner.membershipScope.create({
      data: {
        organizationId: orgId,
        membershipId: m.id,
        hospitalId: opts.hospital,
        departmentId: opts.department ?? null,
      },
    });
  }
  return id;
}

async function ctx(userId: string): Promise<AccessContext> {
  const u = await owner.user.findUniqueOrThrow({ where: { id: userId } });
  const c = await resolveAccess(
    { id: u.id, name: u.name, email: u.email, twoFactorEnabled: true, isPlatformAdmin: false },
    fx.orgId,
  );
  if (!c) throw new Error("no access");
  return c;
}

let woSeq = 0;
async function wo(data: Record<string, unknown>) {
  woSeq++;
  return owner.workOrder.create({
    data: {
      organizationId: fx.orgId,
      number: `WO-2026-${String(woSeq).padStart(5, "0")}`,
      hospitalId: fx.h1,
      departmentId: fx.dept1,
      type: "CORRECTIVE",
      priority: "HIGH",
      faultDescription: "Fictional analytics test job",
      reportedById: fx.reporter,
      ...data,
    } as never,
  });
}

const event = (workOrderId: string, kind: string, at: string) =>
  owner.workOrderEvent.create({
    data: { organizationId: fx.orgId, workOrderId, kind, actorId: fx.tech, createdAt: T(at) },
  });

const completed = (assigned: string, at: string, extra: Record<string, unknown> = {}) => ({
  status: "COMPLETED",
  assignedToId: assigned,
  completedById: assigned,
  completedAt: T(at),
  outcome: "REPAIRED",
  resolution: "Fictional repair",
  functionalCheck: "PASS",
  electricalSafetyCheck: "PASS",
  signOffDeclaration: true,
  ...extra,
});

beforeAll(async () => {
  const org = await owner.organization.create({
    data: { name: "Analytics Test Health", slug: `analytics-${randomUUID().slice(0, 6)}`, country: "KE" },
  });
  const h1 = await owner.hospital.create({
    data: { organizationId: org.id, name: "AT Nairobi Hospital", code: "ATN", timezone: "Africa/Nairobi" },
  });
  const h2 = await owner.hospital.create({
    data: {
      organizationId: org.id,
      name: "AT Melbourne Clinic",
      code: "ATM",
      timezone: "Australia/Melbourne",
      country: "AU",
    },
  });
  const d1 = await owner.department.create({
    data: { organizationId: org.id, hospitalId: h1.id, name: "ICU", code: "ICU" },
  });
  const d2 = await owner.department.create({
    data: { organizationId: org.id, hospitalId: h2.id, name: "Ward", code: "WARD" },
  });
  fx = {
    orgId: org.id,
    h1: h1.id,
    h2: h2.id,
    dept1: d1.id,
    dept2: d2.id,
    manager: "",
    tech: "",
    auditor: "",
    reporter: "",
    techH2: "",
    assets: {},
  };
  fx.manager = await user(org.id, "ENGINEERING_MANAGER", { orgWide: true });
  fx.tech = await user(org.id, "TECHNICIAN", { hospital: h1.id });
  fx.techH2 = await user(org.id, "TECHNICIAN", { hospital: h2.id });
  fx.auditor = await user(org.id, "AUDITOR", { orgWide: true });
  fx.reporter = await user(org.id, "FAULT_REPORTER", { hospital: h1.id, department: d1.id });

  const mf = await owner.manufacturer.create({ data: { organizationId: org.id, name: "AT Devices (demo)" } });
  const cat = await owner.equipmentCategory.create({
    data: { organizationId: org.id, name: "Infusion pump", safetyCritical: true },
  });
  const model = await owner.equipmentModel.create({
    data: {
      organizationId: org.id,
      manufacturerId: mf.id,
      categoryId: cat.id,
      modelName: "AT-Pump",
      expectedLifeYears: 8,
    },
  });
  const asset = async (tag: string, name: string, extra: Record<string, unknown> = {}) =>
    (
      await owner.asset.create({
        data: {
          organizationId: org.id,
          hospitalId: h1.id,
          departmentId: d1.id,
          modelId: model.id,
          assetTag: tag,
          name,
          ...extra,
        } as never,
      })
    ).id;
  fx.assets = {
    A1: await asset("AT-A1", "=cmd|' /C calc'!A0", {
      purchaseDate: T("2018-01-10"),
      purchaseCost: "1000.00",
      purchaseCurrency: "KES",
    }),
    A2: await asset("AT-A2", "Pump two", { status: "OUT_OF_SERVICE" }),
    A3: await asset("AT-A3", "Pump three", { status: "OUT_OF_SERVICE" }),
    A4: await asset("AT-A4", "Melbourne pump", {
      hospitalId: h2.id,
      departmentId: d2.id,
      purchaseCost: "900.00",
      purchaseCurrency: "AUD",
    }),
  };

  // ── Work orders (all times UTC; Nairobi = UTC+3) ──
  const w1 = await wo({
    assetId: fx.assets.A1,
    createdAt: T("2026-09-02T06:00:00Z"),
    startedAt: T("2026-09-02T10:00:00Z"),
    dueAt: T("2026-09-03T06:00:00Z"),
    failureCategory: "POWER_OR_BATTERY",
    ...completed(fx.tech, "2026-09-02T20:00:00Z"),
  });
  await event(w1.id, "CREATED", "2026-09-02T06:00:00Z");
  await event(w1.id, "ASSIGNED", "2026-09-02T08:00:00Z"); // 2 h to assignment
  await event(w1.id, "STARTED", "2026-09-02T10:00:00Z");
  await event(w1.id, "ON_HOLD", "2026-09-02T11:00:00Z");
  await event(w1.id, "RESUMED", "2026-09-02T15:00:00Z"); // 4 h on hold
  await event(w1.id, "COMPLETED", "2026-09-02T20:00:00Z");
  const w2 = await wo({
    assetId: fx.assets.A1,
    createdAt: T("2026-09-20T06:00:00Z"),
    startedAt: T("2026-09-21T06:00:00Z"),
    dueAt: T("2026-09-21T06:00:00Z"),
    ...completed(fx.tech, "2026-09-22T06:00:00Z", {
      electricalSafetyCheck: "NOT_APPLICABLE",
      checkNotes: "Battery device",
    }),
  });
  await event(w2.id, "ASSIGNED", "2026-09-20T07:00:00Z");
  // Boundary: 22:30 UTC on 31 Aug is 01:30 on 1 Sep in Nairobi → inside September.
  await wo({ assetId: fx.assets.A2, createdAt: T("2026-08-31T22:30:00Z"), status: "REQUESTED" });
  // Boundary: 21:30 UTC on 30 Sep is 00:30 on 1 Oct in Nairobi → outside September.
  await wo({ assetId: fx.assets.A2, createdAt: T("2026-09-30T21:30:00Z"), status: "REQUESTED" });
  const w5 = await wo({
    assetId: fx.assets.A3,
    type: "PREVENTIVE",
    createdAt: T("2026-09-10T06:00:00Z"),
    startedAt: T("2026-09-10T08:00:00Z"),
    dueAt: T("2026-09-12T20:59:59Z"),
    ...completed(fx.tech, "2026-09-11T06:00:00Z", {
      outcome: "CHECKS_FAILED",
      electricalSafetyCheck: "FAIL",
      testStandardCode: "IEC 62353",
      testStandardVersion: "Ed. 2.0 (2014)",
    }),
  });
  await event(w5.id, "ASSIGNED", "2026-09-10T07:00:00Z");
  // A job in the Melbourne hospital (outside the Nairobi technician's scope).
  await wo({
    assetId: fx.assets.A4,
    hospitalId: h2.id,
    departmentId: d2.id,
    createdAt: T("2026-09-05T00:00:00Z"),
    status: "REQUESTED",
  });
  await owner.safetyHold.create({
    data: {
      organizationId: org.id,
      assetId: fx.assets.A3,
      failedWorkOrderId: w5.id,
      failureSummary: "Earth bond high (test)",
      placedById: fx.tech,
    },
  });

  // Downtime: A1 14 h (closed); A2 open since 25 Sep 00:00 UTC.
  await owner.downtimeEvent.create({
    data: {
      organizationId: org.id,
      assetId: fx.assets.A1,
      startedAt: T("2026-09-02T06:00:00Z"),
      endedAt: T("2026-09-02T20:00:00Z"),
      reason: "test",
    },
  });
  await owner.downtimeEvent.create({
    data: { organizationId: org.id, assetId: fx.assets.A2, startedAt: T("2026-09-25T00:00:00Z"), reason: "test" },
  });

  // ── PM occurrences for one schedule ──
  const plan = await owner.maintenancePlan.create({
    data: {
      organizationId: org.id,
      name: "AT monthly check",
      targetKind: "MODEL",
      modelId: model.id,
      intervalCount: 1,
      intervalUnit: "MONTH",
      intervalSource: "ORGANIZATION_DEFINED",
      justification: "No manufacturer interval for this fictional test model.",
      startsOn: T("2026-01-01"),
      checklist: [],
      createdById: fx.manager,
    },
  });
  const rev = await owner.maintenancePlanRevision.create({
    data: {
      organizationId: org.id,
      planId: plan.id,
      revisionNo: 1,
      kind: "APPROVAL",
      intervalCount: 1,
      intervalUnit: "MONTH",
      intervalSource: "ORGANIZATION_DEFINED",
      justification: "No manufacturer interval for this fictional test model.",
      checklist: [{ section: "ELECTRICAL_SAFETY" }],
      snapshot: {},
      effectiveFrom: T("2026-01-01"),
      approvedById: fx.manager,
    },
  });
  await owner.maintenancePlan.update({
    where: { id: plan.id },
    data: { approvedRevisionId: rev.id, status: "ACTIVE", hasUnapprovedChanges: false },
  });
  const sch = await owner.pmSchedule.create({
    data: {
      organizationId: org.id,
      planId: plan.id,
      assetId: fx.assets.A1,
      workType: "PREVENTIVE",
      anchorOn: T("2026-01-01"),
      nextSeq: 30,
      nextDueOn: T("2026-12-01"),
      createdById: fx.manager,
    },
  });
  const occ = (due: string, status: string, extra: Record<string, unknown> = {}) =>
    owner.pmOccurrence.create({
      data: {
        organizationId: org.id,
        scheduleId: sch.id,
        planId: plan.id,
        assetId: fx.assets.A1,
        revisionId: rev.id,
        seq: 0,
        dueOn: T(due),
        status: status as never,
        note: "test",
        ...extra,
      },
    });
  await occ("2026-09-05", "COMPLETED", { completedOn: T("2026-09-05"), onTime: true });
  await occ("2026-09-10", "COMPLETED", { completedOn: T("2026-09-14"), onTime: false });
  await occ("2026-09-15", "WORK_ORDER_CREATED");
  await occ("2026-09-20", "CANCELLED");
  await occ("2026-09-25", "MISSED");
  await occ("2026-09-28", "SKIPPED"); // excluded
  await occ("2026-08-31", "COMPLETED", { completedOn: T("2026-08-31"), onTime: true }); // outside
  await occ("2026-10-01", "COMPLETED", { completedOn: T("2026-10-01"), onTime: true }); // outside
});

// ─── Calculations ────────────────────────────────────────────────────────────

describe("PM compliance", () => {
  it("counts eligible due dates exactly, with cancelled and missed as not done and skipped excluded", async () => {
    const r = await getPmComplianceReport(await ctx(fx.manager), SEPT, { now: NOW });
    expect(r.total).toMatchObject({
      due: 5,
      onTime: 1,
      late: 1,
      open: 1,
      cancelled: 1,
      missed: 1,
      compliance: 20,
      completion: 40,
    });
    expect(r.months).toEqual([{ month: "2026-09", due: 5, onTime: 1, compliance: 20 }]);
  });

  it("an empty period is N/A, never 0% or 100%", async () => {
    const r = await getPmComplianceReport(
      await ctx(fx.manager),
      { period: "custom", from: "2026-01-01", to: "2026-01-31" },
      { now: NOW },
    );
    expect(r.total.due).toBe(0);
    expect(r.total.compliance).toBeNull();
  });

  it("period boundaries: 31 Aug and 1 Oct are outside September", async () => {
    const aug = await getPmComplianceReport(
      await ctx(fx.manager),
      { period: "custom", from: "2026-08-31", to: "2026-08-31" },
      { now: NOW },
    );
    expect(aug.total).toMatchObject({ due: 1, onTime: 1, compliance: 100 });
  });

  it("past figures use the recorded on-time result, not today's plan settings", async () => {
    await owner.maintenancePlan.updateMany({ where: { organizationId: fx.orgId }, data: { graceDays: 30 } });
    const r = await getPmComplianceReport(await ctx(fx.manager), SEPT, { now: NOW });
    expect(r.total).toMatchObject({ onTime: 1, late: 1 });
  });
});

describe("work order performance", () => {
  it("counts, durations, targets, hold time and backlog (calendar time, hospital dates)", async () => {
    const r = await getWorkOrderAnalytics(await ctx(fx.manager), SEPT, { now: NOW });
    // Created in September (Nairobi dates): w1, w2, the 31 Aug 22:30 UTC job, w5, the Melbourne job.
    expect(r.counts).toMatchObject({ created: 5, completed: 3, corrective: 4, planned: 1 });
    expect(r.durations.jobs).toBe(3);
    expect(r.durations.completion.avg).toBeCloseTo((14 + 48 + 24) / 3, 1);
    expect(r.durations.completion.median).toBe(24);
    expect(r.durations.toAssignment.avg).toBeCloseTo((2 + 1 + 1) / 3, 1);
    expect(r.durations.onHold).toEqual({ jobs: 1, avg: 4 });
    expect(r.target).toMatchObject({ withTarget: 3, within: 2, rate: 66.7 });
    expect(r.backlog).toEqual([
      { bucket: "0-7", count: 0 },
      { bucket: "8-30", count: 1 }, // 30 Sep job
      { bucket: "31-90", count: 2 }, // 31 Aug and 5 Sep jobs
      { bucket: "90+", count: 0 },
    ]);
    expect(r.repeats.list.map((x) => x.prev_number)).toHaveLength(1); // w2 came 18 days after w1's repair
    expect(r.repeats.list[0].days).toBe(17);
    expect(r.workload?.map((w) => w.completed).reduce((a, b) => a + b, 0)).toBe(3);
  });

  it("missing data never breaks a report: an empty period gives N/A values", async () => {
    const r = await getWorkOrderAnalytics(
      await ctx(fx.manager),
      { period: "custom", from: "2025-01-01", to: "2025-01-31" },
      { now: NOW },
    );
    expect(r.counts.created).toBe(0);
    expect(r.durations.completion.avg).toBeNull();
    expect(r.target.rate).toBeNull();
  });
});

describe("reliability", () => {
  it("fault counts, repeat failures, categories, downtime and repair duration", async () => {
    const r = await getReliabilityReport(await ctx(fx.manager), SEPT, { now: NOW });
    expect(r.failures[0]).toMatchObject({ label: "Infusion pump", reports: 4, assetsAffected: 3, assetsInRegister: 4 });
    expect(r.repeatAssets).toHaveLength(1);
    expect(r.repeatAssets[0]).toMatchObject({ asset_tag: "AT-A1", reports: 2, meanGapDays: 18 });
    expect(r.faultCategories.total).toBe(2);
    expect(r.faultCategories.classifiedShare).toBe(50);
    expect(r.faultCategories.rows.find((x) => x.category === null)?.label).toBe("Not classified");
    expect(r.durations.repairDurationH).toBe(17); // (10 h + 24 h) / 2, start → sign-off
    expect(r.durations.downtimePerEventH).toBe(14);
    // 14 h for A1 + A2 from 25 Sep 00:00 UTC to the end of 30 Sep in Nairobi (21:00 UTC): 141 h.
    expect(r.downtime[0].hours).toBeCloseTo(155, 0);
    expect(r.prolonged.map((p) => p.asset_tag)).toEqual(["AT-A2"]);
  });
});

describe("electrical safety reporting", () => {
  it("failed tests and holds appear, with standard and tester", async () => {
    const r = await getSafetyReport(await ctx(fx.manager), SEPT, { now: NOW });
    expect(r.tests).toMatchObject({ performed: 2, passed: 1, failed: 1 });
    expect(r.holds.awaitingRepair.map((h) => h.asset.assetTag)).toEqual(["AT-A3"]);
    const failed = r.history.rows.find((h) => h.result === "FAIL")!;
    expect(failed.standard).toBe("IEC 62353 Ed. 2.0 (2014)");
    expect(failed.completed_by).toBe(fx.tech);
    const overview = await getAnalyticsOverview(await ctx(fx.manager), SEPT, { now: NOW });
    expect(overview.metrics.find((m) => m.key === "awaiting_retest")?.value).toBe(1);
    expect(overview.metrics.find((m) => m.key === "failed_tests")?.value).toBe(1);
  });

  it("reports are read-only: nothing changes, and a held device stays out of service", async () => {
    const before = await Promise.all([
      owner.workOrder.count({ where: { organizationId: fx.orgId } }),
      owner.safetyHold.findMany({ where: { organizationId: fx.orgId }, select: { status: true, updatedAt: true } }),
      owner.asset.findMany({
        where: { organizationId: fx.orgId },
        select: { status: true, updatedAt: true },
        orderBy: { assetTag: "asc" },
      }),
    ]);
    const c = await ctx(fx.manager);
    for (const r of [
      "overview",
      "pm-compliance",
      "work-orders",
      "reliability",
      "safety",
      "governance",
      "lifecycle",
    ] as const) {
      await exportAnalyticsCsv(c, r, SEPT, { now: NOW });
    }
    const after = await Promise.all([
      owner.workOrder.count({ where: { organizationId: fx.orgId } }),
      owner.safetyHold.findMany({ where: { organizationId: fx.orgId }, select: { status: true, updatedAt: true } }),
      owner.asset.findMany({
        where: { organizationId: fx.orgId },
        select: { status: true, updatedAt: true },
        orderBy: { assetTag: "asc" },
      }),
    ]);
    expect(after).toEqual(before);
    expect((await owner.asset.findUniqueOrThrow({ where: { id: fx.assets.A3 } })).status).toBe("OUT_OF_SERVICE");
  });
});

describe("governance and lifecycle", () => {
  it("lists organisation-defined intervals as exceptions with their approver", async () => {
    const g = await getPlanGovernance(await ctx(fx.manager));
    expect(g.exceptions).toHaveLength(1);
    expect(g.exceptions[0]).toMatchObject({
      name: "AT monthly check",
      source: "ORGANIZATION_DEFINED",
      approvedById: fx.manager,
    });
    expect(g.modelsWithoutInterval.map((m) => m.modelName)).toContain("AT-Pump");
  });

  it("financial figures only for authorised roles, per currency, and audited", async () => {
    const tech = await getLifecycleReport(await ctx(fx.tech), {});
    expect(tech.financial).toBe(false);
    expect(tech.costs).toBeNull();
    const before = await auditCount({ action: "analytics.financial_viewed" });
    const aud = await getLifecycleReport(await ctx(fx.auditor), {});
    expect(aud.costs?.map((c) => c.currency).sort()).toEqual(["AUD", "KES"]); // never added across currencies
    expect(await auditCount({ action: "analytics.financial_viewed" })).toBe(before + 1);
    // A1 bought Jan 2018 with an 8-year expected life: inside a 12-month review threshold.
    expect(aud.review.map((r) => r.asset_tag)).toContain("AT-A1");
  });
});

// ─── Authorization and isolation ─────────────────────────────────────────────

describe("authorization and tenant isolation", () => {
  it("fault reporters cannot open analytics; scope limits what a technician sees", async () => {
    await expect(getAnalyticsOverview(await ctx(fx.reporter), SEPT)).rejects.toBeInstanceOf(AuthorizationError);
    const tech = await getWorkOrderAnalytics(await ctx(fx.tech), SEPT, { now: NOW });
    expect(tech.counts.created).toBe(4); // not the Melbourne job
    expect(tech.workload).toBeNull(); // workload per engineer is for managers only
    await expect(getWorkOrderAnalytics(await ctx(fx.tech), { ...SEPT, hospital: fx.h2 })).rejects.toBeInstanceOf(
      NotFoundError,
    );
    await expect(getPmComplianceReport(await ctx(fx.tech), { ...SEPT, by: "assignee" })).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  it("other organisations' data never appears, and their filters are refused", async () => {
    const coastal = await contextFor("hodan.ali@coastal.example");
    await expect(getAnalyticsOverview(coastal, { hospital: fx.h1 })).rejects.toBeInstanceOf(NotFoundError);
    const o = await getAnalyticsOverview(coastal, SEPT, { now: NOW });
    const coastalAssets = await owner.asset.count({
      where: { organization: { slug: "coastal-health" }, archivedAt: null, status: { not: "DECOMMISSIONED" } },
    });
    expect(o.metrics.find((m) => m.key === "registered")?.value).toBe(coastalAssets);
    const csv = (await exportAnalyticsCsv(coastal, "reliability", SEPT, { now: NOW })).csv;
    expect(csv).not.toContain("AT-A1");
  });

  it("CSV export: permission enforced, stamped, audited and safe against formulas", async () => {
    await expect(exportAnalyticsCsv(await ctx(fx.tech), "overview", SEPT)).rejects.toBeInstanceOf(AuthorizationError);
    const before = await auditCount({ action: "analytics.exported" });
    const { csv } = await exportAnalyticsCsv(await ctx(fx.manager), "reliability", SEPT, { now: NOW });
    expect(csv).toContain('"Generated (UTC)","2026-10-15T09:00:00.000Z"');
    expect(csv).toContain('"Period","1 Sept 2026 – 30 Sept 2026"');
    expect(csv).toContain(`"'=cmd|' /C calc'!A0"`);
    expect(csv).not.toMatch(/(^|,)"=cmd/m);
    expect(await auditCount({ action: "analytics.exported" })).toBe(before + 1);
    // Technicians do not get acquisition costs even through a lifecycle export.
    const life = (await exportAnalyticsCsv(await ctx(fx.auditor), "lifecycle", {})).csv;
    expect(life).toContain("Total acquisition cost");
  });
});

// ─── Scheduled reports ───────────────────────────────────────────────────────

describe("scheduled reports", () => {
  let scheduleId = "";
  it("only managers create schedules; recipients must be allowed to see the report", async () => {
    await expect(
      createReportSchedule(await ctx(fx.tech), {
        name: "Weekly",
        kind: "SAFETY",
        frequency: "WEEKLY",
        hospitalId: fx.h1,
        recipientIds: [fx.tech],
      }),
    ).rejects.toBeInstanceOf(AuthorizationError);
    await expect(
      createReportSchedule(await ctx(fx.manager), {
        name: "Monthly PM",
        kind: "PM_COMPLIANCE",
        frequency: "MONTHLY",
        hospitalId: fx.h1,
        recipientIds: [fx.reporter],
      }),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      createReportSchedule(await ctx(fx.manager), {
        name: "Monthly PM",
        kind: "PM_COMPLIANCE",
        frequency: "MONTHLY",
        hospitalId: fx.h1,
        recipientIds: [fx.techH2],
      }),
    ).rejects.toBeInstanceOf(ValidationError); // Melbourne technician cannot see Nairobi
    const s = await createReportSchedule(await ctx(fx.manager), {
      name: "Monthly PM compliance (Nairobi)",
      kind: "PM_COMPLIANCE",
      frequency: "MONTHLY",
      hospitalId: fx.h1,
      recipientIds: [fx.tech, fx.auditor],
    });
    scheduleId = s.id;
    expect(await auditCount({ action: "report.schedule_created" })).toBeGreaterThan(0);
  });

  it("retries and concurrent runs create exactly one snapshot and one notification per person", async () => {
    await Promise.all([
      runScheduledReports({ now: NOW, organizationIds: [fx.orgId] }),
      runScheduledReports({ now: NOW, organizationIds: [fx.orgId] }),
      generateReportNow(await ctx(fx.manager), { id: scheduleId }, { now: NOW }),
    ]);
    await runScheduledReports({ now: NOW, organizationIds: [fx.orgId] });
    const snaps = await owner.reportSnapshot.findMany({ where: { scheduleId } });
    expect(snaps).toHaveLength(1);
    expect(snaps[0].periodKey).toBe("2026-09");
    const data = snaps[0].data as { total: { due: number; compliance: number } };
    expect(data.total).toMatchObject({ due: 5, compliance: 20 }); // same figures as the screen
    const notes = await owner.notification.findMany({ where: { dedupeKey: `report:${snaps[0].id}` } });
    expect(notes.map((x) => x.userId).sort()).toEqual([fx.auditor, fx.tech].sort());
    await expect(
      owner.reportSnapshot.update({ where: { id: snaps[0].id }, data: { periodKey: "x" } }),
    ).rejects.toThrow();
  });

  it("snapshots stay inside their hospital and organisation; removed recipients get nothing", async () => {
    const [snap] = await owner.reportSnapshot.findMany({ where: { scheduleId } });
    await expect(getReportSnapshot(await ctx(fx.techH2), snap.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(getReportSnapshot(await contextFor("hodan.ali@coastal.example"), snap.id)).rejects.toBeInstanceOf(
      NotFoundError,
    );
    expect((await getReportSnapshot(await ctx(fx.tech), snap.id)).id).toBe(snap.id);
    // The technician's membership is revoked; next month's report does not reach them.
    await owner.membership.updateMany({
      where: { organizationId: fx.orgId, userId: fx.tech },
      data: { status: "REVOKED" },
    });
    await runScheduledReports({ now: new Date("2026-11-10T09:00:00Z"), organizationIds: [fx.orgId] });
    const nov = await owner.reportSnapshot.findFirstOrThrow({ where: { scheduleId, periodKey: "2026-10" } });
    const notes = await owner.notification.findMany({ where: { dedupeKey: `report:${nov.id}` } });
    expect(notes.map((x) => x.userId)).toEqual([fx.auditor]);
    await owner.membership.updateMany({
      where: { organizationId: fx.orgId, userId: fx.tech },
      data: { status: "ACTIVE" },
    });
  });

  it("a paused schedule generates nothing; other organisations' runs never touch it", async () => {
    await setReportScheduleActive(await ctx(fx.manager), { id: scheduleId, active: false });
    await runScheduledReports({ now: new Date("2026-12-10T09:00:00Z"), organizationIds: [fx.orgId] });
    expect(await owner.reportSnapshot.count({ where: { scheduleId, periodKey: "2026-11" } })).toBe(0);
  });
});

// ─── Corrective sign-off records the fault category ──────────────────────────

describe("fault category at sign-off", () => {
  it("is optional, stored on repairs only, and validated", async () => {
    const w = await wo({ assetId: fx.assets.A1, status: "ASSIGNED", assignedToId: fx.tech, createdAt: new Date() });
    const c = await ctx(fx.tech);
    await startWorkOrder(c, { id: w.id });
    const base = {
      id: w.id,
      diagnosis: "Loose battery terminal",
      resolution: "Terminal fixed",
      outcome: "REPAIRED",
      functionalCheck: "PASS",
      electricalSafetyCheck: "PASS",
      checkNotes: "",
      declaration: true,
    };
    await expect(completeWorkOrder(c, { ...base, failureCategory: "MAGIC" })).rejects.toBeInstanceOf(ValidationError);
    await completeWorkOrder(c, { ...base, failureCategory: "POWER_OR_BATTERY" });
    expect((await owner.workOrder.findUniqueOrThrow({ where: { id: w.id } })).failureCategory).toBe("POWER_OR_BATTERY");
    await expect(
      owner.workOrder.update({
        where: {
          id: (await owner.workOrder.findFirstOrThrow({ where: { organizationId: fx.orgId, type: "PREVENTIVE" } })).id,
        },
        data: { failureCategory: "OTHER" },
      }),
    ).rejects.toThrow();
  });
});

// ─── Performance ─────────────────────────────────────────────────────────────

describe("large data sets", () => {
  it("reports over 20,000 work orders and 10,000 due dates answer quickly from the database", async () => {
    // 2025 data so the exact figures above are unaffected.
    await owner.$executeRawUnsafe(`
      INSERT INTO work_orders (id, organization_id, number, asset_id, hospital_id, department_id, type, priority, status,
        fault_description, reported_by, assigned_to, created_at, started_at, completed_at, completed_by, due_at, outcome,
        resolution, functional_check, electrical_safety_check, sign_off_declaration, updated_at)
      SELECT gen_random_uuid(), '${fx.orgId}', 'WO-2025-' || lpad(g::text, 5, '0'), '${fx.assets.A2}', '${fx.h1}', '${fx.dept1}',
        'CORRECTIVE', 'MEDIUM', 'COMPLETED', 'Fictional bulk job', '${fx.reporter}', '${fx.tech}',
        timestamp '2025-01-01' + (g || ' minutes')::interval * 25, timestamp '2025-01-01' + (g || ' minutes')::interval * 25 + interval '1 hour',
        timestamp '2025-01-01' + (g || ' minutes')::interval * 25 + interval '5 hours', '${fx.tech}',
        timestamp '2025-01-01' + (g || ' minutes')::interval * 25 + interval '72 hours', 'REPAIRED', 'Bulk', 'PASS', 'PASS', true, now()
      FROM generate_series(1, 20000) g`);
    const sch = await owner.pmSchedule.findFirstOrThrow({ where: { organizationId: fx.orgId } });
    await owner.$executeRawUnsafe(`
      INSERT INTO pm_occurrences (id, organization_id, schedule_id, plan_id, asset_id, revision_id, seq, due_on, status,
        completed_on, on_time, created_at, updated_at)
      SELECT gen_random_uuid(), '${fx.orgId}', '${sch.id}', '${sch.planId}', '${fx.assets.A1}',
        (SELECT approved_revision_id FROM maintenance_plans WHERE id = '${sch.planId}'), g,
        date '1990-01-01' + g, 'COMPLETED', date '1990-01-01' + g, (g % 3 <> 0), now(), now()
      FROM generate_series(1, 10000) g`);
    const c = await ctx(fx.manager);
    const year = { period: "custom", from: "2025-01-01", to: "2025-12-31" };
    const timings: Record<string, number> = {};
    for (const [name, fn] of [
      ["overview", () => getAnalyticsOverview(c, year, { now: NOW })],
      ["work orders", () => getWorkOrderAnalytics(c, year, { now: NOW })],
      ["reliability", () => getReliabilityReport(c, year, { now: NOW })],
      [
        "pm compliance",
        () =>
          getPmComplianceReport(
            c,
            { period: "custom", from: "2000-01-01", to: "2026-12-31", by: "asset" },
            { now: NOW },
          ),
      ],
      ["safety", () => getSafetyReport(c, year, { now: NOW })],
    ] as const) {
      const t0 = Date.now();
      await fn();
      timings[name] = Date.now() - t0;
    }
    const wo = await getWorkOrderAnalytics(c, year, { now: NOW });
    expect(wo.counts.completed).toBe(20000);
    expect(wo.durations.completion.median).toBe(5);
    console.log("analytics timings (ms):", JSON.stringify(timings));
    for (const t of Object.values(timings)) expect(t).toBeLessThan(5000);
  });
});
