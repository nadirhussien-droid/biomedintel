// A maintenance plan may apply to every asset in one department (24 Oct 2026).
// Same services the pages use; checks the target, the interval rules, scope,
// enrolment, isolation between organisations and the database rules.
import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { db } from "@/server/db/client";
import { NotFoundError, ValidationError } from "@/server/authz/errors";
import { createAsset } from "@/server/services/assets";
import { approvePlan, createPlan, enrolAssets, getPlan, planFormOptions, updatePlan } from "@/server/services/pm-plans";
import { runPmGenerationNow } from "@/server/services/pm-generation";
import { addDays, localToday } from "@/lib/pm/dates";
import {
  addTestMember,
  auditCount,
  coastalAssetInput,
  contextFor,
  departmentId,
  hospitalId,
  modelId,
  owner,
  userByEmail,
} from "../helpers";

const C = "coastal-health";
const TODAY = localToday("Africa/Nairobi");

afterAll(async () => {
  await db.$disconnect();
  await owner.$disconnect();
});

const james = () => contextFor("james.otieno@coastal.example", C); // Engineering Manager, Riverside
const david = () => contextFor("david.mutua@highland.example"); // Highland admin

const CHECKLIST = JSON.stringify([
  { key: "insp", label: "Housing and cables undamaged", section: "INSPECTION" },
  { key: "func", label: "Alarms work", section: "FUNCTIONAL" },
]);

async function deptPlanInput(deptCode: string, over: Record<string, unknown> = {}, hospitalCode = "RGH") {
  return {
    name: `Department plan ${randomUUID().slice(0, 6)}`,
    description: "",
    hospitalId: await hospitalId(C, hospitalCode),
    workType: "INSPECTION",
    targetKind: "DEPARTMENT",
    targetId: await departmentId(C, hospitalCode, deptCode),
    intervalCount: 6,
    intervalUnit: "MONTH",
    intervalSource: "REGULATORY_REQUIREMENT",
    sourceReference: "Fictional hospital policy, section 3",
    justification: "",
    startsOn: addDays(TODAY, -10),
    endsOn: "",
    leadDays: 7,
    graceDays: 0,
    estimatedMinutes: "20",
    defaultAssigneeId: (await userByEmail("amina.warsame@coastal.example")).id,
    requiredCompetency: "",
    priority: "MEDIUM",
    documentReference: "",
    instructions: "Fictional test instructions.",
    checklist: CHECKLIST,
    ...over,
  };
}

async function assetIn(deptCode: string, over: Record<string, unknown> = {}) {
  const created = await createAsset(
    await james(),
    await coastalAssetInput({ departmentId: await departmentId(C, "RGH", deptCode), ...over }),
  );
  return owner.asset.findUniqueOrThrow({ where: { id: created.id } });
}

describe("plan that applies to every asset in one department", () => {
  it("creates a draft plan for a department, audited, and shows it by name", async () => {
    const ctx = await james();
    const before = await auditCount({ action: "pm.plan_created" });
    const plan = await createPlan(ctx, await deptPlanInput("ICU"));
    const row = await owner.maintenancePlan.findUniqueOrThrow({ where: { id: plan.id } });
    expect(row.targetKind).toBe("DEPARTMENT");
    expect(row.departmentId).toBe(await departmentId(C, "RGH", "ICU"));
    expect(row.assetId).toBeNull();
    expect(row.modelId).toBeNull();
    expect(row.categoryId).toBeNull();
    expect(row.status).toBe("DRAFT");
    expect(await auditCount({ action: "pm.plan_created" })).toBe(before + 1);
    expect((await getPlan(ctx, plan.id)).target).toBe("All assets in Intensive Care");
  });

  it("enrols only assets of that department; assets elsewhere are refused", async () => {
    const ctx = await james();
    const icu = await assetIn("ICU");
    const ed = await assetIn("ED");
    const plan = await createPlan(ctx, await deptPlanInput("ICU"));
    await approvePlan(ctx, {
      id: plan.id,
      effectiveFrom: TODAY,
      nextReviewOn: addDays(TODAY, 365),
      note: "",
      confirm: true,
    });
    // The plan page counts exactly the active assets of the ICU (the Emergency pump is not among them).
    const detail = await getPlan(ctx, plan.id);
    const inIcu = await owner.asset.count({
      where: { departmentId: await departmentId(C, "RGH", "ICU"), archivedAt: null, status: { not: "DECOMMISSIONED" } },
    });
    expect(inIcu).toBeGreaterThanOrEqual(2);
    expect(detail.eligible).toBe(inIcu);
    await expect(enrolAssets(ctx, { id: plan.id, firstDueOn: addDays(TODAY, 30), assetIds: [ed.id] })).rejects.toThrow(
      /do not match/,
    );
    const r = await enrolAssets(ctx, { id: plan.id, firstDueOn: addDays(TODAY, 30), assetIds: [icu.id] });
    expect(r.enrolled).toBe(1);
    // One live schedule per asset and type still applies.
    const second = await createPlan(ctx, await deptPlanInput("ICU"));
    const r2 = await enrolAssets(ctx, { id: second.id, firstDueOn: addDays(TODAY, 30), assetIds: [icu.id] });
    expect(r2.enrolled).toBe(0);
    expect(r2.skipped[0].reason).toMatch(/already scheduled/);
  });

  it("the daily job creates a work order for each enrolled asset of the department", async () => {
    const ctx = await james();
    const icu = await assetIn("ICU");
    const plan = await createPlan(ctx, await deptPlanInput("ICU"));
    await approvePlan(ctx, {
      id: plan.id,
      effectiveFrom: TODAY,
      nextReviewOn: addDays(TODAY, 365),
      note: "",
      confirm: true,
    });
    await enrolAssets(ctx, { id: plan.id, firstDueOn: addDays(TODAY, 1), assetIds: [icu.id] });
    await runPmGenerationNow(ctx);
    const schedule = await owner.pmSchedule.findFirstOrThrow({ where: { planId: plan.id, assetId: icu.id } });
    const occurrence = await owner.pmOccurrence.findFirstOrThrow({
      where: { scheduleId: schedule.id },
      include: { workOrder: true },
    });
    expect(occurrence.workOrder?.assetId).toBe(icu.id);
    expect(occurrence.workOrder?.type).toBe("INSPECTION");
  });

  it("follows the interval priority rules: no single manufacturer interval for a department", async () => {
    const ctx = await james();
    await assetIn("ICU"); // an infusion pump with a manufacturer interval on record
    await expect(
      createPlan(ctx, await deptPlanInput("ICU", { intervalSource: "MANUFACTURER" })),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      createPlan(
        ctx,
        await deptPlanInput("ICU", {
          intervalSource: "ORGANIZATION_DEFINED",
          sourceReference: "",
          justification: "We would like a six monthly walk-round of the unit (fictional).",
        }),
      ),
    ).rejects.toThrow(/Manufacturer guidance exists/);
    // A department whose equipment has no manufacturer guidance accepts an organisation-defined interval.
    const org = (await owner.organization.findUniqueOrThrow({ where: { slug: C } })).id;
    const quiet = await owner.department.create({
      data: {
        organizationId: org,
        hospitalId: await hospitalId(C, "RGH"),
        name: "Quiet unit (test)",
        code: `Q${randomUUID().slice(0, 5).toUpperCase()}`,
      },
    });
    const suction = await createAsset(
      ctx,
      await coastalAssetInput({
        departmentId: quiet.id,
        modelId: await modelId(C, "DM-Suction S"),
        riskClass: "LOW",
      }),
    );
    expect(suction.id).toBeDefined();
    const own = await createPlan(ctx, {
      ...(await deptPlanInput("ICU")),
      targetId: quiet.id,
      intervalSource: "ORGANIZATION_DEFINED",
      sourceReference: "",
      justification: "No manufacturer interval for these devices; six months from fault history (fictional).",
    });
    expect(own.id).toBeDefined();
  });

  it("needs a hospital, and the department must belong to that hospital", async () => {
    const ctx = await james();
    await expect(createPlan(ctx, await deptPlanInput("ICU", { hospitalId: "" }))).rejects.toBeInstanceOf(
      ValidationError,
    );
    // Riverside's ICU with Northlake chosen as the hospital.
    await expect(
      createPlan(ctx, await deptPlanInput("ICU", { hospitalId: await hospitalId(C, "NCH") })),
    ).rejects.toBeInstanceOf(Error);
    await expect(createPlan(ctx, await deptPlanInput("ICU", { targetId: randomUUID() }))).rejects.toBeInstanceOf(
      ValidationError,
    );
  });

  it("a department-limited manager can only use their own departments", async () => {
    const email = await addTestMember(C, "ENGINEERING_MANAGER", [{ hospital: "RGH", department: "ICU" }]);
    const ctx = await contextFor(email, C);
    const options = await planFormOptions(ctx);
    expect(options.departments.map((d) => d.name)).toEqual(["Intensive Care"]);
    expect((await createPlan(ctx, await deptPlanInput("ICU"))).id).toBeDefined();
    await expect(createPlan(ctx, await deptPlanInput("ED"))).rejects.toBeInstanceOf(NotFoundError);
  });

  it("an approved plan keeps its department; it cannot be switched to another", async () => {
    const ctx = await james();
    const plan = await createPlan(ctx, await deptPlanInput("ICU"));
    await approvePlan(ctx, {
      id: plan.id,
      effectiveFrom: TODAY,
      nextReviewOn: addDays(TODAY, 365),
      note: "",
      confirm: true,
    });
    await expect(updatePlan(ctx, plan.id, await deptPlanInput("ED"))).rejects.toThrow(/keeps its type and target/);
  });

  it("another organisation cannot use or see a Coastal department", async () => {
    const ctx = await david();
    const input = await deptPlanInput("ICU");
    await expect(createPlan(ctx, input)).rejects.toThrow();
    const options = await planFormOptions(ctx);
    expect(JSON.stringify(options.departments)).not.toContain(await departmentId(C, "RGH", "ICU"));
  });

  it("the database refuses malformed targets", async () => {
    const org = (await owner.organization.findUniqueOrThrow({ where: { slug: C } })).id;
    const user = await userByEmail("james.otieno@coastal.example");
    const base = {
      organizationId: org,
      name: "Raw insert test",
      workType: "INSPECTION" as const,
      intervalCount: 6,
      intervalUnit: "MONTH" as const,
      intervalSource: "REGULATORY_REQUIREMENT" as const,
      sourceReference: "Fictional policy",
      startsOn: new Date(),
      checklist: [],
      createdById: user.id,
    };
    const icu = await departmentId(C, "RGH", "ICU");
    const rgh = await hospitalId(C, "RGH");
    const nch = await hospitalId(C, "NCH");
    // Department plan without a hospital.
    await expect(
      owner.maintenancePlan.create({ data: { ...base, targetKind: "DEPARTMENT", departmentId: icu } }),
    ).rejects.toThrow();
    // Department that belongs to a different hospital.
    await expect(
      owner.maintenancePlan.create({
        data: { ...base, targetKind: "DEPARTMENT", hospitalId: nch, departmentId: icu },
      }),
    ).rejects.toThrow();
    // Department kind with a second target.
    const asset = await assetIn("ICU");
    await expect(
      owner.maintenancePlan.create({
        data: { ...base, targetKind: "DEPARTMENT", hospitalId: rgh, departmentId: icu, assetId: asset.id },
      }),
    ).rejects.toThrow();
    // A manufacturer interval on a department plan.
    await expect(
      owner.maintenancePlan.create({
        data: {
          ...base,
          targetKind: "DEPARTMENT",
          hospitalId: rgh,
          departmentId: icu,
          intervalSource: "MANUFACTURER",
        },
      }),
    ).rejects.toThrow();
    // The well-formed row is accepted.
    const ok = await owner.maintenancePlan.create({
      data: { ...base, targetKind: "DEPARTMENT", hospitalId: rgh, departmentId: icu },
    });
    expect(ok.id).toBeDefined();
  });
});
