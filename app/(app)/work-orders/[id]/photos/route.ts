// Upload ONE photo to a work order (multipart/form-data, field "photo").
//
// A dedicated route (instead of a server action) keeps the 1 MB limit on all
// other forms. Protections: signed-in user with access to the job (service
// checks), same-origin requests only, size checked before and after reading,
// and the file is decoded and re-encoded by the service (never trusted).
import { requireAccess } from "@/server/auth/session";
import { serverEnv } from "@/server/env";
import { AuthorizationError, NotFoundError, ValidationError } from "@/server/authz/errors";
import { addWorkOrderPhoto } from "@/server/services/work-orders";
import { MAX_PHOTO_BYTES } from "@/lib/validation/work-orders";

const json = (status: number, body: Record<string, unknown>) =>
  Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const origin = request.headers.get("origin");
  if (!origin || origin !== new URL(serverEnv().BETTER_AUTH_URL).origin) {
    return json(403, { ok: false, message: "Upload refused." });
  }
  const length = Number(request.headers.get("content-length") ?? "0");
  if (!length || length > MAX_PHOTO_BYTES + 64 * 1024) {
    return json(413, { ok: false, message: "Photos must be 5 MB or smaller." });
  }
  const ctx = await requireAccess();
  const { id } = await params;
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return json(400, { ok: false, message: "The upload could not be read." });
  }
  const file = form.get("photo");
  if (!(file instanceof File)) return json(400, { ok: false, message: "Choose a photo to upload." });
  if (file.size > MAX_PHOTO_BYTES) return json(413, { ok: false, message: "Photos must be 5 MB or smaller." });
  try {
    const photo = await addWorkOrderPhoto(ctx, id, {
      name: file.name,
      bytes: new Uint8Array(await file.arrayBuffer()),
    });
    return json(201, { ok: true, id: photo.id });
  } catch (error) {
    if (error instanceof ValidationError) return json(422, { ok: false, message: error.message });
    if (error instanceof AuthorizationError) return json(403, { ok: false, message: error.message });
    if (error instanceof NotFoundError) return json(404, { ok: false, message: "Work order not found." });
    console.error("[BiomedIntel.ai] photo upload failed", error);
    return json(500, { ok: false, message: "The photo could not be saved." });
  }
}
