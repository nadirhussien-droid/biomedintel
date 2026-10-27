// Upload test results: reading a sheet, limits deciding Pass or Fail, per-row failures, holds and permissions.
import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { db } from "@/server/db/client";
import { ValidationError } from "@/server/authz/errors";
import { createAsset } from "@/server/services/assets";
import { approvePlan, createPlan, enrolAssets } from "@/server/services/pm-plans";
import { runPmGenerationNow } from "@/server/services/pm-generation";
import { addCalibration, createTestEquipment } from "@/server/services/testing";
import { addDays, localToday } from "@/lib/pm/dates";
import { parseResultsTable } from "@/lib/test-results-upload";
import { previewTestResults, uploadTestResults } from "@/server/services/test-results-upload";
import { auditCount, coastalAssetInput, contextFor, hospitalId, owner, userByEmail } from "../helpers";

const C = "coastal-health";
const TODAY = localToday("Africa/Nairobi");

afterAll(async () => {
  await db.$disconnect();
  await owner.$disconnect();
});

const james = () => contextFor("james.otieno@coastal.example", C); // Engineering Manager, Riverside
const amina = () => contextFor("amina.warsame@coastal.example"); // Technician
const fatuma = () => contextFor("fatuma.hassan@coastal.example"); // Auditor

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

const occurrencesOf = (scheduleId: string) =>
  owner.pmOccurrence.findMany({ where: { scheduleId }, orderBy: { dueOn: "asc" }, include: { workOrder: true } });

let analyserId = "";
/** A fictional calibrated safety analyser (electrical safety results need a tool on record). */
async function analyser() {
  if (analyserId) return analyserId;
  const ctx = await amina();
  const tool = await createTestEquipment(ctx, {
    name: "Fictional safety analyser",
    kind: "SAFETY_ANALYSER",
    manufacturer: "Fictional Maker",
    model: "SA-1",
    serialNumber: `PM-${randomUUID().slice(0, 8)}`,
    equipmentTag: "",
    measures: "",
    calibrationIntervalMonths: "12",
    heldBy: "",
    location: "",
    status: "IN_USE",
    notes: "",
  });
  await addCalibration(ctx, {
    testEquipmentId: tool.id,
    calibratedOn: addDays(TODAY, -30),
    dueOn: "",
    certificateNumber: "",
    laboratory: "Fictional Lab",
    accreditation: "",
    traceableTo: "",
    result: "PASS",
    notes: "",
  });
  analyserId = tool.id;
  return analyserId;
}

const NOTES_FAIL = "Earth resistance too high, cable replaced and retest needed (fictional).";

const tableFor = (
  jobs: { tag: string; number?: string; es?: string; insp?: string; func?: string; notes?: string }[],
) => [
  [
    "Work order",
    "Asset ID",
    "Device",
    "Housing and cables undamaged",
    "Alarms work",
    "Protective earth resistance (Ω)",
    "Notes",
    "Findings",
  ],
  ...jobs.map((j) => [
    j.number ?? "",
    j.tag,
    "x",
    j.insp ?? "pass",
    j.func ?? "pass",
    j.es ?? "0.12",
    j.notes ?? "",
    "",
  ]),
];

async function jobFor(over: Record<string, unknown> = {}) {
  const s = await scheduled(-1, over);
  await runPmGenerationNow(await james());
  const [occ] = await occurrencesOf(s.schedule.id);
  return { asset: s.asset, wo: occ!.workOrder! };
}

describe("upload test results", () => {
  it("signs off passing and failing rows with the limits deciding, and places a hold after an electrical fail", async () => {
    const a = await jobFor();
    const b = await jobFor();
    const c = await jobFor();
    const { rows } = parseResultsTable(
      tableFor([
        { tag: a.asset.assetTag, es: "0.12" },
        { tag: b.asset.assetTag, es: "0.9 pass" }, // a typed Pass cannot override the limit
        { tag: c.asset.assetTag, es: "0.9", notes: NOTES_FAIL },
      ]),
    );
    const ctx = await amina();
    const preview = await previewTestResults(ctx, { rows, includeUnassigned: false });
    expect(preview.rows.map((r) => r.outcome)).toEqual(["READY", "PROBLEM", "READY"]);
    expect(preview.rows[1]!.problems.join(" ")).toMatch(/outside the limits/);
    expect(preview.needsTestEquipment).toBe(true);
    // Nothing is saved by a preview.
    expect((await owner.workOrder.findUniqueOrThrow({ where: { id: a.wo.id } })).status).not.toBe("COMPLETED");

    const result = await uploadTestResults(ctx, {
      rows,
      includeUnassigned: false,
      testEquipmentId: await analyser(),
      declaration: true,
      fileName: "bulk.xlsx",
    });
    expect(result).toMatchObject({ signedOff: 2, withFailures: 1, holds: 1 });
    expect(result.failed).toHaveLength(1);
    const wa = await owner.workOrder.findUniqueOrThrow({ where: { id: a.wo.id } });
    expect(wa).toMatchObject({ status: "COMPLETED", outcome: "CHECKS_PASSED", testEquipmentId: await analyser() });
    const wc = await owner.workOrder.findUniqueOrThrow({ where: { id: c.wo.id } });
    expect(wc).toMatchObject({ status: "COMPLETED", outcome: "CHECKS_FAILED" });
    expect(await owner.safetyHold.count({ where: { assetId: c.asset.id } })).toBe(1);
    expect(await owner.safetyHold.count({ where: { assetId: a.asset.id } })).toBe(0);
    expect((await owner.workOrder.findUniqueOrThrow({ where: { id: b.wo.id } })).status).not.toBe("COMPLETED");
    expect(await auditCount({ action: "workorder.results_uploaded" })).toBeGreaterThan(0);
  });

  it("refuses a fail without a note, an empty required cell, and a missing or unknown test tool", async () => {
    const a = await jobFor();
    const b = await jobFor();
    const { rows } = parseResultsTable(
      tableFor([
        { tag: a.asset.assetTag, es: "0.9" },
        { tag: b.asset.assetTag, func: "" },
      ]),
    );
    const ctx = await amina();
    const preview = await previewTestResults(ctx, { rows, includeUnassigned: false });
    expect(preview.counts.problem).toBe(2);
    const ok = parseResultsTable(tableFor([{ tag: a.asset.assetTag }])).rows;
    await expect(
      uploadTestResults(ctx, {
        rows: ok,
        includeUnassigned: false,
        testEquipmentId: "",
        declaration: true,
        fileName: "x",
      }),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      uploadTestResults(ctx, {
        rows: ok,
        includeUnassigned: false,
        testEquipmentId: await analyser(),
        declaration: false,
        fileName: "x",
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("takes unassigned jobs only when asked, and only a worker may upload", async () => {
    const a = await jobFor({ defaultAssigneeId: "" });
    const { rows } = parseResultsTable(tableFor([{ tag: a.asset.assetTag }]));
    const ctx = await amina();
    const without = await previewTestResults(ctx, { rows, includeUnassigned: false });
    expect(without.rows[0]!.outcome).toBe("PROBLEM");
    const withIt = await previewTestResults(ctx, { rows, includeUnassigned: true });
    expect(withIt.rows[0]).toMatchObject({ outcome: "READY", willTake: true });
    const r = await uploadTestResults(ctx, {
      rows,
      includeUnassigned: true,
      testEquipmentId: await analyser(),
      declaration: true,
      fileName: "x",
    });
    expect(r.signedOff).toBe(1);
    expect(await owner.workOrder.findUniqueOrThrow({ where: { id: a.wo.id } })).toMatchObject({
      status: "COMPLETED",
      assignedToId: (await userByEmail("amina.warsame@coastal.example")).id,
    });
    await expect(previewTestResults(await fatuma(), { rows, includeUnassigned: true })).rejects.toThrow();
  });
});
