// Shared handling for the two knowledge upload routes (new document, new version).
import "server-only";
import { serverEnv } from "@/server/env";
import { AuthorizationError, NotFoundError, ValidationError } from "@/server/authz/errors";
import { MAX_DOCUMENT_BYTES } from "@/lib/validation/knowledge";

export const uploadJson = (status: number, body: Record<string, unknown>) =>
  Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

/** Same-origin requests only, with a size check before the body is read. */
export function precheck(request: Request): Response | null {
  const origin = request.headers.get("origin");
  if (!origin || origin !== new URL(serverEnv().BETTER_AUTH_URL).origin)
    return uploadJson(403, { ok: false, message: "Upload refused." });
  const length = Number(request.headers.get("content-length") ?? "0");
  if (!length || length > MAX_DOCUMENT_BYTES + 512 * 1024)
    return uploadJson(413, { ok: false, message: "Documents must be 20 MB or smaller." });
  return null;
}

export async function readFile(form: FormData): Promise<{ name: string; bytes: Uint8Array } | null> {
  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) return null;
  if (file.size > MAX_DOCUMENT_BYTES)
    throw new ValidationError("Documents must be 20 MB or smaller.", { file: ["Too large"] });
  return { name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) };
}

export function uploadError(error: unknown): Response {
  if (error instanceof ValidationError)
    return uploadJson(422, { ok: false, message: error.message, fieldErrors: error.fieldErrors });
  if (error instanceof AuthorizationError) return uploadJson(403, { ok: false, message: error.message });
  if (error instanceof NotFoundError) return uploadJson(404, { ok: false, message: "Not found." });
  console.error("[BiomedIntel.ai] knowledge upload failed", (error as Error)?.name);
  return uploadJson(500, { ok: false, message: "The document could not be saved." });
}
