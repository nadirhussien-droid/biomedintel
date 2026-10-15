// Preventive maintenance (Stage 6): plans, approval and interval rules,
// scheduling, automatic work orders (idempotency, concurrency, failure and
// recovery), checklist sign-off, the failed-safety-test hold with
// second-person approval, notifications, reports, barcode entry and security.
// Calls the same services the pages, the npm script and the scheduler use.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/server/db/client";
import { withTenant } from "@/server/db/tenant";
import { AuthorizationError, NotFoundError, ValidationError } from "@/server/authz/errors";
import { archiveAsset, changeAssetStatus, createAsset, findAssetByCode } from "@/server/services/assets";
import {
  cancelWorkOrder,
  completeWorkOrder,
  getWorkOrder,
  reopenWorkOrder,
  startWorkOrder,
  takeWorkOrder,
  assignWorkOrder,
} from "@/server/services/work-orders";
import {
  approvePlan,
  archivePlan,
  createPlan,
  endSchedule,
  enrolAssets,
  getNeedsReview,
  getPlan,
  listPlans,
  pausePlan,
  resumePlan,
  reviewPlanInterval,
  setModelInterval,
  updatePlan,
} from "@/server/services/pm-plans";
import { runPmGenerationNow, runScheduledGeneration } from "@/server/services/pm-generation";
import { exportPmCsv, getAssetPm, getPmReport, listSchedule } from "@/server/services/pm-schedule";
import { approveRelease, getSafetyHold, rejectRelease } from "@/server/services/safety-holds";
import { addStandard, addStandardRule, verifyStandard } from "@/server/services/test-standards";
import { addDays, endOfLocalDay, localToday } from "@/lib/pm/dates";
import { POST as cronPost } from "@/app/api/cron/pm-generate/route";
import {
  addTestMember,
  assetId,
  auditCount,
  coastalAssetInput,
  contextFor,
  hospitalId,
  modelId,
  orgId,
  owner,
  userByEmail,
} from "../helpers";

const C = "coastal-health";
const H = "highland-medical";
const TODAY = localToday("Africa/Nairobi");

afterAll(async () => {
  await db.$disconnect();
  await owner.$disconnect();
});

const james = () => contextFor("james.otieno@coastal.example", C); // Engineering Manager, Riverside
const amina = () => contextFor("amina.warsame@coastal.example"); // Technician
const hodan = () => contextFor("hodan.ali@coastal.example"); // Org admin (org-wide)
const peter = () => contextFor("peter.kamau@coastal.example"); // Department Head
const fatuma = () => contextFor("fatuma.hassan@coastal.example"); // Auditor
const lucy = () => contextFor("lucy.achieng@coastal.example"); // Fault Reporter
const david = () => contextFor("david.mutua@highland.example"); // Highland admin

let secondManagerEmail = "";
beforeAll(async () => {
  // A second Riverside engineering manager, for the second-person rule.
  secondManagerEmail = await addTestMember(C, "ENGINEERING_MANAGER", [{ hospital: "RGH" }]);
});
const manager2 = () => contextFor(secondManagerEmail, C);

const ITEMS = [
  { key: "insp", label: "Housing and cables undamaged", section: "INSPECTION" },
  { key: "func", label: "Alarms work", section: "FUNCTIONAL" },
  {
    key: "es_pe",
    label: "Protective earth resistance",
    section: "ELECTRICAL_SAFETY",
    kind: "MEASUREMENT",
    unit: "Ω",
    max: 0.3,
  },
];
const NO_ES = ITEMS.slice(0, 2);

/** A fresh Riverside ICU infusion pump so each test controls its own schedule. */
async function freshAsset(overrides: Record<string, unknown> = {}) {
  const created = await createAsset(await james(), await coastalAssetInput(overrides));
  return owner.asset.findUniqueOrThrow({ where: { id: created.id } });
}

async function planInput(target: string, over: Record<string, unknown> = {}) {
  return {
    name: `Test plan ${randomUUID().slice(0, 6)}`,
    description: "",
    hospitalId: await hospitalId(C, "RGH"),
    workType: "PREVENTIVE",
    targetKind: "ASSET",
    targetId: target,
    intervalCount: 1,
    intervalUnit: "MONTH",
    intervalSource: "REGULATORY_REQUIREMENT",
    sourceReference: "Fictional health regulation, clause 4.1",
    justification: "",
    startsOn: addDays(TODAY, -400),
    endsOn: "",
    leadDays: 7,
    graceDays: 0,
    estimatedMinutes: "30",
    defaultAssigneeId: (await userByEmail("amina.warsame@coastal.example")).id,
    requiredCompetency: "",
    priority: "MEDIUM",
    documentReference: "",
    instructions: "Fictional test instructions.",
    checklist: JSON.stringify(ITEMS),
    ...over,
  };
}

const approve = async (id: string, ctx?: Awaited<ReturnType<typeof james>>) =>
  approvePlan(ctx ?? (await james()), {
    id,
    effectiveFrom: TODAY,
    nextReviewOn: addDays(TODAY, 365),
    note: "",
    confirm: true,
  });

/** Fresh asset + approved plan + schedule whose first due date is `offset` days from today. */
async function scheduled(offset: number, over: Record<string, unknown> = {}) {
  const asset = await freshAsset();
  const plan = await createPlan(await james(), await planInput(asset.id, over));
  await approve(plan.id);
  await enrolAssets(await james(), { id: plan.id, firstDueOn: addDays(TODAY, offset), assetIds: [asset.id] });
  const schedule = await owner.pmSchedule.findFirstOrThrow({ where: { planId: plan.id, assetId: asset.id } });
  return { asset, planId: plan.id, schedule };
}

/** Expects a ValidationError whose field messages (or message) match. */
async function rejectsWith(promise: Promise<unknown>, pattern: RegExp) {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(ValidationError);
  const v = error as ValidationError;
  const text = [v.message, ...Object.values(v.fieldErrors).flat()].join(" | ");
  expect(text).toMatch(pattern);
}

const occurrencesOf = (scheduleId: string) =>
  owner.pmOccurrence.findMany({ where: { scheduleId }, orderBy: { dueOn: "asc" }, include: { workOrder: true } });

/** Takes, starts and returns the PM job as the assigned technician. */
async function startAsAmina(workOrderId: string) {
  const wo = await owner.workOrder.findUniqueOrThrow({ where: { id: workOrderId } });
  if (wo.status === "REQUESTED") await takeWorkOrder(await amina(), { id: workOrderId });
  await startWorkOrder(await amina(), { id: workOrderId });
}

const answers = (over: Record<string, { result: string; value?: number | string; notes?: string }> = {}) =>
  ITEMS.map((i) => ({
    key: i.key,
    result: over[i.key]?.result ?? "PASS",
    value: over[i.key]?.value ?? (i.kind === "MEASUREMENT" ? 0.12 : null),
    notes: over[i.key]?.notes ?? null,
  }));

const signOff = async (id: string, a = answers(), ctx?: Awaited<ReturnType<typeof amina>>) =>
  completeWorkOrder(ctx ?? (await amina()), {
    id,
    resolution: "PM carried out as per checklist (fictional).",
    diagnosis: "",
    answers: a,
    declaration: true,
  });

// ─── Maintenance plans ───────────────────────────────────────────────────────

describe("maintenance plans", () => {
  it("creates a valid plan as a draft, audited, which generates nothing until approved", async () => {
    const asset = await freshAsset();
    const plan = await createPlan(await james(), await planInput(asset.id));
    const row = await owner.maintenancePlan.findUniqueOrThrow({ where: { id: plan.id } });
    expect(row.status).toBe("DRAFT");
    expect(row.approvedRevisionId).toBeNull();
    expect(await auditCount({ action: "pm.plan_created" })).toBeGreaterThan(0);
    await enrolAssets(await james(), { id: plan.id, firstDueOn: addDays(TODAY, -1), assetIds: [asset.id] });
    await runPmGenerationNow(await james());
    const s = await owner.pmSchedule.findFirstOrThrow({ where: { planId: plan.id } });
    expect(await occurrencesOf(s.id)).toHaveLength(0);
  });

  it("validates required fields, real dates, date order and interval limits", async () => {
    const asset = await freshAsset();
    const ctx = await james();
    await expect(createPlan(ctx, await planInput(asset.id, { name: "" }))).rejects.toBeInstanceOf(ValidationError);
    await expect(createPlan(ctx, await planInput(asset.id, { startsOn: "2027-02-30" }))).rejects.toBeInstanceOf(
      ValidationError,
    );
    await rejectsWith(
      createPlan(ctx, await planInput(asset.id, { startsOn: TODAY, endsOn: addDays(TODAY, -1) })),
      /end date/i,
    );
    await rejectsWith(createPlan(ctx, await planInput(asset.id, { intervalCount: 200 })), /At most 120/);
    await expect(createPlan(ctx, await planInput(asset.id, { intervalCount: 0 }))).rejects.toBeInstanceOf(
      ValidationError,
    );
    await rejectsWith(createPlan(ctx, await planInput(asset.id, { checklist: "[]" })), /checklist item/i);
    await expect(
      createPlan(
        ctx,
        await planInput(asset.id, {
          checklist: JSON.stringify([
            { key: "m", label: "Leakage", section: "ELECTRICAL_SAFETY", kind: "MEASUREMENT" },
          ]),
        }),
      ),
    ).rejects.toBeInstanceOf(ValidationError); // a measurement needs a unit
  });

  it("enforces the interval priority rules (requirement → manufacturer → organisation-defined)", async () => {
    const asset = await freshAsset(); // DM-Infuse 100: manufacturer interval on record (12 months)
    const ctx = await james();
    // Organisation-defined needs a justification …
    await rejectsWith(
      createPlan(ctx, await planInput(asset.id, { intervalSource: "ORGANIZATION_DEFINED", sourceReference: "" })),
      /Explain why/i,
    );
    // … and is refused where manufacturer guidance exists.
    await expect(
      createPlan(
        ctx,
        await planInput(asset.id, {
          intervalSource: "ORGANIZATION_DEFINED",
          justification: "We think a month is about right for this one (fictional).",
        }),
      ),
    ).rejects.toThrow(/Manufacturer guidance exists/);
    // Manufacturer source must match the interval on record.
    await expect(createPlan(ctx, await planInput(asset.id, { intervalSource: "MANUFACTURER" }))).rejects.toThrow(
      /manufacturer interval on record/i,
    );
    const ok = await createPlan(
      ctx,
      await planInput(asset.id, { intervalSource: "MANUFACTURER", intervalCount: 12, sourceReference: "Manual s6" }),
    );
    expect(ok.id).toBeDefined();
    // A category cannot use one manufacturer's interval.
    const cat = await owner.equipmentCategory.findFirstOrThrow({
      where: { organizationId: await orgId(C), name: "Ventilator" },
    });
    await expect(
      createPlan(ctx, await planInput(cat.id, { targetKind: "CATEGORY", intervalSource: "MANUFACTURER" })),
    ).rejects.toBeInstanceOf(ValidationError);
    // Without any manufacturer interval, organisation-defined is accepted.
    const suction = await freshAsset({ modelId: await modelId(C, "DM-Suction S"), riskClass: "LOW" });
    const own = await createPlan(
      ctx,
      await planInput(suction.id, {
        intervalSource: "ORGANIZATION_DEFINED",
        sourceReference: "",
        justification: "No manufacturer interval for this model; six months from fault history (fictional).",
        intervalCount: 6,
        checklist: JSON.stringify(NO_ES),
      }),
    );
    expect(own.id).toBeDefined();
  });

  it("only managers and admins write plans; only the Engineering Manager approves", async () => {
    const asset = await freshAsset();
    const input = await planInput(asset.id);
    for (const ctx of [await amina(), await peter(), await fatuma(), await lucy()]) {
      await expect(createPlan(ctx, input)).rejects.toBeInstanceOf(AuthorizationError);
    }
    const plan = await createPlan(await hodan(), input);
    await expect(approve(plan.id, await hodan())).rejects.toBeInstanceOf(AuthorizationError);
    await expect(approve(plan.id, await amina())).rejects.toBeInstanceOf(AuthorizationError);
    expect((await approve(plan.id)).revisionNo).toBe(1);
    expect(await auditCount({ action: "authz.denied", outcome: "DENIED" })).toBeGreaterThan(0);
  });

  it("a hospital-scoped manager may approve an organisation-wide plan but not edit or enrol it", async () => {
    const asset = await freshAsset();
    const plan = await createPlan(await hodan(), { ...(await planInput(asset.id)), hospitalId: "" });
    expect((await approve(plan.id)).revisionNo).toBe(1); // James: Riverside only
    await expect(
      updatePlan(await james(), plan.id, { ...(await planInput(asset.id)), hospitalId: "" }),
    ).rejects.toBeInstanceOf(NotFoundError);
    const view = await getPlan(await james(), plan.id);
    expect(view.allowed.approve || view.allowed.review).toBe(true);
    expect(view.allowed.edit).toBe(false);
    expect(view.allowed.enrol).toBe(false);
  });

  it("approval creates an append-only revision; edits wait for re-approval; targets are fixed", async () => {
    const { asset, planId } = await scheduled(-1);
    const ctx = await james();
    const plan = await owner.maintenancePlan.findUniqueOrThrow({ where: { id: planId } });
    expect(plan.status).toBe("ACTIVE");
    const rev1 = await owner.maintenancePlanRevision.findUniqueOrThrow({ where: { id: plan.approvedRevisionId! } });
    expect(rev1).toMatchObject({ revisionNo: 1, kind: "APPROVAL", intervalSource: "REGULATORY_REQUIREMENT" });
    expect(rev1.approvedById).toBe(ctx.user.id);
    await expect(
      owner.maintenancePlanRevision.update({ where: { id: rev1.id }, data: { note: "x" } }),
    ).rejects.toThrow();

    // Edit the working copy: work still uses version 1 until re-approval.
    const changed = await planInput(asset.id, { name: plan.name, checklist: JSON.stringify(NO_ES), intervalCount: 2 });
    await updatePlan(ctx, planId, changed);
    expect((await owner.maintenancePlan.findUniqueOrThrow({ where: { id: planId } })).hasUnapprovedChanges).toBe(true);
    await runPmGenerationNow(ctx);
    const wo = (await occurrencesOf((await owner.pmSchedule.findFirstOrThrow({ where: { planId } })).id))[0].workOrder!;
    expect(wo.checklist).toEqual(rev1.checklist); // the approved version, not the edit
    expect(wo.planRevisionId).toBe(rev1.id);

    await expect(updatePlan(ctx, planId, { ...changed, targetKind: "MODEL", targetId: asset.modelId })).rejects.toThrow(
      /keeps its type and target/,
    );
    expect((await approve(planId)).revisionNo).toBe(2);
    await reviewPlanInterval(ctx, {
      id: planId,
      nextReviewOn: addDays(TODAY, 400),
      note: "Interval still appropriate (test).",
    });
    const revs = await owner.maintenancePlanRevision.findMany({ where: { planId }, orderBy: { revisionNo: "asc" } });
    expect(revs.map((r) => r.kind)).toEqual(["APPROVAL", "APPROVAL", "REVIEW"]);
    // The approved plan history is still intact for the old job.
    expect((await getWorkOrder(ctx, wo.id)).planRevision?.revisionNo).toBe(1);
  });

  it("paused plans generate nothing; resuming continues from today; archiving ends schedules", async () => {
    const { planId, schedule } = await scheduled(-3);
    const ctx = await james();
    await pausePlan(ctx, { id: planId, reason: "Department closed for refurbishment (test)" });
    await runPmGenerationNow(ctx);
    expect(await occurrencesOf(schedule.id)).toHaveLength(0);
    await expect(pausePlan(ctx, { id: planId, reason: "again" })).rejects.toBeInstanceOf(ValidationError);
    await resumePlan(ctx, { id: planId });
    const resumed = await owner.pmSchedule.findUniqueOrThrow({ where: { id: schedule.id } });
    expect(resumed.nextDueOn.toISOString().slice(0, 10) >= TODAY).toBe(true);
    await archivePlan(ctx, { id: planId, reason: "Replaced by a new plan (test)" });
    expect((await owner.pmSchedule.findUniqueOrThrow({ where: { id: schedule.id } })).status).toBe("ENDED");
    await runPmGenerationNow(ctx);
    expect(await occurrencesOf(schedule.id)).toHaveLength(0);
    await expect(updatePlan(ctx, planId, await planInput(schedule.assetId))).rejects.toThrow(/Archived/);
  });

  it("a plan with electrical safety items cannot be approved until a standard is verified", async () => {
    const managerEmail = await addTestMember(H, "ENGINEERING_MANAGER", [{ hospital: "SRH" }]);
    const hm = await contextFor(managerEmail, H);
    const asset = await owner.asset.findFirstOrThrow({
      where: { organizationId: await orgId(H), assetTag: "VEN-0001" },
    });
    const plan = await createPlan(await david(), {
      ...(await planInput(asset.id)),
      hospitalId: await hospitalId(H, "SRH"),
      defaultAssigneeId: "",
    });
    await expect(approve(plan.id, hm)).rejects.toThrow(/no verified test standard/i);
    const std = await owner.testStandard.findFirstOrThrow({
      where: { organizationId: await orgId(H), code: "IEC 62353" },
    });
    // Only an Engineering Manager may verify; an org admin may not.
    await expect(
      verifyStandard(await david(), { id: std.id, note: "Checked the procedure (test)" }),
    ).rejects.toBeInstanceOf(AuthorizationError);
    await verifyStandard(hm, { id: std.id, note: "Checked procedure and limits (test)" });
    expect((await approve(plan.id, hm)).revisionNo).toBe(1);
  });

  it("only matching, active, in-scope assets can be enrolled; one live schedule per asset and type", async () => {
    const asset = await freshAsset();
    const ctx = await james();
    const a = await createPlan(ctx, await planInput(asset.id));
    await enrolAssets(ctx, { id: a.id, firstDueOn: addDays(TODAY, 30), assetIds: [asset.id] });
    const b = await createPlan(ctx, await planInput(asset.id));
    const r = await enrolAssets(ctx, { id: b.id, firstDueOn: addDays(TODAY, 30), assetIds: [asset.id] });
    expect(r.enrolled).toBe(0);
    expect(r.skipped[0].reason).toMatch(/already scheduled/);
    // A different asset is not part of an ASSET plan.
    const other = await freshAsset();
    await expect(enrolAssets(ctx, { id: a.id, firstDueOn: addDays(TODAY, 30), assetIds: [other.id] })).rejects.toThrow(
      /do not match/,
    );
    // The database refuses a second live schedule of the same type too.
    const sch = await owner.pmSchedule.findFirstOrThrow({ where: { planId: a.id } });
    await expect(
      owner.pmSchedule.create({
        data: { ...sch, id: randomUUID(), planId: b.id, createdAt: undefined, updatedAt: undefined },
      }),
    ).rejects.toThrow();
    await endSchedule(ctx, { id: sch.id, reason: "Moved to another plan (test)" });
    expect((await enrolAssets(ctx, { id: b.id, firstDueOn: addDays(TODAY, 30), assetIds: [asset.id] })).enrolled).toBe(
      1,
    );
  });

  it("assets without an approved PM plan are flagged for review, never auto-scheduled", async () => {
    const asset = await freshAsset();
    const ctx = await james();
    const review = await getNeedsReview(ctx);
    expect(review.assets.some((a) => a.id === asset.id)).toBe(true);
    const pm = await getAssetPm(ctx, asset.id);
    expect(pm?.noApprovedPlan).toBe(true);
    expect(pm?.schedules).toHaveLength(0); // the category default interval was NOT used
  });
});

// ─── Scheduling and generation ───────────────────────────────────────────────

describe("automatic PM work orders", () => {
  it("creates one correctly linked work order for a due occurrence and advances the schedule", async () => {
    const { asset, planId, schedule } = await scheduled(-2);
    const summary = await runPmGenerationNow(await james());
    expect(summary.created).toBeGreaterThanOrEqual(1);
    const [occ] = await occurrencesOf(schedule.id);
    expect(occ.status).toBe("WORK_ORDER_CREATED");
    const wo = occ.workOrder!;
    const plan = await owner.maintenancePlan.findUniqueOrThrow({ where: { id: planId } });
    expect(wo).toMatchObject({
      type: "PREVENTIVE",
      assetId: asset.id,
      pmOccurrenceId: occ.id,
      planRevisionId: plan.approvedRevisionId,
      status: "ASSIGNED", // default assignee covers Riverside ICU
      assignedToId: (await userByEmail("amina.warsame@coastal.example")).id,
      reportedById: "system:pm-scheduler",
      testStandardCode: "IEC 62353",
      priority: "HIGH", // safety-critical infusion pump: never below High
      safetyCritical: true,
    });
    expect(wo.checklist).toEqual(JSON.parse(JSON.stringify(ITEMS.map((i) => ({ ...i })))).map(() => expect.anything()));
    expect(wo.dueAt?.toISOString()).toBe(endOfLocalDay(addDays(TODAY, -2), "Africa/Nairobi").toISOString());
    const after = await owner.pmSchedule.findUniqueOrThrow({ where: { id: schedule.id } });
    expect(after.nextSeq).toBe(1);
    expect(after.nextDueOn.toISOString().slice(0, 10)).not.toBe(addDays(TODAY, -2));
    expect(await auditCount({ action: "pm.workorder_generated" })).toBeGreaterThan(0);
    const n = await owner.notification.findMany({ where: { entityId: wo.id, type: "pm.generated" } });
    expect(n.map((x) => x.userId)).toEqual([wo.assignedToId]);
  });

  it("waits until the lead time; generates inside it", async () => {
    const far = await scheduled(30); // lead time 7 days
    const near = await scheduled(5);
    await runPmGenerationNow(await james());
    expect(await occurrencesOf(far.schedule.id)).toHaveLength(0);
    expect(await occurrencesOf(near.schedule.id)).toHaveLength(1);
  });

  it("is safe to retry: running again never creates a second work order or reminder", async () => {
    const { schedule } = await scheduled(0);
    await runPmGenerationNow(await james());
    await runPmGenerationNow(await james());
    await runScheduledGeneration({ organizationIds: [await orgId(C)] });
    const occ = await occurrencesOf(schedule.id);
    expect(occ).toHaveLength(1);
    expect(await owner.workOrder.count({ where: { pmOccurrenceId: occ[0].id } })).toBe(1);
    const due = await owner.notification.findMany({ where: { dedupeKey: `pm.due_today:${occ[0].id}` } });
    expect(due).toHaveLength(1);
  });

  it("is safe under concurrency: simultaneous runs create exactly one work order", async () => {
    const { schedule } = await scheduled(-1);
    const ctx = await james();
    await Promise.all([
      runPmGenerationNow(ctx),
      runPmGenerationNow(ctx),
      runScheduledGeneration({ organizationIds: [ctx.organization.id] }),
    ]);
    const occ = await occurrencesOf(schedule.id);
    expect(occ).toHaveLength(1);
    expect(await owner.workOrder.count({ where: { assetId: schedule.assetId, type: "PREVENTIVE" } })).toBe(1);
  });

  it("catch-up: older passed due dates are recorded as missed, one job for the latest", async () => {
    const { schedule } = await scheduled(-75); // monthly: about three due dates have passed
    await runPmGenerationNow(await james());
    const occ = await occurrencesOf(schedule.id);
    const missed = occ.filter((o) => o.status === "MISSED");
    const created = occ.filter((o) => o.status === "WORK_ORDER_CREATED");
    expect(missed.length).toBeGreaterThanOrEqual(2);
    expect(created).toHaveLength(1);
    expect(missed.every((o) => o.workOrder === null && o.note)).toBe(true);
    expect(created[0].dueOn > missed[missed.length - 1].dueOn).toBe(true);
  });

  it("records a failure without advancing the schedule, then recovers on the next run", async () => {
    const { asset, schedule } = await scheduled(-1);
    // Simulate a database failure for this one asset only (test database).
    const fn = `test_fail_${asset.id.replace(/-/g, "").slice(0, 12)}`;
    await owner.$executeRawUnsafe(`CREATE FUNCTION ${fn}() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF NEW.asset_id = '${asset.id}'::uuid THEN RAISE EXCEPTION 'simulated outage'; END IF; RETURN NEW; END $$`);
    await owner.$executeRawUnsafe(
      `CREATE TRIGGER ${fn} BEFORE INSERT ON work_orders FOR EACH ROW EXECUTE FUNCTION ${fn}()`,
    );
    try {
      const r1 = await runPmGenerationNow(await james());
      expect(r1.failed).toBeGreaterThanOrEqual(1);
      await runPmGenerationNow(await james()); // still failing: same occurrence, more attempts
    } finally {
      await owner.$executeRawUnsafe(`DROP TRIGGER ${fn} ON work_orders`);
      await owner.$executeRawUnsafe(`DROP FUNCTION ${fn}()`);
    }
    let occ = await occurrencesOf(schedule.id);
    expect(occ).toHaveLength(1);
    expect(occ[0]).toMatchObject({ status: "FAILED", attempts: 2 });
    expect(occ[0].lastError).toMatch(/retried/); // generic, no internal details
    expect(occ[0].lastError).not.toMatch(/simulated|outage|stack/i);
    expect((await owner.pmSchedule.findUniqueOrThrow({ where: { id: schedule.id } })).nextSeq).toBe(0);
    expect(await auditCount({ action: "pm.generation_failed", outcome: "FAILURE" })).toBeGreaterThan(0);
    const failedNotes = await owner.notification.findMany({ where: { dedupeKey: `pm.failed:${occ[0].id}` } });
    expect(failedNotes.length).toBeGreaterThan(0);
    expect(new Set(failedNotes.map((n) => n.userId)).size).toBe(failedNotes.length); // once per person
    const review = await getNeedsReview(await james());
    expect(review.failed.some((f) => f.id === occ[0].id)).toBe(true);

    await runPmGenerationNow(await james());
    occ = await occurrencesOf(schedule.id);
    expect(occ).toHaveLength(1);
    expect(occ[0]).toMatchObject({ status: "WORK_ORDER_CREATED", attempts: 3, lastError: null });
    expect(occ[0].workOrder).not.toBeNull();
    expect((await owner.pmSchedule.findUniqueOrThrow({ where: { id: schedule.id } })).nextSeq).toBe(1);
  });

  it("an unverified test standard is a visible, explained failure (never silently skipped)", async () => {
    const ctx = await james();
    // A separate category, so the rule affects only this test's asset.
    const org = await orgId(C);
    const manufacturer = await owner.manufacturer.findFirstOrThrow({ where: { organizationId: org } });
    const cat = await owner.equipmentCategory.create({
      data: { organizationId: org, name: `Test ESU ${randomUUID().slice(0, 5)}` },
    });
    const model = await owner.equipmentModel.create({
      data: {
        organizationId: org,
        manufacturerId: manufacturer.id,
        categoryId: cat.id,
        modelName: `ESU-${randomUUID().slice(0, 5)}`,
      },
    });
    const std = await addStandard(await hodan(), {
      code: "TEST-STD",
      version: randomUUID().slice(0, 6),
      title: "Unverified test standard",
    });
    await addStandardRule(await hodan(), { standardId: std.id, categoryId: cat.id, hospitalId: "", country: "" });
    const { schedule } = await (async () => {
      const asset = await freshAsset({ modelId: model.id });
      const plan = await createPlan(ctx, await planInput(asset.id));
      await approve(plan.id);
      await enrolAssets(ctx, { id: plan.id, firstDueOn: TODAY, assetIds: [asset.id] });
      return { schedule: await owner.pmSchedule.findFirstOrThrow({ where: { planId: plan.id } }) };
    })();
    await runPmGenerationNow(ctx);
    const [occ] = await occurrencesOf(schedule.id);
    expect(occ.status).toBe("FAILED");
    expect(occ.lastError).toMatch(/TEST-STD .* has not been verified/);
  });

  it("decommissioned or archived assets are skipped with a reason and their schedule ends", async () => {
    const { asset, schedule } = await scheduled(-1);
    await archiveAsset(await james(), { id: asset.id, reason: "Test archive" });
    await runPmGenerationNow(await james());
    const [occ] = await occurrencesOf(schedule.id);
    expect(occ).toMatchObject({ status: "SKIPPED", note: "Asset archived" });
    expect((await owner.pmSchedule.findUniqueOrThrow({ where: { id: schedule.id } })).status).toBe("ENDED");
  });

  it("the database refuses a second occurrence or a second job for one due date", async () => {
    const { schedule } = await scheduled(-1);
    await runPmGenerationNow(await james());
    const [occ] = await occurrencesOf(schedule.id);
    await expect(
      owner.pmOccurrence.create({
        data: { ...occ, id: randomUUID(), workOrder: undefined, createdAt: undefined, updatedAt: undefined } as never,
      }),
    ).rejects.toThrow();
    const wo = occ.workOrder!;
    await expect(
      owner.workOrder.create({
        data: {
          ...wo,
          id: randomUUID(),
          number: "WO-2026-99998",
          checklist: wo.checklist ?? undefined,
          createdAt: undefined,
          updatedAt: undefined,
        },
      }),
    ).rejects.toThrow();
  });
});

// ─── Completion, checklists and safety holds ─────────────────────────────────

async function generatedJob(offset = -1) {
  const s = await scheduled(offset);
  await runPmGenerationNow(await james());
  const [occ] = await occurrencesOf(s.schedule.id);
  return { ...s, occ, wo: occ.workOrder! };
}

describe("PM sign-off and checklists", () => {
  it("records every checklist answer with the standard used; the device status is not changed", async () => {
    const { asset, wo, occ, schedule } = await generatedJob(0);
    await startAsAmina(wo.id);
    const r = await signOff(wo.id);
    expect(r).toMatchObject({ returnedToService: false, safetyHoldPlaced: false });
    const done = await owner.workOrder.findUniqueOrThrow({ where: { id: wo.id } });
    expect(done).toMatchObject({ status: "COMPLETED", outcome: "CHECKS_PASSED", electricalSafetyCheck: "PASS" });
    const results = await owner.checklistResult.findMany({ where: { workOrderId: wo.id } });
    expect(results).toHaveLength(ITEMS.length);
    const es = results.find((x) => x.itemKey === "es_pe")!;
    expect(es).toMatchObject({ testStandardCode: "IEC 62353", testStandardVersion: "Ed. 2.0 (2014)", unit: "Ω" });
    expect(Number(es.value)).toBeCloseTo(0.12);
    await expect(owner.checklistResult.update({ where: { id: es.id }, data: { notes: "x" } })).rejects.toThrow();
    expect((await owner.pmOccurrence.findUniqueOrThrow({ where: { id: occ.id } })).status).toBe("COMPLETED");
    expect((await owner.pmOccurrence.findUniqueOrThrow({ where: { id: occ.id } })).onTime).toBe(true);
    expect((await owner.pmSchedule.findUniqueOrThrow({ where: { id: schedule.id } })).lastDoneOn).not.toBeNull();
    expect((await owner.asset.findUniqueOrThrow({ where: { id: asset.id } })).status).toBe("IN_SERVICE");
  });

  it("refuses inconsistent answers: missing items, out-of-limit passes, unexplained failures", async () => {
    const { wo } = await generatedJob();
    await startAsAmina(wo.id);
    await expect(signOff(wo.id, answers().slice(0, 2))).rejects.toThrow(/checklist answers/);
    await expect(signOff(wo.id, answers({ es_pe: { result: "PASS", value: 0.9 } }))).rejects.toBeInstanceOf(
      ValidationError,
    );
    await expect(signOff(wo.id, answers({ func: { result: "FAIL" } }))).rejects.toBeInstanceOf(ValidationError);
    await expect(signOff(wo.id, answers({ es_pe: { result: "PASS", value: "" } }))).rejects.toBeInstanceOf(
      ValidationError,
    );
    // Only the assigned technician signs off.
    await expect(signOff(wo.id, answers(), await james())).rejects.toBeInstanceOf(AuthorizationError);
  });

  it("a failed functional check takes the device out of use and creates a repair job (no safety hold)", async () => {
    const { asset, wo } = await generatedJob();
    await startAsAmina(wo.id);
    await signOff(wo.id, answers({ func: { result: "FAIL", notes: "Occlusion alarm silent (test)" } }));
    expect((await owner.workOrder.findUniqueOrThrow({ where: { id: wo.id } })).outcome).toBe("CHECKS_FAILED");
    expect((await owner.asset.findUniqueOrThrow({ where: { id: asset.id } })).status).toBe("OUT_OF_SERVICE");
    const repair = await owner.workOrder.findFirstOrThrow({ where: { assetId: asset.id, type: "CORRECTIVE" } });
    expect(repair).toMatchObject({ outOfUse: true, status: "REQUESTED" });
    expect(await owner.safetyHold.count({ where: { assetId: asset.id } })).toBe(0);
  });

  it("cancelling a PM job counts the occurrence as cancelled; reopening restores it", async () => {
    const { wo, occ } = await generatedJob();
    await cancelWorkOrder(await james(), { id: wo.id, reason: "Device away for loan (test)" });
    expect((await owner.pmOccurrence.findUniqueOrThrow({ where: { id: occ.id } })).status).toBe("CANCELLED");

    const second = await generatedJob(0);
    await startAsAmina(second.wo.id);
    await signOff(second.wo.id);
    await reopenWorkOrder(await james(), { id: second.wo.id, reason: "Missing reading (test)" });
    expect((await owner.pmOccurrence.findUniqueOrThrow({ where: { id: second.occ.id } })).status).toBe(
      "WORK_ORDER_CREATED",
    );
    expect((await owner.asset.findUniqueOrThrow({ where: { id: second.asset.id } })).status).toBe("IN_SERVICE");
    await signOff(second.wo.id);
    // A second attempt is recorded; the first answers are kept.
    expect(await owner.checklistResult.count({ where: { workOrderId: second.wo.id } })).toBe(ITEMS.length * 2);
  });
});

describe("Failed Safety Test — Do Not Use (independent review before return to service)", () => {
  it("full flow: hold, repair, retest, second-person approval, return to service", async () => {
    const { asset, wo } = await generatedJob();
    await startAsAmina(wo.id);
    const result = await signOff(
      wo.id,
      answers({ es_pe: { result: "FAIL", value: 0.9, notes: "Earth bond high (test)" } }),
    );
    expect(result.safetyHoldPlaced).toBe(true);
    const hold = await owner.safetyHold.findFirstOrThrow({ where: { assetId: asset.id } });
    expect(hold).toMatchObject({ status: "AWAITING_REPAIR", failedWorkOrderId: wo.id });
    expect((await owner.asset.findUniqueOrThrow({ where: { id: asset.id } })).status).toBe("OUT_OF_SERVICE");
    expect(await owner.downtimeEvent.count({ where: { assetId: asset.id, endedAt: null } })).toBe(1);
    expect(await auditCount({ action: "safety.hold_placed" })).toBeGreaterThan(0);

    // Blocked in the normal workflow and in the database.
    await expect(
      changeAssetStatus(await james(), { id: asset.id, status: "IN_SERVICE", reason: "try" }),
    ).rejects.toThrow(/Failed Safety Test/);
    await expect(
      withTenant({ userId: (await james()).user.id, organizationId: asset.organizationId }, (tx) =>
        tx.asset.update({ where: { id: asset.id }, data: { status: "IN_SERVICE" } }),
      ),
    ).rejects.toThrow(/safety hold/);

    // The linked repair job cannot be cancelled; signing it off does NOT return the device.
    const repair = await owner.workOrder.findFirstOrThrow({ where: { safetyHoldId: hold.id, type: "CORRECTIVE" } });
    await expect(cancelWorkOrder(await james(), { id: repair.id, reason: "not needed" })).rejects.toThrow(
      /cannot be cancelled/,
    );
    await assignWorkOrder(await james(), { id: repair.id, assigneeId: (await amina()).user.id });
    await startWorkOrder(await amina(), { id: repair.id });
    const repaired = await completeWorkOrder(await amina(), {
      id: repair.id,
      diagnosis: "Loose earth terminal (test)",
      resolution: "Terminal replaced (test)",
      outcome: "REPAIRED",
      functionalCheck: "PASS",
      electricalSafetyCheck: "PASS",
      checkNotes: "",
      declaration: true,
    });
    expect(repaired.returnedToService).toBe(false);
    expect((await owner.asset.findUniqueOrThrow({ where: { id: asset.id } })).status).not.toBe("IN_SERVICE");
    const afterRepair = await owner.safetyHold.findUniqueOrThrow({ where: { id: hold.id } });
    expect(afterRepair.status).toBe("AWAITING_RETEST");
    const retest = await owner.workOrder.findUniqueOrThrow({ where: { id: afterRepair.retestWorkOrderId! } });
    expect(retest).toMatchObject({ type: "SAFETY_TEST", testStandardCode: "IEC 62353", safetyHoldId: hold.id });
    expect((retest.checklist as { section: string }[]).every((i) => i.section === "ELECTRICAL_SAFETY")).toBe(true);

    // Retest by James (manager): passes, but James may NOT approve his own retest.
    await assignWorkOrder(await james(), { id: retest.id, assigneeId: (await james()).user.id });
    await startWorkOrder(await james(), { id: retest.id });
    await completeWorkOrder(await james(), {
      id: retest.id,
      resolution: "Retest after repair (test)",
      diagnosis: "",
      answers: [{ key: "es_pe", result: "PASS", value: 0.08, notes: null }],
      declaration: true,
    });
    expect((await owner.safetyHold.findUniqueOrThrow({ where: { id: hold.id } })).status).toBe("AWAITING_APPROVAL");
    expect((await owner.asset.findUniqueOrThrow({ where: { id: asset.id } })).status).not.toBe("IN_SERVICE");
    const decision = { id: hold.id, note: "Reviewed retest results and repair record (test).", confirm: true };
    await expect(approveRelease(await james(), decision)).rejects.toBeInstanceOf(AuthorizationError);
    await expect(approveRelease(await amina(), decision)).rejects.toBeInstanceOf(AuthorizationError);
    await expect(approveRelease(await hodan(), decision)).rejects.toBeInstanceOf(AuthorizationError);
    const view = await getSafetyHold(await james(), hold.id);
    expect(view.allowed.release).toBe(false);
    expect(view.allowed.selfRetested).toBe(true);

    // The second Engineering Manager approves.
    const released = await approveRelease(await manager2(), decision);
    expect(released.returnedToService).toBe(true);
    const final = await owner.safetyHold.findUniqueOrThrow({ where: { id: hold.id } });
    expect(final.status).toBe("RELEASED");
    expect(final.retestedById).toBe((await james()).user.id);
    expect(final.releasedById).toBe((await manager2()).user.id);
    expect(final.releasedById).not.toBe(final.retestedById);
    expect((await owner.asset.findUniqueOrThrow({ where: { id: asset.id } })).status).toBe("IN_SERVICE");
    expect(await owner.downtimeEvent.count({ where: { assetId: asset.id, endedAt: null } })).toBe(0);
    const kinds = (
      await owner.safetyHoldEvent.findMany({ where: { holdId: hold.id }, orderBy: { createdAt: "asc" } })
    ).map((e) => e.kind);
    expect(kinds).toEqual([
      "PLACED",
      "REPAIR_CREATED",
      "REPAIR_COMPLETED",
      "RETEST_CREATED",
      "RETEST_PASSED",
      "RELEASE_APPROVED",
    ]);
    expect(await auditCount({ action: "safety.hold_released" })).toBeGreaterThan(0);
  });

  it("the database refuses a release approved by the person who did the retest", async () => {
    const { asset, wo } = await generatedJob();
    await startAsAmina(wo.id);
    await signOff(wo.id, answers({ es_pe: { result: "FAIL", value: 1.2, notes: "High (test)" } }));
    const hold = await owner.safetyHold.findFirstOrThrow({ where: { assetId: asset.id } });
    const same = (await amina()).user.id;
    await expect(
      owner.safetyHold.update({
        where: { id: hold.id },
        data: {
          status: "RELEASED",
          retestedById: same,
          retestedAt: new Date(),
          releasedById: same,
          releasedAt: new Date(),
          releaseNote: "x",
          retestWorkOrderId: wo.id,
        },
      }),
    ).rejects.toThrow();
  });

  it("rejecting the retest starts a new repair; a failed retest does too", async () => {
    const { asset, wo } = await generatedJob();
    await startAsAmina(wo.id);
    await signOff(wo.id, answers({ es_pe: { result: "FAIL", value: 0.7, notes: "High (test)" } }));
    const hold = await owner.safetyHold.findFirstOrThrow({ where: { assetId: asset.id } });
    const repair = await owner.workOrder.findFirstOrThrow({ where: { safetyHoldId: hold.id, type: "CORRECTIVE" } });
    await assignWorkOrder(await james(), { id: repair.id, assigneeId: (await amina()).user.id });
    await startWorkOrder(await amina(), { id: repair.id });
    await completeWorkOrder(await amina(), {
      id: repair.id,
      diagnosis: "Cable damaged (test)",
      resolution: "Cable replaced (test)",
      outcome: "REPAIRED",
      functionalCheck: "PASS",
      electricalSafetyCheck: "PASS",
      checkNotes: "",
      declaration: true,
    });
    const retestId = (await owner.safetyHold.findUniqueOrThrow({ where: { id: hold.id } })).retestWorkOrderId!;
    await assignWorkOrder(await james(), { id: retestId, assigneeId: (await amina()).user.id });
    await startWorkOrder(await amina(), { id: retestId });
    await completeWorkOrder(await amina(), {
      id: retestId,
      resolution: "Retest (test)",
      diagnosis: "",
      answers: [{ key: "es_pe", result: "PASS", value: 0.1, notes: null }],
      declaration: true,
    });
    await rejectRelease(await james(), { id: hold.id, note: "Repair record incomplete; redo (test)." });
    const h = await owner.safetyHold.findUniqueOrThrow({ where: { id: hold.id } });
    expect(h).toMatchObject({ status: "AWAITING_REPAIR", rejectedCount: 1 });
    expect(
      await owner.workOrder.count({ where: { safetyHoldId: hold.id, type: "CORRECTIVE", status: "REQUESTED" } }),
    ).toBe(1);
    expect((await owner.asset.findUniqueOrThrow({ where: { id: asset.id } })).status).not.toBe("IN_SERVICE");
  });
});

// ─── Security, reports, barcode, scheduler endpoint ──────────────────────────

describe("security and tenant isolation", () => {
  it("every table that holds organisation data has Row-Level Security enabled AND forced", async () => {
    const rows = await owner.$queryRaw<{ relname: string; on: boolean; forced: boolean }[]>`
      SELECT c.relname, c.relrowsecurity AS on, c.relforcerowsecurity AS forced
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind = 'r'
        AND EXISTS (SELECT 1 FROM information_schema.columns k
                    WHERE k.table_schema = 'public' AND k.table_name = c.relname AND k.column_name = 'organization_id')`;
    const stage6 = [
      "maintenance_plans",
      "maintenance_plan_revisions",
      "pm_schedules",
      "pm_occurrences",
      "pm_generation_runs",
      "checklist_results",
      "test_standards",
      "test_standard_rules",
      "safety_holds",
      "safety_hold_events",
    ];
    for (const t of stage6) expect(rows.map((r) => r.relname)).toContain(t);
    for (const r of rows) expect([r.relname, r.on, r.forced]).toEqual([r.relname, true, true]);
  });

  it("the app role cannot delete Stage 6 records", async () => {
    const rows = await owner.$queryRaw<{ table_name: string }[]>`
      SELECT table_name FROM information_schema.role_table_grants
      WHERE grantee = 'biomedintel_app' AND privilege_type = 'DELETE'
        AND table_name IN ('maintenance_plans','maintenance_plan_revisions','pm_schedules','pm_occurrences',
          'pm_generation_runs','checklist_results','test_standards','test_standard_rules','safety_holds','safety_hold_events')`;
    expect(rows).toHaveLength(0);
  });

  it("other organisations cannot see, change or run anything in Coastal", async () => {
    const { planId, asset } = await scheduled(10);
    const hd = await david();
    await expect(getPlan(hd, planId)).rejects.toBeInstanceOf(NotFoundError);
    await expect(updatePlan(hd, planId, await planInput(asset.id))).rejects.toBeInstanceOf(NotFoundError);
    await expect(pausePlan(hd, { id: planId, reason: "attack" })).rejects.toBeInstanceOf(NotFoundError);
    await expect(enrolAssets(hd, { id: planId, firstDueOn: TODAY, assetIds: [] })).rejects.toBeInstanceOf(
      NotFoundError,
    );
    await expect(getAssetPm(hd, asset.id)).rejects.toBeInstanceOf(NotFoundError);
    expect((await listPlans(hd, {})).rows.some((p) => p.id === planId)).toBe(false);
    expect((await listSchedule(hd, { view: "all" })).rows.some((r) => r.asset_id === asset.id)).toBe(false);
    // Even with a forged tenant context, RLS returns nothing from Coastal.
    const rows = await withTenant({ userId: hd.user.id, organizationId: hd.organization.id }, (tx) =>
      tx.maintenancePlan.findMany({ where: { id: planId } }),
    );
    expect(rows).toHaveLength(0);
    const summary = await runPmGenerationNow(hd);
    expect(summary.organizationId).toBe(hd.organization.id);
  });

  it("validates referenced assets and people on the server", async () => {
    const ctx = await james();
    const highlandAsset = await assetId(H, "INF-0001");
    await expect(createPlan(ctx, await planInput(highlandAsset))).rejects.toThrow(/asset you can access/);
    const asset = await freshAsset();
    await expect(
      createPlan(ctx, await planInput(asset.id, { defaultAssigneeId: (await lucy()).user.id })),
    ).rejects.toThrow(/technician/);
    await expect(
      createPlan(
        ctx,
        await planInput(asset.id, { defaultAssigneeId: (await userByEmail("sara.nakato@highland.example")).id }),
      ),
    ).rejects.toThrow(/technician/);
    // A hospital-scoped manager cannot write plans for every hospital.
    await expect(createPlan(ctx, await planInput(asset.id, { hospitalId: "" }))).rejects.toThrow(/hospital/);
  });

  it("only managers and admins can run generation; fault reporters cannot see PM at all", async () => {
    await expect(runPmGenerationNow(await amina())).rejects.toBeInstanceOf(AuthorizationError);
    await expect(runPmGenerationNow(await fatuma())).rejects.toBeInstanceOf(AuthorizationError);
    await expect(listSchedule(await lucy(), {})).rejects.toBeInstanceOf(AuthorizationError);
    await expect(
      setModelInterval(await amina(), {
        modelId: await modelId(C, "SC-Trace 12"),
        count: 12,
        unit: "MONTH",
        reference: "x manual",
      }),
    ).rejects.toBeInstanceOf(AuthorizationError);
  });

  it("reports and exports follow permissions and scope", async () => {
    await generatedJob(-1);
    await expect(getPmReport(await amina(), {})).rejects.toBeInstanceOf(AuthorizationError);
    await expect(exportPmCsv(await amina(), {})).rejects.toBeInstanceOf(AuthorizationError);
    await expect(exportPmCsv(await peter(), {})).rejects.toBeInstanceOf(AuthorizationError);
    const report = await getPmReport(await fatuma(), { from: addDays(TODAY, -90), to: TODAY });
    expect(report.total.due).toBeGreaterThan(0);
    const csv = await exportPmCsv(await fatuma(), { from: addDays(TODAY, -90), to: TODAY });
    expect(csv.csv).not.toMatch(/highland|Summit|Lakeview/i);
    expect(await auditCount({ action: "pm.report_exported" })).toBeGreaterThan(0);
    const highland = await exportPmCsv(await david(), { from: addDays(TODAY, -90), to: TODAY });
    expect(highland.csv).not.toMatch(/RGH|NCH/);
    // A hospital outside the user's scope is refused, not silently ignored.
    await expect(getPmReport(await fatuma(), { hospital: await hospitalId(H, "SRH") })).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  it("compliance never counts a generated job as done", async () => {
    const before = await getPmReport(await fatuma(), { from: addDays(TODAY, -5), to: TODAY });
    const { wo } = await generatedJob(-1);
    const generated = await getPmReport(await fatuma(), { from: addDays(TODAY, -5), to: TODAY });
    expect(generated.total.due).toBe(before.total.due + 1);
    expect(generated.total.onTime + generated.total.late).toBe(before.total.onTime + before.total.late);
    await startAsAmina(wo.id);
    await signOff(wo.id);
    const done = await getPmReport(await fatuma(), { from: addDays(TODAY, -5), to: TODAY });
    expect(done.total.onTime + done.total.late).toBe(before.total.onTime + before.total.late + 1);
  });

  it("reminders reach only the right people, once", async () => {
    const { schedule } = await scheduled(-3);
    await runPmGenerationNow(await james());
    await runPmGenerationNow(await james());
    const [occ] = await occurrencesOf(schedule.id);
    const overdue = await owner.notification.findMany({ where: { dedupeKey: `pm.overdue:${occ.id}` } });
    const recipients = overdue.map((n) => n.userId);
    expect(new Set(recipients).size).toBe(recipients.length);
    expect(recipients).toContain((await amina()).user.id);
    expect(recipients).not.toContain((await lucy()).user.id);
    expect(recipients).not.toContain((await david()).user.id);
  });
});

describe("barcode entry to an asset's maintenance schedule", () => {
  it("a scanned asset ID opens that asset's schedule; unknown and out-of-scope codes do not", async () => {
    const { asset } = await scheduled(20);
    const ctx = await james();
    const found = await findAssetByCode(ctx, asset.assetTag);
    expect(found.kind).toBe("asset");
    const pm = await getAssetPm(ctx, found.kind === "asset" ? found.assetId : "");
    expect(pm?.schedules).toHaveLength(1);
    expect(pm?.schedules[0].nextDue).toBe(addDays(TODAY, 20));
    expect((await findAssetByCode(ctx, "ZZZ-9999")).kind).toBe("not-found");
    // Northlake asset: Amina sees it, a Riverside-only manager does not.
    const nch = await assetId(C, "INF-0101");
    await expect(getAssetPm(ctx, nch)).rejects.toBeInstanceOf(NotFoundError);
    expect(await getAssetPm(await amina(), nch)).not.toBeNull();
    expect((await findAssetByCode(await david(), asset.assetTag)).kind).toBe("not-found");
  });
});

describe("scheduler endpoint", () => {
  const call = (auth?: string) =>
    cronPost(
      new Request("http://localhost:3000/api/cron/pm-generate", {
        method: "POST",
        headers: auth ? { authorization: auth } : {},
      }),
    );

  it("is off without a secret, refuses a wrong secret, and runs with the right one", async () => {
    const saved = process.env.CRON_SECRET;
    try {
      process.env.CRON_SECRET = "";
      expect((await call("Bearer anything")).status).toBe(503);
      process.env.CRON_SECRET = "a".repeat(40);
      expect((await call()).status).toBe(401);
      expect((await call(`Bearer ${"b".repeat(40)}`)).status).toBe(401);
      expect(await auditCount({ action: "pm.scheduler_denied", outcome: "DENIED" })).toBeGreaterThan(0);
      const ok = await call(`Bearer ${"a".repeat(40)}`);
      expect(ok.status).toBe(200);
      const body = (await ok.json()) as Record<string, number>;
      expect(Object.keys(body).sort()).toEqual([
        "created",
        "failed",
        "missed",
        "organisations",
        "remindersSent",
        "reports", // Stage 7: scheduled report snapshots run in the same daily job
        "skipped",
      ]);
    } finally {
      process.env.CRON_SECRET = saved;
    }
  });
});
