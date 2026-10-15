// Date maths for preventive maintenance (Stage 6).
//
// Maintenance is due on a CALENDAR DATE in the hospital's own time zone
// ("the defibrillator check is due on 31 October"), not at an instant. So:
//   • Due dates are plain "YYYY-MM-DD" strings here, and DATE columns in
//     PostgreSQL. No time of day, so nothing can shift a day because of UTC.
//   • "Today" is always worked out in the hospital's time zone.
//   • Due date n of a schedule = anchor + n × interval, always counted from
//     the anchor (never from the previous date), so dates never drift.
//     Month steps keep the anchor's day of the month and clamp to the end of
//     shorter months: 31 Jan monthly → 28/29 Feb, 31 Mar, 30 Apr, 31 May …
//     29 Feb yearly → 28 Feb in ordinary years, 29 Feb in leap years.

export type IntervalUnitValue = "DAY" | "WEEK" | "MONTH";
export type DateOnly = string; // "YYYY-MM-DD"

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isDateOnly(value: string): boolean {
  const m = DATE_RE.exec(value);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  return mo >= 1 && mo <= 12 && d >= 1 && d <= daysInMonth(y, mo);
}

function parts(date: DateOnly): [number, number, number] {
  const m = DATE_RE.exec(date);
  if (!m || !isDateOnly(date)) throw new Error(`Invalid date: ${date}`);
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

const pad = (n: number, w = 2) => String(n).padStart(w, "0");
const fmt = (y: number, m: number, d: number): DateOnly => `${pad(y, 4)}-${pad(m)}-${pad(d)}`;

export function isLeapYear(y: number): boolean {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}

export function daysInMonth(y: number, m: number): number {
  return [31, isLeapYear(y) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1];
}

/** Whole days from `a` to `b` (positive when b is later). */
export function daysBetween(a: DateOnly, b: DateOnly): number {
  const [ay, am, ad] = parts(a);
  const [by, bm, bd] = parts(b);
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86_400_000);
}

export function addDays(date: DateOnly, days: number): DateOnly {
  const [y, m, d] = parts(date);
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return fmt(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
}

export function addMonthsClamped(date: DateOnly, months: number): DateOnly {
  const [y, m, d] = parts(date);
  const total = y * 12 + (m - 1) + months;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  return fmt(ny, nm, Math.min(d, daysInMonth(ny, nm)));
}

/** Due date number `n` (0 = the anchor itself) of a schedule. */
export function dueDate(anchor: DateOnly, unit: IntervalUnitValue, count: number, n: number): DateOnly {
  if (!Number.isInteger(n) || n < 0) throw new Error("Occurrence index must be a whole number ≥ 0");
  if (!Number.isInteger(count) || count < 1) throw new Error("Interval must be a whole number ≥ 1");
  if (unit === "DAY") return addDays(anchor, count * n);
  if (unit === "WEEK") return addDays(anchor, 7 * count * n);
  return addMonthsClamped(anchor, count * n);
}

/** Smallest n whose due date is on or after `from`. */
export function firstIndexOnOrAfter(anchor: DateOnly, unit: IntervalUnitValue, count: number, from: DateOnly): number {
  if (from <= anchor) return 0;
  const days = daysBetween(anchor, from);
  let n =
    unit === "DAY"
      ? Math.floor(days / count)
      : unit === "WEEK"
        ? Math.floor(days / (7 * count))
        : Math.floor(days / (31 * count));
  // Month lengths vary; step forward until we reach `from` (at most a few steps).
  while (dueDate(anchor, unit, count, n) < from) n++;
  while (n > 0 && dueDate(anchor, unit, count, n - 1) >= from) n--;
  return n;
}

/** Index of the LAST due date on or before `upTo`, starting from `fromIndex` (null if none). */
export function lastIndexOnOrBefore(
  anchor: DateOnly,
  unit: IntervalUnitValue,
  count: number,
  fromIndex: number,
  upTo: DateOnly,
): number | null {
  if (dueDate(anchor, unit, count, fromIndex) > upTo) return null;
  const n = firstIndexOnOrAfter(anchor, unit, count, addDays(upTo, 1));
  return Math.max(fromIndex, n - 1);
}

/** The calendar date it is right now in a time zone, e.g. "Africa/Nairobi". */
export function localToday(timeZone: string, now: Date = new Date()): DateOnly {
  const f = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" });
  return f.format(now); // en-CA formats as YYYY-MM-DD
}

/** Minutes the time zone is ahead of UTC at a given instant (e.g. +180 for Nairobi). */
function offsetMinutes(timeZone: string, at: Date): number {
  const f = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const p = Object.fromEntries(f.formatToParts(at).map((x) => [x.type, x.value]));
  const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  return Math.round((asUtc - Math.floor(at.getTime() / 1000) * 1000) / 60_000);
}

/** The instant a local calendar day ends (23:59:59.999 local), for work order due times. */
export function endOfLocalDay(date: DateOnly, timeZone: string): Date {
  const [y, m, d] = parts(date);
  const naive = Date.UTC(y, m - 1, d, 23, 59, 59, 999);
  let instant = naive - offsetMinutes(timeZone, new Date(naive)) * 60_000;
  // Re-check once in case a daylight-saving change happens that day.
  instant = naive - offsetMinutes(timeZone, new Date(instant)) * 60_000;
  return new Date(instant);
}

/** DATE column value (Prisma gives and takes midnight UTC) ↔ "YYYY-MM-DD". */
export function toDbDate(date: DateOnly): Date {
  parts(date);
  return new Date(`${date}T00:00:00.000Z`);
}

export function fromDbDate(value: Date): DateOnly {
  return value.toISOString().slice(0, 10);
}

/** Plain-English interval: Weekly, Monthly, Quarterly, Every 6 months, Annually, Every 10 days … */
export function intervalLabel(count: number, unit: IntervalUnitValue): string {
  if (unit === "DAY") return count === 1 ? "Daily" : `Every ${count} days`;
  if (unit === "WEEK") return count === 1 ? "Weekly" : count === 2 ? "Every 2 weeks" : `Every ${count} weeks`;
  if (count === 1) return "Monthly";
  if (count === 3) return "Quarterly";
  if (count === 6) return "Every 6 months (semiannual)";
  if (count === 12) return "Annually";
  if (count % 12 === 0) return `Every ${count / 12} years`;
  return `Every ${count} months`;
}

/** Approximate interval length in days, for comparisons only (never for due dates). */
export function approxIntervalDays(count: number, unit: IntervalUnitValue): number {
  return unit === "DAY" ? count : unit === "WEEK" ? count * 7 : Math.round(count * 30.44);
}

export type DueState = "overdue" | "due_today" | "upcoming";

/** Overdue = the due date has passed and the work is not signed off. */
export function dueState(dueOn: DateOnly, today: DateOnly): DueState {
  return dueOn < today ? "overdue" : dueOn === today ? "due_today" : "upcoming";
}

/** On time = signed off on or before the due date plus the plan's grace days. */
export function isOnTime(dueOn: DateOnly, completedOn: DateOnly, graceDays: number): boolean {
  return completedOn <= addDays(dueOn, graceDays);
}

export function formatDateOnly(date: DateOnly): string {
  const [y, m, d] = parts(date);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}
