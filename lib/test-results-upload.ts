// Upload test results (27 Oct 2026): the sheet people fill in after bulk testing with a safety
// analyser (Rigel, Fluke and similar), and the rules for reading it. This file has no database
// access: it builds the template, reads a table of cells and works out each row's answers.
//
// Rules that never bend:
//  • A measurement is Pass or Fail by comparing it with the limits on the job's checklist, never by
//    trusting a typed word. A value outside the limits is a Fail. Where no limits are set, the person
//    must write the verdict next to the reading ("12.3 pass").
//  • A Fail always needs a note saying what failed.
//  • An empty cell is never guessed: a required item left empty stops that row (other rows still go).
import ExcelJS from "exceljs";
import { ImportFileError } from "@/lib/asset-import";
import type { ChecklistItem } from "@/lib/validation/pm";

export const MAX_RESULT_ROWS = 500;

export const normLabel = (s: string) =>
  s
    .replace(/\*/g, "")
    .toLowerCase()
    .replace(/[\s ]+/g, " ")
    .trim();

export const columnHeader = (item: Pick<ChecklistItem, "label" | "unit">) =>
  item.unit ? `${item.label} (${item.unit})` : item.label;

export type SheetJob = { number: string; assetTag: string; name: string; checklist: ChecklistItem[] };

export type UploadRow = {
  line: number;
  workOrder: string | null;
  assetTag: string;
  /** Cell text by normalised header. */
  cells: Record<string, string>;
  notes: string | null;
  findings: string | null;
};

export type Answer = {
  key: string;
  result: "PASS" | "FAIL" | "NOT_APPLICABLE";
  value: number | null;
  notes: string | null;
};

// ─── The template ────────────────────────────────────────────────────────────

const BASE_HEADERS = ["Work order", "Asset ID", "Device"] as const;
const EXTRA_HEADERS = ["Notes", "Findings"] as const;

export async function buildResultsTemplate(jobs: SheetJob[]): Promise<Buffer> {
  const columns: ChecklistItem[] = [];
  const seen = new Set<string>();
  for (const job of jobs)
    for (const item of job.checklist) {
      const id = normLabel(columnHeader(item));
      if (seen.has(id)) continue;
      seen.add(id);
      columns.push(item);
    }
  const book = new ExcelJS.Workbook();
  const sheet = book.addWorksheet("Results");
  sheet.addRow([...BASE_HEADERS, ...columns.map(columnHeader), ...EXTRA_HEADERS]);
  for (const job of jobs) {
    const own = new Set(job.checklist.map((i) => normLabel(columnHeader(i))));
    // Items that do not belong to this device's checklist are greyed out below.
    sheet.addRow([job.number, job.assetTag, job.name, ...columns.map(() => ""), "", ""]);
    const row = sheet.lastRow!;
    columns.forEach((c, i) => {
      if (!own.has(normLabel(columnHeader(c)))) {
        row.getCell(BASE_HEADERS.length + 1 + i).fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: "FFE0E0E0" },
        };
      }
    });
  }
  const header = sheet.getRow(1);
  header.font = { bold: true, name: "Arial" };
  header.alignment = { wrapText: true, vertical: "top" };
  header.eachCell((cell, n) => {
    cell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: n <= BASE_HEADERS.length ? "FFFFD966" : "FFE7ECF1" },
    };
  });
  sheet.columns.forEach((c, i) => (c.width = i < BASE_HEADERS.length ? 18 : 22));
  sheet.views = [{ state: "frozen", xSplit: 2, ySplit: 1 }];

  const limits = book.addWorksheet("Limits and help");
  limits.addRow(["How to fill in the Results sheet"]).font = { bold: true, name: "Arial" };
  for (const line of [
    "One row per device. Keep the Work order and Asset ID cells as they are.",
    "Pass / Fail checks: write Pass, Fail or N/A.",
    "Measurements: write the reading as a number, for example 0.21. If the checklist has limits, the app decides Pass or Fail by comparing the reading with the limits (a reading outside the limits is a Fail).",
    "Measurements with no limits on the checklist: write the reading and the verdict, for example 12.3 pass.",
    "Write N/A where an item does not apply. Required items cannot be left empty.",
    "A Fail needs a note: say what failed in the Notes column.",
    "Grey cells do not belong to that device's checklist: leave them empty.",
    "Findings is optional. Results are recorded as signed off on the day you upload them.",
  ])
    limits.addRow([line]);
  limits.addRow([]);
  const head = limits.addRow(["Column", "Answer", "Unit", "Lower limit", "Upper limit", "Section", "Required"]);
  head.font = { bold: true, name: "Arial" };
  for (const c of columns)
    limits.addRow([
      columnHeader(c),
      c.kind === "MEASUREMENT" ? "Number" : "Pass / Fail / N/A",
      c.unit ?? "",
      c.min ?? "",
      c.max ?? "",
      c.section,
      c.required ? "Yes" : "No",
    ]);
  limits.getColumn(1).width = 60;
  return Buffer.from(await book.xlsx.writeBuffer());
}

// ─── Reading an uploaded table ───────────────────────────────────────────────

const ALIASES: Record<string, string[]> = {
  workOrder: ["work order", "work order number", "wo", "wo number", "job"],
  assetTag: ["asset id", "asset", "asset tag", "asset number", "asset no"],
  notes: ["notes", "note", "comments", "comment"],
  findings: ["findings", "work done", "work done and findings"],
};
const IGNORED = ["device", "name", "asset name"];

export type ParsedResults = { rows: UploadRow[]; ignoredColumns: string[]; resultColumns: number };

export function parseResultsTable(table: string[][]): ParsedResults {
  const headerIndex = table.findIndex((r) => r.some((c) => ALIASES.assetTag!.includes(normLabel(c))));
  if (headerIndex < 0)
    throw new ImportFileError(
      "The sheet needs an Asset ID column. Download the sheet from this page and fill that one in.",
    );
  const headers = table[headerIndex]!.map(normLabel);
  const col = (field: string) => headers.findIndex((h) => ALIASES[field]!.includes(h));
  const at = { workOrder: col("workOrder"), assetTag: col("assetTag"), notes: col("notes"), findings: col("findings") };
  const special = new Set([at.workOrder, at.assetTag, at.notes, at.findings]);
  const ignored: string[] = [];
  let resultColumns = 0;
  headers.forEach((h, i) => {
    if (!h || special.has(i)) return;
    if (IGNORED.includes(h)) return;
    resultColumns++;
  });
  const rows: UploadRow[] = [];
  for (let r = headerIndex + 1; r < table.length; r++) {
    const cells = table[r]!;
    const text = (i: number) => (i >= 0 ? (cells[i] ?? "").trim() : "");
    const assetTag = text(at.assetTag);
    if (!assetTag && cells.every((c) => !c.trim())) continue;
    const byHeader: Record<string, string> = {};
    headers.forEach((h, i) => {
      if (!h || special.has(i) || IGNORED.includes(h)) return;
      byHeader[h] = (cells[i] ?? "").trim();
    });
    rows.push({
      line: r + 1,
      workOrder: text(at.workOrder) || null,
      assetTag,
      cells: byHeader,
      notes: text(at.notes) || null,
      findings: text(at.findings) || null,
    });
  }
  if (rows.length === 0) throw new ImportFileError("The sheet has no rows with results.");
  if (rows.length > MAX_RESULT_ROWS)
    throw new ImportFileError(`The sheet has more than ${MAX_RESULT_ROWS} rows. Split it into smaller files.`);
  return { rows, ignoredColumns: ignored, resultColumns };
}

// ─── Working out a row's answers ─────────────────────────────────────────────

const NA = new Set(["n/a", "na", "n.a.", "not applicable", "n.a", "-"]);
const PASS = new Set(["pass", "passed", "p", "ok", "yes", "y", "true"]);
const FAIL = new Set(["fail", "failed", "f", "no", "n", "false"]);

export type RowEvaluation = {
  answers: Answer[];
  problems: string[];
  counts: { pass: number; fail: number; na: number };
  /** An electrical safety item failed: the device will be put on a Do Not Use hold. */
  electricalFail: boolean;
  /** At least one electrical safety item has a real (not N/A) answer: the test equipment matters. */
  usesElectrical: boolean;
};

const fmt = (n: number) => String(Number(n.toFixed(4)));

function cellFor(row: UploadRow, item: ChecklistItem): string | undefined {
  const a = row.cells[normLabel(columnHeader(item))];
  if (a !== undefined) return a;
  return row.cells[normLabel(item.label)];
}

export function evaluateRow(checklist: ChecklistItem[], row: UploadRow): RowEvaluation {
  const answers: Answer[] = [];
  const problems: string[] = [];
  const counts = { pass: 0, fail: 0, na: 0 };
  let electricalFail = false;
  let usesElectrical = false;
  let needNotes: string | null = null;

  for (const item of checklist) {
    const raw = cellFor(row, item);
    const text = (raw ?? "").trim();
    const lower = text.toLowerCase();
    const push = (a: Answer) => {
      answers.push(a);
      if (a.result === "PASS") counts.pass++;
      else if (a.result === "FAIL") {
        counts.fail++;
        if (item.section === "ELECTRICAL_SAFETY") electricalFail = true;
      } else counts.na++;
      if (item.section === "ELECTRICAL_SAFETY" && a.result !== "NOT_APPLICABLE") usesElectrical = true;
    };
    const unit = item.unit ? ` ${item.unit}` : "";

    if (text === "") {
      if (item.required) {
        problems.push(
          raw === undefined
            ? `The sheet has no column for "${columnHeader(item)}".`
            : `"${columnHeader(item)}" is empty (write the result, or N/A).`,
        );
      } else {
        push({ key: item.key, result: "NOT_APPLICABLE", value: null, notes: null });
      }
      continue;
    }
    if (NA.has(lower)) {
      if (item.required) needNotes ??= `"${item.label}" is N/A: say why in the Notes column.`;
      push({ key: item.key, result: "NOT_APPLICABLE", value: null, notes: row.notes });
      continue;
    }
    if (item.kind === "CHECK") {
      if (PASS.has(lower)) push({ key: item.key, result: "PASS", value: null, notes: null });
      else if (FAIL.has(lower)) {
        needNotes ??= `"${item.label}" failed: say what failed in the Notes column.`;
        push({ key: item.key, result: "FAIL", value: null, notes: row.notes });
      } else problems.push(`"${item.label}": write Pass, Fail or N/A (not "${text}").`);
      continue;
    }
    // Measurement: a number, optionally followed by the unit and/or a verdict word.
    const m = /^(.*?)\s*(passed|failed|pass|fail|p|f)?$/i.exec(text)!;
    let body = m[1]!.trim();
    const verdictWord = (m[2] ?? "").toLowerCase();
    if (item.unit && body.toLowerCase().endsWith(item.unit.toLowerCase()))
      body = body.slice(0, body.length - item.unit.length).trim();
    if (!/^-?\d+(?:[.,]\d+)?$/.test(body)) {
      problems.push(`"${columnHeader(item)}": write the reading as a number (not "${text}").`);
      continue;
    }
    const value = Number(body.replace(",", "."));
    if (!Number.isFinite(value)) {
      problems.push(`"${columnHeader(item)}": write the reading as a number (not "${text}").`);
      continue;
    }
    const verdict = verdictWord.startsWith("p") ? "PASS" : verdictWord.startsWith("f") ? "FAIL" : null;
    const hasLimits = item.min !== null || item.max !== null;
    const inLimits = (item.min === null || value >= item.min) && (item.max === null || value <= item.max);
    let result: "PASS" | "FAIL";
    if (hasLimits) {
      if (verdict === "PASS" && !inLimits) {
        problems.push(
          `"${item.label}": ${fmt(value)}${unit} is outside the limits (${item.min ?? "—"} to ${item.max ?? "—"}) so it cannot be a Pass.`,
        );
        continue;
      }
      result = verdict === "FAIL" || !inLimits ? "FAIL" : "PASS";
    } else {
      if (!verdict) {
        problems.push(
          `"${item.label}": no limits are set, so write the reading and the verdict, for example ${fmt(value)} pass.`,
        );
        continue;
      }
      result = verdict;
    }
    if (result === "FAIL")
      needNotes ??= `"${item.label}" failed (${fmt(value)}${unit}): say what failed in the Notes column.`;
    push({ key: item.key, result, value, notes: result === "FAIL" || row.notes ? row.notes : null });
  }
  const needsNote = answers.some(
    (a) =>
      (a.result === "FAIL" || (a.result === "NOT_APPLICABLE" && checklist.find((i) => i.key === a.key)?.required)) &&
      !row.notes,
  );
  if (needsNote && needNotes) problems.push(needNotes);
  return { answers, problems, counts, electricalFail, usesElectrical };
}
