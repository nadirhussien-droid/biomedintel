// CSV export of the asset register. Uses exactly the same server-side scope
// and filters as the register screen, so it can never include assets the user
// could not see there. Every export is audited.
import { requireAccess } from "@/server/auth/session";
import { AuthorizationError } from "@/server/authz/errors";
import { exportAssetsCsv } from "@/server/services/assets";

export async function GET(request: Request) {
  const ctx = await requireAccess();
  const params = Object.fromEntries(new URL(request.url).searchParams.entries());
  try {
    const { csv } = await exportAssetsCsv(ctx, params);
    const date = new Date().toISOString().slice(0, 10);
    return new Response(`﻿${csv}`, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="biomedintel-assets-${ctx.organization.slug}-${date}.csv"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    if (error instanceof AuthorizationError) return new Response("Not permitted", { status: 403 });
    throw error;
  }
}
