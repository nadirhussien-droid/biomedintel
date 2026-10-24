// Export of planned maintenance in a period as CSV (default), Excel
// (format=xlsx) or PDF (format=pdf). Same server-side scope, permission and
// filters as the report screen; every export is audited with its format.
import { requireAccess } from "@/server/auth/session";
import { AuthorizationError, NotFoundError } from "@/server/authz/errors";
import { exportPm } from "@/server/services/pm-schedule";
import { exportFilename, parseFormat } from "@/server/export/document";
import { exportResponse } from "@/server/export/render";

export async function GET(request: Request) {
  const ctx = await requireAccess();
  const params = Object.fromEntries(new URL(request.url).searchParams.entries());
  const format = parseFormat(params.format);
  delete params.format;
  try {
    const file = await exportPm(ctx, params, format);
    return exportResponse(
      file,
      exportFilename(`biomedintel-pm-${ctx.organization.slug}-${file.from}-to-${file.to}`, format),
    );
  } catch (error) {
    if (error instanceof AuthorizationError) return new Response("Not permitted", { status: 403 });
    if (error instanceof NotFoundError) return new Response("Not found", { status: 404 });
    throw error;
  }
}
