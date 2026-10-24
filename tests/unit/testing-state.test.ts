import { describe, expect, it } from "vitest";
import { calibrationSchema, calibrationState, dueDateFor } from "@/lib/validation/testing";

describe("calibration state", () => {
  const today = "2026-10-24";
  it("has no calibration", () => expect(calibrationState(null, today)).toBe("NOT_CALIBRATED"));
  it("failed beats everything, even when not yet due", () =>
    expect(calibrationState({ dueOn: "2027-10-01", result: "FAIL" }, today)).toBe("FAILED"));
  it("overdue the day after the due date, not on it", () => {
    expect(calibrationState({ dueOn: "2026-10-23", result: "PASS" }, today)).toBe("OVERDUE");
    expect(calibrationState({ dueOn: "2026-10-24", result: "PASS" }, today)).toBe("DUE_SOON");
  });
  it("due soon within 30 days, current after", () => {
    expect(calibrationState({ dueOn: "2026-11-23", result: "PASS_ADJUSTED" }, today)).toBe("DUE_SOON");
    expect(calibrationState({ dueOn: "2026-11-24", result: "PASS" }, today)).toBe("CURRENT");
  });
});

describe("calibration input", () => {
  const base = { testEquipmentId: "00000000-0000-4000-8000-000000000001", laboratory: "Fictional Lab", result: "PASS" };
  it("suggests the due date from the interval, clamping month ends", () => {
    expect(dueDateFor("2025-01-31", null, 1)).toBe("2025-02-28");
    expect(dueDateFor("2025-10-24", null, 12)).toBe("2026-10-24");
    expect(dueDateFor("2025-10-24", "2026-04-01", 12)).toBe("2026-04-01");
  });
  it("rejects future calibration dates and a due date before the calibration date", () => {
    expect(calibrationSchema.safeParse({ ...base, calibratedOn: "2999-01-01" }).success).toBe(false);
    expect(calibrationSchema.safeParse({ ...base, calibratedOn: "2025-05-01", dueOn: "2025-04-01" }).success).toBe(
      false,
    );
    expect(calibrationSchema.safeParse({ ...base, calibratedOn: "2025-05-01" }).success).toBe(true);
  });
});
