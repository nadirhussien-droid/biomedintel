// Uploads a new version of a knowledge document (multipart/form-data).
// The document returns to draft until an Engineering Manager approves it again.
import { requireAccess } from "@/server/auth/session";
import { addVersion } from "@/server/services/knowledge";
import { precheck, readFile, uploadError, uploadJson } from "@/lib/knowledge-upload";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const refused = precheck(request);
  if (refused) return refused;
  const ctx = await requireAccess();
  const { id } = await params;
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return uploadJson(400, { ok: false, message: "The upload could not be read." });
  }
  try {
    const file = await readFile(form);
    const body = typeof form.get("body") === "string" ? (form.get("body") as string) : "";
    const note = typeof form.get("note") === "string" ? (form.get("note") as string) : "";
    const r = await addVersion(ctx, id, file, file ? null : body.trim() || null, note.trim() || null);
    return uploadJson(201, { ok: true, id: r.id, index: r.index.status });
  } catch (error) {
    return uploadError(error);
  }
}
