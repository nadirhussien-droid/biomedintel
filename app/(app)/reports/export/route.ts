// CSV export of one analytics report. Same permission, scope and server-side
// filters as the screen; formula-safe cells; audited. Linked with a plain
// <a download>, never a prefetching <Link>.
import { requireAccess } from "@/server/auth/session";
import { AuthorizationError, NotFoundError } from "@/server/authz/errors";
import { exportAnalyticsCsv } from "@/server/services/analytics";
import { REPORTS, type ReportName } from "@/lib/validation/analytics";

export async function GET(request: Request) {
  const ctx = await requireAccess();
  const params = Object.fromEntries(new URL(request.url).searchParams.entries());
  const report = params.report as ReportName;
  if (!REPORTS.includes(report)) return new Response("Not found", { status: 404 });
  delete params.report;
  try {
    const { csv } = await exportAnalyticsCsv(ctx, report, params);
    const stamp = new Date().toISOString().slice(0, 10);
    return new Response(`﻿${csv}`, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="biomedintel-${report}-${ctx.organization.slug}-${stamp}.csv"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    if (error instanceof AuthorizationError) return new Response("Not permitted", { status: 403 });
    if (error instanceof NotFoundError) return new Response("Not found", { status: 404 });
    throw error;
  }
}
