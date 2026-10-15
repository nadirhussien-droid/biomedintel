// Equipment lifecycle (Stage 8).
//
// No second status system: the asset keeps its one operational status
// (Stage 4) and its safety hold (Stage 6). The "lifecycle stage" shown here is
// WORKED OUT from those records, in this order of priority:
//   decommissioned → failed safety test hold → decommission awaiting decision
//   → under repair → awaiting assessment (out of service with a fault report
//   not yet started) → temporarily unavailable → awaiting replacement review
//   → awaiting commissioning (commissioning date in the future) → in service.
//
// The history is assembled from records that already exist (status changes,
// work orders, safety holds, warranties and claims, lifecycle events and the
// audit log), so nothing is stored twice.
//
// Lifecycle actions here never change the operational status: a replacement
// review or a disposal record cannot put a device back in use, and the
// database refuses to move a decommissioned device out of DECOMMISSIONED.
import type { Prisma } from "../db/generated/client";
import { withTenant, type Tx } from "../db/tenant";
import { audit } from "../audit/audit";
import { can, requirePermission, type AccessContext } from "../authz/access";
import { ValidationError } from "../authz/errors";
import { checkViolationMessage, isUniqueViolation, parseInput } from "../validation";
import { activeSupplierId, assetScopeWhere, loadScopedAsset } from "./assets";
import { peopleNames } from "./work-order-core";
import { readSettings, tenant } from "./inventory";
import { addDays, localToday, toDbDate } from "@/lib/pm/dates";
import { WORK_TYPE_LABELS, DO_NOT_USE_LABEL } from "@/lib/validation/pm";
import { STATUS_LABELS, type AssetStatusValue } from "@/lib/validation/assets";
import {
  assetSupplierSchema,
  CLAIM_STATUS_LABELS,
  DISPOSAL_LABELS,
  disposalSchema,
  lifecycleReviewSchema,
  REPLACEMENT_REVIEW_LABELS,
  type ClaimStatusValue,
} from "@/lib/validation/inventory";

const iso = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : null);

export type LifecycleStage = { key: string; label: string; tone: "ok" | "warn" | "danger" | "neutral" };

export function lifecycleStage(input: {
  status: string;
  commissionedOn: string | null;
  replacementReview: string | null;
  openHold: boolean;
  pendingDecommission: boolean;
  faultAwaitingAssessment: boolean;
  today: string;
}): LifecycleStage {
  if (input.status === "DECOMMISSIONED") return { key: "decommissioned", label: "Decommissioned", tone: "neutral" };
  if (input.openHold) return { key: "safety_hold", label: DO_NOT_USE_LABEL, tone: "danger" };
  if (input.pendingDecommission)
    return { key: "decommission_pending", label: "Decommissioning awaiting decision", tone: "warn" };
  if (input.status === "UNDER_REPAIR") return { key: "under_repair", label: "Under repair", tone: "warn" };
  if (input.status === "OUT_OF_SERVICE")
    return input.faultAwaitingAssessment
      ? { key: "awaiting_assessment", label: "Awaiting assessment", tone: "warn" }
      : { key: "unavailable", label: "Temporarily unavailable", tone: "warn" };
  if (input.replacementReview === "DUE" || input.replacementReview === "IN_REVIEW")
    return { key: "replacement_review", label: "Awaiting replacement review", tone: "warn" };
  if (input.commissionedOn && input.commissionedOn > input.today)
    return { key: "awaiting_commissioning", label: "Awaiting commissioning", tone: "neutral" };
  return { key: "in_service", label: "In service", tone: "ok" };
}

export type HistoryEntry = {
  at: Date;
  dateOnly?: boolean;
  kind: string;
  title: string;
  detail?: string | null;
  by?: string | null;
  href?: string;
};

const AUDIT_TITLES: Record<string, string> = {
  "asset.created": "Added to the register",
  "asset.reassigned": "Transferred to another hospital or department",
  "asset.location_changed": "Location changed",
  "asset.updated": "Details updated",
  "asset.risk_changed": "Risk category changed",
  "asset.archived": "Archived",
  "asset.restored": "Restored from archive",
  "asset.barcode_replaced": "Label barcode replaced",
  "warranty.updated": "Warranty / contract updated",
  "warranty.archived": "Warranty / contract archived",
  "lifecycle.supplier_linked": "Supplier recorded",
};

async function stageFor(
  tx: Tx,
  asset: { id: string; status: string; commissionedAt: Date | null; replacementReview: string | null },
  today: string,
) {
  const [hold, pending, fault] = await Promise.all([
    tx.safetyHold.count({ where: { assetId: asset.id, status: { not: "RELEASED" } } }),
    tx.lifecycleEvent.count({ where: { assetId: asset.id, eventType: "DECOMMISSION", status: "PENDING" } }),
    tx.workOrder.count({ where: { assetId: asset.id, type: "CORRECTIVE", status: { in: ["REQUESTED", "ASSIGNED"] } } }),
  ]);
  return lifecycleStage({
    status: asset.status,
    commissionedOn: iso(asset.commissionedAt),
    replacementReview: asset.replacementReview,
    openHold: hold > 0,
    pendingDecommission: pending > 0,
    faultAwaitingAssessment: fault > 0,
    today,
  });
}

export async function getAssetLifecycle(ctx: AccessContext, assetId: string) {
  await requirePermission(ctx, "asset.view", { entityType: "asset" });
  return withTenant(tenant(ctx), async (tx) => {
    const scoped = await loadScopedAsset(ctx, tx, assetId, "lifecycle.view");
    const a = await tx.asset.findUniqueOrThrow({
      where: { id: scoped.id },
      select: {
        id: true,
        assetTag: true,
        status: true,
        supplier: true,
        purchaseDate: true,
        commissionedAt: true,
        eolDate: true,
        lifecycleReviewOn: true,
        replacementReview: true,
        createdAt: true,
        hospital: { select: { timezone: true } },
        model: { select: { expectedLifeYears: true } },
        supplierRef: { select: { id: true, name: true } },
      },
    });
    const today = localToday(a.hospital.timezone);
    const stage = await stageFor(tx, a, today);
    const acquired = a.purchaseDate ?? a.commissionedAt;
    const expectedEnd =
      acquired && a.model.expectedLifeYears
        ? new Date(
            Date.UTC(
              acquired.getUTCFullYear() + a.model.expectedLifeYears,
              acquired.getUTCMonth(),
              acquired.getUTCDate(),
            ),
          )
        : null;
    const decommission = await tx.lifecycleEvent.findFirst({
      where: { assetId: a.id, eventType: "DECOMMISSION", status: "APPROVED" },
      orderBy: { decidedAt: "desc" },
      select: { reason: true, effectiveOn: true, decidedAt: true },
    });
    const disposal = await tx.lifecycleEvent.findFirst({
      where: { assetId: a.id, eventType: "DISPOSAL" },
      select: {
        disposalMethod: true,
        effectiveOn: true,
        reference: true,
        reason: true,
        requestedById: true,
        createdAt: true,
      },
    });
    const history = can(ctx, "asset.view") ? await assetHistory(ctx, tx, a.id, a) : [];
    return {
      asset: a,
      today,
      stage,
      expectedEnd: iso(expectedEnd),
      decommission,
      disposal,
      history,
      allowed: {
        review: can(ctx, "lifecycle.manage") && a.status !== "DECOMMISSIONED",
        dispose: can(ctx, "lifecycle.manage") && a.status === "DECOMMISSIONED" && !disposal,
        supplier: can(ctx, "asset.edit") && a.status !== "DECOMMISSIONED",
      },
    };
  });
}

async function assetHistory(
  ctx: AccessContext,
  tx: Tx,
  assetId: string,
  a: { purchaseDate: Date | null; commissionedAt: Date | null; createdAt: Date },
): Promise<HistoryEntry[]> {
  const [statuses, events, warranties, claimEvents, workOrders, holds, audits] = await Promise.all([
    tx.assetStatusHistory.findMany({ where: { assetId }, orderBy: { createdAt: "desc" }, take: 200 }),
    tx.lifecycleEvent.findMany({ where: { assetId }, orderBy: { createdAt: "desc" }, take: 100 }),
    tx.warranty.findMany({
      where: { assetId },
      select: {
        id: true,
        kind: true,
        provider: true,
        startsOn: true,
        endsOn: true,
        createdAt: true,
        createdById: true,
      },
    }),
    tx.warrantyClaimEvent.findMany({
      where: { claim: { assetId } },
      orderBy: { createdAt: "desc" },
      take: 100,
      select: {
        toStatus: true,
        note: true,
        actorId: true,
        createdAt: true,
        claim: { select: { claimReference: true, warranty: { select: { provider: true } } } },
      },
    }),
    tx.workOrder.findMany({
      where: { assetId },
      orderBy: { createdAt: "desc" },
      take: 200,
      select: {
        id: true,
        number: true,
        type: true,
        status: true,
        outcome: true,
        createdAt: true,
        completedAt: true,
        reportedById: true,
        completedById: true,
      },
    }),
    tx.safetyHold.findMany({
      where: { assetId },
      select: { id: true, placedAt: true, placedById: true, releasedAt: true, releasedById: true },
    }),
    tx.auditLog.findMany({
      where: { entityType: "asset", entityId: assetId, action: { in: Object.keys(AUDIT_TITLES) } },
      orderBy: { createdAt: "desc" },
      take: 200,
      select: { action: true, actorUserId: true, createdAt: true, metadata: true },
    }),
  ]);
  const out: HistoryEntry[] = [];
  if (a.purchaseDate) out.push({ at: a.purchaseDate, dateOnly: true, kind: "lifecycle", title: "Purchased" });
  if (a.commissionedAt) out.push({ at: a.commissionedAt, dateOnly: true, kind: "lifecycle", title: "Commissioned" });
  for (const s of statuses)
    out.push({
      at: s.createdAt,
      kind: "status",
      title: `Status: ${s.fromStatus ? STATUS_LABELS[s.fromStatus as AssetStatusValue] + " → " : ""}${STATUS_LABELS[s.toStatus as AssetStatusValue]}`,
      detail: s.reason,
      by: s.changedById,
      href: s.workOrderId ? `/work-orders/${s.workOrderId}` : undefined,
    });
  for (const e of events) {
    if (e.eventType === "DECOMMISSION") {
      out.push({
        at: e.createdAt,
        kind: "lifecycle",
        title: "Decommissioning requested",
        detail: e.reason,
        by: e.requestedById,
      });
      if (e.decidedAt)
        out.push({
          at: e.decidedAt,
          kind: "lifecycle",
          title:
            e.status === "APPROVED"
              ? "Decommissioning approved"
              : e.status === "REJECTED"
                ? "Decommissioning rejected"
                : "Decommissioning request closed",
          detail: e.decisionNote,
          by: e.decidedById,
        });
    } else if (e.eventType === "REPLACEMENT_REVIEW") {
      out.push({
        at: e.createdAt,
        kind: "lifecycle",
        title: `Replacement review: ${REPLACEMENT_REVIEW_LABELS[e.reviewOutcome as keyof typeof REPLACEMENT_REVIEW_LABELS] ?? e.reviewOutcome}`,
        detail: e.reason,
        by: e.requestedById,
      });
    } else if (e.eventType === "DISPOSAL") {
      out.push({
        at: e.effectiveOn ?? e.createdAt,
        dateOnly: Boolean(e.effectiveOn),
        kind: "lifecycle",
        title: `Disposal recorded: ${DISPOSAL_LABELS[e.disposalMethod as keyof typeof DISPOSAL_LABELS] ?? e.disposalMethod}`,
        detail: [e.reason, e.reference ? `Ref. ${e.reference}` : null].filter(Boolean).join(" · "),
        by: e.requestedById,
      });
    }
  }
  for (const w of warranties) {
    const label = w.kind === "WARRANTY" ? "Warranty" : "Service contract";
    out.push({
      at: w.createdAt,
      kind: "warranty",
      title: `${label} recorded: ${w.provider}`,
      detail: `${iso(w.startsOn) ?? "?"} to ${iso(w.endsOn)}`,
      by: w.createdById,
    });
  }
  for (const c of claimEvents)
    out.push({
      at: c.createdAt,
      kind: "warranty",
      title: `Warranty claim (${c.claim.warranty.provider}): ${CLAIM_STATUS_LABELS[c.toStatus as ClaimStatusValue]}`,
      detail: [c.claim.claimReference ? `Ref. ${c.claim.claimReference}` : null, c.note].filter(Boolean).join(" · "),
      by: c.actorId,
    });
  for (const w of workOrders) {
    const label = WORK_TYPE_LABELS[w.type] ?? w.type;
    out.push({
      at: w.createdAt,
      kind: "maintenance",
      title: `${w.number} opened: ${label}`,
      by: w.reportedById,
      href: `/work-orders/${w.id}`,
    });
    if (w.completedAt)
      out.push({
        at: w.completedAt,
        kind: "maintenance",
        title: `${w.number} signed off${w.outcome ? ` (${w.outcome.replaceAll("_", " ").toLowerCase()})` : ""}`,
        by: w.completedById,
        href: `/work-orders/${w.id}`,
      });
  }
  for (const h of holds) {
    out.push({
      at: h.placedAt,
      kind: "safety",
      title: `Safety hold placed: ${DO_NOT_USE_LABEL}`,
      by: h.placedById,
      href: `/maintenance/holds/${h.id}`,
    });
    if (h.releasedAt)
      out.push({
        at: h.releasedAt,
        kind: "safety",
        title: "Safety hold released by a second person",
        by: h.releasedById,
        href: `/maintenance/holds/${h.id}`,
      });
  }
  for (const l of audits) {
    const changed = (l.metadata as { changed?: string[] } | null)?.changed;
    out.push({
      at: l.createdAt,
      kind: l.action.startsWith("warranty")
        ? "warranty"
        : l.action === "asset.reassigned" || l.action === "asset.location_changed"
          ? "transfer"
          : "record",
      title: AUDIT_TITLES[l.action] ?? l.action,
      detail: Array.isArray(changed) && changed.length ? `Fields: ${changed.join(", ")}` : null,
      by: l.actorUserId,
    });
  }
  out.sort((x, y) => y.at.getTime() - x.at.getTime());
  // Warranty and claim entries only for roles that may see warranties.
  const visible = can(ctx, "warranty.view") ? out : out.filter((e) => e.kind !== "warranty");
  const names = await peopleNames(
    tx,
    visible.map((e) => e.by),
  );
  return visible.slice(0, 400).map((e) => ({ ...e, by: e.by ? (names[e.by] ?? "Unknown") : null }));
}

// ─── Actions ─────────────────────────────────────────────────────────────────

function lifecycleAudit(
  tx: Tx,
  ctx: AccessContext,
  action: string,
  assetId: string,
  metadata: Record<string, unknown>,
) {
  return audit(tx, {
    organizationId: ctx.organization.id,
    actorUserId: ctx.user.id,
    action,
    entityType: "asset",
    entityId: assetId,
    metadata,
    request: ctx.request,
  });
}

/** Records a replacement review decision and the next lifecycle review date. Never changes the device status. */
export async function recordReplacementReview(ctx: AccessContext, input: unknown) {
  await requirePermission(ctx, "lifecycle.manage", { entityType: "asset" });
  const data = parseInput(lifecycleReviewSchema, input);
  return withTenant(tenant(ctx), async (tx) => {
    const asset = await loadScopedAsset(ctx, tx, data.assetId, "lifecycle.review");
    if (asset.archivedAt) throw new ValidationError("This asset is archived.");
    if (asset.status === "DECOMMISSIONED") throw new ValidationError("Decommissioned assets are read-only.");
    const h = await tx.hospital.findUnique({ where: { id: asset.hospitalId }, select: { timezone: true } });
    const today = localToday(h?.timezone ?? "UTC");
    if (data.nextReviewOn && data.nextReviewOn < today) {
      throw new ValidationError("The next review date cannot be in the past.", { nextReviewOn: ["In the past"] });
    }
    await tx.asset.update({
      where: { id: asset.id },
      data: {
        replacementReview: data.outcome,
        lifecycleReviewOn: data.nextReviewOn ? toDbDate(data.nextReviewOn) : null,
        updatedById: ctx.user.id,
      },
    });
    await tx.lifecycleEvent.create({
      data: {
        organizationId: ctx.organization.id,
        assetId: asset.id,
        eventType: "REPLACEMENT_REVIEW",
        status: "RECORDED",
        reviewOutcome: data.outcome,
        reason: data.reason,
        effectiveOn: toDbDate(today),
        requestedById: ctx.user.id,
        decidedAt: new Date(),
      },
    });
    await lifecycleAudit(tx, ctx, "lifecycle.review_recorded", asset.id, {
      assetTag: asset.assetTag,
      outcome: data.outcome,
      nextReviewOn: data.nextReviewOn,
    });
  });
}

/** Records what happened to a decommissioned device (disposal or transfer out). Once per device. */
export async function recordDisposal(ctx: AccessContext, input: unknown) {
  await requirePermission(ctx, "lifecycle.manage", { entityType: "asset" });
  const data = parseInput(disposalSchema, input);
  try {
    return await withTenant(tenant(ctx), async (tx) => {
      const asset = await loadScopedAsset(ctx, tx, data.assetId, "lifecycle.disposal");
      if (asset.status !== "DECOMMISSIONED") {
        throw new ValidationError(
          "Disposal can only be recorded after the device has been decommissioned (with approval).",
        );
      }
      const h = await tx.hospital.findUnique({ where: { id: asset.hospitalId }, select: { timezone: true } });
      const today = localToday(h?.timezone ?? "UTC");
      if (data.effectiveOn > today)
        throw new ValidationError("The disposal date cannot be in the future.", { effectiveOn: ["In the future"] });
      const decom = await tx.lifecycleEvent.findFirst({
        where: { assetId: asset.id, eventType: "DECOMMISSION", status: "APPROVED" },
        orderBy: { decidedAt: "desc" },
        select: { decidedAt: true, effectiveOn: true },
      });
      const decomDay = iso(decom?.effectiveOn ?? decom?.decidedAt ?? null);
      if (decomDay && data.effectiveOn < decomDay) {
        throw new ValidationError(`The disposal date cannot be before decommissioning (${decomDay}).`, {
          effectiveOn: ["Before decommissioning"],
        });
      }
      await tx.lifecycleEvent.create({
        data: {
          organizationId: ctx.organization.id,
          assetId: asset.id,
          eventType: "DISPOSAL",
          status: "RECORDED",
          disposalMethod: data.method,
          reference: data.reference,
          reason: data.reason,
          effectiveOn: toDbDate(data.effectiveOn),
          requestedById: ctx.user.id,
          decidedAt: new Date(),
        },
      });
      await lifecycleAudit(tx, ctx, "lifecycle.disposal_recorded", asset.id, {
        assetTag: asset.assetTag,
        method: data.method,
        effectiveOn: data.effectiveOn,
      });
    });
  } catch (error) {
    if (isUniqueViolation(error)) throw new ValidationError("A disposal is already recorded for this device.");
    if (checkViolationMessage(error))
      throw new ValidationError("Disposal can only be recorded for a decommissioned device.");
    throw error;
  }
}

/** Links the asset to a supplier in the register (the Stage 4 free-text supplier is kept). */
export async function setAssetSupplier(ctx: AccessContext, input: unknown) {
  await requirePermission(ctx, "asset.edit", { entityType: "asset" });
  const data = parseInput(assetSupplierSchema, input);
  return withTenant(tenant(ctx), async (tx) => {
    const asset = await loadScopedAsset(ctx, tx, data.assetId, "lifecycle.supplier");
    if (asset.archivedAt) throw new ValidationError("This asset is archived.");
    if (asset.status === "DECOMMISSIONED") throw new ValidationError("Decommissioned assets are read-only.");
    const supplierId = data.supplierId ? await activeSupplierId(tx, data.supplierId) : null;
    await tx.asset.update({ where: { id: asset.id }, data: { supplierId, updatedById: ctx.user.id } });
    await lifecycleAudit(tx, ctx, "lifecycle.supplier_linked", asset.id, { assetTag: asset.assetTag, supplierId });
  });
}

// ─── Lists (reports and reminders) ───────────────────────────────────────────

/** Assets whose lifecycle review is due (or flagged), and decommissioned assets with their disposal status. */
export async function lifecycleLists(ctx: AccessContext) {
  await requirePermission(ctx, "analytics.view", { entityType: "analytics" });
  return withTenant(tenant(ctx), async (tx) => {
    const settings = await readSettings(tx, ctx.organization.id);
    const id = ctx.hospitals[0]?.id;
    const h = id ? await tx.hospital.findUnique({ where: { id }, select: { timezone: true } }) : null;
    const today = localToday(h?.timezone ?? "UTC");
    const until = toDbDate(addDays(today, settings.lifecycleReviewLeadDays));
    const scope: Prisma.AssetWhereInput = { AND: [assetScopeWhere(ctx), { archivedAt: null }] };
    const [reviews, decommissioned] = await Promise.all([
      tx.asset.findMany({
        where: {
          AND: [
            scope,
            { status: { not: "DECOMMISSIONED" } },
            { OR: [{ lifecycleReviewOn: { lte: until } }, { replacementReview: { in: ["DUE", "IN_REVIEW"] } }] },
          ],
        },
        orderBy: [{ lifecycleReviewOn: { sort: "asc", nulls: "last" } }, { assetTag: "asc" }],
        take: 200,
        select: {
          id: true,
          assetTag: true,
          name: true,
          lifecycleReviewOn: true,
          replacementReview: true,
          hospital: { select: { code: true } },
        },
      }),
      tx.asset.findMany({
        where: { AND: [assetScopeWhere(ctx), { status: "DECOMMISSIONED" }] },
        orderBy: { updatedAt: "desc" },
        take: 200,
        select: {
          id: true,
          assetTag: true,
          name: true,
          hospital: { select: { code: true } },
          lifecycleEvents: {
            where: { OR: [{ eventType: "DISPOSAL" }, { eventType: "DECOMMISSION", status: "APPROVED" }] },
            select: { eventType: true, effectiveOn: true, decidedAt: true, reason: true, disposalMethod: true },
          },
        },
      }),
    ]);
    return {
      today,
      leadDays: settings.lifecycleReviewLeadDays,
      reviews: reviews.map((r) => ({ ...r, overdue: r.lifecycleReviewOn ? iso(r.lifecycleReviewOn)! < today : false })),
      decommissioned: decommissioned.map((d) => {
        const decom = d.lifecycleEvents.find((e) => e.eventType === "DECOMMISSION");
        const disp = d.lifecycleEvents.find((e) => e.eventType === "DISPOSAL");
        return {
          id: d.id,
          assetTag: d.assetTag,
          name: d.name,
          hospital: d.hospital.code,
          decommissionedOn: iso(decom?.effectiveOn ?? decom?.decidedAt ?? null),
          reason: decom?.reason ?? null,
          disposal: disp ? (DISPOSAL_LABELS[disp.disposalMethod as keyof typeof DISPOSAL_LABELS] ?? null) : null,
          disposedOn: iso(disp?.effectiveOn ?? null),
        };
      }),
    };
  });
}
