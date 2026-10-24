// The blank spreadsheet people fill in for a bulk upload.
import { requireAccess } from "@/server/auth/session";
import { can } from "@/server/authz/access";
import { buildTemplate } from "@/lib/asset-import";

export async function GET() {
  const ctx = await requireAccess();
  if (!can(ctx, "asset.create")) return new Response("Not permitted", { status: 403 });
  const file = await buildTemplate();
  return new Response(new Uint8Array(file), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": 'attachment; filename="biomedintel-asset-upload-template.xlsx"',
      "Cache-Control": "no-store",
    },
  });
}
