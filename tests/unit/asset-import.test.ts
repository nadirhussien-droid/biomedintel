// Reading the bulk upload file: the template, an export from another system, and a CSV.
import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import {
  buildRows,
  buildTemplate,
  ImportFileError,
  parseCsv,
  parseImportFile,
  readTable,
  tidyCase,
} from "@/lib/asset-import";

async function xlsx(rows: unknown[][]): Promise<Uint8Array> {
  const book = new ExcelJS.Workbook();
  const sheet = book.addWorksheet("Sheet");
  for (const r of rows) sheet.addRow(r);
  return new Uint8Array(await book.xlsx.writeBuffer());
}

describe("bulk upload file reader", () => {
  it("reads a typical export from another system: loose column names, repeated lines, capital letters", async () => {
    const bytes = await xlsx([
      [
        "Work Order #",
        "Control #",
        "Manufacturer Code",
        "Model #",
        "Model Description",
        "Serial #",
        "Asset/Property #",
        "Status",
        "Location",
      ],
      [1, 3000001, "BD", "ALARIS PK", "INFUSION PUMP, MULTITHERAPY", "SN-1", 3000001, "Complete", ""],
      [2, 3000001, "BD", "ALARIS PK", "INFUSION PUMP, MULTITHERAPY", "SN-1", 3000001, "Complete", "Ward 1"],
      [3, 3000002, "GEHEALTH", "B450", "MONITOR, BEDSIDE", "", 3000002, "", ""],
      ["", "", "", "", "", "", "", "", ""],
    ]);
    const parsed = await parseImportFile("export.xlsx", bytes);
    expect(parsed.rows).toHaveLength(2);
    expect(parsed.repeatRows).toBe(1);
    expect(parsed.blankRows).toBe(1);
    const [pump, monitor] = parsed.rows;
    expect(pump).toMatchObject({
      assetTag: "3000001",
      manufacturer: "BD",
      model: "ALARIS PK",
      category: "Infusion Pump, Multitherapy",
      name: "Infusion Pump, Multitherapy",
      serialNumber: "SN-1",
      inventoryNumber: "3000001",
      location: "Ward 1", // a blank on the first line is filled from the repeat
    });
    expect(monitor!.serialNumber).toBeNull();
    expect(parsed.ignoredColumns).toEqual(["Work Order #"]);
  });

  it("needs an asset ID column", () => {
    expect(() =>
      buildRows([
        ["Name", "Model"],
        ["Pump", "X1"],
      ]),
    ).toThrow(ImportFileError);
  });

  it("fills sensible defaults when optional columns are missing", () => {
    const { rows } = buildRows([
      ["Asset ID", "Manufacturer", "Model"],
      ["inf-1", "BD", "Alaris"],
    ]);
    expect(rows[0]).toMatchObject({ assetTag: "INF-1", category: "Uncategorised", name: "Alaris" });
  });

  it("reads CSV with quotes, semicolons and a byte-order mark", () => {
    expect(parseCsv('﻿Asset ID,Name\n"A-1","Pump, large"\n')).toEqual([
      ["Asset ID", "Name"],
      ["A-1", "Pump, large"],
    ]);
    expect(parseCsv("Asset ID;Name\nA-1;Pump\n")[1]).toEqual(["A-1", "Pump"]);
  });

  it("round-trips its own template", async () => {
    const template = await buildTemplate();
    const table = await readTable("t.xlsx", new Uint8Array(template));
    const parsed = buildRows(table);
    expect(parsed.rows[0]!.assetTag).toBe("INF-0001");
    expect(parsed.ignoredColumns).toEqual([]);
  });

  it("explains old .xls files and refuses other types", async () => {
    await expect(readTable("old.xls", new Uint8Array([1, 2, 3]))).rejects.toThrow(/Save As/);
    await expect(readTable("a.pdf", new Uint8Array([1]))).rejects.toThrow(/xlsx/);
    await expect(readTable("fake.xlsx", new Uint8Array([1, 2, 3, 4]))).rejects.toThrow(/valid/);
  });

  it("only changes the case of text that is all capitals", () => {
    expect(tidyCase("PATIENT WARMER - BODY")).toBe("Patient Warmer - Body");
    expect(tidyCase("ECG Monitor")).toBe("ECG Monitor");
    expect(tidyCase("BD")).toBe("BD");
  });
});
