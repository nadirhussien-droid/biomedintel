import type { Metadata } from "next";
import { requireAccess } from "@/server/auth/session";
import { PageHeader } from "@/components/shell/page-header";
import { Card } from "@/components/ui/card";
import { BackButton } from "./back-button";

export const metadata: Metadata = { title: "Preview before download" };

/** Only our own three export routes may be previewed, never any other address. */
const ALLOWED = ["/reports/export", "/assets/export", "/maintenance/reports/export"];

function safeTarget(raw: string | undefined): string | null {
  if (!raw || raw.length > 2000 || /[\r\n\\]/.test(raw)) return null;
  const path = raw.split("?")[0]!;
  if (!ALLOWED.includes(path)) return null;
  return raw;
}

const button =
  "inline-flex min-h-11 items-center justify-center rounded-md border px-4 text-sm font-semibold border-line-strong text-navy-900 bg-white hover:bg-surface-sunken";

export default async function ExportPreviewPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireAccess();
  const sp = await searchParams;
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  const to = safeTarget(one(sp.to));
  const wantsExcel = one(sp.format) === "xlsx";
  if (!to) {
    return (
      <Card>
        <p className="text-sm">This preview link is not valid. Go back and choose the export again.</p>
      </Card>
    );
  }
  const join = to.includes("?") ? "&" : "?";
  const pdf = `${to}${join}format=pdf`;
  const xlsx = `${to}${join}format=xlsx`;
  return (
    <>
      <PageHeader
        title="Preview before you download"
        description="Check the report first. Nothing is saved to your computer until you press Download."
        actions={<BackButton />}
      />
      <Card>
        <div className="flex flex-wrap items-center gap-2">
          {/* Plain links, never prefetched: opening a file is an (audited) export. */}
          <a href={pdf} download className={`${button} ${wantsExcel ? "" : "!border-teal-400 !bg-teal-400"}`}>
            Download PDF
          </a>
          <a href={xlsx} download className={`${button} ${wantsExcel ? "!border-teal-400 !bg-teal-400" : ""}`}>
            Download Excel
          </a>
        </div>
        {wantsExcel ? (
          <p className="text-ink-muted mt-3 text-sm">
            Excel files open in Excel, not in the browser, so the preview below shows the same report as a PDF. The
            Excel file holds the same tables as spreadsheet rows you can sort and add up.
          </p>
        ) : null}
      </Card>
      <Card className="p-0">
        <iframe title="Report preview" src={`${pdf}&inline=1`} className="h-[75vh] w-full rounded-md border-0" />
        <p className="text-ink-muted p-3 text-xs">
          If the preview stays empty (some phones cannot show PDFs inside a page), use the Download buttons.
        </p>
      </Card>
    </>
  );
}
