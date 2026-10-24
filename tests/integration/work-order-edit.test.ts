// Editing a completed job (one Edit button): the technician, engineer or
// manager who worked on the job can fix text, fault category and work log;
// nothing appears on the job; earlier values are kept for audit; safety
// results and the device status never change.
import { afterAll, describe, expect, it } from "vitest";
import { db } from "@/server/db/client";
import { AuthorizationError, ValidationError } from "@/server/authz/errors";
import { createAsset } from "@/server/services/assets";
import {
  assignWorkOrder,
  completeWorkOrder,
  editCompletedJob,
  getWorkOrder,
  logWork,
  reportFault,
  startWorkOrder,
} from "@/server/services/work-orders";
import { addTestMember, coastalAssetInput, contextFor, owner, userByEmail } from "../helpers";

const C = "coastal-health";
afterAll(async () => {
  await db.$disconnect();
  await owner.$disconnect();
});

const james = () => contextFor("james.otieno@coastal.example", C); // Engineering Manager
const amina = () => contextFor("amina.warsame@coastal.example"); // Technician / biomedical engineer
const peter = () => contextFor("peter.kamau@coastal.example"); // Department Head
const hodan = () => contextFor("hodan.ali@coastal.example"); // Organisation Administrator

const SIGN_OFF = {
  diagnosis: "Fictional test: worn connector",
  resolution: "Fictional test: connector replaced, tested",
  outcome: "REPAIRED",
  functionalCheck: "PASS",
  electricalSafetyCheck: "PASS",
  checkNotes: "",
  failureCategory: "MECHANICAL",
  declaration: true,
};

/** A signed-off repair by Amina with two work log lines. */
async function completedJob(assignee = "amina.warsame@coastal.example") {
  const asset = await createAsset(await james(), await coastalAssetInput());
  const wo = await reportFault(await peter(), {
    assetId: asset.id,
    faultDescription: "Fictional test fault: alarm sounds without cause",
    outOfUse: true,
  });
  const user = await userByEmail(assignee);
  const tech = await contextFor(assignee, C);
  await assignWorkOrder(await james(), { id: wo.id, assigneeId: user.id });
  await startWorkOrder(tech, { id: wo.id });
  await logWork(tech, { id: wo.id, description: "Fictional test: opened the casing", minutes: 20 });
  await logWork(tech, { id: wo.id, description: "Fictional test: replaced connector", minutes: 45 });
  await completeWorkOrder(tech, { id: wo.id, ...SIGN_OFF });
  return { wo, asset, user };
}

const base = (id: string) => ({
  id,
  diagnosis: SIGN_OFF.diagnosis,
  resolution: SIGN_OFF.resolution,
  failureCategory: "MECHANICAL",
});

describe("editing a completed job", () => {
  it("fixes text, category and work log in one save; nothing appears on the job; safety facts stay", async () => {
    const { wo, asset, user } = await completedJob();
    const before = await owner.workOrder.findUniqueOrThrow({ where: { id: wo.id } });
    const lines = (await getWorkOrder(await amina(), wo.id)).tasks;
    expect((await getWorkOrder(await amina(), wo.id)).allowed.editCompleted).toBe(true);

    const r = await editCompletedJob(await amina(), {
      ...base(wo.id),
      diagnosis: "Fictional test: worn power connector",
      failureCategory: "POWER_OR_BATTERY",
      lines: [
        { taskId: lines[0].id, description: lines[0].description, minutes: 20 },
        { taskId: lines[1].id, description: "Fictional test: replaced connector and cleaned contacts", minutes: 60 },
      ],
    });
    expect(r).toEqual({ fields: 2, lines: 1 });

    const after = await owner.workOrder.findUniqueOrThrow({ where: { id: wo.id } });
    expect(after).toMatchObject({
      diagnosis: "Fictional test: worn power connector",
      failureCategory: "POWER_OR_BATTERY",
      status: "COMPLETED",
      outcome: before.outcome,
      functionalCheck: before.functionalCheck,
      electricalSafetyCheck: before.electricalSafetyCheck,
      completedById: before.completedById,
      completedAt: before.completedAt,
    });
    expect((await owner.asset.findUniqueOrThrow({ where: { id: asset.id } })).status).toBe("IN_SERVICE");

    // The job shows the new values and no trace of the edit.
    const view = await getWorkOrder(await james(), wo.id);
    expect(view.tasks.map((t) => t.minutes)).toEqual([20, 60]);
    expect(view.tasks[1].performedById).toBe(user.id);
    expect(view.totalMinutes).toBe(80);
    expect(view.events.map((e) => e.kind)).not.toContain("CORRECTED");
    expect(view.events.at(-1)?.kind).toBe("COMPLETED");
    expect("corrections" in view).toBe(false);

    // Kept for audit only: earlier values and an audit entry without the text.
    const kept = await owner.workOrderCorrection.findMany({ where: { workOrderId: wo.id }, orderBy: { field: "asc" } });
    expect(kept.map((k) => [k.field, k.oldValue])).toEqual([
      ["DIAGNOSIS", "Fictional test: worn connector"],
      ["FAILURE_CATEGORY", "MECHANICAL"],
    ]);
    expect(await owner.workOrderTask.count({ where: { workOrderId: wo.id } })).toBe(3);
    const log = await owner.auditLog.findFirstOrThrow({
      where: { action: "workorder.edited_after_completion", entityId: wo.id },
    });
    expect(log.metadata).toMatchObject({ fields: ["DIAGNOSIS", "FAILURE_CATEGORY"], workLogLines: 1 });
    expect(JSON.stringify(log.metadata)).not.toContain("power connector");

    // Reports count only the current version of each line.
    const sum = await owner.$queryRaw<{ m: bigint }[]>`
      SELECT sum(t.minutes) AS m FROM work_order_tasks t
      WHERE t.work_order_id = ${wo.id}::uuid
        AND NOT EXISTS (SELECT 1 FROM work_order_tasks c WHERE c.corrects_task_id = t.id)`;
    expect(Number(sum[0].m)).toBe(80);
  });

  it("a line can be edited again later, and the note is optional", async () => {
    const { wo } = await completedJob();
    let [first] = (await getWorkOrder(await amina(), wo.id)).tasks;
    await editCompletedJob(await amina(), {
      ...base(wo.id),
      lines: [{ taskId: first.id, description: "Opened it", minutes: 25 }],
    });
    [first] = (await getWorkOrder(await amina(), wo.id)).tasks;
    await editCompletedJob(await amina(), {
      ...base(wo.id),
      lines: [{ taskId: first.id, description: "Opened the casing", minutes: 30 }],
      reason: "Checked the timesheet",
    });
    const view = await getWorkOrder(await amina(), wo.id);
    expect(view.tasks.map((t) => [t.description, t.minutes])).toEqual([
      ["Opened the casing", 30],
      ["Fictional test: replaced connector", 45],
    ]);
  });

  it("needs a change, valid values and a completed job", async () => {
    const { wo } = await completedJob();
    const ctx = await amina();
    await expect(editCompletedJob(ctx, base(wo.id))).rejects.toThrow(/Nothing was changed/);
    await expect(editCompletedJob(ctx, { ...base(wo.id), diagnosis: "" })).rejects.toBeInstanceOf(ValidationError);
    const [line] = (await getWorkOrder(ctx, wo.id)).tasks;
    await expect(
      editCompletedJob(ctx, { ...base(wo.id), lines: [{ taskId: line.id, description: "x y", minutes: 0 }] }),
    ).rejects.toBeInstanceOf(ValidationError);
    // An old (already replaced) line cannot be edited: reload first.
    await editCompletedJob(ctx, { ...base(wo.id), lines: [{ taskId: line.id, description: "New", minutes: 22 }] });
    await expect(
      editCompletedJob(ctx, { ...base(wo.id), lines: [{ taskId: line.id, description: "Again", minutes: 23 }] }),
    ).rejects.toThrow(/Reload the page/);

    const asset = await createAsset(await james(), await coastalAssetInput());
    const open = await reportFault(await peter(), { assetId: asset.id, faultDescription: "Fictional test fault" });
    await expect(editCompletedJob(await james(), { ...base(open.id), diagnosis: "New text here" })).rejects.toThrow(
      /Only a completed job/,
    );
  });

  it("only the technician, engineer or manager who worked on the job can edit", async () => {
    const { wo } = await completedJob();
    const change = { ...base(wo.id), diagnosis: "Fictional test: changed" };
    const stranger = await contextFor(await addTestMember(C, "TECHNICIAN", [{ hospital: "RGH" }]));
    await expect(editCompletedJob(stranger, change)).rejects.toBeInstanceOf(AuthorizationError);
    expect((await getWorkOrder(stranger, wo.id)).allowed.editCompleted).toBe(false);
    // A manager who did not work on it, and the organisation administrator, cannot.
    await expect(editCompletedJob(await james(), change)).rejects.toBeInstanceOf(AuthorizationError);
    await expect(editCompletedJob(await hodan(), change)).rejects.toBeInstanceOf(AuthorizationError);
    expect(
      await owner.auditLog.count({ where: { action: "workorder.access_denied", entityId: wo.id, outcome: "DENIED" } }),
    ).toBeGreaterThanOrEqual(2);

    // A manager who did the job can.
    const managerJob = await completedJob("james.otieno@coastal.example");
    await editCompletedJob(await james(), { ...base(managerJob.wo.id), diagnosis: "Fictional test: manager fix" });
    expect((await owner.workOrder.findUniqueOrThrow({ where: { id: managerJob.wo.id } })).diagnosis).toBe(
      "Fictional test: manager fix",
    );
  });

  it("the kept earlier values can never be edited or deleted", async () => {
    const { wo } = await completedJob();
    await editCompletedJob(await amina(), { ...base(wo.id), diagnosis: "Fictional test: changed" });
    const row = await owner.workOrderCorrection.findFirstOrThrow({ where: { workOrderId: wo.id } });
    await expect(owner.workOrderCorrection.delete({ where: { id: row.id } })).rejects.toThrow();
    await expect(owner.workOrderCorrection.update({ where: { id: row.id }, data: { reason: "x" } })).rejects.toThrow();
  });
});
