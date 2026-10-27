// The sheet people fill in after bulk testing: one row per open planned job.
import { requireAccess } from "@/server/auth/session";
import { can } from "@/server/authz/access";
import { buildResultsTemplate } from "@/lib/test-results-upload";
import { listUploadableJobs } from "@/server/services/test-results-upload";

export async function GET(request: Request) {
  const ctx = await requireAccess();
  if (!can(ctx, "workorder.work")) return new Response("Not permitted", { status: 403 });
  const includeUnassigned = new URL(request.url).searchParams.get("unassigned") === "1";
  const jobs = await listUploadableJobs(ctx, { includeUnassigned });
  const file = await buildResultsTemplate(jobs);
  return new Response(new Uint8Array(file), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": 'attachment; filename="biomedintel-test-results-sheet.xlsx"',
      "Cache-Control": "no-store",
    },
  });
}
