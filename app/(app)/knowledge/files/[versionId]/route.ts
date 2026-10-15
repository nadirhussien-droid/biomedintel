// Opens or downloads a stored knowledge document version. The service checks
// permission, organisation (RLS), hospital and access level, and audits every
// access. Files are served with nosniff and a sandboxing policy; text files
// are always sent as plain text, never as a web page.
import { requireAccess } from "@/server/auth/session";
import { AuthorizationError, NotFoundError } from "@/server/authz/errors";
import { readVersionFile } from "@/server/services/knowledge";

export async function GET(request: Request, { params }: { params: Promise<{ versionId: string }> }) {
  const ctx = await requireAccess();
  const { versionId } = await params;
  const download = new URL(request.url).searchParams.get("download") === "1";
  try {
    const f = await readVersionFile(ctx, versionId, download ? "download" : "open");
    const type = f.mime === "application/pdf" ? "application/pdf" : "text/plain; charset=utf-8";
    const disposition = `${download ? "attachment" : "inline"}; filename="${f.filename.replace(/[^A-Za-z0-9._ -]/g, "_")}"`;
    return new Response(Buffer.from(f.content), {
      headers: {
        "Content-Type": type,
        "Content-Disposition": disposition,
        "Content-Length": String(f.content.byteLength),
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
        // Nothing in a stored file may load anything or be framed. Text files are also
        // sandboxed; PDFs are not, because browsers' built-in PDF viewers refuse to
        // open sandboxed documents (the PDF's own scripts run, if at all, inside the
        // browser's viewer, not in BiomedIntel.ai's origin).
        "Content-Security-Policy":
          f.mime === "application/pdf"
            ? "default-src 'none'; frame-ancestors 'none'"
            : "default-src 'none'; frame-ancestors 'none'; sandbox",
      },
    });
  } catch (error) {
    if (error instanceof AuthorizationError) return new Response("Not permitted", { status: 403 });
    if (error instanceof NotFoundError) return new Response("Not found", { status: 404 });
    throw error;
  }
}
