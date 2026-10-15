import type { Metadata } from "next";
import Link from "next/link";
import { requireAccess } from "@/server/auth/session";
import { calendarMonth, scheduleFilterOptions, todayFor, type CalendarEntry } from "@/server/services/pm-schedule";
import { PageHeader } from "@/components/shell/page-header";
import { Card } from "@/components/ui/card";
import { addMonthsClamped, daysInMonth } from "@/lib/pm/dates";

export const metadata: Metadata = { title: "Maintenance calendar" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const control = "min-h-11 rounded-sm border border-line-strong bg-white px-3 text-sm text-ink";
const linkButton = "inline-flex min-h-11 items-center justify-center rounded-md border px-4 text-sm font-semibold";
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function chip(e: CalendarEntry) {
  if (e.kind === "projected") return "border-line bg-white text-ink-muted border-dashed";
  if (e.state === "overdue" || e.status === "MISSED" || e.status === "FAILED")
    return "border-danger/40 bg-danger-bg text-danger";
  if (e.state === "due_today") return "border-warn/40 bg-warn-bg text-warn";
  if (e.status === "COMPLETED") return "border-ok/30 bg-ok-bg text-ok";
  if (e.status === "CANCELLED" || e.status === "SKIPPED")
    return "border-line bg-surface-sunken text-ink-muted line-through";
  return "border-info/30 bg-info-bg text-info";
}

const stateWord = (e: CalendarEntry) =>
  e.kind === "projected"
    ? "projected"
    : e.state === "overdue"
      ? "overdue"
      : e.state === "due_today"
        ? "due today"
        : e.label.toLowerCase();

export default async function CalendarPage({ searchParams }: { searchParams: SearchParams }) {
  const ctx = await requireAccess();
  const sp = await searchParams;
  const hospitalParam = first(sp.hospital);
  const today = await todayFor(
    ctx,
    hospitalParam && UUID.test(hospitalParam) ? hospitalParam : ctx.selection.hospitalId,
  );
  const monthParam = first(sp.month);
  const month = monthParam && /^\d{4}-(0[1-9]|1[0-2])$/.test(monthParam) ? monthParam : today.slice(0, 7);
  const hospital = first(sp.hospital);
  const department = first(sp.department);
  const [y, m] = month.split("-").map(Number);
  const from = `${month}-01`;
  const to = `${month}-${String(daysInMonth(y, m)).padStart(2, "0")}`;
  const [entries, options] = await Promise.all([
    calendarMonth(ctx, {
      from,
      to,
      hospital: hospital && UUID.test(hospital) ? hospital : undefined,
      department: department && UUID.test(department) ? department : undefined,
    }),
    scheduleFilterOptions(ctx),
  ]);
  const byDay = new Map<string, CalendarEntry[]>();
  for (const e of entries) byDay.set(e.date, [...(byDay.get(e.date) ?? []), e]);
  const firstWeekday = (new Date(Date.UTC(y, m - 1, 1)).getUTCDay() + 6) % 7; // Monday = 0
  const cells: (string | null)[] = [
    ...Array.from({ length: firstWeekday }, () => null),
    ...Array.from({ length: daysInMonth(y, m) }, (_, i) => `${month}-${String(i + 1).padStart(2, "0")}`),
  ];
  while (cells.length % 7) cells.push(null);
  const title = new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-GB", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
  const nav = (delta: number) => {
    const p = new URLSearchParams({ month: addMonthsClamped(`${month}-01`, delta).slice(0, 7) });
    if (hospital) p.set("hospital", hospital);
    if (department) p.set("department", department);
    return `/maintenance/calendar?${p.toString()}`;
  };

  return (
    <>
      <PageHeader
        title="Maintenance calendar"
        description="Recorded due dates, the next due date of every schedule, and projected later dates (dashed)."
      />
      <Card>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="flex items-center gap-2">
            <Link href={nav(-1)} className={`${linkButton} border-line-strong bg-white`} aria-label="Previous month">
              ←
            </Link>
            <h2 className="min-w-44 text-center text-lg font-semibold">{title}</h2>
            <Link href={nav(1)} className={`${linkButton} border-line-strong bg-white`} aria-label="Next month">
              →
            </Link>
          </div>
          <form
            method="get"
            action="/maintenance/calendar"
            className="flex flex-wrap items-end gap-2"
            aria-label="Filter the calendar"
          >
            <input type="hidden" name="month" value={month} />
            <label className="flex flex-col text-sm font-semibold">
              Hospital
              <select name="hospital" defaultValue={hospital ?? ""} className={`${control} mt-1`}>
                <option value="">All my hospitals</option>
                {options.hospitals.map((h) => (
                  <option key={h.id} value={h.id}>
                    {h.code} · {h.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col text-sm font-semibold">
              Department
              <select name="department" defaultValue={department ?? ""} className={`${control} mt-1`}>
                <option value="">All departments</option>
                {options.departments.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.hospital.code} · {d.name}
                  </option>
                ))}
              </select>
            </label>
            <button type="submit" className={`${linkButton} text-navy-900 border-teal-400 bg-teal-400`}>
              Apply
            </button>
          </form>
        </div>

        {/* Month grid on wide screens */}
        <div className="hidden md:block">
          <div className="text-ink-muted grid grid-cols-7 gap-1 text-center text-xs font-semibold uppercase">
            {WEEKDAYS.map((d) => (
              <div key={d}>{d}</div>
            ))}
          </div>
          <div className="mt-1 grid grid-cols-7 gap-1">
            {cells.map((d, i) => {
              if (!d) return <div key={`blank-${i}`} className="bg-surface min-h-28 rounded-sm" />;
              const list = byDay.get(d) ?? [];
              return (
                <div
                  key={d}
                  className={`border-line min-h-28 rounded-sm border p-1.5 ${d === today ? "ring-2 ring-teal-400" : ""}`}
                >
                  <div className="flex items-center justify-between text-xs font-semibold">
                    <span>{Number(d.slice(8))}</span>
                    {d === today ? <span className="text-teal-700">Today</span> : null}
                  </div>
                  <ul className="mt-1 flex flex-col gap-1">
                    {list.slice(0, 4).map((e, k) => (
                      <li key={k}>
                        <Link
                          href={e.href}
                          className={`block truncate rounded-sm border px-1 py-0.5 text-[11px] ${chip(e)}`}
                          title={`${e.assetTag} · ${e.planName} · ${stateWord(e)}`}
                        >
                          <span className="font-mono font-semibold">{e.assetTag}</span>{" "}
                          <span className="sr-only">({stateWord(e)})</span>
                        </Link>
                      </li>
                    ))}
                    {list.length > 4 ? (
                      <li>
                        <Link
                          href={`/maintenance/schedule?view=all&from=${d}&to=${d}`}
                          className="text-xs font-semibold text-teal-700 hover:underline"
                        >
                          +{list.length - 4} more
                        </Link>
                      </li>
                    ) : null}
                  </ul>
                </div>
              );
            })}
          </div>
        </div>

        {/* Agenda list on phones */}
        <ol className="flex flex-col gap-3 md:hidden">
          {[...byDay.entries()].map(([d, list]) => (
            <li key={d}>
              <div className="text-sm font-semibold">
                {new Date(`${d}T00:00:00Z`).toLocaleDateString("en-GB", {
                  weekday: "short",
                  day: "numeric",
                  month: "short",
                  timeZone: "UTC",
                })}
                {d === today ? " · Today" : ""}
              </div>
              <ul className="mt-1 flex flex-col gap-1">
                {list.map((e, k) => (
                  <li key={k}>
                    <Link href={e.href} className={`block rounded-sm border px-2 py-1 text-sm ${chip(e)}`}>
                      <span className="font-mono font-semibold">{e.assetTag}</span> · {e.planName} · {stateWord(e)}
                    </Link>
                  </li>
                ))}
              </ul>
            </li>
          ))}
          {byDay.size === 0 ? <li className="text-ink-muted text-sm">Nothing scheduled this month.</li> : null}
        </ol>

        <p className="text-ink-muted text-xs">
          Key: red = overdue, missed or failed · amber = due today · blue = scheduled or open · green = completed ·
          dashed = projected from the interval (no work order yet).
        </p>
      </Card>
    </>
  );
}
