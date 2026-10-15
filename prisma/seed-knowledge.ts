// One fictional, approved knowledge document for development (Stage 9).
//
// FICTIONAL DEMONSTRATION DATA: "DM-Infuse 100" and its manufacturer do not
// exist, and the content below is NOT a real manufacturer instruction. It lets
// a developer try search, citations and IntellAssist without uploading a file.
// AI suggestions stay switched off (no ai_settings row = off).
import { createHash } from "node:crypto";
import type { PrismaClient } from "../server/db/generated/client";
import { buildDemoPdf } from "../scripts/lib/demo-pdf";
import { extract, toPassages } from "../server/knowledge/extract";

const PAGES = [
  [
    "DM-Infuse 100 troubleshooting guide - FICTIONAL DEMO",
    "This document is fictional demonstration content for BiomedIntel.ai.",
    "It is not a manufacturer instruction and must not be used on real equipment.",
  ],
  [
    "Section 2 Occlusion alarms",
    "Error P-110: downstream occlusion detected by the pressure sensor.",
    "Check: administration set clamp open, line not kinked, filter not blocked.",
    "Check: downstream pressure sensor reading at rest with the set removed.",
    "If the reading at rest is outside the limits in section 5, the sensor needs",
    "calibration by a technician trained on DM-Infuse 100.",
  ],
  [
    "Section 5 Pressure sensor check",
    "Tools: calibrated pressure meter. Qualification: trained biomedical technician.",
    "Record the reading at rest and at the test pressure, then repeat the occlusion test.",
  ],
];

export async function seedKnowledge(
  db: PrismaClient,
  organizationId: string,
  slug: string,
  users: Map<string, string>,
) {
  if (slug !== "coastal-health") return;
  const amina = users.get("amina.warsame@coastal.example")!; // Technician (author)
  const james = users.get("james.otieno@coastal.example")!; // Engineering Manager (approver)
  const model = await db.equipmentModel.findFirstOrThrow({
    where: { organizationId, modelName: "DM-Infuse 100" },
    select: { id: true },
  });
  const bytes = buildDemoPdf(PAGES, "DM-Infuse 100 troubleshooting guide (fictional demo)");
  const result = await extract({ bytes, mime: "application/pdf" });
  if (result.status !== "INDEXED") throw new Error(`Demo PDF could not be read (${result.status}).`);
  const passages = toPassages(result.pages);
  const now = new Date();

  const doc = await db.knowledgeDocument.create({
    data: {
      organizationId,
      title: "DM-Infuse 100 troubleshooting guide (fictional demo)",
      docType: "TROUBLESHOOTING_GUIDE",
      summary: "Fictional demonstration document. Not a real manufacturer instruction.",
      source: "Demo Medical Devices Co. (demo)",
      revision: "Rev A (demo)",
      reviewStatus: "APPROVED",
      reviewedById: james,
      reviewedAt: now,
      authorisation: "Fictional seed data for development only.",
      createdById: amina,
      updatedById: amina,
    },
    select: { id: true },
  });
  await db.knowledgeTarget.create({ data: { organizationId, documentId: doc.id, modelId: model.id } });
  const version = await db.knowledgeVersion.create({
    data: {
      organizationId,
      documentId: doc.id,
      versionNo: 1,
      filename: "dm-infuse-100-troubleshooting-demo.pdf",
      mime: "application/pdf",
      sizeBytes: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      pageCount: result.pageCount,
      indexStatus: "INDEXED",
      indexedAt: now,
      uploadedById: amina,
    },
    select: { id: true },
  });
  await db.knowledgeFile.create({ data: { organizationId, versionId: version.id, content: Buffer.from(bytes) } });
  await db.knowledgeChunk.createMany({
    data: passages.map((p) => ({
      organizationId,
      documentId: doc.id,
      versionId: version.id,
      chunkNo: p.chunkNo,
      pageFrom: p.pageFrom,
      pageTo: p.pageTo,
      heading: p.heading,
      content: p.content,
    })),
  });
  await db.knowledgeDocument.update({ where: { id: doc.id }, data: { currentVersionId: version.id } });
  await db.knowledgeErrorCode.create({
    data: {
      organizationId,
      documentId: doc.id,
      code: "P-110",
      codeKey: "P-110",
      meaning: "Downstream occlusion detected by the pressure sensor",
      page: 2,
      createdById: amina,
    },
  });
}
