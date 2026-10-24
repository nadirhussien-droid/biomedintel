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
