// Excel (.xlsx) rendering of an ExportDoc.
//
// One sheet: title, organisation and filters at the top, then each table with a
// bold header row. Numbers stay numbers and dates are real Excel dates, so
// sorting, filtering and sums work. Text is always written as text: a cell that
// starts with "=" is stored as a string and never becomes a formula.
import ExcelJS from "exceljs";
import type { Letterhead } from "@/lib/validation/letterhead";
import { footerLines, headerLines } from "../services/organization-letterhead";
import { DATE_ONLY, friendlyTime, type Cell, type ExportDoc } from "./document";

const NAVY = "FF102D46";
const TEAL_LIGHT = "FFE6F8F5";

function value(c: Cell): string | number | Date | null {
  if (c === null || c === undefined || c === "") return null;
  if (c instanceof Date) return c;
  if (typeof c === "number") return Number.isFinite(c) ? c : String(c);
  if (DATE_ONLY.test(c)) {
    const d = new Date(`${c}T00:00:00Z`);
    return Number.isNaN(d.getTime()) ? c : d;
  }
  return c;
}

export async function toXlsx(
  doc: ExportDoc,
  opts: { exportedBy: string; exportedAt: Date; letterhead?: Letterhead | null },
): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "BiomedIntel.ai";
  wb.created = opts.exportedAt;
  const ws = wb.addWorksheet(doc.title.slice(0, 31).replace(/[\\/?*[\]:]/g, " "), {
    pageSetup: { paperSize: 9, orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  });
  const widths: number[] = [];
  const track = (col: number, text: string) => {
    widths[col] = Math.max(widths[col] ?? 10, Math.min(60, text.length + 2));
  };
  const maxCols = Math.max(2, ...doc.sections.map((s) => s.columns?.length ?? 1));

  const title = ws.addRow([doc.title]);
  title.font = { bold: true, size: 14, color: { argb: NAVY } };
  ws.addRow([doc.organization]).font = { bold: true, size: 11 };
  for (const line of headerLines(opts.letterhead ?? null))
    ws.addRow([line]).font = { size: 9, color: { argb: "FF444444" } };
  for (const [k, v] of doc.meta) {
    if (k === "Report" || k === "Organisation") continue; // already shown as the title lines
    const r = ws.addRow([k.replace(" (UTC)", ""), friendlyTime(v)]);
    r.getCell(1).font = { bold: true };
    track(1, k);
  }
  const ex = ws.addRow([
    "Exported",
    `${opts.exportedAt.toISOString().slice(0, 16).replace("T", " ")} UTC by ${opts.exportedBy}`,
  ]);
  ex.getCell(1).font = { bold: true };
  ws.addRow(["Equipment records only. Contains no patient information."]).font = { italic: true, size: 9 };
  for (const line of footerLines(opts.letterhead ?? null)) ws.addRow([line]).font = { italic: true, size: 9 };

  let firstTable: { headerRow: number; lastRow: number; cols: number } | null = null;
  let tables = 0;
  for (const s of doc.sections) {
    ws.addRow([]);
    if (s.title) ws.addRow([s.title]).font = { bold: true, size: 12, color: { argb: NAVY } };
    if (s.note) {
      const r = ws.addRow([s.note]);
      r.font = { italic: true };
      ws.mergeCells(r.number, 1, r.number, maxCols);
      r.getCell(1).alignment = { wrapText: true, vertical: "top" };
      r.height = Math.min(90, 15 * Math.ceil(s.note.length / (maxCols * 14)));
    }
    if (!s.columns) continue;
    tables++;
    const header = ws.addRow(s.columns);
    header.eachCell((cell, col) => {
      cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: NAVY } };
      cell.alignment = { wrapText: true, vertical: "middle" };
      track(col, String(cell.value ?? ""));
    });
    const start = header.number;
    (s.rows ?? []).forEach((row, i) => {
      const r = ws.addRow(row.map(value));
      for (let col = 1; col <= s.columns!.length; col++) {
        const cell = r.getCell(col);
        if (cell.value instanceof Date) {
          cell.numFmt = typeof row[col - 1] === "string" ? "yyyy-mm-dd" : "yyyy-mm-dd hh:mm";
          track(col, "yyyy-mm-dd hh:mm");
        } else {
          track(col, String(cell.value ?? ""));
        }
        cell.alignment = { vertical: "top", wrapText: String(cell.value ?? "").length > 60 };
        if (i % 2 === 1) cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: TEAL_LIGHT } };
      }
    });
    if (!firstTable) firstTable = { headerRow: start, lastRow: ws.rowCount, cols: s.columns.length };
  }
  // Filters on the first table, and its header kept in view when only one table exists.
  if (firstTable) {
    ws.autoFilter = {
      from: { row: firstTable.headerRow, column: 1 },
      to: { row: Math.max(firstTable.headerRow, firstTable.lastRow), column: firstTable.cols },
    };
    if (tables === 1) ws.views = [{ state: "frozen", ySplit: firstTable.headerRow }];
  }
  widths.forEach((w, i) => {
    if (i > 0) ws.getColumn(i).width = w;
  });
  return Buffer.from(await wb.xlsx.writeBuffer());
}
