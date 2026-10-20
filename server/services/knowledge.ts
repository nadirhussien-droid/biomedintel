// Technical knowledge base (Stage 9, IntellKnowledge).
//
// Rules:
//   • Every read and write goes through withTenant (RLS) plus the visibility
//     rule below: a document limited to a hospital is visible only to people
//     covering that hospital; "managers only" documents only to managers,
//     administrators and auditors; withdrawn documents only to them as well.
//   • Uploads are always DRAFTS. Only an Engineering Manager approves, and a
//     new version of an approved document goes back to draft until reviewed.
//   • Nothing is deleted: documents are superseded or withdrawn; versions and
//     files are kept; passages cited by an AI answer can never be removed.
//   • Text from documents is untrusted: it is stored and shown as plain text
//     and is never treated as instructions anywhere in the application.
import "server-only";
import { Prisma } from "../db/generated/client";
import { withTenant, type Tx } from "../db/tenant";
import { audit } from "../audit/audit";
import { can, requirePermission, type AccessContext } from "../authz/access";
import { AuthorizationError, NotFoundError, ValidationError } from "../authz/errors";
import { parseInput } from "../validation";
import { peopleNames } from "./work-order-core";
import {
  checkFile,
  cleanText,
  extract,
  FileRejected,
  passageLimitNote,
  toPassages,
  type CheckedFile,
} from "../knowledge/extract";
import {
  approveDocumentSchema,
  codeKey,
  documentCreateSchema,
  documentStatusSchema,
  documentUpdateSchema,
  errorCodeSchema,
  knowledgeQuerySchema,
} from "@/lib/validation/knowledge";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const tenant = (ctx: AccessContext) => ({ userId: ctx.user.id, organizationId: ctx.organization.id });
const MANAGER_ROLES = ["ORG_ADMIN", "ENGINEERING_MANAGER", "AUDITOR"];
const NONE = "00000000-0000-0000-0000-000000000000";
/** Private-use markers around search hits: removed from stored text, so they cannot be forged. */
export const HIT_START = "";
export const HIT_END = "";

export const isKnowledgeManager = (ctx: AccessContext) => MANAGER_ROLES.includes(ctx.role);

/** Which documents a person may see (on top of RLS). */
export function documentVisibleWhere(ctx: AccessContext): Prisma.KnowledgeDocumentWhereInput {
  const manager = isKnowledgeManager(ctx);
  return {
    AND: [
      { OR: [{ hospitalId: null }, { hospitalId: { in: ctx.hospitals.map((h) => h.id) } }] },
      manager ? {} : { accessLevel: "ENGINEERING" },
      manager ? {} : { status: { not: "WITHDRAWN" } },
    ],
  };
}

/** The same rule in SQL (alias d). */
export function documentVisibleSql(ctx: AccessContext): Prisma.Sql {
  const manager = isKnowledgeManager(ctx);
  const hs = ctx.hospitals.map((h) => h.id);
  return Prisma.sql`(d.hospital_id IS NULL OR d.hospital_id IN (${Prisma.join(hs.length ? hs : [NONE])}))
    AND (${manager} OR d.access_level = 'ENGINEERING')
    AND (${manager} OR d.status <> 'WITHDRAWN')`;
}

async function loadDocument(ctx: AccessContext, tx: Tx, id: string) {
  if (!UUID.test(id)) throw new NotFoundError("Document");
  const doc = await tx.knowledgeDocument.findFirst({ where: { AND: [{ id }, documentVisibleWhere(ctx)] } });
  if (!doc) throw new NotFoundError("Document");
  return doc;
}

function knowledgeAudit(
  tx: Tx,
  ctx: AccessContext,
  action: string,
  entityId: string,
  metadata: Record<string, unknown> = {},
) {
  return audit(tx, {
    organizationId: ctx.organization.id,
    actorUserId: ctx.user.id,
    action,
    entityType: "knowledge_document",
    entityId,
    metadata,
    request: ctx.request,
  });
}

// ─── Options ─────────────────────────────────────────────────────────────────

export async function knowledgeOptions(ctx: AccessContext) {
  await requirePermission(ctx, "knowledge.view", { entityType: "knowledge_document" });
  return withTenant(tenant(ctx), async (tx) => {
    const [manufacturers, models, categories] = await Promise.all([
      tx.manufacturer.findMany({
        where: { status: "ACTIVE" },
        select: { id: true, name: true },
        orderBy: { name: "asc" },
      }),
      tx.equipmentModel.findMany({
        where: { status: "ACTIVE" },
        select: { id: true, modelName: true, manufacturer: { select: { name: true } } },
        orderBy: { modelName: "asc" },
      }),
      tx.equipmentCategory.findMany({
        where: { status: "ACTIVE" },
        select: { id: true, name: true },
        orderBy: { name: "asc" },
      }),
    ]);
    return {
      manufacturers,
      models: models.map((m) => ({ id: m.id, name: `${m.manufacturer.name} ${m.modelName}` })),
      categories,
      hospitals: ctx.hospitals.map((h) => ({ id: h.id, code: h.code, name: h.name })),
    };
  });
}

// ─── Search ──────────────────────────────────────────────────────────────────

/** Applicability: a model filter also finds documents for the model's category or manufacturer. */
function applicabilitySql(q: {
  model: string | null;
  category: string | null;
  manufacturer: string | null;
}): Prisma.Sql {
  const parts: Prisma.Sql[] = [];
  if (q.model) {
    parts.push(Prisma.sql`EXISTS (SELECT 1 FROM knowledge_targets t JOIN equipment_models em ON em.id = ${q.model}::uuid
      WHERE t.document_id = d.id AND (t.model_id = em.id OR t.category_id = em.category_id OR t.manufacturer_id = em.manufacturer_id))`);
  }
  if (q.category) {
    parts.push(Prisma.sql`EXISTS (SELECT 1 FROM knowledge_targets t LEFT JOIN equipment_models em ON em.id = t.model_id
      WHERE t.document_id = d.id AND (t.category_id = ${q.category}::uuid OR em.category_id = ${q.category}::uuid))`);
  }
  if (q.manufacturer) {
    parts.push(Prisma.sql`(EXISTS (SELECT 1 FROM knowledge_targets t LEFT JOIN equipment_models em ON em.id = t.model_id
      WHERE t.document_id = d.id AND (t.manufacturer_id = ${q.manufacturer}::uuid OR em.manufacturer_id = ${q.manufacturer}::uuid)))`);
  }
  return parts.length ? Prisma.join(parts, " AND ") : Prisma.sql`TRUE`;
}

export async function searchKnowledge(ctx: AccessContext, raw: unknown) {
  await requirePermission(ctx, "knowledge.view", { entityType: "knowledge_document" });
  const q = knowledgeQuerySchema.parse(raw ?? {});
  const PAGE = 25;
  return withTenant(tenant(ctx), async (tx) => {
    const filters: Prisma.Sql[] = [documentVisibleSql(ctx), applicabilitySql(q)];
    if (q.type) filters.push(Prisma.sql`d.doc_type = ${q.type}::knowledge_doc_type`);
    if (q.review !== "any")
      filters.push(Prisma.sql`d.review_status = ${q.review === "approved" ? "APPROVED" : "DRAFT"}::knowledge_review`);
    if (q.status !== "all") filters.push(Prisma.sql`d.status = ${q.status.toUpperCase()}::knowledge_status`);
    const where = Prisma.join(filters, " AND ");
    const text = q.q ? q.q.slice(0, 200) : null;
    const textMatch = text
      ? Prisma.sql`AND (d.title ILIKE ${`%${text.replace(/[%_\\]/g, (c) => `\\${c}`)}%`} OR coalesce(d.summary, '') ILIKE ${`%${text.replace(/[%_\\]/g, (c) => `\\${c}`)}%`}
          OR EXISTS (SELECT 1 FROM knowledge_chunks c WHERE c.version_id = d.current_version_id AND c.tsv @@ websearch_to_tsquery('english', ${text})))`
      : Prisma.empty;
    const [{ total }] = await tx.$queryRaw<
      { total: bigint }[]
    >`SELECT count(*) AS total FROM knowledge_documents d WHERE ${where} ${textMatch}`;
    const pageCount = Math.max(1, Math.ceil(Number(total) / PAGE));
    const page = Math.min(q.page, pageCount);
    const documents = await tx.$queryRaw<
      {
        id: string;
        title: string;
        doc_type: string;
        review_status: string;
        status: string;
        access_level: string;
        source: string | null;
        source_reference: string | null;
        revision: string | null;
        published_on: Date | null;
        updated_at: Date;
        version_no: number | null;
        index_status: string | null;
        targets: string | null;
      }[]
    >`
      SELECT d.id, d.title, d.doc_type::text, d.review_status::text, d.status::text, d.access_level::text, d.source,
             d.source_reference, d.revision, d.published_on, d.updated_at, v.version_no, v.index_status::text,
             (SELECT string_agg(coalesce(mf.name || ' ' || em.model_name, ec.name, m2.name), ', ')
                FROM knowledge_targets t LEFT JOIN equipment_models em ON em.id = t.model_id
                LEFT JOIN manufacturers mf ON mf.id = em.manufacturer_id
                LEFT JOIN equipment_categories ec ON ec.id = t.category_id LEFT JOIN manufacturers m2 ON m2.id = t.manufacturer_id
               WHERE t.document_id = d.id) AS targets
      FROM knowledge_documents d LEFT JOIN knowledge_versions v ON v.id = d.current_version_id
      WHERE ${where} ${textMatch}
      ORDER BY (d.review_status = 'APPROVED') DESC, d.updated_at DESC
      LIMIT ${PAGE} OFFSET ${(page - 1) * PAGE}`;
    // Matching passages (current versions only), with page numbers.
    const passages = text
      ? await tx.$queryRaw<
          {
            id: string;
            document_id: string;
            version_id: string;
            title: string;
            review_status: string;
            status: string;
            page_from: number | null;
            heading: string | null;
            snippet: string;
            rank: number;
          }[]
        >`
          SELECT c.id, c.document_id, c.version_id, d.title, d.review_status::text, d.status::text, c.page_from, c.heading,
                 ts_headline('english', c.content, websearch_to_tsquery('english', ${text}),
                   ${`StartSel=${HIT_START}, StopSel=${HIT_END}, MaxFragments=2, MaxWords=35, MinWords=12, FragmentDelimiter= … `}) AS snippet,
                 ts_rank_cd(c.tsv, websearch_to_tsquery('english', ${text})) AS rank
          FROM knowledge_chunks c JOIN knowledge_documents d ON d.id = c.document_id AND c.version_id = d.current_version_id
          WHERE ${where} AND c.tsv @@ websearch_to_tsquery('english', ${text})
          ORDER BY (d.review_status = 'APPROVED') DESC, rank DESC LIMIT 20`
      : [];
    // Documented error codes.
    const codeText = q.code ?? (text && /^[A-Za-z0-9._/ -]{1,40}$/.test(text) && /\d/.test(text) ? text : null);
    const codes = codeText
      ? await tx.$queryRaw<
          {
            id: string;
            code: string;
            meaning: string;
            page: number | null;
            document_id: string;
            title: string;
            review_status: string;
            status: string;
          }[]
        >`
          SELECT k.id, k.code, k.meaning, k.page, d.id AS document_id, d.title, d.review_status::text, d.status::text
          FROM knowledge_error_codes k JOIN knowledge_documents d ON d.id = k.document_id
          WHERE k.archived_at IS NULL AND k.code_key = ${codeKey(codeText)} AND ${where}
          ORDER BY (d.review_status = 'APPROVED') DESC, k.code LIMIT 50`
      : [];
    return { q, documents, total: Number(total), page, pageCount, passages, codes };
  });
}

// ─── One document ────────────────────────────────────────────────────────────

export async function getDocument(ctx: AccessContext, id: string) {
  await requirePermission(ctx, "knowledge.view", { entityType: "knowledge_document" });
  return withTenant(tenant(ctx), async (tx) => {
    const doc = await loadDocument(ctx, tx, id);
    const [targets, versions, codes, hospital, supersededBy, citedBy] = await Promise.all([
      tx.knowledgeTarget.findMany({
        where: { documentId: doc.id },
        select: {
          id: true,
          model: { select: { id: true, modelName: true, manufacturer: { select: { name: true } } } },
          category: { select: { id: true, name: true } },
          manufacturer: { select: { id: true, name: true } },
        },
      }),
      tx.knowledgeVersion.findMany({
        where: { documentId: doc.id },
        orderBy: { versionNo: "desc" },
        select: {
          id: true,
          versionNo: true,
          filename: true,
          mime: true,
          sizeBytes: true,
          sha256: true,
          pageCount: true,
          indexStatus: true,
          indexNote: true,
          indexedAt: true,
          note: true,
          uploadedById: true,
          createdAt: true,
          _count: { select: { chunks: true, citations: true } },
        },
      }),
      tx.knowledgeErrorCode.findMany({ where: { documentId: doc.id, archivedAt: null }, orderBy: { code: "asc" } }),
      doc.hospitalId
        ? tx.hospital.findUnique({ where: { id: doc.hospitalId }, select: { code: true, name: true } })
        : null,
      doc.supersededById
        ? tx.knowledgeDocument.findUnique({ where: { id: doc.supersededById }, select: { id: true, title: true } })
        : null,
      tx.aiCitation.count({ where: { documentId: doc.id } }),
    ]);
    const names = await peopleNames(tx, [
      doc.createdById,
      doc.reviewedById,
      doc.statusChangedById,
      ...versions.map((v) => v.uploadedById),
      ...codes.map((c) => c.createdById),
    ]);
    const replacements =
      can(ctx, "knowledge.approve") && doc.status === "ACTIVE"
        ? await tx.knowledgeDocument.findMany({
            where: { AND: [documentVisibleWhere(ctx), { status: "ACTIVE", id: { not: doc.id } }] },
            select: { id: true, title: true, revision: true },
            orderBy: { title: "asc" },
            take: 500,
          })
        : [];
    const current = versions.find((v) => v.id === doc.currentVersionId) ?? null;
    const approver = can(ctx, "knowledge.approve");
    const contributor = can(ctx, "knowledge.contribute");
    return {
      doc,
      targets,
      versions,
      current,
      codes,
      hospital,
      supersededBy,
      citedBy,
      names,
      replacements,
      allowed: {
        edit: doc.status === "ACTIVE" && (doc.reviewStatus === "APPROVED" ? approver : contributor),
        newVersion: doc.status === "ACTIVE" && contributor,
        approve:
          approver &&
          doc.status === "ACTIVE" &&
          doc.reviewStatus === "DRAFT" &&
          !!current &&
          ["INDEXED", "NO_TEXT"].includes(current.indexStatus),
        changeStatus: approver && doc.status === "ACTIVE",
        reindex: approver,
        addCode: contributor && doc.status === "ACTIVE",
        archiveCode: approver,
      },
    };
  });
}

// ─── Create, edit, new version ───────────────────────────────────────────────

type Upload = { name: string; bytes: Uint8Array };

async function validTargets(tx: Tx, d: { modelIds: string[]; categoryIds: string[]; manufacturerIds: string[] }) {
  const [m, c, f] = await Promise.all([
    tx.equipmentModel.count({ where: { id: { in: d.modelIds } } }),
    tx.equipmentCategory.count({ where: { id: { in: d.categoryIds } } }),
    tx.manufacturer.count({ where: { id: { in: d.manufacturerIds } } }),
  ]);
  if (m !== new Set(d.modelIds).size || c !== new Set(d.categoryIds).size || f !== new Set(d.manufacturerIds).size) {
    throw new ValidationError("Choose models, categories and manufacturers from the catalogue.", {
      modelIds: ["Unknown entry"],
    });
  }
}

async function writeTargets(
  tx: Tx,
  ctx: AccessContext,
  documentId: string,
  d: { modelIds: string[]; categoryIds: string[]; manufacturerIds: string[] },
) {
  await tx.knowledgeTarget.deleteMany({ where: { documentId } });
  const data = [
    ...[...new Set(d.modelIds)].map((modelId) => ({ organizationId: ctx.organization.id, documentId, modelId })),
    ...[...new Set(d.categoryIds)].map((categoryId) => ({
      organizationId: ctx.organization.id,
      documentId,
      categoryId,
    })),
    ...[...new Set(d.manufacturerIds)].map((manufacturerId) => ({
      organizationId: ctx.organization.id,
      documentId,
      manufacturerId,
    })),
  ];
  if (data.length) await tx.knowledgeTarget.createMany({ data });
}

function checkHospital(ctx: AccessContext, hospitalId: string | null) {
  if (hospitalId && !ctx.hospitals.some((h) => h.id === hospitalId)) {
    throw new ValidationError("Choose one of your hospitals.", { hospitalId: ["Outside your access"] });
  }
}

function fileFrom(upload: Upload | null, body: string | null, title: string): CheckedFile {
  try {
    if (upload) return checkFile(upload.name, upload.bytes);
    if (body) return checkFile(`${title}.md`, new TextEncoder().encode(body));
  } catch (error) {
    if (error instanceof FileRejected) throw new ValidationError(error.message, { file: [error.message] });
    throw error;
  }
  throw new ValidationError("Attach a file or type the text.", { file: ["Required"] });
}

/** Extracts and stores the passages of one version (outside the upload transaction). */
async function indexVersion(ctx: AccessContext, versionId: string, file: CheckedFile) {
  const result = await extract(file);
  const passages = result.status === "INDEXED" ? toPassages(result.pages) : [];
  await withTenant(tenant(ctx), async (tx) => {
    const v = await tx.knowledgeVersion.findUniqueOrThrow({ where: { id: versionId }, select: { documentId: true } });
    await tx.knowledgeChunk.deleteMany({ where: { versionId } });
    if (passages.length) {
      await tx.knowledgeChunk.createMany({
        data: passages.map((p) => ({
          organizationId: ctx.organization.id,
          documentId: v.documentId,
          versionId,
          chunkNo: p.chunkNo,
          pageFrom: p.pageFrom,
          pageTo: p.pageTo,
          heading: p.heading ? cleanText(p.heading).slice(0, 200) : null,
          content: p.content,
        })),
      });
    }
    await tx.knowledgeVersion.update({
      where: { id: versionId },
      data: {
        indexStatus: passages.length ? "INDEXED" : result.status === "INDEXED" ? "NO_TEXT" : result.status,
        indexNote: passageLimitNote(passages) ?? result.note,
        pageCount: result.pageCount,
        indexedAt: new Date(),
      },
    });
  });
  return { status: result.status, passages: passages.length };
}

export async function createDocument(ctx: AccessContext, input: unknown, upload: Upload | null) {
  await requirePermission(ctx, "knowledge.contribute", { entityType: "knowledge_document" });
  const data = parseInput(documentCreateSchema, input);
  checkHospital(ctx, data.hospitalId);
  const file = fileFrom(upload, data.body, data.title);
  const created = await withTenant(tenant(ctx), async (tx) => {
    await validTargets(tx, data);
    const doc = await tx.knowledgeDocument.create({
      data: {
        organizationId: ctx.organization.id,
        title: data.title,
        docType: data.docType,
        summary: data.summary,
        source: data.source,
        sourceReference: data.sourceReference,
        revision: data.revision,
        publishedOn: data.publishedOn ? new Date(`${data.publishedOn}T00:00:00Z`) : null,
        accessLevel: data.accessLevel,
        hospitalId: data.hospitalId,
        createdById: ctx.user.id,
        updatedById: ctx.user.id,
      },
      select: { id: true },
    });
    await writeTargets(tx, ctx, doc.id, data);
    const version = await tx.knowledgeVersion.create({
      data: {
        organizationId: ctx.organization.id,
        documentId: doc.id,
        versionNo: 1,
        filename: file.filename,
        mime: file.mime,
        sizeBytes: file.sizeBytes,
        sha256: file.sha256,
        uploadedById: ctx.user.id,
      },
      select: { id: true },
    });
    await tx.knowledgeFile.create({
      data: { organizationId: ctx.organization.id, versionId: version.id, content: Buffer.from(file.bytes) },
    });
    await tx.knowledgeDocument.update({ where: { id: doc.id }, data: { currentVersionId: version.id } });
    await knowledgeAudit(tx, ctx, "knowledge.document_created", doc.id, {
      title: data.title,
      docType: data.docType,
      mime: file.mime,
      sizeBytes: file.sizeBytes,
      sha256: file.sha256,
    });
    return { id: doc.id, versionId: version.id };
  });
  const index = await indexVersion(ctx, created.versionId, file);
  return { ...created, index };
}

export async function updateDocument(ctx: AccessContext, input: unknown) {
  await requirePermission(ctx, "knowledge.contribute", { entityType: "knowledge_document" });
  const data = parseInput(documentUpdateSchema, input);
  checkHospital(ctx, data.hospitalId);
  return withTenant(tenant(ctx), async (tx) => {
    const doc = await loadDocument(ctx, tx, data.id);
    if (doc.status !== "ACTIVE") throw new ValidationError("Superseded and withdrawn documents are read-only.");
    if (doc.reviewStatus === "APPROVED" && !can(ctx, "knowledge.approve")) {
      throw new AuthorizationError("knowledge.approve", "Only an Engineering Manager can change an approved document.");
    }
    await validTargets(tx, data);
    await tx.knowledgeDocument.update({
      where: { id: doc.id },
      data: {
        title: data.title,
        docType: data.docType,
        summary: data.summary,
        source: data.source,
        sourceReference: data.sourceReference,
        revision: data.revision,
        publishedOn: data.publishedOn ? new Date(`${data.publishedOn}T00:00:00Z`) : null,
        accessLevel: data.accessLevel,
        hospitalId: data.hospitalId,
        updatedById: ctx.user.id,
      },
    });
    await writeTargets(tx, ctx, doc.id, data);
    await knowledgeAudit(tx, ctx, "knowledge.document_updated", doc.id, {
      title: data.title,
      reviewStatus: doc.reviewStatus,
    });
  });
}

/** Adds a new version. The document goes back to DRAFT: new content is not approved content. */
export async function addVersion(
  ctx: AccessContext,
  documentId: string,
  upload: Upload | null,
  body: string | null,
  note: string | null,
) {
  await requirePermission(ctx, "knowledge.contribute", { entityType: "knowledge_document" });
  const created = await withTenant(tenant(ctx), async (tx) => {
    const doc = await loadDocument(ctx, tx, documentId);
    if (doc.status !== "ACTIVE")
      throw new ValidationError("Superseded and withdrawn documents cannot get new versions.");
    const file = fileFrom(upload, body ? cleanText(body).slice(0, 200_000) : null, doc.title);
    const last = await tx.knowledgeVersion.findFirst({
      where: { documentId: doc.id },
      orderBy: { versionNo: "desc" },
      select: { versionNo: true, sha256: true },
    });
    if (last?.sha256 === file.sha256)
      throw new ValidationError("This file is identical to the current version.", { file: ["Same file"] });
    const version = await tx.knowledgeVersion.create({
      data: {
        organizationId: ctx.organization.id,
        documentId: doc.id,
        versionNo: (last?.versionNo ?? 0) + 1,
        filename: file.filename,
        mime: file.mime,
        sizeBytes: file.sizeBytes,
        sha256: file.sha256,
        note: note ? cleanText(note).slice(0, 500) : null,
        uploadedById: ctx.user.id,
      },
      select: { id: true, versionNo: true },
    });
    await tx.knowledgeFile.create({
      data: { organizationId: ctx.organization.id, versionId: version.id, content: Buffer.from(file.bytes) },
    });
    await tx.knowledgeDocument.update({
      where: { id: doc.id },
      data: {
        currentVersionId: version.id,
        reviewStatus: "DRAFT",
        reviewedById: null,
        reviewedAt: null,
        reviewNote: null,
        updatedById: ctx.user.id,
      },
    });
    await knowledgeAudit(tx, ctx, "knowledge.version_added", doc.id, {
      versionNo: version.versionNo,
      previousReviewStatus: doc.reviewStatus,
      sha256: file.sha256,
      sizeBytes: file.sizeBytes,
    });
    return { id: doc.id, versionId: version.id, file };
  });
  const index = await indexVersion(ctx, created.versionId, created.file);
  return { id: created.id, versionId: created.versionId, index };
}

// ─── Review and status ───────────────────────────────────────────────────────

export async function approveDocument(ctx: AccessContext, input: unknown) {
  await requirePermission(ctx, "knowledge.approve", { entityType: "knowledge_document" });
  const data = parseInput(approveDocumentSchema, input);
  return withTenant(tenant(ctx), async (tx) => {
    const doc = await loadDocument(ctx, tx, data.id);
    if (doc.status !== "ACTIVE") throw new ValidationError("Only active documents can be approved.");
    if (doc.reviewStatus === "APPROVED") throw new ValidationError("This version is already approved.");
    const current = doc.currentVersionId
      ? await tx.knowledgeVersion.findUnique({
          where: { id: doc.currentVersionId },
          select: { versionNo: true, indexStatus: true },
        })
      : null;
    if (!current || !["INDEXED", "NO_TEXT"].includes(current.indexStatus)) {
      throw new ValidationError("The current version could not be read. Upload a readable version first.");
    }
    await tx.knowledgeDocument.update({
      where: { id: doc.id },
      data: {
        reviewStatus: "APPROVED",
        reviewedById: ctx.user.id,
        reviewedAt: new Date(),
        reviewNote: data.reviewNote,
        authorisation: data.authorisation,
        updatedById: ctx.user.id,
      },
    });
    await knowledgeAudit(tx, ctx, "knowledge.document_approved", doc.id, {
      versionNo: current.versionNo,
      authorisation: data.authorisation,
      uploaderApproved: doc.createdById === ctx.user.id,
    });
  });
}

export async function setDocumentStatus(ctx: AccessContext, input: unknown) {
  await requirePermission(ctx, "knowledge.approve", { entityType: "knowledge_document" });
  const data = parseInput(documentStatusSchema, input);
  return withTenant(tenant(ctx), async (tx) => {
    const doc = await loadDocument(ctx, tx, data.id);
    if (doc.status !== "ACTIVE") throw new ValidationError("This document is already superseded or withdrawn.");
    if (data.supersededById) {
      if (data.supersededById === doc.id)
        throw new ValidationError("A document cannot replace itself.", { supersededById: ["Same document"] });
      const next = await tx.knowledgeDocument.findFirst({
        where: { AND: [{ id: data.supersededById, status: "ACTIVE" }, documentVisibleWhere(ctx)] },
        select: { id: true },
      });
      if (!next)
        throw new ValidationError("Choose an active document as the replacement.", {
          supersededById: ["Unknown document"],
        });
    }
    await tx.knowledgeDocument.update({
      where: { id: doc.id },
      data: {
        status: data.status,
        supersededById: data.supersededById,
        statusChangedById: ctx.user.id,
        statusChangedAt: new Date(),
        statusReason: data.reason,
        updatedById: ctx.user.id,
      },
    });
    await knowledgeAudit(
      tx,
      ctx,
      data.status === "WITHDRAWN" ? "knowledge.document_withdrawn" : "knowledge.document_superseded",
      doc.id,
      {
        reason: data.reason,
        supersededById: data.supersededById,
      },
    );
  });
}

/** Re-reads a stored file and rebuilds its passages. Refused when an AI answer cites them. */
export async function reindexVersion(ctx: AccessContext, input: { versionId?: unknown }) {
  await requirePermission(ctx, "knowledge.approve", { entityType: "knowledge_document" });
  const versionId = String(input?.versionId ?? "");
  if (!UUID.test(versionId)) throw new NotFoundError("Version");
  const file = await withTenant(tenant(ctx), async (tx) => {
    const v = await tx.knowledgeVersion.findUnique({
      where: { id: versionId },
      select: { id: true, documentId: true, mime: true, filename: true, versionNo: true },
    });
    if (!v) throw new NotFoundError("Version");
    await loadDocument(ctx, tx, v.documentId);
    const cited = await tx.aiCitation.count({ where: { versionId } });
    if (cited)
      throw new ValidationError(
        "AI answers cite this version, so its passages are kept as evidence. Upload a new version instead.",
      );
    const f = await tx.knowledgeFile.findUniqueOrThrow({ where: { versionId }, select: { content: true } });
    await knowledgeAudit(tx, ctx, "knowledge.version_reindexed", v.documentId, { versionNo: v.versionNo });
    return checkFile(v.filename, new Uint8Array(f.content));
  });
  return indexVersion(ctx, versionId, file);
}

// ─── Error codes ─────────────────────────────────────────────────────────────

export async function addErrorCode(ctx: AccessContext, input: unknown) {
  await requirePermission(ctx, "knowledge.contribute", { entityType: "knowledge_document" });
  const data = parseInput(errorCodeSchema, input);
  return withTenant(tenant(ctx), async (tx) => {
    const doc = await loadDocument(ctx, tx, data.documentId);
    if (doc.status !== "ACTIVE") throw new ValidationError("Superseded and withdrawn documents are read-only.");
    const row = await tx.knowledgeErrorCode.create({
      data: {
        organizationId: ctx.organization.id,
        documentId: doc.id,
        code: data.code,
        codeKey: codeKey(data.code),
        meaning: data.meaning,
        page: data.page,
        createdById: ctx.user.id,
      },
      select: { id: true },
    });
    await knowledgeAudit(tx, ctx, "knowledge.error_code_added", doc.id, { code: data.code, page: data.page });
    return row;
  });
}

export async function archiveErrorCode(ctx: AccessContext, input: { id?: unknown }) {
  await requirePermission(ctx, "knowledge.approve", { entityType: "knowledge_document" });
  const id = String(input?.id ?? "");
  if (!UUID.test(id)) throw new NotFoundError("Error code");
  return withTenant(tenant(ctx), async (tx) => {
    const code = await tx.knowledgeErrorCode.findUnique({
      where: { id },
      select: { id: true, documentId: true, code: true, archivedAt: true },
    });
    if (!code) throw new NotFoundError("Error code");
    await loadDocument(ctx, tx, code.documentId);
    if (code.archivedAt) return;
    await tx.knowledgeErrorCode.update({ where: { id }, data: { archivedAt: new Date() } });
    await knowledgeAudit(tx, ctx, "knowledge.error_code_archived", code.documentId, { code: code.code });
  });
}

// ─── Files ───────────────────────────────────────────────────────────────────

/** The stored file of a version, for a person allowed to see the document. Audited. */
export async function readVersionFile(ctx: AccessContext, versionId: string, mode: "open" | "download") {
  await requirePermission(ctx, "knowledge.view", { entityType: "knowledge_document" });
  if (!UUID.test(versionId)) throw new NotFoundError("File");
  return withTenant(tenant(ctx), async (tx) => {
    const v = await tx.knowledgeVersion.findUnique({
      where: { id: versionId },
      select: { id: true, documentId: true, filename: true, mime: true, versionNo: true },
    });
    if (!v) throw new NotFoundError("File");
    const doc = await loadDocument(ctx, tx, v.documentId);
    const f = await tx.knowledgeFile.findUniqueOrThrow({ where: { versionId }, select: { content: true } });
    await knowledgeAudit(tx, ctx, mode === "download" ? "knowledge.file_downloaded" : "knowledge.file_opened", doc.id, {
      versionNo: v.versionNo,
      status: doc.status,
    });
    return { filename: v.filename, mime: v.mime, content: new Uint8Array(f.content) };
  });
}
