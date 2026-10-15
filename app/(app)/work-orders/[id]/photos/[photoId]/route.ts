// Serves one work order photo to a user who may see the job.
import { requireAccess } from "@/server/auth/session";
import { NotFoundError } from "@/server/authz/errors";
import { getWorkOrderPhoto } from "@/server/services/work-orders";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string; photoId: string }> }) {
  const ctx = await requireAccess();
  const { id, photoId } = await params;
  try {
    const photo = await getWorkOrderPhoto(ctx, id, photoId);
    return new Response(Uint8Array.from(photo.content), {
      headers: {
        "Content-Type": photo.mime,
        "Content-Disposition": `inline; filename="${photo.filename.replace(/"/g, "")}"`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
        ETag: `"${photo.sha256}"`,
      },
    });
  } catch (error) {
    if (error instanceof NotFoundError) return new Response("Not found", { status: 404 });
    throw error;
  }
}
