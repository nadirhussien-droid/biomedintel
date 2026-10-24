// Report exports in Excel and PDF (24 Oct 2026): the same permission-checked
// rows as CSV, real numbers and dates in Excel, text that can never become a
// formula, a printable PDF with the optional hospital logo, row cap, Unicode,
// audit records with the format, permissions and isolation between organisations.
import ExcelJS from "exceljs";
import { afterAll, describe, expect, it } from "vitest";
import { db } from "@/server/db/client";
import { AuthorizationError } from "@/server/authz/errors";
import { exportAnalytics, exportAnalyticsCsv } from "@/server/services/analytics";
import { exportAssets, exportAssetsCsv } from "@/server/services/assets";
import { exportPm } from "@/server/services/pm-schedule";
import { removeLogo, setLogo } from "@/server/services/organization-logo";
import { exportFilename, parseFormat, toCsv, type ExportDoc } from "@/server/export/document";
import { PDF_MAX_ROWS, toPdf } from "@/server/export/pdf";
import { toXlsx } from "@/server/export/xlsx";
import { REPORTS, REPORT_TITLES } from "@/lib/validation/analytics";
import { contextFor, owner } from "../helpers";

afterAll(async () => {
  await db.$disconnect();
  await owner.$disconnect();
});

const C = "coastal-health";
const hodan = () => contextFor("hodan.ali@coastal.example", C); // Org admin, Coastal
const david = () => contextFor("david.mutua@highland.example"); // Org admin, Highland
const amina = () => contextFor("amina.warsame@coastal.example"); // Technician
const lucy = () => contextFor("lucy.achieng@coastal.example"); // Fault reporter
const PERIOD = { period: "last_12_months" };
const META = { exportedBy: "Test Person", exportedAt: new Date("2026-10-24T05:00:00Z") };

async function pdfText(bytes: Uint8Array): Promise<string[]> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const doc = await pdfjs.getDocument({ data: new Uint8Array(bytes), disableFontFace: true, verbosity: 0 }).promise;
  const pages: string[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const content = await (await doc.getPage(i)).getTextContent();
    pages.push(content.items.map((it) => ("str" in it ? it.str : "")).join(" "));
  }
  return pages;
}

async function sheet(bytes: Buffer) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(bytes as unknown as ArrayBuffer);
  return wb.worksheets[0];
}

const findRow = (ws: ExcelJS.Worksheet, first: string) => {
  let found = 0;
  ws.eachRow((r, n) => {
    if (!found && r.getCell(1).value === first) found = n;
  });
  return found;
};

describe("export formats", () => {
  it("unknown formats fall back to CSV; file names are safe", () => {
    expect(parseFormat("xlsx")).toBe("xlsx");
    expect(parseFormat("pdf")).toBe("pdf");
    expect(parseFormat("exe")).toBe("csv");
    expect(parseFormat(undefined)).toBe("csv");
    expect(exportFilename('a b/../"c', "pdf")).toBe("a-b-.-c.pdf");
  });

  it("CSV keeps its existing layout", async () => {
    const { csv } = await exportAnalyticsCsv(await hodan(), "overview", PERIOD);
    const lines = csv.split("\r\n");
    expect(lines[0]).toBe('"Report","Engineering analytics dashboard"');
    expect(lines[1]).toBe('"Organisation","Coastal Health Group"');
    expect(lines[5]).toBe("");
    expect(lines[6]).toBe('"Metric","Value","Basis","Definition"');
    const assets = (await exportAssetsCsv(await hodan(), {})).csv;
    expect(assets.startsWith('"Asset ID","Name","Manufacturer"')).toBe(true);
    expect(assets.endsWith("\r\n")).toBe(true);
  });

  it("every analytics report exports to Excel with its title, organisation and tables", async () => {
    const ctx = await hodan();
    for (const r of REPORTS) {
      const file = await exportAnalytics(ctx, r, PERIOD, "xlsx");
      expect(file.contentType).toContain("spreadsheetml");
      const ws = await sheet(file.body);
      expect(ws.getCell("A1").value).toBe(REPORT_TITLES[r]);
      expect(ws.getCell("A2").value).toBe("Coastal Health Group");
      expect(findRow(ws, "Equipment records only. Contains no patient information.")).toBeGreaterThan(0);
      expect(ws.autoFilter).toBeTruthy();
    }
  });

  it("every analytics report exports to a PDF with organisation, title and page numbers", async () => {
    const ctx = await hodan();
    for (const r of REPORTS) {
      const file = await exportAnalytics(ctx, r, PERIOD, "pdf");
      expect(file.body.subarray(0, 5).toString()).toBe("%PDF-");
      const text = (await pdfText(file.body)).join(" ");
      expect(text).toContain("Coastal Health Group");
      expect(text).toContain(REPORT_TITLES[r]);
      expect(text).toMatch(/Page 1 of \d+/);
      expect(text).toContain("no patient information");
    }
  });

  it("Excel keeps numbers and dates as real values, and text never becomes a formula", async () => {
    const doc: ExportDoc = {
      title: "Type test",
      organization: "Fictional Hospital",
      meta: [["Generated (UTC)", "2026-10-24T05:00:00.000Z"]],
      sections: [
        {
          columns: ["Text", "Number", "Signed off", "Due date"],
          rows: [
            ['=HYPERLINK("http://evil.example","x")', 42, new Date("2026-09-01T08:30:00Z"), "2026-10-01"],
            ["@SUM(A1:A9)", 3.5, null, ""],
          ],
        },
      ],
    };
    const ws = await sheet(await toXlsx(doc, META));
    const header = findRow(ws, "Text");
    const first = ws.getRow(header + 1);
    expect(first.getCell(1).type).toBe(ExcelJS.ValueType.String);
    expect(first.getCell(1).value).toBe('=HYPERLINK("http://evil.example","x")');
    expect(first.getCell(2).value).toBe(42);
    expect((first.getCell(3).value as Date).toISOString()).toBe("2026-09-01T08:30:00.000Z");
    expect(first.getCell(3).numFmt).toBe("yyyy-mm-dd hh:mm");
    expect((first.getCell(4).value as Date).toISOString()).toBe("2026-10-01T00:00:00.000Z");
    expect(first.getCell(4).numFmt).toBe("yyyy-mm-dd");
    expect(ws.getRow(header + 2).getCell(1).type).toBe(ExcelJS.ValueType.String);
    // The CSV of the same document neutralises the formula characters.
    expect(toCsv(doc)).toContain(`"'=HYPERLINK(""http://evil.example"",""x"")"`);
    expect(toCsv(doc)).toContain(`"'@SUM(A1:A9)"`);
  });

  it("PDF prints Unicode, repeats the header on each page and caps very long tables", async () => {
    const rows = Array.from({ length: PDF_MAX_ROWS + 100 }, (_, i) => [`TAG-${i}`, "Çağrı Ω ✓", i]);
    const doc: ExportDoc = {
      title: "Long table",
      organization: "Fictional Hospital",
      meta: [],
      sections: [{ columns: ["Asset ID", "Note", "Count"], rows }],
    };
    const pages = await pdfText(await toPdf(doc, { ...META, logo: null }));
    expect(pages.length).toBeGreaterThan(10);
    expect(pages[0]).toContain("Çağrı Ω");
    expect(pages[1]).toContain("Asset ID"); // header repeated
    expect(pages.join(" ")).toContain("Showing the first 2,000 of 2,100 rows");
    expect(pages.join(" ")).not.toContain(`TAG-${PDF_MAX_ROWS}`);
    expect(pages.at(-1)).toContain(`Page ${pages.length} of ${pages.length}`);
  }, 60000);

  it("the PDF shows the hospital logo only when one is uploaded", async () => {
    const ctx = await hodan();
    const without = (await exportAssets(ctx, {}, "pdf")).body.toString("latin1");
    expect(without).not.toContain("/Subtype /Image");
    const sharp = (await import("sharp")).default;
    const png = await sharp({ create: { width: 200, height: 80, channels: 3, background: "#102d46" } })
      .png()
      .toBuffer();
    await setLogo(ctx, { name: "logo.png", bytes: new Uint8Array(png) });
    const withLogo = (await exportAssets(ctx, {}, "pdf")).body.toString("latin1");
    expect(withLogo).toContain("/Subtype /Image");
    await removeLogo(ctx);
  });

  it("exports contain only the organisation's own records", async () => {
    const coastal = (await pdfText((await exportAssets(await hodan(), {}, "pdf")).body)).join(" ");
    const highland = (await pdfText((await exportAssets(await david(), {}, "pdf")).body)).join(" ");
    expect(coastal).toContain("Riverside General Hospital");
    expect(highland).not.toContain("Riverside General Hospital");
    expect(highland).not.toContain("Coastal Health Group");
    const ws = await sheet((await exportAssets(await david(), {}, "xlsx")).body);
    let leak = false;
    ws.eachRow((r) => r.eachCell((c) => (leak ||= String(c.value).includes("Riverside"))));
    expect(leak).toBe(false);
  });

  it("each export is audited with its format", async () => {
    const ctx = await hodan();
    const count = (action: string, format: string) =>
      owner.auditLog.count({
        where: { action, actorUserId: ctx.user.id, metadata: { path: ["format"], equals: format } },
      });
    const before = [
      await count("analytics.exported", "pdf"),
      await count("asset.exported", "xlsx"),
      await count("pm.report_exported", "pdf"),
    ];
    await exportAnalytics(ctx, "work-orders", PERIOD, "pdf");
    await exportAssets(ctx, {}, "xlsx");
    await exportPm(ctx, {}, "pdf");
    expect(await count("analytics.exported", "pdf")).toBe(before[0] + 1);
    expect(await count("asset.exported", "xlsx")).toBe(before[1] + 1);
    expect(await count("pm.report_exported", "pdf")).toBe(before[2] + 1);
  });

  it("people without export permission get nothing in any format", async () => {
    for (const f of ["xlsx", "pdf", "csv"] as const) {
      await expect(exportAnalytics(await amina(), "overview", PERIOD, f)).rejects.toBeInstanceOf(AuthorizationError);
      await expect(exportAssets(await lucy(), {}, f)).rejects.toBeInstanceOf(AuthorizationError);
      await expect(exportPm(await lucy(), {}, f)).rejects.toBeInstanceOf(AuthorizationError);
    }
  });
});
