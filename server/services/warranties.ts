// Warranties, service contracts and warranty claims (Stage 8).
//
// What BiomedIntel.ai does and does not say:
//   • A warranty's state (active / expiring / expired) comes only from the
//     recorded dates. It never says a repair IS covered: coverage is decided
//     by the supplier, so the screens say "on record" and show what was
//     recorded about parts and labour, and "not recorded" where nothing was.
//   • A claim's status is what actually happened, entered by an authorised
//     person with the evidence supplied. Decided claims are final; every
//     change is kept in the claim history (append-only) and audited.
import type { Prisma } from "../db/generated/client";
import { withTenant, type Tx } from "../db/tenant";
import { audit } from "../audit/audit";
import { can, requirePermission, type AccessContext } from "../authz/access";
import { NotFoundError, ValidationError } from "../authz/errors";
import { parseInput } from "../validation";
import { activeSupplierId, assetScopeWhere, loadScopedAsset } from "./assets";
import { peopleNames } from "./work-order-core";
import { workOrderScopeWhere } from "./work-orders";
import { readSettings, tenant } from "./inventory";
import { addDays, localToday, toDbDate, type DateOnly } from "@/lib/pm/dates";
import {
  CLAIM_STATUS_LABELS,
  CLAIM_TRANSITIONS,
  claimCreateSchema,
  claimStatusSchema,
  warrantyUpdateSchema,
  type ClaimStatusValue,
} from "@/lib/validation/inventory";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const iso = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : null);

export type WarrantyState = "not_started" | "active" | "expiring" | "expired";
export const WARRANTY_STATE_LABELS: Record<WarrantyState, string> = {
  not_started: "Not started yet",
  active: "Active",
  expiring: "Expiring soon",
  expired: "Expired",
};

/** State from the recorded dates only. `warnDays` = the largest reminder threshold. */
export function warrantyState(
  startsOn: DateOnly | null,
  endsOn: DateOnly,
  today: DateOnly,
  warnDays: number,
): WarrantyState {
  if (endsOn < today) return "expired";
  if (startsOn && startsOn > today) return "not_started";
  if (endsOn <= addDays(today, warnDays)) return "expiring";
  return "active";
}

async function orgToday(ctx: AccessContext, tx: Tx) {
  const id = ctx.hospitals[0]?.id;
  const h = id ? await tx.hospital.findUnique({ where: { id }, select: { timezone: true } }) : null;
  return localToday(h?.timezone ?? "UTC");
}

// ─── Lists ───────────────────────────────────────────────────────────────────

export const WARRANTY_VIEWS = ["active", "expiring", "expired", "missing", "contracts", "claims"] as const;
export type WarrantyView = (typeof WARRANTY_VIEWS)[number];

export async function listWarranties(ctx: AccessContext, raw: { view?: string; page?: string } = {}) {
  await requirePermission(ctx, "warranty.view", { entityType: "warranty" });
  const view: WarrantyView = (WARRANTY_VIEWS as readonly string[]).includes(raw.view ?? "")
    ? (raw.view as WarrantyView)
    : "expiring";
  const page = Math.max(1, Math.min(10000, Number(raw.page) || 1));
  const PAGE = 50;
  return withTenant(tenant(ctx), async (tx) => {
    const settings = await readSettings(tx, ctx.organization.id);
    const today = await orgToday(ctx, tx);
    const warnDays = Math.max(...settings.warrantyReminderDays, ...settings.contractReminderDays);
    const t = toDbDate(today);
    const warn = toDbDate(addDays(today, warnDays));
    const assetScope = { ...assetScopeWhere(ctx), archivedAt: null };
    const counts = {
      active: await tx.warranty.count({
        where: {
          archivedAt: null,
          asset: assetScope,
          endsOn: { gt: warn },
          OR: [{ startsOn: null }, { startsOn: { lte: t } }],
        },
      }),
      expiring: await tx.warranty.count({
        where: { archivedAt: null, asset: assetScope, endsOn: { gte: t, lte: warn } },
      }),
      expired: await tx.warranty.count({
        where: { archivedAt: null, asset: { ...assetScope, status: { not: "DECOMMISSIONED" } }, endsOn: { lt: t } },
      }),
      missing: await tx.asset.count({
        where: {
          AND: [assetScope, { status: { not: "DECOMMISSIONED" } }, { warranties: { none: { archivedAt: null } } }],
        },
      }),
      contracts: await tx.warranty.count({
        where: { archivedAt: null, kind: "SERVICE_CONTRACT", asset: assetScope, endsOn: { gte: t } },
      }),
      claims: await tx.warrantyClaim.count({
        where: { asset: assetScopeWhere(ctx), status: { in: ["DRAFT", "SUBMITTED"] } },
      }),
    };
    const select = {
      id: true,
      kind: true,
      provider: true,
      reference: true,
      startsOn: true,
      endsOn: true,
      coversParts: true,
      coversLabour: true,
      responseTargetHours: true,
      supplier: { select: { id: true, name: true } },
      asset: { select: { id: true, assetTag: true, name: true, hospital: { select: { code: true } } } },
    } satisfies Prisma.WarrantySelect;
    let rows: Prisma.WarrantyGetPayload<{ select: typeof select }>[] = [];
    let missing: { id: string; assetTag: string; name: string; status: string; hospital: { code: string } }[] = [];
    let claims: Awaited<ReturnType<typeof claimList>> = [];
    let total = 0;
    if (view === "missing") {
      const where: Prisma.AssetWhereInput = {
        AND: [assetScope, { status: { not: "DECOMMISSIONED" } }, { warranties: { none: { archivedAt: null } } }],
      };
      total = counts.missing;
      missing = await tx.asset.findMany({
        where,
        orderBy: { assetTag: "asc" },
        skip: (page - 1) * PAGE,
        take: PAGE,
        select: { id: true, assetTag: true, name: true, status: true, hospital: { select: { code: true } } },
      });
    } else if (view === "claims") {
      claims = await claimList(tx, { asset: assetScopeWhere(ctx) });
      total = claims.length;
    } else {
      const where: Prisma.WarrantyWhereInput =
        view === "active"
          ? {
              archivedAt: null,
              asset: assetScope,
              endsOn: { gt: warn },
              OR: [{ startsOn: null }, { startsOn: { lte: t } }],
            }
          : view === "expiring"
            ? { archivedAt: null, asset: assetScope, endsOn: { gte: t, lte: warn } }
            : view === "expired"
              ? { archivedAt: null, asset: { ...assetScope, status: { not: "DECOMMISSIONED" } }, endsOn: { lt: t } }
              : { archivedAt: null, kind: "SERVICE_CONTRACT", asset: assetScope, endsOn: { gte: t } };
      total = await tx.warranty.count({ where });
      rows = await tx.warranty.findMany({
        where,
        orderBy: view === "expired" ? { endsOn: "desc" } : { endsOn: "asc" },
        skip: (page - 1) * PAGE,
        take: PAGE,
        select,
      });
    }
    return {
      view,
      today,
      warnDays,
      counts,
      rows: rows.map((r) => ({ ...r, state: warrantyState(iso(r.startsOn), iso(r.endsOn)!, today, warnDays) })),
      missing,
      claims,
      page,
      pageCount: Math.max(1, Math.ceil(total / PAGE)),
    };
  });
}

function claimList(tx: Tx, where: Prisma.WarrantyClaimWhereInput) {
  return tx.warrantyClaim.findMany({
    where,
    orderBy: { updatedAt: "desc" },
    take: 200,
    select: {
      id: true,
      status: true,
      claimReference: true,
      description: true,
      submittedOn: true,
      decidedOn: true,
      outcome: true,
      evidence: true,
      amountClaimed: true,
      amountRecovered: true,
      currency: true,
      createdAt: true,
      warranty: { select: { id: true, kind: true, provider: true, reference: true } },
      asset: { select: { id: true, assetTag: true } },
      workOrder: { select: { id: true, number: true } },
      events: {
        orderBy: { createdAt: "asc" },
        select: { id: true, fromStatus: true, toStatus: true, note: true, actorId: true, createdAt: true },
      },
    },
  });
}

/** Warranties, contracts and claims of one asset (for its page). */
export async function getAssetWarranties(ctx: AccessContext, assetId: string) {
  if (!can(ctx, "warranty.view")) return null;
  return withTenant(tenant(ctx), async (tx) => {
    const asset = await loadScopedAsset(ctx, tx, assetId, "warranty.view");
    const settings = await readSettings(tx, ctx.organization.id);
    const h = await tx.hospital.findUnique({ where: { id: asset.hospitalId }, select: { timezone: true } });
    const today = localToday(h?.timezone ?? "UTC");
    const warnDays = Math.max(...settings.warrantyReminderDays, ...settings.contractReminderDays);
    const warranties = await tx.warranty.findMany({
      where: { assetId: asset.id, archivedAt: null },
      orderBy: { endsOn: "desc" },
      include: { supplier: { select: { id: true, name: true } } },
    });
    const claims = await claimList(tx, { assetId: asset.id });
    const showMoney = can(ctx, "asset.viewCost");
    const names = await peopleNames(
      tx,
      claims.flatMap((c) => c.events.map((e) => e.actorId)),
    );
    return {
      today,
      warranties: warranties.map((w) => ({
        ...w,
        state: warrantyState(iso(w.startsOn), iso(w.endsOn)!, today, warnDays),
      })),
      claims: claims.map((c) => (showMoney ? c : { ...c, amountClaimed: null, amountRecovered: null, currency: null })),
      names,
      showMoney,
    };
  });
}

/**
 * Warranties and contracts on record for a job's device, for the work order
 * page and the fault report form. Says only what was recorded.
 */
export async function warrantyForAsset(ctx: AccessContext, assetId: string) {
  if (!can(ctx, "warranty.view")) return null;
  if (!UUID.test(assetId)) return null;
  return withTenant(tenant(ctx), async (tx) => {
    const asset = await tx.asset.findFirst({
      where: { AND: [{ id: assetId }, assetScopeWhere(ctx)] },
      select: { id: true, hospitalId: true },
    });
    if (!asset) return null;
    const h = await tx.hospital.findUnique({ where: { id: asset.hospitalId }, select: { timezone: true } });
    const today = localToday(h?.timezone ?? "UTC");
    const rows = await tx.warranty.findMany({
      where: { assetId, archivedAt: null, endsOn: { gte: toDbDate(addDays(today, -365)) } },
      orderBy: { endsOn: "desc" },
      select: {
        id: true,
        kind: true,
        provider: true,
        reference: true,
        startsOn: true,
        endsOn: true,
        coversParts: true,
        coversLabour: true,
        exclusions: true,
        responseTargetHours: true,
        supplier: { select: { name: true } },
      },
    });
    return {
      today,
      rows: rows.map((r) => ({ ...r, state: warrantyState(iso(r.startsOn), iso(r.endsOn)!, today, 0) })),
    };
  });
}

// ─── Edit and archive ────────────────────────────────────────────────────────

async function loadWarranty(ctx: AccessContext, tx: Tx, id: string, action: string) {
  if (!UUID.test(id)) throw new NotFoundError("Warranty");
  const w = await tx.warranty.findUnique({
    where: { id },
    select: { id: true, assetId: true, kind: true, archivedAt: true, endsOn: true },
  });
  if (!w) throw new NotFoundError("Warranty");
  await loadScopedAsset(ctx, tx, w.assetId, action);
  return w;
}

export async function updateWarranty(ctx: AccessContext, input: unknown) {
  await requirePermission(ctx, "warranty.manage", { entityType: "warranty" });
  const data = parseInput(warrantyUpdateSchema, input);
  return withTenant(tenant(ctx), async (tx) => {
    const w = await loadWarranty(ctx, tx, data.id, "warranty.update");
    if (w.archivedAt) throw new ValidationError("This record is archived.");
    if (data.responseTargetHours && w.kind !== "SERVICE_CONTRACT") {
      throw new ValidationError("A response target applies to service contracts only.", {
        responseTargetHours: ["Contracts only"],
      });
    }
    await tx.warranty.update({
      where: { id: w.id },
      data: {
        provider: data.provider,
        startsOn: data.startsOn ? toDbDate(data.startsOn) : null,
        endsOn: toDbDate(data.endsOn),
        coverage: data.coverage,
        supplierId: data.supplierId ? await activeSupplierId(tx, data.supplierId) : null,
        reference: data.reference,
        coversParts: data.coversParts,
        coversLabour: data.coversLabour,
        exclusions: data.exclusions,
        notes: data.notes,
        documentReference: data.documentReference,
        responseTargetHours: data.responseTargetHours,
        updatedById: ctx.user.id,
      },
    });
    await audit(tx, {
      organizationId: ctx.organization.id,
      actorUserId: ctx.user.id,
      action: "warranty.updated",
      entityType: "asset",
      entityId: w.assetId,
      metadata: { warrantyId: w.id, kind: w.kind, endsOn: data.endsOn, previousEndsOn: iso(w.endsOn) },
      request: ctx.request,
    });
  });
}

export async function archiveWarranty(ctx: AccessContext, input: { id?: unknown }) {
  await requirePermission(ctx, "warranty.manage", { entityType: "warranty" });
  return withTenant(tenant(ctx), async (tx) => {
    const w = await loadWarranty(ctx, tx, String(input?.id ?? ""), "warranty.archive");
    if (w.archivedAt) return;
    const open = await tx.warrantyClaim.count({ where: { warrantyId: w.id, status: { in: ["DRAFT", "SUBMITTED"] } } });
    if (open) throw new ValidationError("Close or withdraw the open claims on this warranty first.");
    await tx.warranty.update({ where: { id: w.id }, data: { archivedAt: new Date(), updatedById: ctx.user.id } });
    await audit(tx, {
      organizationId: ctx.organization.id,
      actorUserId: ctx.user.id,
      action: "warranty.archived",
      entityType: "asset",
      entityId: w.assetId,
      metadata: { warrantyId: w.id, kind: w.kind },
      request: ctx.request,
    });
  });
}

// ─── Claims ──────────────────────────────────────────────────────────────────

export async function createClaim(ctx: AccessContext, input: unknown) {
  await requirePermission(ctx, "warranty.claim", { entityType: "warranty_claim" });
  const data = parseInput(claimCreateSchema, input);
  return withTenant(tenant(ctx), async (tx) => {
    const w = await loadWarranty(ctx, tx, data.warrantyId, "warranty.claim");
    if (w.archivedAt) throw new ValidationError("This warranty is archived.");
    if (data.workOrderId) {
      const wo = await tx.workOrder.findFirst({
        where: { AND: [{ id: data.workOrderId, assetId: w.assetId }, workOrderScopeWhere(ctx)] },
        select: { id: true },
      });
      if (!wo)
        throw new ValidationError("Choose a work order for this device.", { workOrderId: ["Unknown work order"] });
    }
    const claim = await tx.warrantyClaim.create({
      data: {
        organizationId: ctx.organization.id,
        warrantyId: w.id,
        assetId: w.assetId,
        workOrderId: data.workOrderId,
        description: data.description,
        evidence: data.evidence,
        claimReference: data.claimReference,
        amountClaimed: data.amountClaimed,
        currency: data.currency,
        createdById: ctx.user.id,
        updatedById: ctx.user.id,
      },
      select: { id: true },
    });
    await tx.warrantyClaimEvent.create({
      data: {
        organizationId: ctx.organization.id,
        claimId: claim.id,
        fromStatus: null,
        toStatus: "DRAFT",
        note: "Claim recorded",
        actorId: ctx.user.id,
      },
    });
    await audit(tx, {
      organizationId: ctx.organization.id,
      actorUserId: ctx.user.id,
      action: "warranty.claim_created",
      entityType: "warranty_claim",
      entityId: claim.id,
      metadata: { warrantyId: w.id, assetId: w.assetId, workOrderId: data.workOrderId ?? undefined },
      request: ctx.request,
    });
    return claim;
  });
}

/** Moves a claim along: Draft → Submitted → Accepted / Partly accepted / Rejected (or Withdrawn). */
export async function updateClaimStatus(ctx: AccessContext, input: unknown) {
  await requirePermission(ctx, "warranty.claim", { entityType: "warranty_claim" });
  const data = parseInput(claimStatusSchema, input);
  return withTenant(tenant(ctx), async (tx) => {
    const claim = await tx.warrantyClaim.findUnique({
      where: { id: data.claimId },
      select: { id: true, status: true, assetId: true, submittedOn: true, amountClaimed: true, currency: true },
    });
    if (!claim) throw new NotFoundError("Claim");
    await loadScopedAsset(ctx, tx, claim.assetId, "warranty.claim_update");
    const from = claim.status as ClaimStatusValue;
    const to = data.status;
    if (!CLAIM_TRANSITIONS[from].includes(to)) {
      throw new ValidationError(
        `A claim that is "${CLAIM_STATUS_LABELS[from]}" cannot become "${CLAIM_STATUS_LABELS[to]}".`,
        { status: ["Not allowed"] },
      );
    }
    const decided = to === "ACCEPTED" || to === "PARTIALLY_ACCEPTED" || to === "REJECTED";
    if ((to === "SUBMITTED" || decided) && !data.date) {
      throw new ValidationError(
        to === "SUBMITTED" ? "Enter the date the claim was sent." : "Enter the date of the supplier's decision.",
        { date: ["Required"] },
      );
    }
    if (decided && claim.submittedOn && data.date && data.date < iso(claim.submittedOn)!) {
      throw new ValidationError("The decision date cannot be before the submission date.", {
        date: ["Before submission"],
      });
    }
    if (decided && !data.outcome)
      throw new ValidationError("Record the supplier's decision.", { outcome: ["Required"] });
    if (data.amountRecovered !== null && to !== "ACCEPTED" && to !== "PARTIALLY_ACCEPTED") {
      throw new ValidationError("An amount recovered is recorded only for accepted claims.", {
        amountRecovered: ["Accepted claims only"],
      });
    }
    const currency = data.amountRecovered !== null ? (data.currency ?? claim.currency) : claim.currency;
    if (data.amountRecovered !== null && !currency)
      throw new ValidationError("Enter the currency.", { currency: ["Required"] });
    const updated = await tx.warrantyClaim.updateMany({
      where: { id: claim.id, status: from },
      data: {
        status: to,
        ...(to === "SUBMITTED" ? { submittedOn: toDbDate(data.date!) } : {}),
        ...(decided ? { decidedOn: toDbDate(data.date!), outcome: data.outcome } : {}),
        ...(data.claimReference ? { claimReference: data.claimReference } : {}),
        ...(data.evidence ? { evidence: data.evidence } : {}),
        ...(data.amountRecovered !== null ? { amountRecovered: data.amountRecovered, currency } : {}),
        updatedById: ctx.user.id,
      },
    });
    if (!updated.count) throw new ValidationError("This claim changed. Reload and try again.");
    await tx.warrantyClaimEvent.create({
      data: {
        organizationId: ctx.organization.id,
        claimId: claim.id,
        fromStatus: from,
        toStatus: to,
        note: data.note ?? data.outcome,
        actorId: ctx.user.id,
      },
    });
    await audit(tx, {
      organizationId: ctx.organization.id,
      actorUserId: ctx.user.id,
      action: "warranty.claim_status_changed",
      entityType: "warranty_claim",
      entityId: claim.id,
      metadata: { from, to },
      request: ctx.request,
    });
  });
}
