// Export of one analytics report as CSV (default), Excel (format=xlsx) or PDF
// (format=pdf). Same permission, scope and server-side filters as the screen;
// formula-safe cells; audited with the format. Linked with a plain
// <a download>, never a prefetching <Link>.
import { requireAccess } from "@/server/auth/session";
import { AuthorizationError, NotFoundError } from "@/server/authz/errors";
import { exportAnalytics } from "@/server/services/analytics";
import { exportFilename, parseFormat } from "@/server/export/document";
import { exportResponse } from "@/server/export/render";
import { REPORTS, type ReportName } from "@/lib/validation/analytics";

export async function GET(request: Request) {
  const ctx = await requireAccess();
  const params = Object.fromEntries(new URL(request.url).searchParams.entries());
  const report = params.report as ReportName;
  if (!REPORTS.includes(report)) return new Response("Not found", { status: 404 });
  const format = parseFormat(params.format);
  delete params.report;
  delete params.format;
  try {
    const file = await exportAnalytics(ctx, report, params, format);
    const stamp = new Date().toISOString().slice(0, 10);
    return exportResponse(file, exportFilename(`biomedintel-${report}-${ctx.organization.slug}-${stamp}`, format));
  } catch (error) {
    if (error instanceof AuthorizationError) return new Response("Not permitted", { status: 403 });
    if (error instanceof NotFoundError) return new Response("Not found", { status: 404 });
    throw error;
  }
}
