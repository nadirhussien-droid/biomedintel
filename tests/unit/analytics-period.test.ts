// Reporting periods and small statistics helpers (Stage 7).
import { describe, expect, it } from "vitest";
import { median, monthsBetween, percent, previousCompletePeriod, resolvePeriod } from "@/lib/analytics/period";

describe("reporting periods", () => {
  it("this month, previous month, this year and last 12 months", () => {
    expect(resolvePeriod("this_month", "2026-10-15")).toMatchObject({ from: "2026-10-01", to: "2026-10-15" });
    expect(resolvePeriod("last_month", "2026-10-15")).toMatchObject({ from: "2026-09-01", to: "2026-09-30" });
    expect(resolvePeriod("last_month", "2026-03-31")).toMatchObject({ from: "2026-02-01", to: "2026-02-28" });
    expect(resolvePeriod("last_month", "2028-03-01")).toMatchObject({ from: "2028-02-01", to: "2028-02-29" });
    expect(resolvePeriod("last_month", "2026-01-10")).toMatchObject({ from: "2025-12-01", to: "2025-12-31" });
    expect(resolvePeriod("this_year", "2026-10-15")).toMatchObject({ from: "2026-01-01", to: "2026-10-15" });
    expect(resolvePeriod("last_12_months", "2026-10-15")).toMatchObject({ from: "2025-11-01", to: "2026-10-15" });
  });

  it("custom ranges are validated, ordered and bounded", () => {
    expect(resolvePeriod("custom", "2026-10-15", { from: "2026-09-30", to: "2026-09-01" })).toMatchObject({
      from: "2026-09-01",
      to: "2026-09-30",
    });
    expect(resolvePeriod("custom", "2026-10-15", { from: "2026-02-30", to: "x" })).toMatchObject({
      from: "2026-10-01",
      to: "2026-10-15",
    });
    const long = resolvePeriod("custom", "2026-10-15", { from: "2000-01-01", to: "2026-10-15" });
    expect(long.from > "2023-01-01").toBe(true);
    expect(resolvePeriod("custom", "2026-10-15", { from: "2026-10-01", to: "2026-12-31" }).endsInFuture).toBe(true);
  });

  it("scheduled reports cover the last COMPLETE week or month", () => {
    expect(previousCompletePeriod("MONTHLY", "2026-10-15")).toEqual({
      from: "2026-09-01",
      to: "2026-09-30",
      key: "2026-09",
    });
    expect(previousCompletePeriod("MONTHLY", "2026-03-01")).toEqual({
      from: "2026-02-01",
      to: "2026-02-28",
      key: "2026-02",
    });
    // 15 Oct 2026 is a Thursday: last complete week is Mon 5 – Sun 11 Oct.
    expect(previousCompletePeriod("WEEKLY", "2026-10-15")).toEqual({
      from: "2026-10-05",
      to: "2026-10-11",
      key: "W2026-10-05",
    });
    expect(previousCompletePeriod("WEEKLY", "2026-10-12")).toEqual({
      from: "2026-10-05",
      to: "2026-10-11",
      key: "W2026-10-05",
    });
  });

  it("month buckets for trends", () => {
    expect(monthsBetween("2025-11-20", "2026-02-03")).toEqual(["2025-11", "2025-12", "2026-01", "2026-02"]);
  });
});

describe("statistics helpers", () => {
  it("median and percentage, with N/A for nothing due", () => {
    expect(median([])).toBeNull();
    expect(median([5, 1, 3])).toBe(3);
    expect(median([4, 1, 2, 3])).toBe(2.5);
    expect(percent(1, 0)).toBeNull();
    expect(percent(1, 3)).toBe(33.3);
    expect(percent(2, 2)).toBe(100);
  });
});

describe("return-after-sign-in links for reports", () => {
  it("accepts report pages and snapshot links, nothing else", async () => {
    const { safeNextPath } = await import("@/lib/safe-next");
    expect(safeNextPath("/reports")).toBe("/reports");
    expect(safeNextPath("/reports/pm-compliance")).toBe("/reports/pm-compliance");
    expect(safeNextPath("/reports/scheduled/0b7e7f0e-3f1d-4c55-9a39-2f3c8e0b9a11")).not.toBeNull();
    for (const bad of ["/reports/export", "/reports/scheduled/x", "/reports//evil.example", "/reports?x=1"]) {
      expect(safeNextPath(bad)).toBeNull();
    }
  });
});
