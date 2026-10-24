// Opens or downloads a calibration certificate (PDF). The service checks
// permission and organisation (RLS) and audits every access.
import { requireAccess } from "@/server/auth/session";
import { AuthorizationError, NotFoundError } from "@/server/authz/errors";
import { readCertificate } from "@/server/services/testing";

export async function GET(request: Request, { params }: { params: Promise<{ recordId: string }> }) {
  const ctx = await requireAccess();
  const { recordId } = await params;
  const download = new URL(request.url).searchParams.get("download") === "1";
  try {
    const f = await readCertificate(ctx, recordId, download ? "download" : "open");
    const name = f.filename.replace(/[^A-Za-z0-9._ -]/g, "_");
    return new Response(Buffer.from(f.content), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `${download ? "attachment" : "inline"}; filename="${name}"`,
        "Content-Length": String(f.content.byteLength),
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
        // Nothing in a stored file may load anything or be framed (same policy as knowledge PDFs).
        "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
      },
    });
  } catch (error) {
    if (error instanceof AuthorizationError) return new Response("Not permitted", { status: 403 });
    if (error instanceof NotFoundError) return new Response("Not found", { status: 404 });
    throw error;
  }
}
