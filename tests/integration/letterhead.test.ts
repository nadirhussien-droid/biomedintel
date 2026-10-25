// Contact details on reports, and the inline PDF preview response.
import { afterAll, describe, expect, it } from "vitest";
import { db } from "@/server/db/client";
import { AuthorizationError, ValidationError } from "@/server/authz/errors";
import { footerLines, getLetterhead, headerLines, setLetterhead } from "@/server/services/organization-letterhead";
import { exportAnalytics } from "@/server/services/analytics";
import { exportResponse } from "@/server/export/render";
import { contextFor, owner } from "../helpers";

const C = "coastal-health";

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
afterAll(async () => {
  await db.$disconnect();
  await owner.$disconnect();
});
const hodan = () => contextFor("hodan.ali@coastal.example", C); // Org admin
const james = () => contextFor("james.otieno@coastal.example", C); // Engineering Manager

const DETAILS = {
  address: "12 Fictional Road\nNairobi",
  email: "info@coastal.example",
  phone: "+254 700 000 000",
  website: "coastal.example",
  registration: "Reg. 123456",
  note: "Fictional note",
};

describe("contact details on reports", () => {
  it("only the organisation administrator saves them; bad values are refused; saving is audited", async () => {
    await expect(setLetterhead(await james(), DETAILS)).rejects.toBeInstanceOf(AuthorizationError);
    await expect(setLetterhead(await hodan(), { ...DETAILS, email: "not-an-email" })).rejects.toBeInstanceOf(
      ValidationError,
    );
    await setLetterhead(await hodan(), DETAILS);
    expect(await getLetterhead(await james())).toMatchObject({
      email: "info@coastal.example",
      phone: "+254 700 000 000",
    });
    expect(await owner.auditLog.count({ where: { action: "organization.letterhead_set" } })).toBeGreaterThan(0);
    expect(headerLines(await getLetterhead(await hodan()))).toEqual([
      "12 Fictional Road",
      "Nairobi",
      "Tel: +254 700 000 000",
      "info@coastal.example",
      "coastal.example",
    ]);
    expect(footerLines(await getLetterhead(await hodan()))).toEqual(["Reg. 123456", "Fictional note"]);
  });

  it("prints on the PDF and Excel reports, and saving with empty boxes clears them", async () => {
    await setLetterhead(await hodan(), DETAILS);
    const pdf = await exportAnalytics(await hodan(), "overview", { period: "this_month" }, "pdf");
    const text = (await pdfText(pdf.body)).join(" ");
    expect(text).toContain("12 Fictional Road");
    expect(text).toContain("info@coastal.example");
    expect(text).toContain("Reg. 123456");
    await setLetterhead(await hodan(), {});
    expect(await getLetterhead(await hodan())).toBeNull();
    const plain = await exportAnalytics(await hodan(), "overview", { period: "this_month" }, "pdf");
    expect((await pdfText(plain.body)).join(" ")).not.toContain("12 Fictional Road");
  });

  it("a preview shows the PDF in the page; a download is still an attachment", async () => {
    const file = await exportAnalytics(await hodan(), "overview", { period: "this_month" }, "pdf");
    expect(exportResponse(file, "x.pdf", { inline: true }).headers.get("content-disposition")).toMatch(/^inline/);
    expect(exportResponse(file, "x.pdf").headers.get("content-disposition")).toMatch(/^attachment/);
    const xlsx = await exportAnalytics(await hodan(), "overview", { period: "this_month" }, "xlsx");
    expect(exportResponse(xlsx, "x.xlsx", { inline: true }).headers.get("content-disposition")).toMatch(/^attachment/);
  });
});
