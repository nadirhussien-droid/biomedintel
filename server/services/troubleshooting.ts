// Troubleshooting sessions and AI assistance (Stage 9, IntellAssist).
//
// A session belongs to one asset (and optionally one of its work orders). It
// records what the engineer saw and tested, what the AI suggested and how the
// engineer judged each suggestion, and the conclusion. Rules:
//
//   • The AI is ADVISORY. Nothing in this file changes an asset's status, a
//     work order's status or sign-off, a safety hold or a PM plan. Closing a
//     session as "resolved" records the engineer's conclusion only; return to
//     service still goes through the work order and safety-hold workflows.
//   • History is append-only: observations, tests, feedback and conclusion
//     changes are new entries (database trigger); AI requests and citations
//     can never be edited.
//   • Only approved, active documents the person may see are used as
//     evidence, and an answer can cite only passages the server retrieved.
//   • Only the minimum leaves the application: no names, no e-mail
//     addresses, no hospital or organisation names; numbers that look like
//     phone or record numbers are removed.
import "server-only";
import { Prisma } from "../db/generated/client";
import { withTenant, type Tx } from "../db/tenant";
import { audit } from "../audit/audit";
import { can, requirePermission, type AccessContext } from "../authz/access";
import { AuthorizationError, NotFoundError, ValidationError } from "../authz/errors";
import { parseInput } from "../validation";
import { loadScopedAsset } from "./assets";
import { addEvent, peopleNames } from "./work-order-core";
import { workOrderScopeWhere } from "./work-orders";
import { documentVisibleSql } from "./knowledge";
import { aiConfig, aiLimits, AiProviderError, getAiProvider } from "../ai/provider";
import {
  buildUserPrompt,
  checkAnswer,
  PROMPT_VERSION,
  SYSTEM_PROMPT,
  UNVERIFIED_NOTE,
  type PromptPassage,
} from "../ai/prompt";
import { HAZARDS, hazardFlags, redact, type HazardKey } from "../ai/safety";
import { STATUS_LABELS, RISK_LABELS, type AssetStatusValue, type RiskClassValue } from "@/lib/validation/assets";
import { HOLD_STATUS_LABELS, WORK_TYPE_LABELS } from "@/lib/validation/pm";
import { FAILURE_CATEGORY_LABELS, type FailureCategoryValue } from "@/lib/validation/work-orders";
import {
  askSchema,
  closeSchema,
  entrySchema,
  feedbackSchema,
  reopenSchema,
  rootCauseSchema,
  sessionDetailsSchema,
  sessionQuerySchema,
  sessionStartSchema,
  TS_RESULT_LABELS,
  VERIFICATION_LABELS,
} from "@/lib/validation/knowledge";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const tenant = (ctx: AccessContext) => ({ userId: ctx.user.id, organizationId: ctx.organization.id });
const iso = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : null);
const clip = (s: string | null | undefined, n: number) => (s ? (s.length > n ? `${s.slice(0, n)}…` : s) : "");
const MAX_PASSAGES = 6;
const GENERIC_LEXEMES = new Set([
  "check",
  "caus",
  "possibl",
  "fault",
  "faulti",
  "issu",
  "problem",
  "devic",
  "unit",
  "equip",
  "equipment",
  "machin",
  "show",
  "use",
  "work",
  "test",
  "error",
  "occur",
  "happen",
  "see",
  "time",
  "need",
  "may",
  "also",
  "next",
  "find",
]);

export function sessionScopeWhere(ctx: AccessContext): Prisma.TroubleshootingSessionWhereInput {
  if (!ctx.hospitals.length) return { id: { in: [] } };
  return {
    OR: ctx.hospitals.map((h) =>
      h.departments === "ALL" ? { hospitalId: h.id } : { hospitalId: h.id, departmentId: { in: h.departments } },
    ),
  };
}

async function loadSession(ctx: AccessContext, tx: Tx, id: string) {
  if (!UUID.test(id)) throw new NotFoundError("Troubleshooting session");
  const s = await tx.troubleshootingSession.findFirst({
    where: { AND: [{ id }, sessionScopeWhere(ctx)] },
    include: { workOrder: { select: { id: true, number: true, status: true, assignedToId: true } } },
  });
  if (!s) throw new NotFoundError("Troubleshooting session");
  return s;
}

/** Managers on any session in scope; technicians on sessions they started or on jobs assigned to them. */
function mayWork(ctx: AccessContext, s: { startedById: string; workOrder: { assignedToId: string | null } | null }) {
  if (!can(ctx, "troubleshoot.work")) return false;
  if (ctx.role === "ENGINEERING_MANAGER") return true;
  return s.startedById === ctx.user.id || s.workOrder?.assignedToId === ctx.user.id;
}

async function editable(ctx: AccessContext, tx: Tx, id: string, action: string) {
  await requirePermission(ctx, "troubleshoot.work", { entityType: "troubleshooting_session" });
  const s = await loadSession(ctx, tx, id);
  if (!mayWork(ctx, s))
    throw new AuthorizationError(
      action,
      "Only the engineer who started this session, the assigned technician or a manager can change it.",
    );
  return s;
}

function tsAudit(tx: Tx, ctx: AccessContext, action: string, entityId: string, metadata: Record<string, unknown> = {}) {
  return audit(tx, {
    organizationId: ctx.organization.id,
    actorUserId: ctx.user.id,
    action,
    entityType: "troubleshooting_session",
    entityId,
    metadata,
    request: ctx.request,
  });
}

async function entry(
  tx: Tx,
  ctx: AccessContext,
  sessionId: string,
  kind:
    | "OBSERVATION"
    | "TEST"
    | "NOTE"
    | "FEEDBACK"
    | "ROOT_CAUSE"
    | "CORRECTIVE_ACTION"
    | "VERIFICATION"
    | "STATUS"
    | "DETAILS",
  text: string,
  extra: {
    testName?: string | null;
    result?: "NORMAL" | "ABNORMAL" | "INCONCLUSIVE" | null;
    suggestionId?: string | null;
  } = {},
) {
  await tx.troubleshootingEntry.create({
    data: {
      organizationId: ctx.organization.id,
      sessionId,
      kind,
      text: text.slice(0, 4000),
      testName: extra.testName ?? null,
      result: extra.result ?? null,
      suggestionId: extra.suggestionId ?? null,
      authorId: ctx.user.id,
    },
  });
}

async function nextNumber(tx: Tx, organizationId: string, now: Date) {
  const year = now.getUTCFullYear();
  const rows = await tx.$queryRaw<{ last_number: number }[]>`
    INSERT INTO troubleshooting_counters (organization_id, year, last_number) VALUES (${organizationId}::uuid, ${year}, 1)
    ON CONFLICT (organization_id, year) DO UPDATE SET last_number = troubleshooting_counters.last_number + 1
    RETURNING last_number`;
  return `TS-${year}-${String(rows[0].last_number).padStart(5, "0")}`;
}

// ─── Start, list, read ───────────────────────────────────────────────────────

export async function startSession(ctx: AccessContext, input: unknown) {
  await requirePermission(ctx, "troubleshoot.work", { entityType: "troubleshooting_session" });
  const data = parseInput(sessionStartSchema, input);
  return withTenant(tenant(ctx), async (tx) => {
    const asset = await loadScopedAsset(ctx, tx, data.assetId, "troubleshoot.start");
    if (asset.archivedAt) throw new ValidationError("This asset is archived.");
    let wo: { id: string; number: string; assetId: string; assignedToId: string | null } | null = null;
    if (data.workOrderId) {
      wo = await tx.workOrder.findFirst({
        where: { AND: [{ id: data.workOrderId }, workOrderScopeWhere(ctx)] },
        select: { id: true, number: true, assetId: true, assignedToId: true },
      });
      if (!wo) throw new NotFoundError("Work order");
      if (wo.assetId !== asset.id)
        throw new ValidationError("The work order is for a different device.", { workOrderId: ["Different device"] });
    }
    if (ctx.role === "TECHNICIAN" && wo?.assignedToId && wo.assignedToId !== ctx.user.id) {
      throw new AuthorizationError("troubleshoot.start", "This job is assigned to another technician.");
    }
    const number = await nextNumber(tx, ctx.organization.id, new Date());
    const s = await tx.troubleshootingSession.create({
      data: {
        organizationId: ctx.organization.id,
        number,
        assetId: asset.id,
        workOrderId: wo?.id ?? null,
        hospitalId: asset.hospitalId,
        departmentId: asset.departmentId,
        faultDescription: data.faultDescription,
        symptoms: data.symptoms,
        errorCodes: data.errorCodes,
        alarms: data.alarms,
        operatingConditions: data.operatingConditions,
        startedById: ctx.user.id,
      },
      select: { id: true, number: true },
    });
    if (wo) await addEvent(tx, ctx, wo.id, "TROUBLESHOOTING", { note: `Troubleshooting session ${number} started` });
    await tsAudit(tx, ctx, "troubleshoot.session_started", s.id, {
      number,
      assetTag: asset.assetTag,
      workOrder: wo?.number ?? null,
    });
    return s;
  });
}

export async function listSessions(ctx: AccessContext, raw: unknown) {
  await requirePermission(ctx, "troubleshoot.view", { entityType: "troubleshooting_session" });
  const q = sessionQuerySchema.parse(raw ?? {});
  const PAGE = 25;
  return withTenant(tenant(ctx), async (tx) => {
    const where: Prisma.TroubleshootingSessionWhereInput = {
      AND: [
        sessionScopeWhere(ctx),
        q.status === "all" ? {} : { status: q.status.toUpperCase() as "OPEN" | "RESOLVED" | "UNRESOLVED" },
        q.mine ? { startedById: ctx.user.id } : {},
        q.asset ? { assetId: q.asset } : {},
      ],
    };
    const total = await tx.troubleshootingSession.count({ where });
    const pageCount = Math.max(1, Math.ceil(total / PAGE));
    const page = Math.min(q.page, pageCount);
    const rows = await tx.troubleshootingSession.findMany({
      where,
      orderBy: { updatedAt: "desc" },
      skip: (page - 1) * PAGE,
      take: PAGE,
      select: {
        id: true,
        number: true,
        status: true,
        faultDescription: true,
        errorCodes: true,
        rootCause: true,
        startedById: true,
        createdAt: true,
        updatedAt: true,
        asset: { select: { id: true, assetTag: true, name: true } },
        workOrder: { select: { id: true, number: true } },
        _count: { select: { suggestions: true, entries: true } },
      },
    });
    const names = await peopleNames(
      tx,
      rows.map((r) => r.startedById),
    );
    return { q, rows, names, total, page, pageCount };
  });
}

/** Sessions of one asset or one work order (for their pages). Null when the role cannot see them. */
export async function sessionsFor(ctx: AccessContext, by: { assetId?: string; workOrderId?: string }) {
  if (!can(ctx, "troubleshoot.view")) return null;
  return withTenant(tenant(ctx), (tx) =>
    tx.troubleshootingSession.findMany({
      where: {
        AND: [
          sessionScopeWhere(ctx),
          by.assetId ? { assetId: by.assetId } : {},
          by.workOrderId ? { workOrderId: by.workOrderId } : {},
        ],
      },
      orderBy: { createdAt: "desc" },
      take: 20,
      select: {
        id: true,
        number: true,
        status: true,
        faultDescription: true,
        rootCause: true,
        createdAt: true,
        workOrder: { select: { number: true } },
      },
    }),
  );
}

// ─── Evidence: facts from records and retrieved passages ─────────────────────

type Fact = { label: string; text: string; href?: string };

async function recordFacts(
  tx: Tx,
  session: { assetId: string; workOrderId: string | null; errorCodes: string[] },
  ctx: AccessContext,
) {
  const asset = await tx.asset.findUniqueOrThrow({
    where: { id: session.assetId },
    select: {
      id: true,
      assetTag: true,
      status: true,
      riskClass: true,
      purchaseDate: true,
      commissionedAt: true,
      modelId: true,
      model: {
        select: {
          modelName: true,
          categoryId: true,
          manufacturerId: true,
          manufacturer: { select: { name: true } },
          category: { select: { name: true, safetyCritical: true } },
        },
      },
    },
  });
  const facts: Fact[] = [
    {
      label: "Device",
      text: `${asset.assetTag}: ${asset.model.manufacturer.name} ${asset.model.modelName} (${asset.model.category.name})${asset.riskClass ? `, ${RISK_LABELS[asset.riskClass as RiskClassValue].toLowerCase()} risk` : ""}`,
      href: `/assets/${asset.id}`,
    },
    { label: "Current status", text: STATUS_LABELS[asset.status as AssetStatusValue] },
  ];
  const acquired = asset.purchaseDate ?? asset.commissionedAt;
  if (acquired) facts.push({ label: "In use since", text: iso(acquired)! });
  const hold = await tx.safetyHold.findFirst({
    where: { assetId: asset.id, status: { not: "RELEASED" } },
    select: { id: true, status: true },
  });
  if (hold)
    facts.push({
      label: "Safety hold",
      text: `Failed Safety Test — Do Not Use (${HOLD_STATUS_LABELS[hold.status] ?? hold.status})`,
      href: `/maintenance/holds/${hold.id}`,
    });
  const lastTest = await tx.workOrder.findFirst({
    where: { assetId: asset.id, status: "COMPLETED", electricalSafetyCheck: { in: ["PASS", "FAIL"] } },
    orderBy: { completedAt: "desc" },
    select: { id: true, number: true, completedAt: true, electricalSafetyCheck: true },
  });
  if (lastTest) {
    facts.push({
      label: "Last electrical safety result",
      text: `${lastTest.electricalSafetyCheck === "PASS" ? "Pass" : "Fail"} on ${iso(lastTest.completedAt)} (${lastTest.number})`,
      href: `/work-orders/${lastTest.id}`,
    });
  }
  if (session.workOrderId) {
    const wo = await tx.workOrder.findUnique({
      where: { id: session.workOrderId },
      select: { id: true, number: true, faultDescription: true, status: true },
    });
    if (wo)
      facts.push({
        label: "Linked work order",
        text: `${wo.number} (${wo.status.toLowerCase().replace("_", " ")}): ${clip(wo.faultDescription, 300)}`,
        href: `/work-orders/${wo.id}`,
      });
  }
  const history = await tx.workOrder.findMany({
    where: {
      assetId: asset.id,
      id: session.workOrderId ? { not: session.workOrderId } : undefined,
      status: "COMPLETED",
    },
    orderBy: { completedAt: "desc" },
    take: 5,
    select: {
      id: true,
      number: true,
      type: true,
      completedAt: true,
      outcome: true,
      failureCategory: true,
      diagnosis: true,
      resolution: true,
    },
  });
  for (const h of history) {
    const parts = [
      `${WORK_TYPE_LABELS[h.type] ?? h.type}, signed off ${iso(h.completedAt)}`,
      h.outcome ? `outcome ${h.outcome.toLowerCase().replaceAll("_", " ")}` : null,
      h.failureCategory
        ? `fault category ${FAILURE_CATEGORY_LABELS[h.failureCategory as FailureCategoryValue].toLowerCase()}`
        : null,
      h.diagnosis ? `diagnosis: ${clip(h.diagnosis, 200)}` : null,
      h.resolution ? `work done: ${clip(h.resolution, 200)}` : null,
    ].filter(Boolean);
    facts.push({ label: `History ${h.number}`, text: parts.join("; "), href: `/work-orders/${h.id}` });
  }
  const confirmed = await tx.troubleshootingSession.findMany({
    where: { AND: [sessionScopeWhere(ctx), { status: "RESOLVED", asset: { modelId: asset.modelId } }] },
    orderBy: { closedAt: "desc" },
    take: 5,
    select: { id: true, number: true, rootCause: true, verificationOutcome: true },
  });
  for (const c of confirmed) {
    facts.push({
      label: `Confirmed on this model (${c.number})`,
      text: `${clip(c.rootCause, 300)}${c.verificationOutcome ? ` — ${VERIFICATION_LABELS[c.verificationOutcome].toLowerCase()}` : ""}`,
      href: `/assist/${c.id}`,
    });
  }
  // Documented error-code meanings: approved, active documents the person may see.
  const codes = session.errorCodes.length
    ? await tx.$queryRaw<{ code: string; meaning: string; page: number | null; title: string; document_id: string }[]>`
        SELECT k.code_key AS code, k.meaning, k.page, d.title, d.id AS document_id
        FROM knowledge_error_codes k JOIN knowledge_documents d ON d.id = k.document_id
        WHERE k.archived_at IS NULL AND k.code_key IN (${Prisma.join(session.errorCodes)})
          AND d.review_status = 'APPROVED' AND d.status = 'ACTIVE' AND ${documentVisibleSql(ctx)}
          AND (NOT EXISTS (SELECT 1 FROM knowledge_targets t WHERE t.document_id = d.id)
               OR EXISTS (SELECT 1 FROM knowledge_targets t WHERE t.document_id = d.id
                          AND (t.model_id = ${asset.modelId}::uuid OR t.category_id = ${asset.model.categoryId}::uuid
                               OR t.manufacturer_id = ${asset.model.manufacturerId}::uuid)))
        ORDER BY k.code LIMIT 20`
    : [];
  for (const c of codes) {
    facts.push({
      label: `Error code ${c.code} (documented)`,
      text: `${c.meaning} — ${c.title}${c.page ? `, page ${c.page}` : ""}`,
      href: `/knowledge/${c.document_id}`,
    });
  }
  const undocumented = session.errorCodes.filter((code) => !codes.some((c) => c.code === code));
  return {
    asset,
    facts,
    undocumented,
    safetyCritical: asset.model.category.safetyCritical || asset.riskClass === "HIGH",
  };
}

type Retrieved = {
  label: string;
  chunkId: string;
  documentId: string;
  versionId: string;
  title: string;
  page: number | null;
  heading: string | null;
  content: string;
  specificity: number;
};

async function retrievePassages(
  ctx: AccessContext,
  tx: Tx,
  asset: { modelId: string; model: { categoryId: string; manufacturerId: string } },
  text: string,
  codes: string[],
): Promise<Retrieved[]> {
  const lex = await tx.$queryRaw<{ lexemes: string[] | null }[]>`
    SELECT array_agg(lexeme) AS lexemes FROM (SELECT DISTINCT lexeme FROM unnest(to_tsvector('english', ${text.slice(0, 6000)})) LIMIT 60) x`;
  // Words that appear in almost every fault description match nearly any manual: ignore them.
  const lexemes = (lex[0]?.lexemes ?? []).filter((l) => !GENERIC_LEXEMES.has(l));
  const codePatterns = codes.map((c) => `%${c.replace(/[%_\\]/g, (m) => `\\${m}`)}%`);
  if (!lexemes.length && !codePatterns.length) return [];
  const rows = await tx.$queryRaw<
    {
      chunk_id: string;
      document_id: string;
      version_id: string;
      title: string;
      page_from: number | null;
      heading: string | null;
      content: string;
      specificity: number;
      matched: number;
      code_hit: boolean;
    }[]
  >`
    WITH q AS (SELECT ${lexemes}::text[] AS lex)
    SELECT c.id AS chunk_id, c.document_id, c.version_id, d.title, c.page_from, c.heading, c.content,
      (SELECT coalesce(max(CASE WHEN t.model_id = ${asset.modelId}::uuid THEN 3 WHEN t.category_id = ${asset.model.categoryId}::uuid THEN 2
                                WHEN t.manufacturer_id = ${asset.model.manufacturerId}::uuid THEN 1 ELSE 0 END), 0)
         FROM knowledge_targets t WHERE t.document_id = d.id)::int AS specificity,
      (SELECT count(*) FROM unnest(tsvector_to_array(c.tsv)) l WHERE l = ANY (q.lex))::int AS matched,
      ${codePatterns.length ? Prisma.sql`(upper(c.content) LIKE ANY (ARRAY[${Prisma.join(codePatterns)}]))` : Prisma.sql`false`} AS code_hit
    FROM knowledge_chunks c
    JOIN knowledge_documents d ON d.id = c.document_id AND c.version_id = d.current_version_id
    CROSS JOIN q
    WHERE d.review_status = 'APPROVED' AND d.status = 'ACTIVE' AND ${documentVisibleSql(ctx)}
      AND (NOT EXISTS (SELECT 1 FROM knowledge_targets t WHERE t.document_id = d.id)
           OR EXISTS (SELECT 1 FROM knowledge_targets t WHERE t.document_id = d.id
                      AND (t.model_id = ${asset.modelId}::uuid OR t.category_id = ${asset.model.categoryId}::uuid
                           OR t.manufacturer_id = ${asset.model.manufacturerId}::uuid)))
    ORDER BY code_hit DESC, specificity DESC, matched DESC, c.chunk_no
    LIMIT 40`;
  return rows
    .filter((r) => r.code_hit || r.matched >= 2)
    .slice(0, MAX_PASSAGES)
    .map((r, i) => ({
      label: `S${i + 1}`,
      chunkId: r.chunk_id,
      documentId: r.document_id,
      versionId: r.version_id,
      title: r.title,
      page: r.page_from,
      heading: r.heading,
      content: r.content,
      specificity: r.specificity,
    }));
}

// ─── Read one session ────────────────────────────────────────────────────────

export async function getSession(ctx: AccessContext, id: string) {
  await requirePermission(ctx, "troubleshoot.view", { entityType: "troubleshooting_session" });
  return withTenant(tenant(ctx), async (tx) => {
    const s = await loadSession(ctx, tx, id);
    const [asset, entries, requests, suggestions] = await Promise.all([
      tx.asset.findUniqueOrThrow({
        where: { id: s.assetId },
        select: { id: true, assetTag: true, name: true, hospital: { select: { code: true } } },
      }),
      tx.troubleshootingEntry.findMany({ where: { sessionId: s.id }, orderBy: { createdAt: "asc" } }),
      tx.aiRequest.findMany({
        where: { sessionId: s.id },
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          provider: true,
          model: true,
          status: true,
          question: true,
          unverifiedAllowed: true,
          errorCode: true,
          safetyFlags: true,
          answer: true,
          inputTokens: true,
          outputTokens: true,
          latencyMs: true,
          requestedById: true,
          createdAt: true,
        },
      }),
      tx.aiSuggestion.findMany({
        where: { sessionId: s.id },
        orderBy: [{ createdAt: "desc" }, { ordinal: "asc" }],
        include: {
          citations: {
            select: {
              id: true,
              pageFrom: true,
              chunk: { select: { id: true, content: true, heading: true } },
              document: {
                select: {
                  id: true,
                  title: true,
                  revision: true,
                  status: true,
                  reviewStatus: true,
                  currentVersionId: true,
                },
              },
              version: { select: { id: true, versionNo: true, mime: true } },
            },
          },
        },
      }),
    ]);
    const { facts, undocumented, safetyCritical } = await recordFacts(tx, s, ctx);
    const names = await peopleNames(tx, [
      s.startedById,
      s.closedById,
      s.rootCauseById,
      ...entries.map((e) => e.authorId),
      ...requests.map((r) => r.requestedById),
      ...suggestions.map((x) => x.feedbackById),
    ]);
    const settings = await tx.aiSettings.findUnique({ where: { organizationId: ctx.organization.id } });
    const config = aiConfig();
    const hazards = hazardFlags(
      s.faultDescription,
      s.symptoms,
      s.alarms,
      s.operatingConditions,
      ...entries.map((e) => e.text),
    );
    return {
      session: s,
      asset,
      entries,
      requests,
      suggestions,
      facts,
      undocumented,
      safetyCritical,
      hazards: hazards.map((k) => HAZARDS[k].label),
      names,
      ai: {
        enabled: Boolean(settings?.enabled),
        configured: config.configured,
        provider: config.provider,
        model: config.model,
        isMock: config.provider === "mock",
      },
      allowed: {
        work: s.status === "OPEN" && mayWork(ctx, s),
        reopen: s.status !== "OPEN" && ctx.role === "ENGINEERING_MANAGER",
      },
    };
  });
}

// ─── Record findings ─────────────────────────────────────────────────────────

export async function updateDetails(ctx: AccessContext, input: unknown) {
  const data = parseInput(sessionDetailsSchema, input);
  return withTenant(tenant(ctx), async (tx) => {
    const s = await editable(ctx, tx, data.id, "troubleshoot.update");
    if (s.status !== "OPEN") throw new ValidationError("Closed sessions are read-only. Reopen it first.");
    const before: Record<string, string> = {
      faultDescription: s.faultDescription,
      symptoms: s.symptoms ?? "—",
      errorCodes: s.errorCodes.join(", ") || "—",
      alarms: s.alarms ?? "—",
      operatingConditions: s.operatingConditions ?? "—",
    };
    const after: Record<string, string> = {
      faultDescription: data.faultDescription,
      symptoms: data.symptoms ?? "—",
      errorCodes: data.errorCodes.join(", ") || "—",
      alarms: data.alarms ?? "—",
      operatingConditions: data.operatingConditions ?? "—",
    };
    const changed = Object.keys(before).filter((k) => before[k] !== after[k]);
    if (!changed.length) return;
    await tx.troubleshootingSession.update({
      where: { id: s.id },
      data: {
        faultDescription: data.faultDescription,
        symptoms: data.symptoms,
        errorCodes: data.errorCodes,
        alarms: data.alarms,
        operatingConditions: data.operatingConditions,
      },
    });
    // The previous wording is kept in the history.
    const previous = changed.map((k) => `${k}: ${clip(before[k], 400)}`).join("\n");
    await entry(tx, ctx, s.id, "DETAILS", `Details updated (${changed.join(", ")}). Previous values:\n${previous}`);
    await tsAudit(tx, ctx, "troubleshoot.details_updated", s.id, { fields: changed });
  });
}

export async function addEntry(ctx: AccessContext, input: unknown) {
  const data = parseInput(entrySchema, input);
  return withTenant(tenant(ctx), async (tx) => {
    const s = await editable(ctx, tx, data.sessionId, "troubleshoot.entry");
    if (s.status !== "OPEN") throw new ValidationError("Closed sessions are read-only. Reopen it first.");
    await entry(tx, ctx, s.id, data.kind, data.text, { testName: data.testName, result: data.result });
    await tsAudit(tx, ctx, "troubleshoot.entry_added", s.id, { kind: data.kind, result: data.result });
  });
}

export async function recordFeedback(ctx: AccessContext, input: unknown) {
  const data = parseInput(feedbackSchema, input);
  return withTenant(tenant(ctx), async (tx) => {
    const sug = await tx.aiSuggestion.findUnique({
      where: { id: data.suggestionId },
      select: { id: true, sessionId: true, cause: true, feedback: true, ordinal: true },
    });
    if (!sug) throw new NotFoundError("Suggestion");
    const s = await editable(ctx, tx, sug.sessionId, "troubleshoot.feedback");
    if (s.status !== "OPEN") throw new ValidationError("Closed sessions are read-only. Reopen it first.");
    await tx.aiSuggestion.update({
      where: { id: sug.id },
      data: { feedback: data.feedback, feedbackNote: data.note, feedbackById: ctx.user.id, feedbackAt: new Date() },
    });
    await entry(
      tx,
      ctx,
      s.id,
      "FEEDBACK",
      `Suggestion "${clip(sug.cause, 200)}": ${sug.feedback === "PENDING" ? "" : `${sug.feedback.toLowerCase().replace("_", " ")} → `}${data.feedback.toLowerCase().replace("_", " ")}${data.note ? ` — ${data.note}` : ""}`,
      { suggestionId: sug.id },
    );
    await tsAudit(tx, ctx, "troubleshoot.suggestion_feedback", s.id, {
      suggestionId: sug.id,
      from: sug.feedback,
      to: data.feedback,
    });
  });
}

export async function recordRootCause(ctx: AccessContext, input: unknown) {
  const data = parseInput(rootCauseSchema, input);
  return withTenant(tenant(ctx), async (tx) => {
    const s = await editable(ctx, tx, data.id, "troubleshoot.root_cause");
    if (s.status !== "OPEN") throw new ValidationError("Closed sessions are read-only. Reopen it first.");
    await tx.troubleshootingSession.update({
      where: { id: s.id },
      data: { rootCause: data.rootCause, rootCauseById: ctx.user.id, rootCauseAt: new Date() },
    });
    await entry(
      tx,
      ctx,
      s.id,
      "ROOT_CAUSE",
      s.rootCause
        ? `Root cause changed from: "${clip(s.rootCause, 500)}" to: "${data.rootCause}"`
        : `Root cause: ${data.rootCause}`,
    );
    await tsAudit(
      tx,
      ctx,
      s.rootCause ? "troubleshoot.root_cause_changed" : "troubleshoot.root_cause_recorded",
      s.id,
      {},
    );
  });
}

/** Ends the session. Never changes the asset, the work order or a safety hold. */
export async function closeSession(ctx: AccessContext, input: unknown) {
  const data = parseInput(closeSchema, input);
  return withTenant(tenant(ctx), async (tx) => {
    const s = await editable(ctx, tx, data.id, "troubleshoot.close");
    if (s.status !== "OPEN") throw new ValidationError("This session is already closed.");
    if (data.outcome === "RESOLVED" && !s.rootCause) {
      throw new ValidationError("Record the confirmed root cause before closing the session as resolved.", {
        outcome: ["Root cause missing"],
      });
    }
    await tx.troubleshootingSession.update({
      where: { id: s.id },
      data: {
        status: data.outcome,
        correctiveAction: data.correctiveAction,
        verificationOutcome: data.verificationOutcome,
        verificationNote: data.verificationNote,
        closedById: ctx.user.id,
        closedAt: new Date(),
      },
    });
    if (data.correctiveAction) await entry(tx, ctx, s.id, "CORRECTIVE_ACTION", data.correctiveAction);
    if (data.verificationOutcome) {
      await entry(
        tx,
        ctx,
        s.id,
        "VERIFICATION",
        `${VERIFICATION_LABELS[data.verificationOutcome]}${data.verificationNote ? `: ${data.verificationNote}` : ""}`,
      );
    }
    await entry(
      tx,
      ctx,
      s.id,
      "STATUS",
      data.outcome === "RESOLVED" ? "Closed: root cause confirmed" : "Closed without a confirmed cause",
    );
    if (s.workOrder) {
      await addEvent(tx, ctx, s.workOrder.id, "TROUBLESHOOTING", {
        note: `Troubleshooting session ${s.number} closed (${data.outcome === "RESOLVED" ? "root cause confirmed" : "no confirmed cause"}). Sign-off and return to service follow the work order and safety workflows.`,
      });
    }
    await tsAudit(tx, ctx, "troubleshoot.session_closed", s.id, {
      outcome: data.outcome,
      verificationOutcome: data.verificationOutcome,
    });
  });
}

export async function reopenSession(ctx: AccessContext, input: unknown) {
  await requirePermission(ctx, "troubleshoot.work", { entityType: "troubleshooting_session" });
  const data = parseInput(reopenSchema, input);
  if (ctx.role !== "ENGINEERING_MANAGER")
    throw new AuthorizationError("troubleshoot.reopen", "Only an Engineering Manager can reopen a session.");
  return withTenant(tenant(ctx), async (tx) => {
    const s = await loadSession(ctx, tx, data.id);
    if (s.status === "OPEN") return;
    await tx.troubleshootingSession.update({
      where: { id: s.id },
      data: { status: "OPEN", closedById: null, closedAt: null },
    });
    await entry(tx, ctx, s.id, "STATUS", `Reopened: ${data.reason}`);
    await tsAudit(tx, ctx, "troubleshoot.session_reopened", s.id, { reason: data.reason, previous: s.status });
  });
}

// ─── AI assistance ───────────────────────────────────────────────────────────

export type AskResult = { status: string; message: string; requestId?: string };

const STATUS_MESSAGES: Record<string, string> = {
  DISABLED: "AI suggestions are switched off. Manual troubleshooting and the knowledge base still work.",
  NOT_CONFIGURED:
    "No AI provider is configured on the server. Manual troubleshooting and the knowledge base still work.",
  RATE_LIMITED: "The AI usage limit has been reached. Try again later; manual troubleshooting still works.",
  NO_SOURCES:
    'No approved document in the knowledge base matches this fault, so no AI suggestions were requested. Add evidence (error codes, symptoms), add approved documents, or choose "ask anyway" to get unverified suggestions.',
  TIMEOUT: "The AI service did not answer in time. Nothing was saved as a suggestion; try again later.",
  FAILED:
    "The AI service is unavailable at the moment. Nothing was saved as a suggestion; manual troubleshooting still works.",
  INVALID_RESPONSE: "The AI reply was not in the required format, so it was discarded. Try again.",
  SUCCEEDED: "Suggestions received. Review the evidence for each one and record your assessment.",
};

async function usageCheck(tx: Tx, ctx: AccessContext, now: Date) {
  const limits = aiLimits();
  const counted = {
    status: { notIn: ["RATE_LIMITED", "DISABLED", "NO_SOURCES"] as ("RATE_LIMITED" | "DISABLED" | "NO_SOURCES")[] },
  };
  const [mine, org, tokens] = await Promise.all([
    tx.aiRequest.count({
      where: { ...counted, requestedById: ctx.user.id, createdAt: { gte: new Date(now.getTime() - 3600_000) } },
    }),
    tx.aiRequest.count({ where: { ...counted, createdAt: { gte: new Date(now.getTime() - 86_400_000) } } }),
    tx.aiRequest.aggregate({
      where: { createdAt: { gte: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)) } },
      _sum: { inputTokens: true, outputTokens: true },
    }),
  ]);
  const used = (tokens._sum.inputTokens ?? 0) + (tokens._sum.outputTokens ?? 0);
  if (mine >= limits.userPerHour) return "user_hourly_limit";
  if (org >= limits.orgPerDay) return "org_daily_limit";
  if (used >= limits.orgTokensPerMonth) return "org_monthly_token_limit";
  return null;
}

export async function askAi(ctx: AccessContext, input: unknown, opts: { now?: Date } = {}): Promise<AskResult> {
  await requirePermission(ctx, "troubleshoot.work", { entityType: "troubleshooting_session" });
  const data = parseInput(askSchema, input);
  const now = opts.now ?? new Date();
  const provider = getAiProvider();
  const config = aiConfig();

  // 1. Checks and evidence, read inside the person's own RLS context.
  const prep = await withTenant(tenant(ctx), async (tx) => {
    const s = await editable(ctx, tx, data.sessionId, "troubleshoot.ask");
    if (s.status !== "OPEN") throw new ValidationError("Closed sessions are read-only. Reopen it first.");
    const settings = await tx.aiSettings.findUnique({ where: { organizationId: ctx.organization.id } });
    if (!settings?.enabled) return { stop: "DISABLED" as const };
    if (!provider) return { stop: "NOT_CONFIGURED" as const };
    const limit = await usageCheck(tx, ctx, now);
    const entries = await tx.troubleshootingEntry.findMany({
      where: { sessionId: s.id, kind: { in: ["OBSERVATION", "TEST", "NOTE"] } },
      orderBy: { createdAt: "asc" },
      take: 40,
      select: { kind: true, text: true, testName: true, result: true },
    });
    const evidence = await recordFacts(tx, s, ctx);
    const question = data.question ?? "What are the possible causes of this fault and what should be checked next?";
    // The default question adds no evidence, so only a question the engineer typed is searched.
    const searchText = [
      s.faultDescription,
      s.symptoms,
      s.alarms,
      s.operatingConditions,
      s.errorCodes.join(" "),
      data.question,
      ...entries.map((e) => e.text),
    ]
      .filter(Boolean)
      .join("\n");
    const passages = limit ? [] : await retrievePassages(ctx, tx, evidence.asset, searchText, s.errorCodes);
    return { stop: null, limit, s, entries, evidence, question, passages };
  });
  if (prep.stop) return { status: prep.stop, message: STATUS_MESSAGES[prep.stop] };
  const { s, entries, evidence, question, passages } = prep;

  const save = (
    status: "SUCCEEDED" | "NO_SOURCES" | "RATE_LIMITED" | "TIMEOUT" | "FAILED" | "INVALID_RESPONSE",
    extra: Partial<Prisma.AiRequestUncheckedCreateInput> = {},
  ) =>
    withTenant(tenant(ctx), async (tx) => {
      const row = await tx.aiRequest.create({
        data: {
          organizationId: ctx.organization.id,
          sessionId: s.id,
          requestedById: ctx.user.id,
          provider: provider!.name,
          model: provider!.model,
          promptVersion: PROMPT_VERSION,
          status,
          question: question.slice(0, 4000),
          unverifiedAllowed: data.allowUnverified,
          retrievedChunkIds: passages.map((p) => p.chunkId),
          ...extra,
        },
        select: { id: true },
      });
      await tsAudit(tx, ctx, "troubleshoot.ai_requested", s.id, {
        requestId: row.id,
        status,
        provider: provider!.name,
        model: provider!.model,
        passages: passages.length,
        errorCode: extra.errorCode ?? null,
      });
      return row.id;
    });

  if (prep.limit) {
    const id = await save("RATE_LIMITED", { errorCode: prep.limit });
    return { status: "RATE_LIMITED", message: STATUS_MESSAGES.RATE_LIMITED, requestId: id };
  }
  if (!passages.length && !data.allowUnverified) {
    const id = await save("NO_SOURCES");
    return { status: "NO_SOURCES", message: STATUS_MESSAGES.NO_SOURCES, requestId: id };
  }

  // 2. The request: only the minimum, with e-mail addresses and long numbers removed.
  const factLines = evidence.facts
    .filter((f) => !f.label.startsWith("Confirmed on"))
    .map((f) => redact(`${f.label}: ${f.text}`));
  for (const f of evidence.facts.filter((x) => x.label.startsWith("Confirmed on")))
    factLines.push(redact(`Previously confirmed root cause on this model: ${f.text}`));
  if (evidence.undocumented.length)
    factLines.push(`Error codes with no documented meaning in the knowledge base: ${evidence.undocumented.join(", ")}`);
  const observations = [
    `Reported fault: ${s.faultDescription}`,
    s.symptoms ? `Symptoms: ${s.symptoms}` : null,
    s.errorCodes.length ? `Displayed error codes: ${s.errorCodes.join(", ")}` : null,
    s.alarms ? `Alarms: ${s.alarms}` : null,
    s.operatingConditions ? `Operating conditions: ${s.operatingConditions}` : null,
    ...entries.map((e) =>
      e.kind === "TEST"
        ? `Test "${e.testName}": ${e.result ? TS_RESULT_LABELS[e.result] : ""} — ${e.text}`
        : `${e.kind === "NOTE" ? "Note" : "Observation"}: ${e.text}`,
    ),
  ]
    .filter((x): x is string => Boolean(x))
    .map(redact);
  const promptPassages: PromptPassage[] = passages.map((p) => ({
    label: p.label,
    title: p.title,
    page: p.page,
    heading: p.heading,
    content: redact(p.content),
  }));
  const user = buildUserPrompt({
    facts: factLines,
    observations,
    passages: promptPassages,
    question: redact(question),
  });

  const limits = aiLimits();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), limits.timeoutMs);
  const started = Date.now();
  let completion;
  try {
    completion = await provider!.complete({
      system: SYSTEM_PROMPT,
      user,
      maxTokens: limits.maxOutputTokens,
      signal: controller.signal,
    });
  } catch (error) {
    const timedOut = controller.signal.aborted || (error instanceof AiProviderError && error.timeout);
    const code = error instanceof AiProviderError ? error.code : "provider_error";
    if (!(error instanceof AiProviderError))
      console.error("[BiomedIntel.ai] AI provider error", (error as Error)?.name);
    const id = await save(timedOut ? "TIMEOUT" : "FAILED", {
      errorCode: timedOut ? "timeout" : code.slice(0, 80),
      latencyMs: Date.now() - started,
    });
    return {
      status: timedOut ? "TIMEOUT" : "FAILED",
      message: STATUS_MESSAGES[timedOut ? "TIMEOUT" : "FAILED"],
      requestId: id,
    };
  } finally {
    clearTimeout(timer);
  }
  const latencyMs = Date.now() - started;
  const usage = { inputTokens: completion.inputTokens, outputTokens: completion.outputTokens, latencyMs };

  // 3. Check the answer: format, citations, decision wording, percentages.
  const labels = new Set(passages.map((p) => p.label));
  const checked = checkAnswer(completion.text, labels);
  if (!checked) {
    const id = await save("INVALID_RESPONSE", {
      ...usage,
      errorCode: completion.stopReason === "max_tokens" ? "truncated" : "invalid_format",
    });
    return { status: "INVALID_RESPONSE", message: STATUS_MESSAGES.INVALID_RESPONSE, requestId: id };
  }
  const answerText = checked.causes.flatMap((c) => [c.cause, ...c.nextSteps, ...c.safetyNotes]).join("\n");
  const hazards: HazardKey[] = hazardFlags(
    s.faultDescription,
    s.symptoms,
    s.alarms,
    ...entries.map((e) => e.text),
    ...passages.map((p) => p.content),
    answerText,
  );
  const flags = [
    ...checked.flags,
    ...hazards.map((h) => `hazard:${h}`),
    ...(evidence.safetyCritical ? ["safety_critical_device"] : []),
  ];

  // 4. Save the request, the suggestions and their citations together.
  const requestId = await withTenant(tenant(ctx), async (tx) => {
    const req = await tx.aiRequest.create({
      data: {
        organizationId: ctx.organization.id,
        sessionId: s.id,
        requestedById: ctx.user.id,
        provider: provider!.name,
        model: provider!.model,
        promptVersion: PROMPT_VERSION,
        status: "SUCCEEDED",
        question: question.slice(0, 4000),
        unverifiedAllowed: data.allowUnverified,
        retrievedChunkIds: passages.map((p) => p.chunkId),
        safetyFlags: flags,
        answer: JSON.parse(
          JSON.stringify({
            missingInformation: checked.missingInformation,
            clarifyingQuestions: checked.clarifyingQuestions,
            facts: evidence.facts.map((f) => ({ label: f.label, text: f.text })),
            undocumentedCodes: evidence.undocumented,
            passages: passages.map((p) => ({
              label: p.label,
              chunkId: p.chunkId,
              documentId: p.documentId,
              versionId: p.versionId,
              title: p.title,
              page: p.page,
            })),
            isMock: provider!.isMock,
            configuredModel: config.model,
          }),
        ),
        ...usage,
      },
      select: { id: true },
    });
    for (const [i, c] of checked.causes.entries()) {
      const sug = await tx.aiSuggestion.create({
        data: {
          organizationId: ctx.organization.id,
          sessionId: s.id,
          requestId: req.id,
          ordinal: i + 1,
          cause: c.cause.slice(0, 1000),
          supportingObservations: c.supportingObservations,
          nextSteps: c.evidence === "UNVERIFIED" ? [...c.nextSteps, UNVERIFIED_NOTE] : c.nextSteps,
          toolsQualifications: c.toolsQualifications,
          safetyNotes: c.safetyNotes,
          confirmRuleOut: c.confirmRuleOut,
          evidence: c.evidence,
        },
        select: { id: true },
      });
      const cited = passages.filter((p) => c.citations.includes(p.label));
      if (cited.length) {
        await tx.aiCitation.createMany({
          data: cited.map((p) => ({
            organizationId: ctx.organization.id,
            suggestionId: sug.id,
            chunkId: p.chunkId,
            documentId: p.documentId,
            versionId: p.versionId,
            pageFrom: p.page,
            pageTo: p.page,
          })),
        });
      }
    }
    await tsAudit(tx, ctx, "troubleshoot.ai_requested", s.id, {
      requestId: req.id,
      status: "SUCCEEDED",
      provider: provider!.name,
      model: provider!.model,
      passages: passages.length,
      suggestions: checked.causes.length,
      flags,
    });
    return req.id;
  });
  return { status: "SUCCEEDED", message: STATUS_MESSAGES.SUCCEEDED, requestId };
}

// ─── AI settings and usage ───────────────────────────────────────────────────

export async function getAiOverview(ctx: AccessContext, now = new Date()) {
  if (!can(ctx, "ai.usage") && !can(ctx, "ai.settings"))
    throw new AuthorizationError("ai.usage", "Your role does not include AI settings.");
  return withTenant(tenant(ctx), async (tx) => {
    const settings = await tx.aiSettings.findUnique({ where: { organizationId: ctx.organization.id } });
    const month = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const byStatus = await tx.aiRequest.groupBy({
      by: ["status"],
      where: { createdAt: { gte: month } },
      _count: { _all: true },
      _sum: { inputTokens: true, outputTokens: true },
    });
    const names = settings?.changedById ? await peopleNames(tx, [settings.changedById]) : {};
    return { settings, config: aiConfig(), limits: aiLimits(), byStatus, names, canChange: can(ctx, "ai.settings") };
  });
}

export async function setAiEnabled(ctx: AccessContext, input: { enabled?: unknown }) {
  await requirePermission(ctx, "ai.settings", { entityType: "ai_settings" });
  const enabled = input?.enabled === true || input?.enabled === "on" || input?.enabled === "true";
  return withTenant(tenant(ctx), async (tx) => {
    await tx.aiSettings.upsert({
      where: { organizationId: ctx.organization.id },
      create: { organizationId: ctx.organization.id, enabled, changedById: ctx.user.id, changedAt: new Date() },
      update: { enabled, changedById: ctx.user.id, changedAt: new Date() },
    });
    await audit(tx, {
      organizationId: ctx.organization.id,
      actorUserId: ctx.user.id,
      action: enabled ? "ai.enabled" : "ai.disabled",
      entityType: "ai_settings",
      entityId: ctx.organization.id,
      metadata: { provider: aiConfig().provider },
      request: ctx.request,
    });
  });
}
