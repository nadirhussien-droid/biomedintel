// Chart data for the overview, shared by the screen and the PDF so both show the same picture.
import type { ChartSpec } from "@/server/export/document";

export const CHART_COLORS = {
  ok: "#1E9E6A",
  warn: "#E0A100",
  danger: "#D64545",
  navy: "#102D46",
  teal: "#2BB3A0",
  grey: "#9AA9B8",
};

type M = { key: string; value: number | null };

/** Builds the overview charts from the key figures. Charts with nothing to show are left out. */
export function overviewCharts(metrics: M[], pm: { due: number; onTime: number }): ChartSpec[] {
  const v = (k: string) => metrics.find((m) => m.key === k)?.value ?? 0;
  const charts: ChartSpec[] = [];

  const registered = v("registered");
  if (registered > 0)
    charts.push({
      kind: "donut",
      title: "Equipment availability",
      items: [
        { label: "In service", value: v("in_service"), color: CHART_COLORS.ok },
        { label: "Unavailable", value: v("unavailable"), color: CHART_COLORS.warn },
      ],
      centre: { value: String(registered), label: "devices" },
    });

  if (pm.due > 0)
    charts.push({
      kind: "donut",
      title: "Planned maintenance due in the period",
      items: [
        { label: "Signed off on time", value: pm.onTime, color: CHART_COLORS.ok },
        { label: "Late or not done", value: pm.due - pm.onTime, color: CHART_COLORS.danger },
      ],
      centre: { value: `${Math.round((pm.onTime / pm.due) * 100)}%`, label: "on time" },
    });

  charts.push({
    kind: "bar",
    title: "Work orders needing attention",
    items: [
      { label: "Open jobs", value: v("open_wo"), color: CHART_COLORS.navy },
      { label: "Awaiting manager review", value: v("awaiting_review"), color: CHART_COLORS.teal },
      { label: "Backlog over 30 days", value: v("backlog"), color: CHART_COLORS.danger },
      { label: "PM due in 30 days", value: v("pm_due_soon"), color: CHART_COLORS.warn },
      { label: "PM overdue", value: v("pm_overdue"), color: CHART_COLORS.danger },
    ],
  });

  charts.push({
    kind: "bar",
    title: "Safety and reliability",
    items: [
      { label: "Failed electrical safety tests", value: v("failed_tests"), color: CHART_COLORS.danger },
      { label: "Awaiting repair or retest", value: v("awaiting_retest"), color: CHART_COLORS.warn },
      { label: "Awaiting return approval", value: v("awaiting_approval"), color: CHART_COLORS.teal },
      { label: "Equipment with recurring faults", value: v("recurring"), color: CHART_COLORS.navy },
    ],
  });
  return charts;
}

const PALETTE = ["#102D46", "#2BB3A0", "#E0A100", "#D64545", "#6C7FD8", "#1E9E6A", "#9AA9B8", "#B0568A"];
const top = (items: { label: string; value: number }[], max = 8) =>
  items
    .filter((i) => i.value > 0)
    .sort((a, b) => b.value - a.value)
    .slice(0, max)
    .map((i, k) => ({ ...i, color: PALETTE[k % PALETTE.length]! }));

type SpendLine = {
  department: string;
  hours: number;
  currency: string | null;
  parts: number;
  labour: number;
  service: number;
  total: number;
};

/** Charts for the department spend report: where the money went, and where the hours went. */
export function spendCharts(rows: SpendLine[], totals: { currency: string; total: number }[]): ChartSpec[] {
  const charts: ChartSpec[] = [];
  const main = [...totals].sort((a, b) => b.total - a.total)[0];
  if (main) {
    const by = new Map<string, number>();
    for (const r of rows) if (r.currency === main.currency) by.set(r.department, (by.get(r.department) ?? 0) + r.total);
    const items = top([...by].map(([label, value]) => ({ label, value: Math.round(value) })));
    if (items.length) charts.push({ kind: "bar", title: `Total spend by department (${main.currency})`, items });
    const split = [
      {
        label: "Parts",
        value: rows.filter((r) => r.currency === main.currency).reduce((a, r) => a + r.parts, 0),
        color: CHART_COLORS.navy,
      },
      {
        label: "Labour",
        value: rows.filter((r) => r.currency === main.currency).reduce((a, r) => a + r.labour, 0),
        color: CHART_COLORS.teal,
      },
      {
        label: "External service",
        value: rows.filter((r) => r.currency === main.currency).reduce((a, r) => a + r.service, 0),
        color: CHART_COLORS.warn,
      },
    ];
    if (split.some((s) => s.value > 0))
      charts.push({
        kind: "donut",
        title: `Where the money went (${main.currency})`,
        items: split.map((s) => ({ ...s, value: Math.round(s.value * 100) / 100 })),
        centre: { value: String(Math.round(main.total)), label: main.currency },
      });
  }
  const hours = new Map<string, number>();
  for (const r of rows) hours.set(r.department, (hours.get(r.department) ?? 0) + r.hours);
  const hItems = top([...hours].map(([label, value]) => ({ label, value: Math.round(value * 10) / 10 })));
  if (hItems.length) charts.push({ kind: "bar", title: "Labour hours by department", items: hItems });
  return charts;
}

type StaffLine = { name: string; completed: number; hours: number; corrective: number; planned: number };

/** Charts for the staff report: jobs completed and hours logged per person. */
export function staffCharts(rows: StaffLine[]): ChartSpec[] {
  const charts: ChartSpec[] = [];
  const jobs = top(rows.map((r) => ({ label: r.name, value: r.completed })));
  if (jobs.length) charts.push({ kind: "bar", title: "Jobs completed", items: jobs });
  const hrs = top(rows.map((r) => ({ label: r.name, value: r.hours })));
  if (hrs.length) charts.push({ kind: "bar", title: "Hours logged", items: hrs });
  const corrective = rows.reduce((a, r) => a + r.corrective, 0);
  const planned = rows.reduce((a, r) => a + r.planned, 0);
  if (corrective + planned > 0)
    charts.push({
      kind: "donut",
      title: "Kind of work completed",
      items: [
        { label: "Repairs", value: corrective, color: CHART_COLORS.warn },
        { label: "Planned maintenance and tests", value: planned, color: CHART_COLORS.teal },
      ],
      centre: { value: String(corrective + planned), label: "jobs" },
    });
  return charts;
}
