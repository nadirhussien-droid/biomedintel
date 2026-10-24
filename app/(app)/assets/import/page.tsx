import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { requireAccess } from "@/server/auth/session";
import { can } from "@/server/authz/access";
import { getAssetFormOptions } from "@/server/services/assets";
import { Card, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/shell/page-header";
import { ImportFlow } from "./import-flow";

export const metadata: Metadata = { title: "Upload equipment" };

export default async function ImportAssetsPage() {
  const ctx = await requireAccess();
  if (!can(ctx, "asset.create") || !can(ctx, "catalog.create")) redirect("/assets");
  const options = await getAssetFormOptions(ctx);

  return (
    <>
      <PageHeader
        title="Upload equipment"
        description="Add many assets at once from an Excel (.xlsx) or CSV file. You see a preview first and nothing is saved until you confirm."
        actions={
          <Link
            href="/assets"
            className="border-line-strong text-navy-900 hover:bg-surface-sunken inline-flex min-h-11 items-center rounded-md border bg-white px-4 text-sm font-semibold"
          >
            Back to register
          </Link>
        }
      />
      <Card className="max-w-5xl">
        <CardTitle>How it works</CardTitle>
        <ol className="text-ink-muted list-decimal space-y-1 pl-5 text-sm">
          <li>
            Download the{" "}
            {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- a file download, not a page */}
            <a href="/assets/import/template" className="font-semibold text-teal-700 underline">
              blank template
            </a>{" "}
            and fill it in, or use a spreadsheet exported from your old system. Only the Asset ID, Manufacturer, Model
            and Category columns are needed.
          </li>
          <li>Choose the hospital and department these assets belong to, then choose the file.</li>
          <li>Check the preview. Missing manufacturers, models, categories and rooms are created for you.</li>
          <li>Confirm. Asset IDs are kept exactly as written. Assets already in the register are skipped.</li>
        </ol>
      </Card>
      <ImportFlow hospitals={options.hospitals} departments={options.departments} />
    </>
  );
}
