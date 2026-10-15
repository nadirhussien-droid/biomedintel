// Equipment asset register (Stage 4).
//
// Same pattern as every BiomedIntel.ai service:
//   1. requirePermission  — is this role allowed? (denials are audited)
//   2. parseInput         — is the input valid? (never trust the browser)
//   3. scope check        — is the asset's hospital AND department in the user's scope?
//   4. withTenant         — do the work with RLS set to this organisation
//   5. audit              — record what changed (field names, not whole records)
//
// Isolation is enforced three times: the scope filter below, Row-Level
// Security in PostgreSQL, and composite foreign keys. Searching, filtering,
// sorting and paging all happen inside the database query AFTER the scope
// filter is applied, so no combination of query-string values can widen it.
import type { Prisma } from "../db/generated/client";
import { withTenant, type Tx } from "../db/tenant";
import { audit, auditStandalone } from "../audit/audit";
import { can, requireHospitalAccess, requirePermission, type AccessContext } from "../authz/access";
import { NotFoundError, ValidationError } from "../authz/errors";
import { isUniqueViolation, parseInput } from "../validation";
import {
  assetIdSchema,
  assetQuerySchema,
  createAssetSchema,
  decommissionDecisionSchema,
  decommissionRequestSchema,
  PAGE_SIZE,
  quickStatusSchema,
  updateAssetSchema,
  warrantySchema,
  type AssetQuery,
  type CreateAssetInput,
} from "@/lib/validation/assets";
import { parseAssetCode } from "@/lib/asset-code";

const tenant = (ctx: AccessContext) => ({ userId: ctx.user.id, organizationId: ctx.organization.id });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const toDate = (iso: string | null) => (iso ? new Date(`${iso}T00:00:00Z`) : null);
const isoDate = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);

// ─── Scope ───────────────────────────────────────────────────────────────────

/** Prisma filter limiting assets to the user's hospitals and departments. */
export function assetScopeWhere(ctx: AccessContext): Prisma.AssetWhereInput {
  if (ctx.hospitals.length === 0) return { id: { in: [] } };
  return {
    OR: ctx.hospitals.map((h) =>
      h.departments === "ALL" ? { hospitalId: h.id } : { hospitalId: h.id, departmentId: { in: h.departments } },
    ),
  };
}

function auditOutsideScope(ctx: AccessContext, assetId: string, action: string) {
  return auditStandalone({
    organizationId: ctx.organization.id,
    actorUserId: ctx.user.id,
    action: "asset.access_denied",
    outcome: "DENIED",
    entityType: "asset",
    entityId: assetId,
    metadata: { reason: "not_found_or_outside_scope", attemptedAction: action, role: ctx.role },
    request: ctx.request,
  });
}

/**
 * Loads an asset for an action, or throws NotFoundError. "Not found" covers
 * three cases on purpose — no such asset, another organisation's asset (RLS
 * hides it), and an asset outside the user's hospitals/departments — so a
 * guessed id reveals nothing. Every such attempt is audited.
 */
async function loadScopedAsset(ctx: AccessContext, tx: Tx, assetId: string, action: string) {
  const asset = await tx.asset.findFirst({
    where: { AND: [{ id: assetId }, assetScopeWhere(ctx)] },
    select: {
      id: true,
      assetTag: true,
      hospitalId: true,
      departmentId: true,
      locationId: true,
      status: true,
      riskClass: true,
      archivedAt: true,
      updatedAt: true,
      purchaseCost: true,
      purchaseCurrency: true,
    },
  });
  if (!asset) {
    await auditOutsideScope(ctx, assetId, action);
    throw new NotFoundError("Asset");
  }
  return asset;
}

// ─── Register: list, search, filter, sort, paginate ─────────────────────────

const LIST_SELECT = {
  id: true,
  assetTag: true,
  name: true,
  serialNumber: true,
  inventoryNumber: true,
  status: true,
  riskClass: true,
  archivedAt: true,
  updatedAt: true,
  hospital: { select: { name: true, code: true } },
  department: { select: { name: true } },
  location: { select: { name: true } },
  model: {
    select: {
      modelName: true,
      manufacturer: { select: { name: true } },
      category: { select: { name: true } },
    },
  },
} satisfies Prisma.AssetSelect;

export function buildAssetWhere(ctx: AccessContext, q: AssetQuery): Prisma.AssetWhereInput {
  const and: Prisma.AssetWhereInput[] = [assetScopeWhere(ctx)];
  if (q.hospital) and.push({ hospitalId: q.hospital });
  if (q.department) and.push({ departmentId: q.department });
  if (q.status) and.push({ status: q.status });
  if (q.risk) and.push({ riskClass: q.risk });
  if (q.category) and.push({ model: { categoryId: q.category } });
  if (q.manufacturer) and.push({ model: { manufacturerId: q.manufacturer } });
  if (q.archived === "exclude") and.push({ archivedAt: null });
  if (q.archived === "only") and.push({ archivedAt: { not: null } });
  if (q.q) {
    const contains = { contains: q.q, mode: "insensitive" as const };
    and.push({
      OR: [
        { assetTag: contains },
        { name: contains },
        { serialNumber: contains },
        { inventoryNumber: contains },
        { model: { modelName: contains } },
        { model: { manufacturer: { name: contains } } },
      ],
    });
  }
  return { AND: and };
}

function orderBy(q: AssetQuery): Prisma.AssetOrderByWithRelationInput[] {
  // Only whitelisted fields (validated by zod); `id` makes paging stable.
  return [{ [q.sort]: q.dir }, { id: "asc" }];
}

export async function listAssets(ctx: AccessContext, rawQuery: unknown) {
  await requirePermission(ctx, "asset.view", { entityType: "asset" });
  const q = assetQuerySchema.parse(rawQuery ?? {});
  const where = buildAssetWhere(ctx, q);
  return withTenant(tenant(ctx), async (tx) => {
    const total = await tx.asset.count({ where });
    const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
    const page = Math.min(q.page, pageCount);
    const rows = await tx.asset.findMany({
      where,
      orderBy: orderBy(q),
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      select: LIST_SELECT,
    });
    return { rows, total, page, pageCount, pageSize: PAGE_SIZE, query: { ...q, page } };
  });
}

/** Filter choices: only hospitals/departments in scope, plus this organisation's catalog. */
export async function getRegisterFilterOptions(ctx: AccessContext) {
  await requirePermission(ctx, "asset.view", { entityType: "asset" });
  return withTenant(tenant(ctx), async (tx) => {
    const departments = await tx.department.findMany({
      where: {
        status: "ACTIVE",
        OR: ctx.hospitals.map((h) =>
          h.departments === "ALL" ? { hospitalId: h.id } : { hospitalId: h.id, id: { in: h.departments } },
        ),
      },
      orderBy: { name: "asc" },
      select: { id: true, name: true, hospitalId: true },
    });
    const [categories, manufacturers] = await Promise.all([
      tx.equipmentCategory.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
      tx.manufacturer.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
    ]);
    return {
      hospitals: ctx.hospitals.map((h) => ({ id: h.id, name: h.name })),
      departments: ctx.hospitals.length ? departments : [],
      categories,
      manufacturers,
    };
  });
}

/** Status counts for the dashboard (assets in scope, not archived). */
export async function getAssetStatusCounts(ctx: AccessContext, hospitalId?: string | null) {
  if (!can(ctx, "asset.view")) return null;
  const where: Prisma.AssetWhereInput = {
    AND: [assetScopeWhere(ctx), { archivedAt: null }, ...(hospitalId ? [{ hospitalId }] : [])],
  };
  return withTenant(tenant(ctx), async (tx) => {
    const groups = await tx.asset.groupBy({ by: ["status"], where, _count: { _all: true } });
    const counts = { IN_SERVICE: 0, UNDER_REPAIR: 0, OUT_OF_SERVICE: 0, DECOMMISSIONED: 0 };
    for (const g of groups) counts[g.status] = g._count._all;
    const highRisk = await tx.asset.count({ where: { AND: [where, { riskClass: "HIGH" }] } });
    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    return { total, highRisk, ...counts };
  });
}

// ─── Asset details ───────────────────────────────────────────────────────────

export async function getAsset(ctx: AccessContext, assetId: string) {
  await requirePermission(ctx, "asset.view", { entityType: "asset" });
  if (!UUID.test(assetId)) throw new NotFoundError("Asset");
  const showCost = can(ctx, "asset.viewCost");
  const showAudit = can(ctx, "asset.auditView");

  return withTenant(tenant(ctx), async (tx) => {
    const asset = await tx.asset.findFirst({
      where: { AND: [{ id: assetId }, assetScopeWhere(ctx)] },
      include: {
        hospital: { select: { id: true, name: true, code: true } },
        department: { select: { id: true, name: true, code: true } },
        location: { select: { id: true, name: true, building: true, floor: true } },
        model: {
          select: {
            id: true,
            modelName: true,
            expectedLifeYears: true,
            manufacturer: { select: { id: true, name: true, supportContact: true } },
            category: { select: { id: true, name: true } },
          },
        },
        statusHistory: { orderBy: { createdAt: "desc" }, take: 20 },
        warranties: { where: { archivedAt: null }, orderBy: { endsOn: "desc" } },
        lifecycleEvents: { orderBy: { createdAt: "desc" }, take: 10 },
      },
    });
    if (!asset) {
      await auditOutsideScope(ctx, assetId, "asset.view");
      throw new NotFoundError("Asset");
    }

    const auditEvents = showAudit
      ? await tx.auditLog.findMany({
          where: { entityType: "asset", entityId: asset.id },
          orderBy: { createdAt: "desc" },
          take: 30,
          select: { id: true, action: true, outcome: true, actorUserId: true, metadata: true, createdAt: true },
        })
      : null;

    // Names for people shown in history (users is a global table; only ids we already hold).
    const personIds = new Set<string>();
    asset.statusHistory.forEach((h) => h.changedById && personIds.add(h.changedById));
    asset.lifecycleEvents.forEach((e) => {
      personIds.add(e.requestedById);
      if (e.decidedById) personIds.add(e.decidedById);
    });
    auditEvents?.forEach((e) => e.actorUserId && personIds.add(e.actorUserId));
    [asset.createdById, asset.updatedById].forEach((id) => id && personIds.add(id));
    const people = await tx.user.findMany({ where: { id: { in: [...personIds] } }, select: { id: true, name: true } });

    // Can the current user decide the pending decommissioning request (if any)?
    const pending = asset.lifecycleEvents.find((e) => e.status === "PENDING");
    const pendingDecider = pending
      ? { id: pending.id, kind: await decommissionApproverKind(ctx, tx, asset, pending.requestedById) }
      : null;

    const { purchaseCost, purchaseCurrency, ...rest } = asset;
    return {
      ...rest,
      purchaseDate: isoDate(asset.purchaseDate),
      commissionedAt: isoDate(asset.commissionedAt),
      eolDate: isoDate(asset.eolDate),
      cost: showCost && purchaseCost !== null ? { amount: purchaseCost.toFixed(2), currency: purchaseCurrency } : null,
      costHidden: !showCost && purchaseCost !== null,
      warranties: asset.warranties.map((w) => ({ ...w, startsOn: isoDate(w.startsOn), endsOn: isoDate(w.endsOn)! })),
      lifecycleEvents: asset.lifecycleEvents.map((e) => ({
        ...e,
        effectiveOn: isoDate(e.effectiveOn),
        canDecide: e.id === pendingDecider?.id ? pendingDecider.kind : null,
      })),
      auditEvents,
      people: Object.fromEntries(people.map((p) => [p.id, p.name])) as Record<string, string>,
    };
  });
}

/** The current values for the edit form (cost only for those allowed to edit it). */
export async function getAssetForEdit(ctx: AccessContext, assetId: string) {
  await requirePermission(ctx, "asset.edit", { entityType: "asset", entityId: assetId });
  if (!UUID.test(assetId)) throw new NotFoundError("Asset");
  return withTenant(tenant(ctx), async (tx) => {
    const a = await tx.asset.findFirst({ where: { AND: [{ id: assetId }, assetScopeWhere(ctx)] } });
    if (!a) {
      await auditOutsideScope(ctx, assetId, "asset.edit");
      throw new NotFoundError("Asset");
    }
    const canCost = can(ctx, "asset.editCost");
    return {
      id: a.id,
      version: a.updatedAt.toISOString(),
      archived: a.archivedAt !== null,
      decommissioned: a.status === "DECOMMISSIONED",
      values: {
        name: a.name,
        assetTag: a.assetTag,
        modelId: a.modelId,
        hospitalId: a.hospitalId,
        departmentId: a.departmentId,
        locationId: a.locationId ?? "",
        serialNumber: a.serialNumber ?? "",
        inventoryNumber: a.inventoryNumber ?? "",
        supplier: a.supplier ?? "",
        description: a.description ?? "",
        status: a.status,
        riskClass: a.riskClass ?? "",
        purchaseDate: isoDate(a.purchaseDate) ?? "",
        commissionedAt: isoDate(a.commissionedAt) ?? "",
        eolDate: isoDate(a.eolDate) ?? "",
        purchaseCost: canCost && a.purchaseCost ? a.purchaseCost.toFixed(2) : "",
        purchaseCurrency: canCost ? (a.purchaseCurrency ?? "") : "",
      },
    };
  });
}

/** Choices for the create/edit form, limited to the user's scope. */
export async function getAssetFormOptions(ctx: AccessContext) {
  await requirePermission(ctx, "asset.view", { entityType: "asset" });
  return withTenant(tenant(ctx), async (tx) => {
    const scopeOr = ctx.hospitals.map((h) =>
      h.departments === "ALL" ? { hospitalId: h.id } : { hospitalId: h.id, id: { in: h.departments } },
    );
    const departments = ctx.hospitals.length
      ? await tx.department.findMany({
          where: { status: "ACTIVE", OR: scopeOr },
          orderBy: { name: "asc" },
          select: { id: true, name: true, hospitalId: true },
        })
      : [];
    const locations = departments.length
      ? await tx.location.findMany({
          where: { status: "ACTIVE", departmentId: { in: departments.map((d) => d.id) } },
          orderBy: { name: "asc" },
          select: { id: true, name: true, departmentId: true, building: true, floor: true },
        })
      : [];
    const models = await tx.equipmentModel.findMany({
      where: { status: "ACTIVE" },
      orderBy: [{ manufacturer: { name: "asc" } }, { modelName: "asc" }],
      select: {
        id: true,
        modelName: true,
        manufacturer: { select: { name: true } },
        category: { select: { name: true, defaultRiskClass: true } },
      },
    });
    return { hospitals: ctx.hospitals.map((h) => ({ id: h.id, name: h.name })), departments, locations, models };
  });
}

// ─── Create and edit ─────────────────────────────────────────────────────────

async function checkReferences(
  tx: Tx,
  data: Pick<CreateAssetInput, "hospitalId" | "departmentId" | "locationId" | "modelId">,
) {
  const department = await tx.department.findFirst({
    where: { id: data.departmentId, hospitalId: data.hospitalId, status: "ACTIVE" },
    select: { id: true },
  });
  if (!department) {
    throw new ValidationError("Choose a department that belongs to the selected hospital.", {
      departmentId: ["Not a department of this hospital"],
    });
  }
  if (data.locationId) {
    const location = await tx.location.findFirst({
      where: { id: data.locationId, departmentId: data.departmentId, status: "ACTIVE" },
      select: { id: true },
    });
    if (!location) {
      throw new ValidationError("Choose a location inside the selected department.", {
        locationId: ["Not a location of this department"],
      });
    }
  }
  const model = await tx.equipmentModel.findFirst({
    where: { id: data.modelId, status: "ACTIVE" },
    select: { id: true },
  });
  if (!model) throw new ValidationError("Choose a model from the list.", { modelId: ["Unknown model"] });
}

/**
 * Duplicate checks run under RLS, so they only ever look inside the user's own
 * organisation: another organisation's asset tags and serial numbers are
 * invisible and can never cause (or be revealed by) a conflict here.
 */
async function checkDuplicates(
  tx: Tx,
  data: Pick<
    CreateAssetInput,
    "assetTag" | "serialNumber" | "inventoryNumber" | "hospitalId" | "modelId" | "confirmDuplicateSerial"
  >,
  excludeId?: string,
) {
  const notSelf = excludeId ? { id: { not: excludeId } } : {};
  const tagTaken = await tx.asset.findFirst({ where: { assetTag: data.assetTag, ...notSelf }, select: { id: true } });
  if (tagTaken) {
    throw new ValidationError("That asset ID is already used in your organisation.", {
      assetTag: ["Already used in your organisation — asset IDs are never reused, even after archiving"],
    });
  }
  if (data.inventoryNumber) {
    const inv = await tx.asset.findFirst({
      where: { hospitalId: data.hospitalId, inventoryNumber: data.inventoryNumber, ...notSelf },
      select: { id: true },
    });
    if (inv) {
      throw new ValidationError("That hospital inventory number is already used in this hospital.", {
        inventoryNumber: ["Already used in this hospital"],
      });
    }
  }
  if (data.serialNumber && !data.confirmDuplicateSerial) {
    const same = await tx.asset.findFirst({
      where: {
        modelId: data.modelId,
        serialNumber: { equals: data.serialNumber, mode: "insensitive" },
        ...notSelf,
      },
      select: { id: true },
    });
    if (same) {
      // Deliberately no details about the other asset (it may be in a hospital
      // this user cannot see).
      throw new ValidationError("Possible duplicate: check the serial number.", {
        serialNumber: [
          "Another asset of this model in your organisation already has this serial number. If this really is a different device, tick the confirmation box and save again.",
        ],
        confirmDuplicateSerial: ["needed"],
      });
    }
  }
}

function uniqueViolationMessage(error: unknown): ValidationError {
  const text = JSON.stringify(error, Object.getOwnPropertyNames(error as object));
  if (text.includes("asset_tag")) {
    return new ValidationError("That asset ID is already used in your organisation.", {
      assetTag: ["Already used in your organisation"],
    });
  }
  if (text.includes("inventory_number")) {
    return new ValidationError("That hospital inventory number is already used in this hospital.", {
      inventoryNumber: ["Already used in this hospital"],
    });
  }
  return new ValidationError("This record conflicts with an existing one. Please try again.");
}

export async function createAsset(ctx: AccessContext, input: unknown) {
  await requirePermission(ctx, "asset.create", { entityType: "asset" });
  const data = parseInput(createAssetSchema, input);
  // Scope: the target hospital AND department must be the user's (audited if not).
  await requireHospitalAccess(ctx, data.hospitalId, data.departmentId);
  // Field-level: only some roles may record the purchase cost.
  if (data.purchaseCost !== null) await requirePermission(ctx, "asset.editCost", { entityType: "asset" });

  try {
    return await withTenant(tenant(ctx), async (tx) => {
      await checkReferences(tx, data);
      await checkDuplicates(tx, data);
      const asset = await tx.asset.create({
        data: {
          organizationId: ctx.organization.id,
          hospitalId: data.hospitalId,
          departmentId: data.departmentId,
          locationId: data.locationId,
          modelId: data.modelId,
          assetTag: data.assetTag,
          name: data.name,
          serialNumber: data.serialNumber,
          inventoryNumber: data.inventoryNumber,
          description: data.description,
          supplier: data.supplier,
          status: data.status,
          riskClass: data.riskClass,
          purchaseDate: toDate(data.purchaseDate),
          commissionedAt: toDate(data.commissionedAt),
          eolDate: toDate(data.eolDate),
          purchaseCost: data.purchaseCost,
          purchaseCurrency: data.purchaseCurrency,
          createdById: ctx.user.id,
          updatedById: ctx.user.id,
        },
        select: { id: true, assetTag: true },
      });
      await tx.assetStatusHistory.create({
        data: {
          organizationId: ctx.organization.id,
          assetId: asset.id,
          fromStatus: null,
          toStatus: data.status,
          reason: "Registered in BiomedIntel.ai",
          changedById: ctx.user.id,
        },
      });
      const base = {
        organizationId: ctx.organization.id,
        actorUserId: ctx.user.id,
        entityType: "asset",
        entityId: asset.id,
        request: ctx.request,
      };
      await audit(tx, {
        ...base,
        action: "asset.created",
        metadata: {
          assetTag: asset.assetTag,
          hospitalId: data.hospitalId,
          departmentId: data.departmentId,
          status: data.status,
          riskClass: data.riskClass,
          duplicateSerialConfirmed: data.confirmDuplicateSerial || undefined,
        },
      });
      // The barcode is the asset ID in Code 128; recorded so label history is traceable.
      await audit(tx, {
        ...base,
        action: "asset.barcode_issued",
        metadata: { assetTag: asset.assetTag, symbology: "code128" },
      });
      return asset;
    });
  } catch (error) {
    if (isUniqueViolation(error)) throw uniqueViolationMessage(error);
    throw error;
  }
}

const AUDITED_FIELDS = [
  "name",
  "assetTag",
  "modelId",
  "hospitalId",
  "departmentId",
  "locationId",
  "serialNumber",
  "inventoryNumber",
  "supplier",
  "description",
  "status",
  "riskClass",
  "purchaseDate",
  "commissionedAt",
  "eolDate",
  "purchaseCost",
  "purchaseCurrency",
] as const;

export async function updateAsset(ctx: AccessContext, input: unknown) {
  await requirePermission(ctx, "asset.edit", { entityType: "asset" });
  const canCost = can(ctx, "asset.editCost");
  const raw = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const id = typeof raw.id === "string" && UUID.test(raw.id) ? raw.id : null;
  if (!id) throw new NotFoundError("Asset");

  return withTenant(tenant(ctx), async (tx) => {
    // 1. The CURRENT asset must be in scope (audited if not).
    const current = await loadScopedAsset(ctx, tx, id, "asset.edit");
    if (current.archivedAt) throw new ValidationError("This asset is archived. Restore it before editing.");
    if (current.status === "DECOMMISSIONED") {
      throw new ValidationError("Decommissioned assets are read-only.");
    }
    // Field-level: people who cannot edit the cost never see it, so their form
    // does not send it. Keep the stored value; refuse any attempt to change it.
    const merged = canCost
      ? raw
      : {
          ...raw,
          purchaseCost: raw.purchaseCost ?? (current.purchaseCost ? current.purchaseCost.toFixed(2) : null),
          purchaseCurrency: raw.purchaseCurrency ?? current.purchaseCurrency,
        };
    const data = parseInput(updateAssetSchema, merged);
    if (!canCost) {
      const before = current.purchaseCost ? current.purchaseCost.toFixed(2) : null;
      const after = data.purchaseCost === null ? null : Number(data.purchaseCost).toFixed(2);
      if (before !== after || (current.purchaseCurrency ?? null) !== data.purchaseCurrency) {
        await requirePermission(ctx, "asset.editCost", { entityType: "asset", entityId: id });
      }
    }
    // 2. The NEW hospital/department must also be in scope (audited if not).
    await requireHospitalAccess(ctx, data.hospitalId, data.departmentId);
    await checkReferences(tx, data);
    const existing = await tx.asset.findUniqueOrThrow({ where: { id } });
    // Only warn about a repeated serial number when the serial or model changes.
    const serialUnchanged =
      existing.modelId === data.modelId &&
      (existing.serialNumber ?? "").toLowerCase() === (data.serialNumber ?? "").toLowerCase();
    await checkDuplicates(tx, { ...data, confirmDuplicateSerial: data.confirmDuplicateSerial || serialUnchanged }, id);

    const next = {
      name: data.name,
      assetTag: data.assetTag,
      modelId: data.modelId,
      hospitalId: data.hospitalId,
      departmentId: data.departmentId,
      locationId: data.locationId,
      serialNumber: data.serialNumber,
      inventoryNumber: data.inventoryNumber,
      supplier: data.supplier,
      description: data.description,
      status: data.status,
      riskClass: data.riskClass,
      purchaseDate: toDate(data.purchaseDate),
      commissionedAt: toDate(data.commissionedAt),
      eolDate: toDate(data.eolDate),
      purchaseCost: data.purchaseCost,
      purchaseCurrency: data.purchaseCurrency,
    };
    // Compare as plain strings: dates as YYYY-MM-DD, money with 2 decimals.
    const norm = (field: (typeof AUDITED_FIELDS)[number], v: unknown): string | null => {
      if (v === null || v === undefined) return null;
      if (v instanceof Date) return v.toISOString().slice(0, 10);
      if (field === "purchaseCost") return Number(String(v)).toFixed(2);
      return String(v);
    };
    const changed = AUDITED_FIELDS.filter((f) => norm(f, existing[f]) !== norm(f, next[f]));
    if (changed.length === 0) return { id, assetTag: existing.assetTag, changed };

    // 3. Optimistic concurrency: only update if nobody saved in between.
    let result;
    try {
      result = await tx.asset.updateMany({
        where: { id, updatedAt: new Date(data.version) },
        data: { ...next, updatedById: ctx.user.id },
      });
    } catch (error) {
      if (isUniqueViolation(error)) throw uniqueViolationMessage(error);
      throw error;
    }
    if (result.count === 0) {
      throw new ValidationError(
        "Someone else changed this asset while you were editing. Reload the page to see their changes, then try again.",
      );
    }

    const base = {
      organizationId: ctx.organization.id,
      actorUserId: ctx.user.id,
      entityType: "asset",
      entityId: id,
      request: ctx.request,
    };
    // Field names only — never a copy of the whole record. The cost value is
    // not written to the audit log either.
    await audit(tx, { ...base, action: "asset.updated", metadata: { assetTag: data.assetTag, changed } });
    if (changed.includes("hospitalId") || changed.includes("departmentId")) {
      await audit(tx, {
        ...base,
        action: "asset.reassigned",
        metadata: {
          from: { hospitalId: existing.hospitalId, departmentId: existing.departmentId },
          to: { hospitalId: data.hospitalId, departmentId: data.departmentId },
        },
      });
    }
    if (changed.includes("status")) {
      await tx.assetStatusHistory.create({
        data: {
          organizationId: ctx.organization.id,
          assetId: id,
          fromStatus: existing.status,
          toStatus: data.status,
          reason: "Edited in the asset register",
          changedById: ctx.user.id,
        },
      });
      await audit(tx, {
        ...base,
        action: "asset.status_changed",
        metadata: { from: existing.status, to: data.status },
      });
    }
    if (changed.includes("assetTag")) {
      // A new asset ID means a new barcode: labels printed before no longer match.
      await audit(tx, {
        ...base,
        action: "asset.barcode_replaced",
        metadata: { from: existing.assetTag, to: data.assetTag, symbology: "code128", reprintLabel: true },
      });
    }
    if (changed.includes("riskClass")) {
      await audit(tx, {
        ...base,
        action: "asset.risk_changed",
        metadata: { from: existing.riskClass, to: data.riskClass },
      });
    }
    return { id, assetTag: data.assetTag, changed };
  });
}

/** Quick status (and optional room) change — e.g. a technician marking a device out of service. */
export async function changeAssetStatus(ctx: AccessContext, input: unknown) {
  await requirePermission(ctx, "asset.edit", { entityType: "asset" });
  const data = parseInput(quickStatusSchema, input);
  return withTenant(tenant(ctx), async (tx) => {
    const current = await loadScopedAsset(ctx, tx, data.id, "asset.status");
    if (current.archivedAt) throw new ValidationError("This asset is archived.");
    if (current.status === "DECOMMISSIONED") throw new ValidationError("Decommissioned assets are read-only.");
    const updates: Prisma.AssetUncheckedUpdateManyInput = { updatedById: ctx.user.id };
    const base = {
      organizationId: ctx.organization.id,
      actorUserId: ctx.user.id,
      entityType: "asset",
      entityId: data.id,
      request: ctx.request,
    };

    if (data.locationId !== undefined && data.locationId !== current.locationId) {
      if (data.locationId) {
        const loc = await tx.location.findFirst({
          where: { id: data.locationId, departmentId: current.departmentId, status: "ACTIVE" },
          select: { id: true },
        });
        if (!loc)
          throw new ValidationError("Choose a location in this department.", { locationId: ["Unknown location"] });
      }
      updates.locationId = data.locationId;
    }
    const statusChanged = data.status !== current.status;
    if (statusChanged) updates.status = data.status;
    if (!statusChanged && updates.locationId === undefined) return { changed: false };

    await tx.asset.updateMany({ where: { id: data.id }, data: updates });
    if (statusChanged) {
      await tx.assetStatusHistory.create({
        data: {
          organizationId: ctx.organization.id,
          assetId: data.id,
          fromStatus: current.status,
          toStatus: data.status,
          reason: data.reason,
          changedById: ctx.user.id,
        },
      });
      await audit(tx, {
        ...base,
        action: "asset.status_changed",
        metadata: { from: current.status, to: data.status, assetTag: current.assetTag },
      });
    }
    if (updates.locationId !== undefined) {
      await audit(tx, { ...base, action: "asset.location_changed", metadata: { assetTag: current.assetTag } });
    }
    return { changed: true };
  });
}

// ─── Archive and restore ─────────────────────────────────────────────────────

/** Archives an asset. Nothing is deleted; its history stays. */
export async function archiveAsset(ctx: AccessContext, input: unknown) {
  await requirePermission(ctx, "asset.archive", { entityType: "asset" });
  const { id } = parseInput(assetIdSchema, input);
  return withTenant(tenant(ctx), async (tx) => {
    const current = await loadScopedAsset(ctx, tx, id, "asset.archive");
    if (current.archivedAt) throw new ValidationError("This asset is already archived.");
    await tx.asset.updateMany({
      where: { id },
      data: { archivedAt: new Date(), archivedById: ctx.user.id, updatedById: ctx.user.id },
    });
    await audit(tx, {
      organizationId: ctx.organization.id,
      actorUserId: ctx.user.id,
      action: "asset.archived",
      entityType: "asset",
      entityId: id,
      metadata: { assetTag: current.assetTag },
      request: ctx.request,
    });
  });
}

export async function restoreAsset(ctx: AccessContext, input: unknown) {
  await requirePermission(ctx, "asset.archive", { entityType: "asset" });
  const { id } = parseInput(assetIdSchema, input);
  return withTenant(tenant(ctx), async (tx) => {
    const current = await loadScopedAsset(ctx, tx, id, "asset.restore");
    if (!current.archivedAt) throw new ValidationError("This asset is not archived.");
    await tx.asset.updateMany({
      where: { id },
      data: { archivedAt: null, archivedById: null, updatedById: ctx.user.id },
    });
    await audit(tx, {
      organizationId: ctx.organization.id,
      actorUserId: ctx.user.id,
      action: "asset.restored",
      entityType: "asset",
      entityId: id,
      metadata: { assetTag: current.assetTag },
      request: ctx.request,
    });
  });
}

// ─── Barcode scanning and look-up ────────────────────────────────────────────

export type CodeLookup =
  | { kind: "asset"; assetId: string; matchedBy: "assetTag" | "inventoryNumber" }
  | { kind: "several" }
  | { kind: "not-found" };

/**
 * Finds the asset for a scanned barcode or a typed code.
 *
 * A barcode holds the asset ID (BiomedIntel.ai labels) or, on a hospital's own
 * older labels, its inventory number. It is an identifier, not a key: the
 * search runs only inside the user's current organisation (RLS) and the asset
 * opens only if its hospital AND department are in the user's scope. Unknown
 * codes and out-of-scope assets give the same "not found" answer; out-of-scope
 * attempts are audited.
 */
export async function findAssetByCode(ctx: AccessContext, rawCode: string): Promise<CodeLookup> {
  await requirePermission(ctx, "asset.view", { entityType: "asset" });
  const parsed = parseAssetCode(typeof rawCode === "string" ? rawCode : "");
  if (parsed.kind !== "code") return { kind: "not-found" };
  const code = parsed.code;

  return withTenant(tenant(ctx), async (tx) => {
    // 1. BiomedIntel.ai asset ID (unique per organisation).
    let matchedBy: "assetTag" | "inventoryNumber" = "assetTag";
    let candidates = parsed.isAssetTag
      ? await tx.asset.findMany({ where: { assetTag: code.toUpperCase() }, select: { id: true } })
      : [];
    // 2. Otherwise the hospital inventory number (unique per hospital, so the
    //    same number can exist in two hospitals of one organisation).
    if (candidates.length === 0) {
      matchedBy = "inventoryNumber";
      candidates = await tx.asset.findMany({
        where: { inventoryNumber: { equals: code, mode: "insensitive" } },
        select: { id: true },
        take: 20,
      });
    }
    if (candidates.length === 0) return { kind: "not-found" } as const;

    const visible = await tx.asset.findMany({
      where: { AND: [{ id: { in: candidates.map((c) => c.id) } }, assetScopeWhere(ctx)] },
      select: { id: true },
    });
    if (visible.length === 0) {
      await auditOutsideScope(ctx, candidates[0].id, "asset.scan");
      return { kind: "not-found" } as const;
    }
    if (visible.length > 1) return { kind: "several" } as const;
    await audit(tx, {
      organizationId: ctx.organization.id,
      actorUserId: ctx.user.id,
      action: "asset.scanned",
      entityType: "asset",
      entityId: visible[0].id,
      metadata: { matchedBy },
      request: ctx.request,
    });
    return { kind: "asset", assetId: visible[0].id, matchedBy } as const;
  });
}

// ─── Labels and export ───────────────────────────────────────────────────────

export const MAX_LABELS = 100;

export async function getAssetsForLabels(ctx: AccessContext, ids: string[]) {
  await requirePermission(ctx, "asset.labelPrint", { entityType: "asset" });
  const valid = [...new Set(ids.filter((id) => UUID.test(id)))].slice(0, MAX_LABELS);
  if (valid.length === 0) return { assets: [], requested: ids.length };
  return withTenant(tenant(ctx), async (tx) => {
    const assets = await tx.asset.findMany({
      where: { AND: [{ id: { in: valid } }, assetScopeWhere(ctx), { archivedAt: null }] },
      orderBy: { assetTag: "asc" },
      select: {
        id: true,
        assetTag: true,
        name: true,
        hospital: { select: { name: true, code: true } },
        department: { select: { name: true } },
      },
    });
    if (assets.length) {
      await audit(tx, {
        organizationId: ctx.organization.id,
        actorUserId: ctx.user.id,
        action: "asset.label_printed",
        entityType: "asset",
        entityId: assets.length === 1 ? assets[0].id : undefined,
        metadata: { count: assets.length, assetTags: assets.map((a) => a.assetTag).slice(0, 50) },
        request: ctx.request,
      });
    }
    return { assets, requested: ids.length };
  });
}

export const MAX_EXPORT_ROWS = 5000;

/** CSV export of the register with the same scope and filters as the screen. */
export async function exportAssetsCsv(ctx: AccessContext, rawQuery: unknown): Promise<{ csv: string; count: number }> {
  await requirePermission(ctx, "asset.export", { entityType: "asset" });
  const q = assetQuerySchema.parse(rawQuery ?? {});
  const where = buildAssetWhere(ctx, q);
  return withTenant(tenant(ctx), async (tx) => {
    const rows = await tx.asset.findMany({ where, orderBy: orderBy(q), take: MAX_EXPORT_ROWS, select: LIST_SELECT });
    const header = [
      "Asset ID",
      "Name",
      "Manufacturer",
      "Model",
      "Category",
      "Serial number",
      "Inventory number",
      "Hospital",
      "Department",
      "Location",
      "Status",
      "Risk",
      "Archived",
    ];
    const lines = [
      header,
      ...rows.map((r) => [
        r.assetTag,
        r.name,
        r.model.manufacturer.name,
        r.model.modelName,
        r.model.category.name,
        r.serialNumber ?? "",
        r.inventoryNumber ?? "",
        r.hospital.name,
        r.department.name,
        r.location?.name ?? "",
        r.status,
        r.riskClass ?? "",
        r.archivedAt ? "yes" : "no",
      ]),
    ].map((cells) => cells.map(csvCell).join(","));
    await audit(tx, {
      organizationId: ctx.organization.id,
      actorUserId: ctx.user.id,
      action: "asset.exported",
      entityType: "asset",
      metadata: { count: rows.length, filters: { ...q, page: undefined } },
      request: ctx.request,
    });
    return { csv: `${lines.join("\r\n")}\r\n`, count: rows.length };
  });
}

/** Quotes a CSV cell and neutralises spreadsheet formulas (CSV injection). */
export function csvCell(value: string): string {
  let v = value;
  if (/^[=+\-@\t\r]/.test(v)) v = `'${v}`;
  return `"${v.replace(/"/g, '""')}"`;
}

// ─── Warranties ──────────────────────────────────────────────────────────────

export async function addWarranty(ctx: AccessContext, input: unknown) {
  await requirePermission(ctx, "asset.edit", { entityType: "asset" });
  const data = parseInput(warrantySchema, input);
  return withTenant(tenant(ctx), async (tx) => {
    const current = await loadScopedAsset(ctx, tx, data.assetId, "warranty.add");
    if (current.archivedAt) throw new ValidationError("This asset is archived.");
    const w = await tx.warranty.create({
      data: {
        organizationId: ctx.organization.id,
        assetId: data.assetId,
        kind: data.kind,
        provider: data.provider,
        startsOn: toDate(data.startsOn),
        endsOn: toDate(data.endsOn)!,
        coverage: data.coverage,
        createdById: ctx.user.id,
      },
      select: { id: true },
    });
    await audit(tx, {
      organizationId: ctx.organization.id,
      actorUserId: ctx.user.id,
      action: "asset.warranty_added",
      entityType: "asset",
      entityId: data.assetId,
      metadata: { warrantyId: w.id, kind: data.kind, endsOn: data.endsOn },
      request: ctx.request,
    });
  });
}

// ─── Decommissioning (decision 8: NUM approval) ──────────────────────────────
//
// Who may approve (approved 14 Oct 2026):
//   1. The NUM: a Department Head assigned to the asset's specific department.
//   2. ONLY if that department has no NUM (other than the requester): the
//      Biomedical Engineering Manager for the hospital, or the Facility Manager
//      (a Department Head covering the whole hospital).
// The requester can never approve their own request.

export type ApproverKind = "NUM" | "ENGINEERING_MANAGER" | "FACILITY_MANAGER";

export const APPROVER_LABELS: Record<ApproverKind, string> = {
  NUM: "Department Head / NUM",
  ENGINEERING_MANAGER: "Biomedical Engineering Manager (no NUM for this department)",
  FACILITY_MANAGER: "Facility Manager (no NUM for this department)",
};

/** Returns how the current user may approve this asset's request, or null if they may not. */
export async function decommissionApproverKind(
  ctx: AccessContext,
  tx: Tx,
  asset: { hospitalId: string; departmentId: string },
  requestedById: string,
): Promise<ApproverKind | null> {
  if (!can(ctx, "asset.decommissionApprove") || requestedById === ctx.user.id) return null;
  const hospital = ctx.hospitals.find((h) => h.id === asset.hospitalId);
  if (!hospital) return null;
  const isNum =
    ctx.role === "DEPARTMENT_HEAD" &&
    hospital.departments !== "ALL" &&
    hospital.departments.includes(asset.departmentId);
  if (isNum) return "NUM";
  // Is there an active NUM for this department who did not make the request?
  const otherNums = await tx.membership.count({
    where: {
      role: "DEPARTMENT_HEAD",
      status: "ACTIVE",
      orgWide: false,
      userId: { not: requestedById },
      scopes: { some: { hospitalId: asset.hospitalId, departmentId: asset.departmentId } },
    },
  });
  if (otherNums > 0) return null;
  if (ctx.role === "ENGINEERING_MANAGER") return "ENGINEERING_MANAGER";
  if (ctx.role === "DEPARTMENT_HEAD" && hospital.departments === "ALL") return "FACILITY_MANAGER";
  return null;
}

export async function requestDecommission(ctx: AccessContext, input: unknown) {
  await requirePermission(ctx, "asset.decommissionRequest", { entityType: "asset" });
  const data = parseInput(decommissionRequestSchema, input);
  try {
    return await withTenant(tenant(ctx), async (tx) => {
      const current = await loadScopedAsset(ctx, tx, data.id, "asset.decommission_request");
      if (current.archivedAt) throw new ValidationError("This asset is archived.");
      if (current.status === "DECOMMISSIONED") throw new ValidationError("This asset is already decommissioned.");
      const event = await tx.lifecycleEvent.create({
        data: {
          organizationId: ctx.organization.id,
          assetId: data.id,
          eventType: "DECOMMISSION",
          reason: data.reason,
          effectiveOn: toDate(data.effectiveOn),
          requestedById: ctx.user.id,
        },
        select: { id: true },
      });
      await audit(tx, {
        organizationId: ctx.organization.id,
        actorUserId: ctx.user.id,
        action: "asset.decommission_requested",
        entityType: "asset",
        entityId: data.id,
        metadata: { requestId: event.id, assetTag: current.assetTag },
        request: ctx.request,
      });
      return event;
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new ValidationError("A decommissioning request for this asset is already waiting for approval.");
    }
    throw error;
  }
}

export async function decideDecommission(ctx: AccessContext, input: unknown) {
  await requirePermission(ctx, "asset.decommissionApprove", { entityType: "asset" });
  const data = parseInput(decommissionDecisionSchema, input);
  return withTenant(tenant(ctx), async (tx) => {
    const request = await tx.lifecycleEvent.findFirst({
      where: { id: data.requestId, eventType: "DECOMMISSION" },
      select: { id: true, assetId: true, status: true, requestedById: true },
    });
    if (!request) throw new NotFoundError("Request");
    const current = await loadScopedAsset(ctx, tx, request.assetId, "asset.decommission_decide");
    if (request.status !== "PENDING") throw new ValidationError("This request has already been decided.");
    const approver = await decommissionApproverKind(ctx, tx, current, request.requestedById);
    if (!approver) {
      const own = request.requestedById === ctx.user.id;
      await auditStandalone({
        organizationId: ctx.organization.id,
        actorUserId: ctx.user.id,
        action: "authz.denied",
        outcome: "DENIED",
        entityType: "asset",
        entityId: request.assetId,
        metadata: { attemptedAction: "asset.decommissionApprove", reason: own ? "own_request" : "not_the_approver" },
        request: ctx.request,
      });
      throw new ValidationError(
        own
          ? "You cannot decide on your own request."
          : "This request must be decided by the NUM of the department (or, if it has none, the Biomedical Engineering Manager or Facility Manager).",
      );
    }
    const approved = data.decision === "APPROVE";
    const now = new Date();
    const updated = await tx.lifecycleEvent.updateMany({
      where: { id: request.id, status: "PENDING" },
      data: {
        status: approved ? "APPROVED" : "REJECTED",
        decidedById: ctx.user.id,
        decidedAt: now,
        decisionNote: data.note,
      },
    });
    if (updated.count === 0) throw new ValidationError("This request has already been decided.");
    const base = {
      organizationId: ctx.organization.id,
      actorUserId: ctx.user.id,
      entityType: "asset",
      entityId: request.assetId,
      request: ctx.request,
    };
    if (approved) {
      await tx.asset.updateMany({
        where: { id: request.assetId },
        data: { status: "DECOMMISSIONED", updatedById: ctx.user.id },
      });
      await tx.assetStatusHistory.create({
        data: {
          organizationId: ctx.organization.id,
          assetId: request.assetId,
          fromStatus: current.status,
          toStatus: "DECOMMISSIONED",
          reason: `Decommissioning approved by ${APPROVER_LABELS[approver]}`,
          changedById: ctx.user.id,
        },
      });
      await audit(tx, {
        ...base,
        action: "asset.decommissioned",
        metadata: { requestId: request.id, from: current.status, approvedAs: approver },
      });
    } else {
      await audit(tx, {
        ...base,
        action: "asset.decommission_rejected",
        metadata: { requestId: request.id, decidedAs: approver },
      });
    }
    return { assetId: request.assetId, approved };
  });
}

/** The requester (or a manager/admin) withdraws a pending request. */
export async function cancelDecommission(ctx: AccessContext, input: unknown) {
  await requirePermission(ctx, "asset.decommissionRequest", { entityType: "asset" });
  const { id } = parseInput(assetIdSchema, input);
  return withTenant(tenant(ctx), async (tx) => {
    const request = await tx.lifecycleEvent.findFirst({
      where: { id, eventType: "DECOMMISSION", status: "PENDING" },
      select: { id: true, assetId: true, requestedById: true },
    });
    if (!request) throw new NotFoundError("Request");
    await loadScopedAsset(ctx, tx, request.assetId, "asset.decommission_cancel");
    if (request.requestedById !== ctx.user.id && !can(ctx, "asset.archive")) {
      throw new ValidationError("Only the person who made the request, or a manager, can withdraw it.");
    }
    await tx.lifecycleEvent.updateMany({
      where: { id, status: "PENDING" },
      data: { status: "CANCELLED", decidedAt: new Date() },
    });
    await audit(tx, {
      organizationId: ctx.organization.id,
      actorUserId: ctx.user.id,
      action: "asset.decommission_cancelled",
      entityType: "asset",
      entityId: request.assetId,
      metadata: { requestId: id },
      request: ctx.request,
    });
    return { assetId: request.assetId };
  });
}

/** Pending decommissioning requests the current user may decide (NUM, or the fallback approvers). */
export async function listPendingDecommissions(ctx: AccessContext) {
  if (!can(ctx, "asset.decommissionApprove")) return [];
  return withTenant(tenant(ctx), async (tx) => {
    const events = await tx.lifecycleEvent.findMany({
      where: { eventType: "DECOMMISSION", status: "PENDING", asset: assetScopeWhere(ctx) },
      orderBy: { createdAt: "asc" },
      take: 50,
      select: {
        id: true,
        reason: true,
        createdAt: true,
        requestedById: true,
        asset: {
          select: {
            id: true,
            assetTag: true,
            name: true,
            hospitalId: true,
            departmentId: true,
            department: { select: { name: true } },
          },
        },
      },
    });
    const decidable = [];
    for (const e of events) {
      const kind = await decommissionApproverKind(ctx, tx, e.asset, e.requestedById);
      if (kind) decidable.push({ ...e, approverKind: kind });
    }
    const people = await tx.user.findMany({
      where: { id: { in: decidable.map((e) => e.requestedById) } },
      select: { id: true, name: true },
    });
    const names = new Map(people.map((p) => [p.id, p.name]));
    return decidable.map((e) => ({ ...e, requestedBy: names.get(e.requestedById) ?? "Unknown" }));
  });
}
