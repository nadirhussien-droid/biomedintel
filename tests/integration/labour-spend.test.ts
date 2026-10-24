// Labour rates, the department spend report and the staff effectiveness report.
import { afterAll, describe, expect, it } from "vitest";
import { db } from "@/server/db/client";
import { AuthorizationError, ValidationError } from "@/server/authz/errors";
import { createAsset } from "@/server/services/assets";
import {
  assignWorkOrder,
  completeWorkOrder,
  logWork,
  reportFault,
  startWorkOrder,
} from "@/server/services/work-orders";
import { addLabourRate, listLabourRates } from "@/server/services/labour-rates";
import { getDepartmentSpend } from "@/server/services/department-spend";
import { getStaffEffectiveness } from "@/server/services/staff-effectiveness";
import { addTestMember, coastalAssetInput, contextFor, departmentId, owner, userByEmail } from "../helpers";

const C = "coastal-health";

afterAll(async () => {
  await db.$disconnect();
  await owner.$disconnect();
});

const james = () => contextFor("james.otieno@coastal.example", C); // Engineering Manager
const peter = () => contextFor("peter.kamau@coastal.example"); // Department Head
const amina = () => contextFor("amina.warsame@coastal.example"); // Technician
const today = () => new Date().toISOString().slice(0, 10);

const SIGN_OFF = {
  diagnosis: "Fictional test: worn connector",
  resolution: "Fictional test: connector replaced, tested",
  outcome: "REPAIRED",
  functionalCheck: "PASS",
  electricalSafetyCheck: "PASS",
  checkNotes: "",
  declaration: true,
};

/** A repair job in the ICU assigned to `assigneeEmail`, with minutes logged. */
async function job(assigneeEmail: string, minutes: number, finish = false) {
  const asset = await createAsset(await james(), await coastalAssetInput());
  const wo = await reportFault(await peter(), { assetId: asset.id, faultDescription: "Fictional test fault" });
  const who = await userByEmail(assigneeEmail);
  await assignWorkOrder(await james(), { id: wo.id, assigneeId: who.id });
  const ctx = await contextFor(assigneeEmail);
  await startWorkOrder(ctx, { id: wo.id });
  await logWork(ctx, { id: wo.id, description: "Fictional test work", minutes });
  if (finish) await completeWorkOrder(ctx, { id: wo.id, ...SIGN_OFF });
  return who.id;
}

describe("labour rates", () => {
  it("managers add rates; technicians cannot; bad values are refused; changes are audited", async () => {
    const aminaUser = await userByEmail("amina.warsame@coastal.example");
    await expect(
      addLabourRate(await amina(), { userId: aminaUser.id, hourlyRate: "20", currency: "USD", effectiveFrom: today() }),
    ).rejects.toBeInstanceOf(AuthorizationError);
    await expect(listLabourRates(await amina())).rejects.toBeInstanceOf(AuthorizationError);
    for (const bad of [
      { hourlyRate: "-5", currency: "USD" },
      { hourlyRate: "abc", currency: "USD" },
      { hourlyRate: "20", currency: "DOLLAR" },
    ])
      await expect(
        addLabourRate(await james(), { userId: aminaUser.id, effectiveFrom: today(), ...bad }),
      ).rejects.toBeInstanceOf(ValidationError);
    const added = await addLabourRate(await james(), {
      userId: aminaUser.id,
      hourlyRate: "20",
      currency: "usd",
      effectiveFrom: "2000-01-01",
    });
    const row = await owner.labourRate.findUniqueOrThrow({ where: { id: added.id } });
    expect(row.currency).toBe("USD");
    expect(await owner.auditLog.count({ where: { action: "labour_rate.added", entityId: added.id } })).toBe(1);
    // Rates are never edited or deleted.
    await expect(owner.labourRate.update({ where: { id: added.id }, data: { currency: "KES" } })).rejects.toThrow();
    const people = await listLabourRates(await james());
    expect(people.find((p) => p.userId === aminaUser.id)!.rates[0]!.hourlyRate).toBe("20.00");
  });
});

describe("department spend by month", () => {
  it("prices logged hours with the person's rate, and counts unrated hours without inventing money", async () => {
    const icu = await departmentId(C, "RGH", "ICU");
    const filter = { department: icu, period: "this_month" };
    const before = await getDepartmentSpend(await james(), filter);
    const sum = (d: typeof before, f: (r: (typeof before.rows)[number]) => number) =>
      d.rows.reduce((a, r) => a + f(r), 0);
    const usd = (d: typeof before) => d.rows.filter((r) => r.currency === "USD");

    await job("amina.warsame@coastal.example", 90); // Amina has a 20 USD/h rate: 30 USD
    const newcomer = await addTestMember(C, "TECHNICIAN", [{ hospital: "RGH" }]); // no rate
    await job(newcomer, 60);

    const after = await getDepartmentSpend(await james(), filter);
    const labourDelta =
      sum({ ...after, rows: usd(after) }, (r) => r.labour) - sum({ ...before, rows: usd(before) }, (r) => r.labour);
    expect(Math.round(labourDelta * 100) / 100).toBe(30);
    expect(Math.abs(after.totalHours - before.totalHours - 2.5)).toBeLessThan(0.15);
    expect(Math.abs(after.unratedHours - before.unratedHours - 1)).toBeLessThan(0.15);
    expect(after.rows.every((r) => r.departmentId === icu)).toBe(true);
    // The view is audited as a financial view.
    expect(
      await owner.auditLog.count({
        where: { action: "analytics.financial_viewed", actorUserId: (await james()).user.id },
      }),
    ).toBeGreaterThan(0);
  });

  it("is for financial roles only", async () => {
    await expect(getDepartmentSpend(await amina(), {})).rejects.toBeInstanceOf(AuthorizationError);
    await expect(getDepartmentSpend(await peter(), {})).rejects.toBeInstanceOf(AuthorizationError);
  });
});

describe("staff effectiveness", () => {
  it("counts completed jobs and logged hours per engineer, for managers only", async () => {
    const icu = await departmentId(C, "RGH", "ICU");
    const filter = { department: icu, period: "this_month" };
    const aminaUser = await userByEmail("amina.warsame@coastal.example");
    const before = await getStaffEffectiveness(await james(), filter);
    const was = before.rows.find((r) => r.userId === aminaUser.id);

    await job("amina.warsame@coastal.example", 45, true);

    const after = await getStaffEffectiveness(await james(), filter);
    const now = after.rows.find((r) => r.userId === aminaUser.id)!;
    expect(now.completed - (was?.completed ?? 0)).toBe(1);
    expect(now.corrective - (was?.corrective ?? 0)).toBe(1);
    expect(Math.abs(now.hours - (was?.hours ?? 0) - 0.75)).toBeLessThan(0.15);
    expect(now.meanCompletionH).not.toBeNull();
    await expect(getStaffEffectiveness(await amina(), {})).rejects.toBeInstanceOf(AuthorizationError);
    await expect(getStaffEffectiveness(await peter(), {})).rejects.toBeInstanceOf(AuthorizationError);
  });
});
