// Export of the asset register as CSV (default), Excel (format=xlsx) or PDF
// (format=pdf). Uses exactly the same server-side scope and filters as the
// register screen, so it can never include assets the user could not see
// there. Every export is audited with its format.
import { requireAccess } from "@/server/auth/session";
import { AuthorizationError } from "@/server/authz/errors";
import { exportAssets } from "@/server/services/assets";
import { exportFilename, parseFormat } from "@/server/export/document";
import { exportResponse } from "@/server/export/render";

export async function GET(request: Request) {
  const ctx = await requireAccess();
  const params = Object.fromEntries(new URL(request.url).searchParams.entries());
  const format = parseFormat(params.format);
  delete params.format;
  try {
    const file = await exportAssets(ctx, params, format);
    const date = new Date().toISOString().slice(0, 10);
    return exportResponse(file, exportFilename(`biomedintel-assets-${ctx.organization.slug}-${date}`, format));
  } catch (error) {
    if (error instanceof AuthorizationError) return new Response("Not permitted", { status: 403 });
    throw error;
  }
}
