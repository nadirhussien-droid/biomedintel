// Reading a spreadsheet of equipment for the bulk upload (no database here).
//
// Accepts .xlsx and .csv. The first row holds the column names. Names are matched
// loosely, so the BiomedIntel.ai template works and so does a typical export from
// another maintenance system (for example "Control #", "Model Description").
// Everything read here is only a proposal: the server checks every row again
// before anything is saved.
import ExcelJS from "exceljs";

export const MAX_IMPORT_ROWS = 1000;
export const MAX_IMPORT_BYTES = 3 * 1024 * 1024;

export type ImportRow = {
  /** Row number in the file (the header is row 1). */
  line: number;
  assetTag: string;
  name: string;
  manufacturer: string;
  model: string;
  category: string;
  serialNumber: string | null;
  inventoryNumber: string | null;
  location: string | null;
  status: string | null;
  riskClass: string | null;
  electricalClass: string | null;
  appliedPartType: string | null;
  purchaseDate: string | null;
  supplier: string | null;
  notes: string | null;
};

/** The four columns every row must have. They come first in the template. */
export const REQUIRED_COLUMNS = ["Asset ID", "Manufacturer", "Model", "Category"] as const;

export const TEMPLATE_COLUMNS = [
  "Asset ID",
  "Manufacturer",
  "Model",
  "Category",
  "Name",
  "Serial number",
  "Inventory number",
  "Location",
  "Status",
  "Risk class",
  "Electrical class",
  "Applied part type",
  "Purchase date",
  "Supplier",
  "Notes",
] as const;

type Field = keyof Omit<ImportRow, "line">;

// Column names, written without spaces or punctuation and in lower case.
const ALIASES: Record<Field, string[]> = {
  assetTag: ["assetid", "assettag", "controlno", "controlnumber", "control", "equipmentid", "barcode"],
  name: ["name", "assetname", "equipmentname", "devicename", "equipment"],
  manufacturer: ["manufacturer", "manufacturercode", "make", "brand", "maker"],
  model: ["model", "modelno", "modelnumber", "modelname"],
  category: ["category", "devicetype", "equipmenttype", "type", "modeldescription", "devicecategory"],
  serialNumber: ["serialnumber", "serialno", "serial", "sn"],
  inventoryNumber: ["inventorynumber", "inventoryno", "assetpropertyno", "assetproperty", "propertyno", "assetno"],
  location: ["location", "room", "locationdescription"],
  status: ["status", "assetstatus"],
  riskClass: ["riskclass", "risk", "risklevel"],
  electricalClass: ["electricalclass", "protectionclass", "deviceclass", "class", "electricalprotectionclass"],
  appliedPartType: ["appliedparttype", "appliedpart", "parttype", "typebbfcf", "bfcf"],
  purchaseDate: ["purchasedate", "dateofpurchase", "purchased"],
  supplier: ["supplier", "vendor", "purchasedfrom"],
  notes: ["notes", "note", "comments", "comment", "description", "remarks"],
};

export class ImportFileError extends Error {}

const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
// Characters that could hide in a cell: control characters except tab and line break.
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g;

function clean(v: string): string {
  return v.replace(CONTROL, "").replace(/\s+/g, " ").trim();
}

/** Minimal CSV reader: commas or semicolons, quoted cells, doubled quotes, line breaks inside quotes. */
export function parseCsv(text: string): string[][] {
  const src = text.replace(/^﻿/, "");
  const firstLine = src.split(/\r?\n/, 1)[0] ?? "";
  const sep = (firstLine.match(/;/g)?.length ?? 0) > (firstLine.match(/,/g)?.length ?? 0) ? ";" : ",";
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === sep) {
      row.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += ch;
  }
  if (cell !== "" || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

function cellText(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === "number") return String(value);
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "string") return value;
  if ("richText" in value) return value.richText.map((r) => r.text).join("");
  if ("result" in value) return cellText((value.result ?? null) as ExcelJS.CellValue);
  if ("text" in value) return String(value.text);
  return "";
}

/** Read the first sheet of an .xlsx file or a .csv file into rows of text. */
export async function readTable(fileName: string, bytes: Uint8Array): Promise<string[][]> {
  if (bytes.byteLength > MAX_IMPORT_BYTES) throw new ImportFileError("The file is larger than 3 MB.");
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".csv") || lower.endsWith(".txt")) return parseCsv(new TextDecoder("utf-8").decode(bytes));
  if (lower.endsWith(".xls")) {
    throw new ImportFileError(
      "Old Excel files (.xls) cannot be read. Open the file in Excel, choose File → Save As → Excel Workbook (.xlsx), then upload that file.",
    );
  }
  if (!lower.endsWith(".xlsx")) throw new ImportFileError("Upload an Excel file (.xlsx) or a CSV file (.csv).");
  // An .xlsx file is a zip archive: it starts with "PK".
  if (bytes[0] !== 0x50 || bytes[1] !== 0x4b) throw new ImportFileError("This does not look like a valid .xlsx file.");
  const book = new ExcelJS.Workbook();
  try {
    await book.xlsx.load(bytes as unknown as ArrayBuffer);
  } catch {
    throw new ImportFileError("This Excel file could not be read. Check that it opens in Excel, then try again.");
  }
  const sheet = book.worksheets[0];
  if (!sheet) throw new ImportFileError("The Excel file has no sheets.");
  const rows: string[][] = [];
  sheet.eachRow({ includeEmpty: false }, (row) => {
    const cells: string[] = [];
    const count = Math.min(row.cellCount, 60);
    for (let c = 1; c <= count; c++) cells.push(cellText(row.getCell(c).value));
    rows.push(cells);
  });
  return rows;
}

/** Words in capitals only (a typical export) become Title Case; mixed case is left alone. */
export function tidyCase(s: string): string {
  if (!s || /[a-z]/.test(s) || s.length < 4) return s;
  return s.toLowerCase().replace(/(^|[\s(/-])([a-z])/g, (_m, a: string, b: string) => a + b.toUpperCase());
}

const DMY = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/;

/** Dates are written the Australian way (day first) or as YYYY-MM-DD. Anything else is returned unchanged and rejected later. */
export function normaliseDate(s: string): string {
  const t = s.trim();
  const m = DMY.exec(t);
  if (m) return `${m[3]}-${m[2]!.padStart(2, "0")}-${m[1]!.padStart(2, "0")}`;
  return t.length >= 10 && /^\d{4}-\d{2}-\d{2}/.test(t) ? t.slice(0, 10) : t;
}

export type ParsedImport = {
  rows: ImportRow[];
  /** Column names that were not recognised and so were ignored. */
  ignoredColumns: string[];
  /** Which file column feeds which field. */
  recognised: { field: Field; column: string }[];
  /** Rows in the file that repeat an asset ID already seen (combined into one). */
  repeatRows: number;
  blankRows: number;
};

export function buildRows(table: string[][]): ParsedImport {
  if (table.length < 2) throw new ImportFileError("The file needs a header row and at least one row of equipment.");
  const headers = table[0]!.map((h) => clean(h));
  const wanted = new Map<Field, number>();
  const recognised: ParsedImport["recognised"] = [];
  headers.forEach((h, idx) => {
    const key = squash(h);
    if (!key) return;
    for (const [field, names] of Object.entries(ALIASES) as [Field, string[]][]) {
      if (names.includes(key) && !wanted.has(field)) {
        wanted.set(field, idx);
        recognised.push({ field, column: h });
        return;
      }
    }
  });
  const usedColumns = new Set(wanted.values());
  const ignoredColumns = headers.filter((h, idx) => h && !usedColumns.has(idx));
  if (!wanted.has("assetTag"))
    throw new ImportFileError(
      'No asset ID column was found. Name one column "Asset ID" (or "Control #") and try again.',
    );

  const rows: ImportRow[] = [];
  const byTag = new Map<string, ImportRow>();
  let repeatRows = 0;
  let blankRows = 0;
  for (let r = 1; r < table.length; r++) {
    const cells = table[r]!;
    const get = (f: Field) => {
      const idx = wanted.get(f);
      return idx === undefined ? "" : clean(cells[idx] ?? "");
    };
    if (cells.every((c) => clean(c) === "")) {
      blankRows++;
      continue;
    }
    const category = tidyCase(get("category")) || "Uncategorised";
    const row: ImportRow = {
      line: r + 1,
      assetTag: get("assetTag").toUpperCase(),
      name: tidyCase(get("name")) || (category === "Uncategorised" ? tidyCase(get("model")) : category),
      manufacturer: get("manufacturer") || "Unknown",
      model: get("model") || "Not specified",
      category,
      serialNumber: get("serialNumber") || null,
      inventoryNumber: get("inventoryNumber") || null,
      location: get("location") || null,
      status: get("status") || null,
      riskClass: get("riskClass") || null,
      electricalClass: get("electricalClass") || null,
      appliedPartType: get("appliedPartType") || null,
      purchaseDate: get("purchaseDate") ? normaliseDate(get("purchaseDate")) : null,
      supplier: get("supplier") || null,
      notes: get("notes") || null,
    };
    const earlier = byTag.get(row.assetTag);
    if (earlier && row.assetTag) {
      // A system that lists one line per job repeats the same asset: keep the first and fill any blanks.
      repeatRows++;
      for (const k of ["serialNumber", "inventoryNumber", "location", "supplier", "notes", "purchaseDate"] as const) {
        earlier[k] ??= row[k];
      }
      continue;
    }
    if (row.assetTag) byTag.set(row.assetTag, row);
    rows.push(row);
  }
  if (rows.length === 0) throw new ImportFileError("The file has no equipment rows.");
  if (rows.length > MAX_IMPORT_ROWS)
    throw new ImportFileError(
      `The file has ${rows.length} assets. Upload at most ${MAX_IMPORT_ROWS} at a time (split the file in two).`,
    );
  return { rows, ignoredColumns, recognised, repeatRows, blankRows };
}

export async function parseImportFile(fileName: string, bytes: Uint8Array): Promise<ParsedImport> {
  return buildRows(await readTable(fileName, bytes));
}

/** The blank template people download: header row, one example row and a short guide sheet. */
export async function buildTemplate(): Promise<Buffer> {
  const book = new ExcelJS.Workbook();
  const sheet = book.addWorksheet("Assets");
  // Required columns are marked with a star and a strong colour; the star is ignored when the file is read.
  sheet.addRow(TEMPLATE_COLUMNS.map((c) => ((REQUIRED_COLUMNS as readonly string[]).includes(c) ? `${c} *` : c)));
  sheet.addRow([
    "INF-0001",
    "BD",
    "Alaris 8000",
    "Infusion Pump",
    "Infusion pump",
    "SN123456",
    "HOSP-1001",
    "Ward 2",
    "In service",
    "High",
    "Class I",
    "CF",
    "2024-03-15",
    "Example Supplier",
    "Example row: delete it before uploading",
  ]);
  sheet.getRow(1).font = { bold: true, name: "Arial" };
  TEMPLATE_COLUMNS.forEach((c, i) => {
    const required = (REQUIRED_COLUMNS as readonly string[]).includes(c);
    sheet.getRow(1).getCell(i + 1).fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: required ? "FFFFD966" : "FFE7ECF1" },
    };
  });
  sheet.columns.forEach((c) => (c.width = 20));
  sheet.views = [{ state: "frozen", ySplit: 1 }];
  const guide = book.addWorksheet("How to fill in");
  for (const line of [
    ["Column", "Required?", "What to write"],
    ["Only the four yellow columns marked * are required. Everything else is optional and can be left empty.", "", ""],
    [
      "Asset ID",
      "Yes",
      "Your own ID for the device (capital letters, digits, dots, slashes or hyphens). Kept exactly as written.",
    ],
    ["Manufacturer", "Yes", "Created automatically if it is not in the catalog yet."],
    ["Model", "Yes", "Created automatically if it is not in the catalog yet."],
    ["Category", "Yes", "Type of equipment, for example Infusion Pump. Created automatically if new."],
    ["Name", "No", "What you call the device. If blank, the Category is used."],
    ["Serial number", "No", "A repeated serial number on the same model is flagged for you to check."],
    ["Inventory number", "No", "The hospital's own number. Must be different for every asset in a hospital."],
    ["Location", "No", "Room or area inside the department you choose. Created automatically if new."],
    ["Status", "No", "In service, Under repair, or Out of service. Blank means In service."],
    ["Risk class", "No", "High, Medium or Low."],
    ["Electrical class", "No", "Class I, Class II, Class III or Internally powered. Used for electrical safety tests."],
    ["Applied part type", "No", "Type B, BF or CF, or None if the device has no applied part."],
    ["Purchase date", "No", "YYYY-MM-DD or DD/MM/YYYY."],
    ["Supplier", "No", "Where it was bought."],
    ["Notes", "No", "Anything useful. Never put patient information here."],
  ])
    guide.addRow(line);
  guide.getRow(1).font = { bold: true, name: "Arial" };
  guide.columns = [{ width: 18 }, { width: 11 }, { width: 100 }];
  return Buffer.from(await book.xlsx.writeBuffer());
}
