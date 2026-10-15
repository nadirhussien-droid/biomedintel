// Report filters: a plain GET form, so every filtered view has a shareable
// URL. The server re-validates every value against the user's scope.
import { PERIOD_LABELS, PERIOD_PRESETS, type Period } from "@/lib/analytics/period";
import type { AnalyticsQuery } from "@/lib/validation/analytics";
import { PRIORITIES, PRIORITY_LABELS, WO_STATUSES, WO_STATUS_LABELS } from "@/lib/validation/work-orders";

type Option = { id: string; name: string };
export type FilterOptions = {
  hospitals: { id: string; code: string; name: string }[];
  departments: Option[];
  categories: Option[];
  locations: Option[];
  engineers: Option[];
};
export type FilterField =
  | "period"
  | "hospital"
  | "department"
  | "location"
  | "category"
  | "priority"
  | "status"
  | "assignee";

const control = "min-h-11 w-full rounded-sm border border-line-strong bg-white px-3 text-sm text-ink";
const button =
  "inline-flex min-h-11 items-center justify-center rounded-md border border-teal-400 bg-teal-400 px-4 text-sm font-semibold text-navy-900";

function Select({
  id,
  label,
  name,
  value,
  children,
}: {
  id: string;
  label: string;
  name: string;
  value?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label htmlFor={id} className="text-sm font-semibold">
        {label}
      </label>
      <select id={id} name={name} defaultValue={value ?? ""} className={`${control} mt-1.5`}>
        {children}
      </select>
    </div>
  );
}

export function ReportFilters({
  action,
  q,
  period,
  options,
  fields,
  by,
  extra,
}: {
  action: string;
  q: AnalyticsQuery;
  period?: Period;
  options: FilterOptions;
  fields: FilterField[];
  by?: { value: string; choices: Record<string, string> };
  extra?: React.ReactNode;
}) {
  const has = (f: FilterField) => fields.includes(f);
  return (
    <form method="get" action={action} aria-label="Report filters" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {has("period") ? (
        <>
          <Select id="f-period" label="Period" name="period" value={q.period}>
            {PERIOD_PRESETS.map((p) => (
              <option key={p} value={p}>
                {PERIOD_LABELS[p]}
              </option>
            ))}
          </Select>
          <div>
            <label htmlFor="f-from" className="text-sm font-semibold">
              From <span className="text-ink-muted font-normal">(custom)</span>
            </label>
            <input id="f-from" name="from" type="date" defaultValue={period?.from} className={`${control} mt-1.5`} />
          </div>
          <div>
            <label htmlFor="f-to" className="text-sm font-semibold">
              To <span className="text-ink-muted font-normal">(custom)</span>
            </label>
            <input id="f-to" name="to" type="date" defaultValue={period?.to} className={`${control} mt-1.5`} />
          </div>
        </>
      ) : null}
      {has("hospital") ? (
        <Select id="f-hospital" label="Hospital" name="hospital" value={q.hospital}>
          <option value="">All my hospitals</option>
          {options.hospitals.map((h) => (
            <option key={h.id} value={h.id}>
              {h.code} · {h.name}
            </option>
          ))}
        </Select>
      ) : null}
      {has("department") ? (
        <Select id="f-department" label="Department" name="department" value={q.department}>
          <option value="">All departments</option>
          {options.departments.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </Select>
      ) : null}
      {has("location") ? (
        <Select id="f-location" label="Location" name="location" value={q.location}>
          <option value="">All locations</option>
          {options.locations.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </Select>
      ) : null}
      {has("category") ? (
        <Select id="f-category" label="Equipment category" name="category" value={q.category}>
          <option value="">All categories</option>
          {options.categories.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </Select>
      ) : null}
      {has("priority") ? (
        <Select id="f-priority" label="Priority" name="priority" value={q.priority}>
          <option value="">All priorities</option>
          {PRIORITIES.map((p) => (
            <option key={p} value={p}>
              {PRIORITY_LABELS[p]}
            </option>
          ))}
        </Select>
      ) : null}
      {has("status") ? (
        <Select id="f-status" label="Work order status" name="status" value={q.status}>
          <option value="">Any status</option>
          {WO_STATUSES.map((p) => (
            <option key={p} value={p}>
              {WO_STATUS_LABELS[p]}
            </option>
          ))}
        </Select>
      ) : null}
      {has("assignee") && options.engineers.length ? (
        <Select id="f-assignee" label="Assigned engineer" name="assignee" value={q.assignee}>
          <option value="">Everyone</option>
          {options.engineers.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </Select>
      ) : null}
      {by ? (
        <Select id="f-by" label="Break down by" name="by" value={by.value}>
          {Object.entries(by.choices).map(([k, l]) => (
            <option key={k} value={k}>
              {l}
            </option>
          ))}
        </Select>
      ) : null}
      {extra}
      <div className="flex items-end gap-2">
        <button type="submit" className={button}>
          Show
        </button>
        <a href={action} className="text-sm font-semibold text-teal-700 hover:underline">
          Reset
        </a>
      </div>
    </form>
  );
}

/** Query string carrying the active filters (for exports, links and paging). */
export function filterQuery(
  q: AnalyticsQuery,
  period?: Period,
  extra: Record<string, string | number | undefined> = {},
) {
  const p = new URLSearchParams();
  const all: Record<string, string | number | undefined> = {
    period: q.period,
    from: q.period === "custom" ? period?.from : undefined,
    to: q.period === "custom" ? period?.to : undefined,
    hospital: q.hospital,
    department: q.department,
    location: q.location,
    category: q.category,
    priority: q.priority,
    status: q.status,
    assignee: q.assignee,
    by: q.by,
    ...extra,
  };
  for (const [k, v] of Object.entries(all)) if (v !== undefined && v !== "") p.set(k, String(v));
  return p.toString();
}
