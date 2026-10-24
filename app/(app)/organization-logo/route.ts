// The organisation's optional logo.
//   GET    any signed-in member: the current logo image (404 when there is none)
//   POST   Organisation Administrator: upload a PNG or JPEG (multipart, field "logo")
//   DELETE Organisation Administrator: remove the logo
// A dedicated route (not a server action) keeps the 1 MB limit on other forms.
// POST and DELETE accept same-origin requests only; the service re-checks the
// permission and the file is decoded and re-encoded (never trusted).
import { requireAccess } from "@/server/auth/session";
import { serverEnv } from "@/server/env";
import { AuthorizationError, NotFoundError, ValidationError } from "@/server/authz/errors";
import { getLogoImage, MAX_LOGO_UPLOAD_BYTES, removeLogo, setLogo } from "@/server/services/organization-logo";
import { log } from "@/server/log";

const json = (status: number, body: Record<string, unknown>) =>
  Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

function sameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  return !!origin && origin === new URL(serverEnv().BETTER_AUTH_URL).origin;
}

export async function GET() {
  const ctx = await requireAccess();
  try {
    const logo = await getLogoImage(ctx);
    return new Response(Uint8Array.from(logo.content), {
      headers: {
        "Content-Type": logo.mime,
        "Content-Disposition": 'inline; filename="logo"',
        "Cache-Control": "private, no-cache",
        "X-Content-Type-Options": "nosniff",
        ETag: `"${logo.sha256}"`,
      },
    });
  } catch (error) {
    if (error instanceof NotFoundError) return new Response("Not found", { status: 404 });
    throw error;
  }
}

export async function POST(request: Request) {
  if (!sameOrigin(request)) return json(403, { ok: false, message: "Upload refused." });
  const length = Number(request.headers.get("content-length") ?? "0");
  if (!length || length > MAX_LOGO_UPLOAD_BYTES + 64 * 1024) {
    return json(413, { ok: false, message: "The logo must be 2 MB or smaller." });
  }
  const ctx = await requireAccess();
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return json(400, { ok: false, message: "The upload could not be read." });
  }
  const file = form.get("logo");
  if (!(file instanceof File)) return json(400, { ok: false, message: "Choose a logo to upload." });
  try {
    await setLogo(ctx, { name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) });
    return json(201, { ok: true });
  } catch (error) {
    if (error instanceof ValidationError) return json(422, { ok: false, message: error.message });
    if (error instanceof AuthorizationError) return json(403, { ok: false, message: error.message });
    log.error("organization.logo_upload_failed", { requestId: request.headers.get("x-request-id") }, error);
    return json(500, { ok: false, message: "The logo could not be saved." });
  }
}

export async function DELETE(request: Request) {
  if (!sameOrigin(request)) return json(403, { ok: false, message: "Request refused." });
  const ctx = await requireAccess();
  try {
    await removeLogo(ctx);
    return json(200, { ok: true });
  } catch (error) {
    if (error instanceof ValidationError) return json(422, { ok: false, message: error.message });
    if (error instanceof AuthorizationError) return json(403, { ok: false, message: error.message });
    log.error("organization.logo_remove_failed", { requestId: request.headers.get("x-request-id") }, error);
    return json(500, { ok: false, message: "The logo could not be removed." });
  }
}
