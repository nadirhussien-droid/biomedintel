// Reads report filters from the page URL (first value of each key only).
// Values are validated by the service, never trusted here.
export type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const KEYS = [
  "period",
  "from",
  "to",
  "hospital",
  "department",
  "location",
  "category",
  "priority",
  "status",
  "assignee",
  "by",
  "page",
  "threshold",
];

export async function readReportParams(searchParams: SearchParams) {
  const sp = await searchParams;
  const raw: Record<string, string | undefined> = {};
  for (const k of KEYS) {
    const v = sp[k];
    raw[k] = Array.isArray(v) ? v[0] : v;
  }
  return raw;
}
