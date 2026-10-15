// Registers a new knowledge document with its first version (multipart/form-data).
// A dedicated route keeps the 1 MB limit on all other forms.
import { requireAccess } from "@/server/auth/session";
import { createDocument } from "@/server/services/knowledge";
import { formInput } from "@/lib/form-input";
import { precheck, readFile, uploadError, uploadJson } from "@/lib/knowledge-upload";

export async function POST(request: Request) {
  const refused = precheck(request);
  if (refused) return refused;
  const ctx = await requireAccess();
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return uploadJson(400, { ok: false, message: "The upload could not be read." });
  }
  try {
    const file = await readFile(form);
    const meta = formInput(form, ["modelIds", "categoryIds", "manufacturerIds"]);
    if (file) delete meta.body;
    const r = await createDocument(ctx, meta, file);
    return uploadJson(201, { ok: true, id: r.id, index: r.index.status });
  } catch (error) {
    return uploadError(error);
  }
}
