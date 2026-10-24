// Correcting a completed job: anyone who worked on it (and managers) can fix
// the text, the fault category and the work log; every change needs a reason
// and keeps the old value; safety results and the device status never change.
import { afterAll, describe, expect, it } from "vitest";
import { db } from "@/server/db/client";
import { AuthorizationError, ValidationError } from "@/server/authz/errors";
import { createAsset } from "@/server/services/assets";
import {
  assignWorkOrder,
  completeWorkOrder,
  correctWorkLine,
  correctWorkOrder,
  getWorkOrder,
  logWork,
  reportFault,
  startWorkOrder,
} from "@/server/services/work-orders";
import { listMyNotifications } from "@/server/services/notifications";
import { addTestMember, coastalAssetInput, contextFor, owner, userByEmail } from "../helpers";

const C = "coastal-health";
afterAll(async () => {
  await db.$disconnect();
  await owner.$disconnect();
});

const james = () => contextFor("james.otieno@coastal.example", C); // Engineering Manager
const amina = () => contextFor("amina.warsame@coastal.example"); // Technician
const peter = () => contextFor("peter.kamau@coastal.example"); // Department Head
const lucy = () => contextFor("lucy.achieng@coastal.example"); // Fault Reporter
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

/** A signed-off repair with two work log lines. */
async function completedJob() {
  const asset = await createAsset(await james(), await coastalAssetInput());
  const wo = await reportFault(await peter(), {
    assetId: asset.id,
    faultDescription: "Fictional test fault: alarm sounds without cause",
    outOfUse: true,
  });
  const aminaUser = await userByEmail("amina.warsame@coastal.example");
  await assignWorkOrder(await james(), { id: wo.id, assigneeId: aminaUser.id });
  await startWorkOrder(await amina(), { id: wo.id });
  await logWork(await amina(), { id: wo.id, description: "Fictional test: opened the casing", minutes: 20 });
  await logWork(await amina(), { id: wo.id, description: "Fictional test: replaced connector", minutes: 45 });
  await completeWorkOrder(await amina(), { id: wo.id, ...SIGN_OFF });
  return { wo, asset, aminaUser };
}

describe("correcting the text of a completed job", () => {
  it("the technician fixes the diagnosis and work done; old text is kept and nothing safety-related moves", async () => {
    const { wo, asset } = await completedJob();
    const before = await owner.workOrder.findUniqueOrThrow({ where: { id: wo.id } });
    await correctWorkOrder(await amina(), {
      id: wo.id,
      diagnosis: "Fictional test: worn power connector",
      resolution: SIGN_OFF.resolution,
      failureCategory: "POWER_OR_BATTERY",
      reason: "Typed the wrong part name",
    });
    const after = await owner.workOrder.findUniqueOrThrow({ where: { id: wo.id } });
    expect(after.diagnosis).toBe("Fictional test: worn power connector");
    expect(after.failureCategory).toBe("POWER_OR_BATTERY");
    // Sign-off facts are untouched.
    expect(after).toMatchObject({
      status: "COMPLETED",
      outcome: before.outcome,
      functionalCheck: before.functionalCheck,
      electricalSafetyCheck: before.electricalSafetyCheck,
      completedById: before.completedById,
      completedAt: before.completedAt,
      resolution: before.resolution,
    });
    expect((await owner.asset.findUniqueOrThrow({ where: { id: asset.id } })).status).toBe("IN_SERVICE");

    const rows = await owner.workOrderCorrection.findMany({ where: { workOrderId: wo.id }, orderBy: { field: "asc" } });
    expect(rows.map((r) => [r.field, r.oldValue, r.newValue])).toEqual([
      ["DIAGNOSIS", "Fictional test: worn connector", "Fictional test: worn power connector"],
      ["FAILURE_CATEGORY", "MECHANICAL", "POWER_OR_BATTERY"],
    ]);
    expect(rows.every((r) => r.reason === "Typed the wrong part name")).toBe(true);

    const events = await owner.workOrderEvent.findMany({ where: { workOrderId: wo.id, kind: "CORRECTED" } });
    expect(events).toHaveLength(1);
    const log = await owner.auditLog.findFirstOrThrow({ where: { action: "workorder.corrected", entityId: wo.id } });
    expect(log.metadata).toMatchObject({ fields: ["DIAGNOSIS", "FAILURE_CATEGORY"] });
    expect(JSON.stringify(log.metadata)).not.toContain("power connector"); // text stays out of the audit log

    // The page data shows the new text and the history.
    const view = await getWorkOrder(await amina(), wo.id);
    expect(view.diagnosis).toBe("Fictional test: worn power connector");
    expect(view.corrections).toHaveLength(2);
    expect(view.allowed.correct).toBe(true);
  });

  it("needs a reason, a real change and a completed job", async () => {
    const { wo } = await completedJob();
    const ctx = await amina();
    const same = {
      id: wo.id,
      diagnosis: SIGN_OFF.diagnosis,
      resolution: SIGN_OFF.resolution,
      failureCategory: "MECHANICAL",
    };
    await expect(correctWorkOrder(ctx, { ...same, reason: "Fix it" })).rejects.toThrow(/Nothing was changed/);
    await expect(correctWorkOrder(ctx, { ...same, diagnosis: "New text here", reason: "" })).rejects.toBeInstanceOf(
      ValidationError,
    );
    await expect(correctWorkOrder(ctx, { ...same, diagnosis: "", reason: "Because" })).rejects.toBeInstanceOf(
      ValidationError,
    );

    // A job that is not signed off yet is not corrected this way.
    const asset = await createAsset(await james(), await coastalAssetInput());
    const open = await reportFault(await peter(), { assetId: asset.id, faultDescription: "Fictional test fault" });
    await expect(
      correctWorkOrder(await james(), { ...same, id: open.id, diagnosis: "New text here", reason: "Because" }),
    ).rejects.toThrow(/Only a completed job/);
    expect(await owner.workOrderCorrection.count({ where: { workOrderId: wo.id } })).toBe(0);
  });

  it("only people who worked on the job, and managers, can correct it", async () => {
    const { wo } = await completedJob();
    const change = {
      id: wo.id,
      diagnosis: "Fictional test: changed",
      resolution: SIGN_OFF.resolution,
      failureCategory: "MECHANICAL",
    };
    const stranger = await contextFor(await addTestMember(C, "TECHNICIAN", [{ hospital: "RGH" }]));
    await expect(correctWorkOrder(stranger, { ...change, reason: "Not mine" })).rejects.toBeInstanceOf(
      AuthorizationError,
    );
    await expect(correctWorkOrder(await lucy(), { ...change, reason: "Not mine" })).rejects.toBeInstanceOf(
      AuthorizationError,
    );
    expect(
      await owner.auditLog.count({ where: { action: "workorder.access_denied", entityId: wo.id, outcome: "DENIED" } }),
    ).toBeGreaterThanOrEqual(1); // the technician; the reporter is stopped earlier by role
    expect((await getWorkOrder(stranger, wo.id)).allowed.correct).toBe(false);

    // A manager may, and the technician is told.
    await correctWorkOrder(await james(), { ...change, reason: "Wording fixed after review" });
    await correctWorkOrder(await hodan(), {
      ...change,
      diagnosis: "Fictional test: changed again",
      reason: "Admin tidy up",
    });
    const notes = await listMyNotifications(await amina());
    expect(notes.some((n) => n.type === "workorder.corrected" && n.link === `/work-orders/${wo.id}`)).toBe(true);
  });

  it("corrections can never be edited or deleted", async () => {
    const { wo } = await completedJob();
    await correctWorkOrder(await amina(), {
      id: wo.id,
      diagnosis: "Fictional test: changed",
      resolution: SIGN_OFF.resolution,
      failureCategory: "MECHANICAL",
      reason: "Typo in the diagnosis",
    });
    const row = await owner.workOrderCorrection.findFirstOrThrow({ where: { workOrderId: wo.id } });
    await expect(owner.workOrderCorrection.delete({ where: { id: row.id } })).rejects.toThrow();
    await expect(
      owner.workOrderCorrection.update({ where: { id: row.id }, data: { reason: "edited" } }),
    ).rejects.toThrow();
  });
});

describe("correcting the work log of a completed job", () => {
  it("replaces a line, keeps the original, credits the original technician and updates the total", async () => {
    const { wo, aminaUser } = await completedJob();
    const lines = (await getWorkOrder(await amina(), wo.id)).tasks;
    expect(lines.map((t) => t.minutes)).toEqual([20, 45]);

    await correctWorkLine(await amina(), {
      id: wo.id,
      taskId: lines[1].id,
      description: "Fictional test: replaced connector and cleaned contacts",
      minutes: 60,
      reason: "Forgot the cleaning time",
    });
    const view = await getWorkOrder(await james(), wo.id);
    expect(view.tasks.map((t) => t.minutes)).toEqual([20, 60]);
    expect(view.totalMinutes).toBe(80);
    expect(view.tasks[1].performedById).toBe(aminaUser.id);
    expect(view.tasks[1].corrected).toMatchObject({ reason: "Forgot the cleaning time" });
    expect(view.tasks[1].corrected!.before).toEqual([
      { description: "Fictional test: replaced connector", minutes: 45 },
    ]);
    // The original line is still stored.
    expect(await owner.workOrderTask.count({ where: { workOrderId: wo.id } })).toBe(3);

    // The old line cannot be corrected twice; the new one can (a chain).
    await expect(
      correctWorkLine(await amina(), {
        id: wo.id,
        taskId: lines[1].id,
        description: "Another change",
        minutes: 30,
        reason: "Second try",
      }),
    ).rejects.toThrow(/corrected by someone else/);
    await correctWorkLine(await james(), {
      id: wo.id,
      taskId: view.tasks[1].id,
      description: "Fictional test: replaced connector and cleaned contacts",
      minutes: 55,
      reason: "Rounded after checking the timesheet",
    });
    const again = await getWorkOrder(await james(), wo.id);
    expect(again.totalMinutes).toBe(75);
    expect(again.tasks[1].corrected!.before).toHaveLength(2);

    // Reports count only the current version of each line.
    const row = await owner.$queryRaw<{ m: bigint }[]>`
      SELECT sum(t.minutes) AS m FROM work_order_tasks t
      WHERE t.work_order_id = ${wo.id}::uuid
        AND NOT EXISTS (SELECT 1 FROM work_order_tasks c WHERE c.corrects_task_id = t.id)`;
    expect(Number(row[0].m)).toBe(75);
  });

  it("needs a change, a reason and a person who worked on the job", async () => {
    const { wo } = await completedJob();
    const [line] = (await getWorkOrder(await amina(), wo.id)).tasks;
    const same = { id: wo.id, taskId: line.id, description: line.description, minutes: line.minutes };
    await expect(correctWorkLine(await amina(), { ...same, reason: "No change" })).rejects.toThrow(
      /Nothing was changed/,
    );
    await expect(correctWorkLine(await amina(), { ...same, minutes: 25, reason: "" })).rejects.toBeInstanceOf(
      ValidationError,
    );
    await expect(correctWorkLine(await amina(), { ...same, minutes: 0, reason: "Zero" })).rejects.toBeInstanceOf(
      ValidationError,
    );
    const stranger = await contextFor(await addTestMember(C, "TECHNICIAN", [{ hospital: "RGH" }]));
    await expect(correctWorkLine(stranger, { ...same, minutes: 25, reason: "Not mine" })).rejects.toBeInstanceOf(
      AuthorizationError,
    );
  });
});
