// Preventive maintenance date maths (Stage 6): intervals, month ends, leap
// years, time zones and due/overdue rules.
import { describe, expect, it } from "vitest";
import {
  addMonthsClamped,
  dueDate,
  dueState,
  endOfLocalDay,
  firstIndexOnOrAfter,
  fromDbDate,
  intervalLabel,
  isDateOnly,
  isOnTime,
  lastIndexOnOrBefore,
  localToday,
  toDbDate,
} from "@/lib/pm/dates";

const series = (anchor: string, unit: "DAY" | "WEEK" | "MONTH", count: number, n: number) =>
  Array.from({ length: n }, (_, i) => dueDate(anchor, unit, count, i));

describe("supported intervals", () => {
  it("weekly, monthly, quarterly, semiannual, annual and custom day intervals", () => {
    expect(series("2026-10-01", "WEEK", 1, 3)).toEqual(["2026-10-01", "2026-10-08", "2026-10-15"]);
    expect(series("2026-10-15", "MONTH", 1, 3)).toEqual(["2026-10-15", "2026-11-15", "2026-12-15"]);
    expect(series("2026-10-15", "MONTH", 3, 3)).toEqual(["2026-10-15", "2027-01-15", "2027-04-15"]);
    expect(series("2026-10-15", "MONTH", 6, 3)).toEqual(["2026-10-15", "2027-04-15", "2027-10-15"]);
    expect(series("2026-10-15", "MONTH", 12, 3)).toEqual(["2026-10-15", "2027-10-15", "2028-10-15"]);
    expect(series("2026-12-28", "DAY", 10, 3)).toEqual(["2026-12-28", "2027-01-07", "2027-01-17"]);
  });

  it("labels intervals in plain English", () => {
    expect(intervalLabel(1, "WEEK")).toBe("Weekly");
    expect(intervalLabel(1, "MONTH")).toBe("Monthly");
    expect(intervalLabel(3, "MONTH")).toBe("Quarterly");
    expect(intervalLabel(6, "MONTH")).toBe("Every 6 months (semiannual)");
    expect(intervalLabel(12, "MONTH")).toBe("Annually");
    expect(intervalLabel(24, "MONTH")).toBe("Every 2 years");
    expect(intervalLabel(10, "DAY")).toBe("Every 10 days");
  });

  it("rejects impossible intervals and indexes", () => {
    expect(() => dueDate("2026-01-01", "MONTH", 0, 1)).toThrow();
    expect(() => dueDate("2026-01-01", "MONTH", 1, -1)).toThrow();
    expect(() => dueDate("2026-02-30", "MONTH", 1, 1)).toThrow();
  });
});

describe("month ends and leap years", () => {
  it("clamps to the end of shorter months without drifting", () => {
    expect(series("2026-01-31", "MONTH", 1, 5)).toEqual([
      "2026-01-31",
      "2026-02-28",
      "2026-03-31", // back to the 31st: counted from the anchor, not from 28 Feb
      "2026-04-30",
      "2026-05-31",
    ]);
    expect(dueDate("2027-11-30", "MONTH", 3, 1)).toBe("2028-02-29"); // leap year
    expect(addMonthsClamped("2026-08-31", 6)).toBe("2027-02-28");
  });

  it("29 February yearly falls on 28 February in ordinary years", () => {
    expect(series("2028-02-29", "MONTH", 12, 5)).toEqual([
      "2028-02-29",
      "2029-02-28",
      "2030-02-28",
      "2031-02-28",
      "2032-02-29",
    ]);
  });

  it("validates calendar dates including leap days", () => {
    expect(isDateOnly("2028-02-29")).toBe(true);
    expect(isDateOnly("2027-02-29")).toBe(false);
    expect(isDateOnly("2100-02-29")).toBe(false); // century, not divisible by 400
    expect(isDateOnly("2000-02-29")).toBe(true);
    expect(isDateOnly("2026-13-01")).toBe(false);
  });
});

describe("finding positions in a series", () => {
  it("first due date on or after a day", () => {
    expect(firstIndexOnOrAfter("2026-01-31", "MONTH", 1, "2026-03-01")).toBe(2); // 31 Mar
    expect(firstIndexOnOrAfter("2026-01-31", "MONTH", 1, "2026-02-28")).toBe(1);
    expect(firstIndexOnOrAfter("2026-01-01", "WEEK", 2, "2026-01-01")).toBe(0);
    expect(firstIndexOnOrAfter("2026-01-01", "DAY", 7, "2026-01-09")).toBe(2);
  });

  it("last due date on or before a day (catch-up after missed dates)", () => {
    // Monthly from 15 Jun; on 20 Oct the dates 15 Jun … 15 Oct have all passed.
    expect(lastIndexOnOrBefore("2026-06-15", "MONTH", 1, 0, "2026-10-20")).toBe(4);
    expect(lastIndexOnOrBefore("2026-06-15", "MONTH", 1, 0, "2026-06-14")).toBeNull();
    expect(lastIndexOnOrBefore("2026-06-15", "MONTH", 1, 3, "2026-10-15")).toBe(4);
  });
});

describe("time zones and date boundaries", () => {
  // 21:30 UTC on 31 Oct is already 1 Nov in Nairobi (UTC+3) but not in UTC.
  const lateUtc = new Date("2026-10-31T21:30:00Z");

  it("works out today in the hospital time zone, not UTC", () => {
    expect(localToday("Africa/Nairobi", lateUtc)).toBe("2026-11-01");
    expect(localToday("UTC", lateUtc)).toBe("2026-10-31");
    expect(localToday("Australia/Melbourne", new Date("2026-10-15T13:30:00Z"))).toBe("2026-10-16");
  });

  it("a due day ends at local midnight", () => {
    expect(endOfLocalDay("2026-10-31", "Africa/Nairobi").toISOString()).toBe("2026-10-31T20:59:59.999Z");
    // Melbourne is UTC+11 in summer (daylight saving) and UTC+10 in winter.
    expect(endOfLocalDay("2027-01-15", "Australia/Melbourne").toISOString()).toBe("2027-01-15T12:59:59.999Z");
    expect(endOfLocalDay("2027-07-15", "Australia/Melbourne").toISOString()).toBe("2027-07-15T13:59:59.999Z");
  });

  it("DATE values round-trip without shifting a day", () => {
    expect(fromDbDate(toDbDate("2026-12-31"))).toBe("2026-12-31");
    expect(toDbDate("2026-03-01").toISOString()).toBe("2026-03-01T00:00:00.000Z");
  });
});

describe("due, overdue and on-time rules", () => {
  it("overdue only once the due date has passed", () => {
    expect(dueState("2026-10-14", "2026-10-15")).toBe("overdue");
    expect(dueState("2026-10-15", "2026-10-15")).toBe("due_today");
    expect(dueState("2026-10-16", "2026-10-15")).toBe("upcoming");
  });

  it("on time includes the plan's grace days", () => {
    expect(isOnTime("2026-10-15", "2026-10-15", 0)).toBe(true);
    expect(isOnTime("2026-10-15", "2026-10-16", 0)).toBe(false);
    expect(isOnTime("2026-10-15", "2026-10-22", 7)).toBe(true);
    expect(isOnTime("2026-10-15", "2026-10-23", 7)).toBe(false);
  });
});
