// Turns an ExportDoc into the requested file. The caller has already checked
// permission and scope (the doc only holds rows the user may see) and records
// the audit event.
import type { AccessContext } from "../authz/access";
import { NotFoundError } from "../authz/errors";
import { getLogoImage } from "../services/organization-logo";
import { FORMAT_INFO, type ExportDoc, type ExportFormat } from "./document";
import { toPdf } from "./pdf";
import { toXlsx } from "./xlsx";

export type RenderedExport = { body: Buffer; contentType: string; extension: string };

export async function renderExport(
  ctx: AccessContext,
  doc: ExportDoc,
  format: ExportFormat,
  opts: { csv: () => string; now?: Date },
): Promise<RenderedExport> {
  const info = FORMAT_INFO[format];
  const exportedAt = opts.now ?? new Date();
  if (format === "csv") return { body: Buffer.from(opts.csv(), "utf8"), ...info };
  if (format === "xlsx") return { body: await toXlsx(doc, { exportedBy: ctx.user.name, exportedAt }), ...info };
  // PDF: the organisation's optional logo (PNG/JPEG, already decoded and re-encoded on upload).
  let logo: { content: Uint8Array } | null = null;
  try {
    logo = await getLogoImage(ctx);
  } catch (error) {
    if (!(error instanceof NotFoundError)) throw error;
  }
  return { body: await toPdf(doc, { exportedBy: ctx.user.name, exportedAt, logo }), ...info };
}

/** The HTTP response for a rendered export. CSV keeps its byte-order mark so Excel reads accents correctly. */
export function exportResponse(file: RenderedExport, filename: string): Response {
  const body = file.extension === "csv" ? Buffer.concat([Buffer.from("﻿", "utf8"), file.body]) : file.body;
  return new Response(new Uint8Array(body), {
    headers: {
      "Content-Type": file.contentType,
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
