// One report, independent of the file format.
//
// Every export (analytics reports, the PM due-date list and the asset register)
// first builds an ExportDoc from the same permission-checked, scope-filtered
// rows the screen uses. The renderers then turn it into CSV, Excel or PDF, so
// the three formats can never disagree about what a user is allowed to see.

/** A cell: text, a number, or a date-time (shown in UTC). "YYYY-MM-DD" strings are calendar dates. */
export type Cell = string | number | Date | null | undefined;

/** A chart drawn in the PDF and on screen. Excel and CSV carry the same numbers in the tables. */
export type ChartSpec = {
  kind: "donut" | "bar";
  title: string;
  items: { label: string; value: number; color: string }[];
  /** Donut only: the big number in the middle, e.g. { value: "100%", label: "on time" }. */
  centre?: { value: string; label: string };
};

export type Section = {
  /** Charts printed above the table (PDF only). */
  charts?: ChartSpec[];
  /** Heading above a table (PDF and Excel only; CSV keeps its existing layout). */
  title?: string;
  /** A sentence that explains the figures (printed as its own line). */
  note?: string;
  columns?: string[];
  rows?: Cell[][];
};

export type ExportDoc = {
  /** e.g. "Preventive maintenance compliance" */
  title: string;
  organization: string;
  /** Label/value lines printed under the title, e.g. ["Period", "1 Sep 2026 to 30 Sep 2026"]. */
  meta: [string, string][];
  sections: Section[];
};

export const EXPORT_FORMATS = ["csv", "xlsx", "pdf"] as const;
export type ExportFormat = (typeof EXPORT_FORMATS)[number];

/** The requested format; anything unknown falls back to CSV (the original behaviour). */
export function parseFormat(value: unknown): ExportFormat {
  return (EXPORT_FORMATS as readonly unknown[]).includes(value) ? (value as ExportFormat) : "csv";
}

export const FORMAT_INFO: Record<ExportFormat, { contentType: string; extension: string }> = {
  csv: { contentType: "text/csv; charset=utf-8", extension: "csv" },
  xlsx: { contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", extension: "xlsx" },
  pdf: { contentType: "application/pdf", extension: "pdf" },
};

export const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/** Quotes a CSV cell and neutralises spreadsheet formulas (CSV injection). */
export function csvCell(value: string): string {
  let v = value;
  if (/^[=+\-@\t\r]/.test(v)) v = `'${v}`;
  return `"${v.replace(/"/g, '""')}"`;
}

const ISO_TIME = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})(:\d{2}(\.\d+)?)?Z$/;

/** "2026-10-24T05:53:02.975Z" → "2026-10-24 05:53 UTC" (labels and values in the header block). */
export function friendlyTime(v: string): string {
  const m = ISO_TIME.exec(v);
  return m ? `${m[1]} ${m[2]} UTC` : v;
}

/** Plain text of a cell, exactly as the CSV has always shown it. */
export function cellText(c: Cell): string {
  if (c === null || c === undefined) return "";
  if (c instanceof Date) return c.toISOString();
  return String(c);
}

const csvLine = (cells: Cell[]) => cells.map((c) => csvCell(cellText(c))).join(",");

/**
 * CSV in the layout the analytics exports have always used: the label/value
 * lines, a blank line, then each section (a note line, or a header line and
 * its rows), separated by blank lines. Formula-safe cells.
 */
export function toCsv(doc: ExportDoc): string {
  const lines: string[] = [...doc.meta.map(([k, v]) => csvLine([k, v])), ""];
  doc.sections.forEach((s, i) => {
    if (i > 0) lines.push("");
    if (s.note) lines.push(csvLine([s.note]));
    if (s.columns) lines.push(csvLine(s.columns));
    for (const r of s.rows ?? []) lines.push(csvLine(r));
  });
  return lines.join("\r\n");
}

/** A single table as CSV (header + rows), as the asset and PM exports have always been. */
export function tableCsv(columns: string[], rows: Cell[][]): string {
  return [csvLine(columns), ...rows.map(csvLine)].join("\r\n");
}

/** File name: letters, digits, dots and hyphens only. */
export function exportFilename(base: string, format: ExportFormat): string {
  const safe = base
    .replace(/[^A-Za-z0-9.-]+/g, "-")
    .replace(/\.{2,}/g, ".")
    .replace(/-+/g, "-")
    .slice(0, 120);
  return `${safe}.${FORMAT_INFO[format].extension}`;
}
