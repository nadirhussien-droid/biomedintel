// Reporting periods for analytics (Stage 7). Pure functions: easy to test.
//
// A period is a range of CALENDAR DATES (inclusive) interpreted in each
// record's hospital time zone, exactly like Stage 6 due dates:
//   • date-based facts (PM due dates) are compared as dates;
//   • time-stamped facts (a job created at 23:30 Nairobi time) are compared
//     with the start of `from` and the end of `to` in that hospital's zone.
import { addDays, addMonthsClamped, daysBetween, isDateOnly, type DateOnly } from "@/lib/pm/dates";

export const PERIOD_PRESETS = ["this_month", "last_month", "this_year", "last_12_months", "custom"] as const;
export type PeriodPreset = (typeof PERIOD_PRESETS)[number];

export const PERIOD_LABELS: Record<PeriodPreset, string> = {
  this_month: "This month",
  last_month: "Previous month",
  this_year: "This year",
  last_12_months: "Last 12 months",
  custom: "Custom range",
};

export type Period = { preset: PeriodPreset; from: DateOnly; to: DateOnly; label: string; endsInFuture: boolean };

/** Longest custom range accepted (keeps queries bounded). */
export const MAX_PERIOD_DAYS = 3 * 366;

export function resolvePeriod(
  preset: PeriodPreset,
  today: DateOnly,
  custom: { from?: string; to?: string } = {},
): Period {
  const monthStart = `${today.slice(0, 8)}01`;
  let from: DateOnly;
  let to: DateOnly;
  switch (preset) {
    case "last_month": {
      from = addMonthsClamped(monthStart, -1);
      to = addDays(monthStart, -1);
      break;
    }
    case "this_year":
      from = `${today.slice(0, 4)}-01-01`;
      to = today;
      break;
    case "last_12_months":
      from = addMonthsClamped(monthStart, -11);
      to = today;
      break;
    case "custom": {
      const f = custom.from && isDateOnly(custom.from) ? custom.from : monthStart;
      const t = custom.to && isDateOnly(custom.to) ? custom.to : today;
      [from, to] = f <= t ? [f, t] : [t, f];
      if (daysBetween(from, to) > MAX_PERIOD_DAYS) from = addDays(to, -MAX_PERIOD_DAYS);
      break;
    }
    default:
      from = monthStart;
      to = today;
  }
  const label = `${fmt(from)} – ${fmt(to)}`;
  return { preset, from, to, label, endsInFuture: to > today };
}

/** The last complete week (Mon–Sun) or month before `today`, for scheduled reports. */
export function previousCompletePeriod(frequency: "WEEKLY" | "MONTHLY", today: DateOnly) {
  if (frequency === "MONTHLY") {
    const monthStart = `${today.slice(0, 8)}01`;
    const from = addMonthsClamped(monthStart, -1);
    return { from, to: addDays(monthStart, -1), key: from.slice(0, 7) };
  }
  const weekday = (new Date(`${today}T00:00:00Z`).getUTCDay() + 6) % 7; // Monday = 0
  const thisMonday = addDays(today, -weekday);
  const from = addDays(thisMonday, -7);
  return { from, to: addDays(thisMonday, -1), key: `W${from}` };
}

/** Month buckets ("YYYY-MM") covering a period, for trends. */
export function monthsBetween(from: DateOnly, to: DateOnly): string[] {
  const out: string[] = [];
  let m = `${from.slice(0, 7)}-01`;
  while (m.slice(0, 7) <= to.slice(0, 7) && out.length < 60) {
    out.push(m.slice(0, 7));
    m = addMonthsClamped(m, 1);
  }
  return out;
}

/** Median of a list of numbers (null when empty). */
export function median(values: number[]): number | null {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** Percentage with one decimal, or null ("N/A") when nothing is due. */
export function percent(numerator: number, denominator: number): number | null {
  return denominator === 0 ? null : Math.round((numerator / denominator) * 1000) / 10;
}

function fmt(d: DateOnly) {
  return new Date(`${d}T00:00:00Z`).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}
