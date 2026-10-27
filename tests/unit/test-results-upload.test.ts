import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { buildResultsTemplate, evaluateRow, parseResultsTable, type UploadRow } from "@/lib/test-results-upload";
import { readTable } from "@/lib/asset-import";
import type { ChecklistItem } from "@/lib/validation/pm";

const item = (over: Partial<ChecklistItem>): ChecklistItem => ({
  key: "k",
  label: "Item",
  section: "FUNCTIONAL",
  kind: "CHECK",
  required: true,
  unit: null,
  min: null,
  max: null,
  guidance: null,
  ...over,
});
const PE = item({ key: "pe", label: "Earth", section: "ELECTRICAL_SAFETY", kind: "MEASUREMENT", unit: "Ω", max: 0.3 });
const FREE = item({ key: "fr", label: "Reading", kind: "MEASUREMENT", unit: "V" });
const row = (cells: Record<string, string>, notes: string | null = null): UploadRow => ({
  line: 2,
  workOrder: null,
  assetTag: "A1",
  cells,
  notes,
  findings: null,
});

describe("evaluateRow", () => {
  it("decides Pass or Fail from the limits, never from the typed word", () => {
    expect(evaluateRow([PE], row({ "earth (ω)": "0.12" })).answers[0]).toMatchObject({ result: "PASS", value: 0.12 });
    expect(evaluateRow([PE], row({ "earth (ω)": "0.9" }, "Cable bad")).answers[0]).toMatchObject({ result: "FAIL" });
    expect(evaluateRow([PE], row({ "earth (ω)": "0.9 pass" })).problems.join(" ")).toMatch(/outside the limits/);
    expect(evaluateRow([PE], row({ "earth (ω)": "0,2 Ω" })).answers[0]).toMatchObject({ result: "PASS", value: 0.2 });
  });
  it("needs a note for a fail, a verdict where no limits exist, and never accepts a blank required cell", () => {
    expect(evaluateRow([PE], row({ "earth (ω)": "0.9" })).problems.join(" ")).toMatch(/Notes column/);
    expect(evaluateRow([FREE], row({ "reading (v)": "12" })).problems.join(" ")).toMatch(/verdict/);
    expect(evaluateRow([FREE], row({ "reading (v)": "12 pass" })).answers[0]).toMatchObject({ result: "PASS" });
    expect(evaluateRow([item({})], row({ item: "" })).problems.join(" ")).toMatch(/empty/);
    expect(evaluateRow([item({})], row({ item: "maybe" })).problems.join(" ")).toMatch(/Pass, Fail or N\/A/);
    expect(evaluateRow([PE], row({ "earth (ω)": "0.9" }, "bad")).electricalFail).toBe(true);
  });
});

describe("results sheet", () => {
  it("round-trips: the template reads back with its Asset ID and Work order columns", async () => {
    const buf = await buildResultsTemplate([
      { number: "WO-1", assetTag: "A1", name: "Pump", checklist: [PE, item({ key: "c", label: "Alarms" })] },
    ]);
    const book = new ExcelJS.Workbook();
    await book.xlsx.load(buf as never);
    expect(book.worksheets.map((w) => w.name)).toEqual(["Results", "Limits and help"]);
    const table = await readTable("r.xlsx", new Uint8Array(buf));
    const parsed = parseResultsTable(table);
    expect(parsed.rows[0]).toMatchObject({ workOrder: "WO-1", assetTag: "A1" });
  });
});
