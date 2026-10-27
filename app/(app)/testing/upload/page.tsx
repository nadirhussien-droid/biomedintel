import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { requireAccess } from "@/server/auth/session";
import { can } from "@/server/authz/access";
import { listUsableTestEquipment } from "@/server/services/testing";
import { Card, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/shell/page-header";
import { ResultsFlow } from "./results-flow";

export const metadata: Metadata = { title: "Upload test results" };

export default async function UploadResultsPage() {
  const ctx = await requireAccess();
  if (!can(ctx, "workorder.work")) redirect("/testing");
  const tools = can(ctx, "testing.view") ? await listUsableTestEquipment(ctx) : [];

  return (
    <>
      <PageHeader
        title="Upload test results"
        description="Tested many devices with a safety analyser such as a Rigel or Fluke? Enter the results in one spreadsheet instead of one form per device. You see a check first and nothing is saved until you confirm."
        actions={
          <Link
            href="/testing"
            className="border-line-strong text-navy-900 hover:bg-surface-sunken inline-flex min-h-11 items-center rounded-md border bg-white px-4 text-sm font-semibold"
          >
            Back
          </Link>
        }
      />
      <Card className="max-w-5xl">
        <CardTitle>How it works</CardTitle>
        <ol className="text-ink-muted list-decimal space-y-1 pl-5 text-sm">
          <li>Download the results sheet. It has one row for each planned test job that is waiting for you.</li>
          <li>
            Type the readings from your analyser. The app decides Pass or Fail by comparing each reading with the limits
            on the checklist, so a reading outside the limits is always a Fail.
          </li>
          <li>
            Upload the sheet and read the check. Rows with a problem are listed and skipped; the rest can go ahead.
          </li>
          <li>
            Choose the test tool you used and confirm. Each job is signed off exactly as if you had filled in its own
            form, including the Do Not Use hold after an electrical safety fail.
          </li>
        </ol>
        <p className="text-ink-muted mt-3 text-xs">
          Importing a Rigel or Fluke export file directly is planned. For now, copy the readings into the sheet.
        </p>
      </Card>
      <ResultsFlow tools={tools} />
    </>
  );
}
