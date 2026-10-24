// Optional hospital logo, printed at the top of job sheets.
//
// Rules:
//   • Only an Organisation Administrator may set or remove it (logo.manage).
//   • Any signed-in member of the organisation may READ it (it is printed on
//     the job sheets they can see). Row-level security keeps each organisation
//     to its own rows, so one hospital can never fetch another hospital's logo.
//   • PNG or JPEG only. The file is decoded and re-encoded (never trusted), so
//     hidden metadata is removed. SVG is refused on purpose: it can carry code.
//   • Append-only history: setting adds a SET row, removing adds a REMOVED row;
//     the newest row is the current logo.
import { createHash } from "node:crypto";
import sharp from "sharp";
import { withTenant } from "../db/tenant";
import { audit } from "../audit/audit";
import { requirePermission, type AccessContext } from "../authz/access";
import { NotFoundError, ValidationError } from "../authz/errors";

export const MAX_LOGO_UPLOAD_BYTES = 2 * 1024 * 1024;
export const MAX_LOGO_STORED_BYTES = 1024 * 1024;
/** Stored logos are scaled to fit inside this box (never enlarged). */
const BOX = { width: 800, height: 400 };

const tenant = (ctx: AccessContext) => ({ userId: ctx.user.id, organizationId: ctx.organization.id });

function safeName(name: string, ext: string): string {
  const base = (name.split(/[\\/]/).pop() ?? "logo")
    .replace(/\.[^.]*$/, "")
    .replace(/[^A-Za-z0-9 _-]/g, "")
    .trim()
    .slice(0, 80);
  return `${base || "logo"}.${ext}`;
}

/** Whether the organisation currently has a logo, and its version tag (for caching). */
export async function getLogoInfo(ctx: AccessContext): Promise<{ sha256: string; filename: string } | null> {
  await requirePermission(ctx, "dashboard.view");
  return withTenant(tenant(ctx), async (tx) => {
    const latest = await tx.organizationLogo.findFirst({
      where: { organizationId: ctx.organization.id },
      orderBy: { createdAt: "desc" },
      select: { kind: true, sha256: true, filename: true },
    });
    return latest && latest.kind === "SET" && latest.sha256 && latest.filename
      ? { sha256: latest.sha256, filename: latest.filename }
      : null;
  });
}

/** The current logo image, or NotFoundError when the organisation has none. */
export async function getLogoImage(ctx: AccessContext) {
  await requirePermission(ctx, "dashboard.view");
  return withTenant(tenant(ctx), async (tx) => {
    const latest = await tx.organizationLogo.findFirst({
      where: { organizationId: ctx.organization.id },
      orderBy: { createdAt: "desc" },
      select: { kind: true, content: true, mime: true, sha256: true },
    });
    if (!latest || latest.kind !== "SET" || !latest.content || !latest.mime || !latest.sha256) {
      throw new NotFoundError("Logo");
    }
    return { content: latest.content, mime: latest.mime, sha256: latest.sha256 };
  });
}

export async function setLogo(ctx: AccessContext, file: { name: string; bytes: Uint8Array }) {
  await requirePermission(ctx, "logo.manage", { entityType: "organization" });
  if (file.bytes.byteLength === 0) throw new ValidationError("The file is empty.");
  if (file.bytes.byteLength > MAX_LOGO_UPLOAD_BYTES) throw new ValidationError("The logo must be 2 MB or smaller.");

  let data: Buffer;
  let info: { width: number; height: number };
  let format: "png" | "jpeg";
  try {
    const image = sharp(file.bytes, { limitInputPixels: 25_000_000, failOn: "error" });
    const meta = await image.metadata();
    if (meta.format !== "png" && meta.format !== "jpeg") {
      throw new ValidationError("Use a PNG or JPEG image. Other formats, including SVG, are not accepted.");
    }
    format = meta.format;
    const pipeline = image.rotate().resize({ ...BOX, fit: "inside", withoutEnlargement: true });
    const out = await (
      format === "png" ? pipeline.png({ compressionLevel: 9 }) : pipeline.jpeg({ quality: 90, mozjpeg: true })
    ).toBuffer({
      resolveWithObject: true,
    });
    data = out.data;
    info = { width: out.info.width, height: out.info.height };
  } catch (error) {
    if (error instanceof ValidationError) throw error;
    throw new ValidationError("This file is not a readable image. Use a PNG or JPEG logo.");
  }
  if (data.byteLength > MAX_LOGO_STORED_BYTES) throw new ValidationError("This logo is too large after processing.");

  const sha256 = createHash("sha256").update(data).digest("hex");
  const ext = format === "jpeg" ? "jpg" : "png";
  await withTenant(tenant(ctx), async (tx) => {
    await tx.organizationLogo.create({
      data: {
        organizationId: ctx.organization.id,
        kind: "SET",
        filename: safeName(file.name, ext),
        mime: format === "jpeg" ? "image/jpeg" : "image/png",
        sizeBytes: data.byteLength,
        sha256,
        width: info.width,
        height: info.height,
        content: Uint8Array.from(data),
        changedById: ctx.user.id,
      },
    });
    await audit(tx, {
      organizationId: ctx.organization.id,
      actorUserId: ctx.user.id,
      action: "organization.logo_set",
      entityType: "organization",
      entityId: ctx.organization.id,
      metadata: { sha256, sizeBytes: data.byteLength, width: info.width, height: info.height },
      request: ctx.request,
    });
  });
  return { sha256 };
}

export async function removeLogo(ctx: AccessContext) {
  await requirePermission(ctx, "logo.manage", { entityType: "organization" });
  await withTenant(tenant(ctx), async (tx) => {
    const latest = await tx.organizationLogo.findFirst({
      where: { organizationId: ctx.organization.id },
      orderBy: { createdAt: "desc" },
      select: { kind: true },
    });
    if (!latest || latest.kind !== "SET") throw new ValidationError("There is no logo to remove.");
    await tx.organizationLogo.create({
      data: { organizationId: ctx.organization.id, kind: "REMOVED", changedById: ctx.user.id },
    });
    await audit(tx, {
      organizationId: ctx.organization.id,
      actorUserId: ctx.user.id,
      action: "organization.logo_removed",
      entityType: "organization",
      entityId: ctx.organization.id,
      request: ctx.request,
    });
  });
}
