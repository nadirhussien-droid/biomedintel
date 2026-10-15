// Spare parts inventory (Stage 8, Stage 2 workflow H).
//
// How stock is kept correct:
//   • Every change in quantity is a row in stock_movements (append-only).
//     A database trigger applies it to stock_levels in the same transaction
//     and refuses negative stock or using stock reserved for work orders.
//     The application cannot write stock_levels at all.
//   • Every operation on a part first locks that part's row (SELECT … FOR
//     UPDATE), so two people issuing the last unit at the same moment are
//     handled one after the other: the second is refused, never both.
//   • Every form carries a one-time key, stored UNIQUE with the movement:
//     a double-click or a retried request is recorded once.
//
// Definitions (shown in the interface):
//   on hand   = sum of recorded movements, per store and lot;
//   usable    = on hand in lots that have not expired;
//   reserved  = active reservations for work orders;
//   available = usable − reserved.
//
// Stores belong to a hospital; stock is visible and movable only for stores
// in the user's hospitals. Parts are an organisation-wide catalogue.
import { randomUUID } from "node:crypto";
import { Prisma } from "../db/generated/client";
import { withTenant, type Tx } from "../db/tenant";
import { audit } from "../audit/audit";
import { can, requirePermission, type AccessContext } from "../authz/access";
import { AuthorizationError, NotFoundError, ValidationError } from "../authz/errors";
import { checkViolationMessage, isUniqueViolation, parseInput } from "../validation";
import { addDays, localToday, toDbDate, type DateOnly } from "@/lib/pm/dates";
import {
  adjustSchema,
  PART_PAGE_SIZE,
  partNumberSchema,
  partQuerySchema,
  partSchema,
  receiveSchema,
  storeSchema,
  transferSchema,
} from "@/lib/validation/inventory";

export const tenant = (ctx: AccessContext) => ({ userId: ctx.user.id, organizationId: ctx.organization.id });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const n = (v: bigint | number | null | undefined) => (v === null || v === undefined ? 0 : Number(v));

export const DEFAULT_SETTINGS = {
  warrantyReminderDays: [90, 60, 30],
  contractReminderDays: [90, 60, 30],
  stockExpiryWarningDays: 60,
  lifecycleReviewLeadDays: 30,
  adjustmentLimit: 10,
};

export async function readSettings(tx: Tx, organizationId: string) {
  const s = await tx.inventorySettings.findUnique({ where: { organizationId } });
  return s ?? { ...DEFAULT_SETTINGS, organizationId, updatedById: null, updatedAt: null };
}

/** Stores the user may see and use: those of their hospitals. */
export function storeScopeWhere(ctx: AccessContext): Prisma.StockLocationWhereInput {
  return { hospitalId: { in: ctx.hospitals.map((h) => h.id) } };
}
const storeIds = (ctx: AccessContext) =>
  Prisma.join(ctx.hospitals.length ? ctx.hospitals.map((h) => h.id) : ["00000000-0000-0000-0000-000000000000"]);

async function auditDenied(
  ctx: AccessContext,
  entityType: string,
  entityId: string | undefined,
  action: string,
  reason: string,
) {
  const { auditStandalone } = await import("../audit/audit");
  await auditStandalone({
    organizationId: ctx.organization.id,
    actorUserId: ctx.user.id,
    action: "inventory.access_denied",
    outcome: "DENIED",
    entityType,
    entityId,
    metadata: { attemptedAction: action, reason, role: ctx.role },
    request: ctx.request,
  });
}

/** A store in the user's hospitals, or NotFound (audited). */
export async function loadStore(
  ctx: AccessContext,
  tx: Tx,
  id: string | null | undefined,
  action: string,
  active = true,
) {
  if (!id || !UUID.test(id)) throw new NotFoundError("Store");
  const store = await tx.stockLocation.findFirst({
    where: { AND: [{ id }, storeScopeWhere(ctx)] },
    select: {
      id: true,
      code: true,
      name: true,
      status: true,
      hospitalId: true,
      hospital: { select: { code: true, timezone: true } },
    },
  });
  if (!store) {
    await auditDenied(ctx, "stock_location", id, action, "not_found_or_outside_scope");
    throw new NotFoundError("Store");
  }
  if (active && store.status !== "ACTIVE") throw new ValidationError("This store is archived.");
  return store;
}

type LockedPart = {
  id: string;
  part_number: string;
  name: string;
  status: string;
  tracks_lots: boolean;
  tracks_expiry: boolean;
  unit_cost: string | null;
  currency: string | null;
};

/** Locks the part row for the rest of the transaction (serialises stock operations per part). */
export async function lockPart(tx: Tx, partId: string | null | undefined, opts: { active?: boolean } = {}) {
  if (!partId || !UUID.test(partId)) throw new NotFoundError("Part");
  const [part] = await tx.$queryRaw<LockedPart[]>`
    SELECT id, part_number, name, status::text AS status, tracks_lots, tracks_expiry, unit_cost::text AS unit_cost, currency
    FROM parts WHERE id = ${partId}::uuid FOR UPDATE`;
  if (!part) throw new NotFoundError("Part");
  if (opts.active !== false && part.status !== "ACTIVE") throw new ValidationError("This part is archived.");
  return part;
}

/** Stock of one part in one store, with the definitions above. */
export async function stockAt(tx: Tx, partId: string, locationId: string, today: DateOnly) {
  const lots = await tx.stockLevel.findMany({
    where: { partId, locationId, onHand: { gt: 0 } },
    select: { lotNumber: true, expiresOn: true, onHand: true },
    orderBy: [{ expiresOn: { sort: "asc", nulls: "last" } }, { lotNumber: "asc" }],
  });
  const reserved = await tx.partReservation.aggregate({
    where: { partId, locationId, status: "ACTIVE" },
    _sum: { quantity: true },
  });
  const usableLots = lots.filter((l) => !l.expiresOn || l.expiresOn.toISOString().slice(0, 10) >= today);
  const onHand = lots.reduce((s, l) => s + l.onHand, 0);
  const usable = usableLots.reduce((s, l) => s + l.onHand, 0);
  const res = reserved._sum.quantity ?? 0;
  return { lots, usableLots, onHand, usable, reserved: res, available: usable - res };
}

export type MovementInput = {
  partId: string;
  locationId: string;
  lotNumber?: string;
  expiresOn?: Date | null;
  type: "INITIAL" | "RECEIPT" | "ISSUE" | "RETURN" | "TRANSFER_OUT" | "TRANSFER_IN" | "ADJUSTMENT" | "WRITE_OFF";
  quantity: number;
  unitCost?: string | null;
  currency?: string | null;
  workOrderId?: string | null;
  reservationId?: string | null;
  purchaseLineId?: string | null;
  supplierId?: string | null;
  transferId?: string | null;
  reference?: string | null;
  reason?: string | null;
  idempotencyKey: string;
};

const DB_MESSAGES: [RegExp, string][] = [
  [
    /stock_negative|Not enough stock|stock_levels_not_negative/,
    "There is not enough stock for this. Someone may have just used it — reload and check.",
  ],
  [
    /stock_reserved|reserved for work orders/,
    "This would use stock that is reserved for work orders. Release a reservation first.",
  ],
  [
    /purchase_not_ordered|ordered purchase request/,
    "Stock can only be received against a request that has been marked as ordered.",
  ],
  [/purchase_lines_quantities/, "This is more than was ordered on that line of the purchase request."],
];

/** Inserts one movement; database refusals become clear messages. */
export async function recordMovement(
  tx: Tx,
  ctx: { user: { id: string }; organization: { id: string } },
  m: MovementInput,
) {
  try {
    return await tx.stockMovement.create({
      data: {
        organizationId: ctx.organization.id,
        partId: m.partId,
        locationId: m.locationId,
        lotNumber: m.lotNumber ?? "",
        expiresOn: m.expiresOn ?? null,
        type: m.type,
        quantity: m.quantity,
        unitCost: m.unitCost ?? null,
        currency: m.unitCost ? (m.currency ?? null) : null,
        workOrderId: m.workOrderId ?? null,
        reservationId: m.reservationId ?? null,
        purchaseLineId: m.purchaseLineId ?? null,
        supplierId: m.supplierId ?? null,
        transferId: m.transferId ?? null,
        reference: m.reference ?? null,
        reason: m.reason ?? null,
        idempotencyKey: m.idempotencyKey,
        performedById: ctx.user.id,
      },
      select: { id: true, balanceAfter: true },
    });
  } catch (error) {
    const msg = checkViolationMessage(error);
    if (msg) {
      const known = DB_MESSAGES.find(([re]) => re.test(msg));
      if (!known) console.error("[inventory] database refused a movement:", msg);
      throw new ValidationError(known ? known[1] : "The database refused this stock movement.", {
        quantity: [known ? known[1] : "Refused"],
      });
    }
    throw error;
  }
}

/** True when this one-time key was already used (the earlier submission was recorded). */
export async function alreadyRecorded(tx: Tx, organizationId: string, key: string) {
  const [m, r] = await Promise.all([
    tx.stockMovement.findFirst({
      where: { organizationId, idempotencyKey: { in: [key, `${key}:1`, `${key}:out`] } },
      select: { id: true },
    }),
    tx.partReservation.findFirst({ where: { organizationId, idempotencyKey: key }, select: { id: true } }),
  ]);
  return Boolean(m || r);
}

/** Runs a keyed stock operation; a concurrent duplicate of the same key is reported as "already recorded". */
export async function keyed<T>(work: () => Promise<T>): Promise<T | { duplicate: true }> {
  try {
    return await work();
  } catch (error) {
    if (isUniqueViolation(error)) return { duplicate: true };
    throw error;
  }
}

function lotRules(part: LockedPart, lotNumber: string, expiresOn: string | null, needExpiry: boolean) {
  if (!part.tracks_lots && (lotNumber || expiresOn)) {
    throw new ValidationError("This part does not track lots or expiry dates.", {
      lotNumber: ["Leave blank for this part"],
    });
  }
  if (part.tracks_lots && !lotNumber) {
    throw new ValidationError("Enter the lot or batch number.", { lotNumber: ["Required for this part"] });
  }
  if (needExpiry && part.tracks_expiry && !expiresOn) {
    throw new ValidationError("Enter the expiry date of this lot.", { expiresOn: ["Required for this part"] });
  }
}

const storeToday = (store: { hospital: { timezone: string } }) => localToday(store.hospital.timezone);

// ─── Stores ──────────────────────────────────────────────────────────────────

export async function listStores(ctx: AccessContext) {
  await requirePermission(ctx, "inventory.view", { entityType: "stock_location" });
  return withTenant(tenant(ctx), (tx) =>
    tx.stockLocation.findMany({
      where: storeScopeWhere(ctx),
      orderBy: [{ status: "asc" }, { hospital: { code: "asc" } }, { code: "asc" }],
      select: {
        id: true,
        code: true,
        name: true,
        description: true,
        status: true,
        hospital: { select: { id: true, code: true, name: true } },
      },
    }),
  );
}

export async function createStore(ctx: AccessContext, input: unknown) {
  await requirePermission(ctx, "inventory.manage", { entityType: "stock_location" });
  const data = parseInput(storeSchema, input);
  if (!ctx.hospitals.some((h) => h.id === data.hospitalId)) throw new NotFoundError("Hospital");
  try {
    return await withTenant(tenant(ctx), async (tx) => {
      const s = await tx.stockLocation.create({
        data: { ...data, organizationId: ctx.organization.id, createdById: ctx.user.id },
        select: { id: true },
      });
      await audit(tx, {
        organizationId: ctx.organization.id,
        actorUserId: ctx.user.id,
        action: "inventory.store_created",
        entityType: "stock_location",
        entityId: s.id,
        metadata: { code: data.code, hospitalId: data.hospitalId },
        request: ctx.request,
      });
      return s;
    });
  } catch (error) {
    if (isUniqueViolation(error))
      throw new ValidationError("This hospital already has a store with that code.", { code: ["Already used"] });
    throw error;
  }
}

export async function setStoreArchived(ctx: AccessContext, input: { id?: unknown; archived?: unknown }) {
  await requirePermission(ctx, "inventory.manage", { entityType: "stock_location" });
  const archived = input?.archived === true;
  return withTenant(tenant(ctx), async (tx) => {
    const store = await loadStore(ctx, tx, String(input?.id ?? ""), "inventory.store_archive", false);
    if (archived) {
      const held = await tx.stockLevel.aggregate({ where: { locationId: store.id }, _sum: { onHand: true } });
      if ((held._sum.onHand ?? 0) > 0)
        throw new ValidationError("Move or write off the stock in this store before archiving it.");
    }
    await tx.stockLocation.update({
      where: { id: store.id },
      data: { status: archived ? "ARCHIVED" : "ACTIVE", archivedAt: archived ? new Date() : null },
    });
    await audit(tx, {
      organizationId: ctx.organization.id,
      actorUserId: ctx.user.id,
      action: archived ? "inventory.store_archived" : "inventory.store_restored",
      entityType: "stock_location",
      entityId: store.id,
      request: ctx.request,
    });
  });
}

// ─── Parts catalogue ─────────────────────────────────────────────────────────

export async function savePart(ctx: AccessContext, input: unknown) {
  await requirePermission(ctx, "inventory.manage", { entityType: "part" });
  const data = parseInput(partSchema, input);
  try {
    return await withTenant(tenant(ctx), async (tx) => {
      // Every reference must belong to this organisation (RLS) and be active.
      const check = async (ok: boolean, field: string, label: string) => {
        if (!ok) throw new ValidationError(`Choose ${label} from the catalogue.`, { [field]: ["Unknown"] });
      };
      const uniq = <T>(a: T[]) => [...new Set(a)];
      const modelIds = uniq(data.modelIds);
      const categoryIds = uniq(data.categoryIds);
      const compatManufacturerIds = uniq(data.compatManufacturerIds);
      const supplierIds = uniq(data.supplierIds);
      if (data.manufacturerId)
        await check(
          Boolean(await tx.manufacturer.findUnique({ where: { id: data.manufacturerId }, select: { id: true } })),
          "manufacturerId",
          "a manufacturer",
        );
      await check(
        (await tx.equipmentModel.count({ where: { id: { in: modelIds } } })) === modelIds.length,
        "modelIds",
        "models",
      );
      await check(
        (await tx.equipmentCategory.count({ where: { id: { in: categoryIds } } })) === categoryIds.length,
        "categoryIds",
        "categories",
      );
      await check(
        (await tx.manufacturer.count({ where: { id: { in: compatManufacturerIds } } })) ===
          compatManufacturerIds.length,
        "compatManufacturerIds",
        "manufacturers",
      );
      await check(
        (await tx.supplier.count({ where: { id: { in: supplierIds }, status: "ACTIVE" } })) === supplierIds.length,
        "supplierIds",
        "suppliers",
      );

      const fields = {
        name: data.name,
        description: data.description,
        manufacturerId: data.manufacturerId,
        manufacturerPartNumber: data.manufacturerPartNumber,
        unit: data.unit,
        minLevel: data.minLevel,
        targetLevel: data.targetLevel,
        unitCost: data.unitCost,
        currency: data.currency,
        tracksLots: data.tracksLots,
        tracksExpiry: data.tracksExpiry,
        updatedById: ctx.user.id,
      };
      let id = data.id;
      let changed: string[] = [];
      if (id) {
        const existing = await tx.part.findUnique({ where: { id } });
        if (!existing) throw new NotFoundError("Part");
        if (existing.status === "ARCHIVED") throw new ValidationError("Restore this part before editing it.");
        if (existing.partNumber !== data.partNumber) {
          throw new ValidationError("The part number cannot be changed: it is printed on labels.", {
            partNumber: ["Cannot change"],
          });
        }
        if (existing.tracksLots !== data.tracksLots || existing.tracksExpiry !== data.tracksExpiry) {
          const moved = await tx.stockMovement.count({ where: { partId: id } });
          if (moved)
            throw new ValidationError("Lot and expiry tracking cannot be changed once stock has been recorded.", {
              tracksLots: ["Stock already recorded"],
            });
        }
        changed = (Object.keys(fields) as (keyof typeof fields)[]).filter(
          (k) => k !== "updatedById" && String(existing[k] ?? "") !== String(fields[k] ?? ""),
        );
        await tx.part.update({ where: { id }, data: fields });
        await tx.partCompatibility.deleteMany({ where: { partId: id } });
        await tx.partSupplier.deleteMany({ where: { partId: id, supplierId: { notIn: supplierIds } } });
      } else {
        id = (
          await tx.part.create({
            data: {
              ...fields,
              partNumber: data.partNumber,
              organizationId: ctx.organization.id,
              createdById: ctx.user.id,
            },
            select: { id: true },
          })
        ).id;
      }
      const org = ctx.organization.id;
      await tx.partCompatibility.createMany({
        data: [
          ...modelIds.map((m) => ({ organizationId: org, partId: id!, modelId: m })),
          ...categoryIds.map((c) => ({ organizationId: org, partId: id!, categoryId: c })),
          ...compatManufacturerIds.map((m) => ({ organizationId: org, partId: id!, manufacturerId: m })),
        ],
      });
      await tx.partSupplier.createMany({
        data: supplierIds.map((s) => ({ organizationId: org, partId: id!, supplierId: s })),
        skipDuplicates: true,
      });
      await audit(tx, {
        organizationId: org,
        actorUserId: ctx.user.id,
        action: data.id ? "inventory.part_updated" : "inventory.part_created",
        entityType: "part",
        entityId: id,
        metadata: { partNumber: data.partNumber, ...(data.id ? { changed } : {}) },
        request: ctx.request,
      });
      return { id: id! };
    });
  } catch (error) {
    if (isUniqueViolation(error))
      throw new ValidationError("This part number is already in the catalogue.", { partNumber: ["Already used"] });
    throw error;
  }
}

export async function setPartArchived(ctx: AccessContext, input: { id?: unknown; archived?: unknown }) {
  await requirePermission(ctx, "inventory.manage", { entityType: "part" });
  const archived = input?.archived === true;
  return withTenant(tenant(ctx), async (tx) => {
    const part = await lockPart(tx, String(input?.id ?? ""), { active: false });
    if (archived) {
      const [held, reserved] = await Promise.all([
        tx.stockLevel.aggregate({ where: { partId: part.id }, _sum: { onHand: true } }),
        tx.partReservation.count({ where: { partId: part.id, status: "ACTIVE" } }),
      ]);
      if ((held._sum.onHand ?? 0) > 0 || reserved) {
        throw new ValidationError("This part still has stock or reservations. Issue, move or write them off first.");
      }
    }
    await tx.part.update({
      where: { id: part.id },
      data: {
        status: archived ? "ARCHIVED" : "ACTIVE",
        archivedAt: archived ? new Date() : null,
        updatedById: ctx.user.id,
      },
    });
    await audit(tx, {
      organizationId: ctx.organization.id,
      actorUserId: ctx.user.id,
      action: archived ? "inventory.part_archived" : "inventory.part_restored",
      entityType: "part",
      entityId: part.id,
      metadata: { partNumber: part.part_number },
      request: ctx.request,
    });
  });
}

type PartRow = {
  id: string;
  part_number: string;
  name: string;
  unit: string;
  min_level: number;
  target_level: number | null;
  status: string;
  manufacturer_part_number: string | null;
  manufacturer: string | null;
  unit_cost: string | null;
  currency: string | null;
  on_hand: bigint;
  usable: bigint;
  reserved: bigint;
  expiring: bigint;
  expired: bigint;
  on_order: bigint;
  total: bigint;
};

/** Parts with stock in the user's stores (or one store), filtered, sorted and paged in the database. */
export async function listParts(ctx: AccessContext, raw: unknown) {
  await requirePermission(ctx, "inventory.view", { entityType: "part" });
  const q = partQuerySchema.parse(raw ?? {});
  return withTenant(tenant(ctx), async (tx) => {
    if (q.location) await loadStore(ctx, tx, q.location, "inventory.list", false);
    const settings = await readSettings(tx, ctx.organization.id);
    const hospital = q.location
      ? await tx.stockLocation.findUnique({
          where: { id: q.location },
          select: { hospital: { select: { timezone: true } } },
        })
      : null;
    const tz =
      hospital?.hospital.timezone ??
      (ctx.hospitals[0]
        ? (await tx.hospital.findUnique({ where: { id: ctx.hospitals[0].id }, select: { timezone: true } }))?.timezone
        : null) ??
      "UTC";
    const today = localToday(tz);
    const warnUntil = addDays(today, settings.stockExpiryWarningDays);
    const stores = q.location
      ? Prisma.sql`${q.location}::uuid`
      : Prisma.sql`SELECT id FROM stock_locations WHERE hospital_id IN (${storeIds(ctx)})`;
    const hospitalsSql = q.location
      ? Prisma.sql`SELECT hospital_id FROM stock_locations WHERE id = ${q.location}::uuid`
      : Prisma.sql`${storeIds(ctx)}`;
    const search = q.q
      ? Prisma.sql`AND (p.part_number ILIKE ${"%" + q.q + "%"} OR p.name ILIKE ${"%" + q.q + "%"} OR coalesce(p.manufacturer_part_number, '') ILIKE ${"%" + q.q + "%"})`
      : Prisma.empty;
    const viewSql = {
      all: Prisma.sql`p.status = 'ACTIVE'`,
      archived: Prisma.sql`p.status = 'ARCHIVED'`,
      available: Prisma.sql`p.status = 'ACTIVE' AND x.usable - x.reserved > 0`,
      low: Prisma.sql`p.status = 'ACTIVE' AND x.usable - x.reserved > 0 AND x.usable - x.reserved <= p.min_level`,
      out: Prisma.sql`p.status = 'ACTIVE' AND x.usable - x.reserved <= 0`,
      reserved: Prisma.sql`x.reserved > 0`,
      expiring: Prisma.sql`x.expiring > 0`,
    }[q.view];
    const order = {
      partNumber: Prisma.sql`p.part_number`,
      name: Prisma.sql`lower(p.name)`,
      available: Prisma.sql`x.usable - x.reserved`,
    }[q.sort];
    const dir = q.dir === "desc" ? Prisma.sql`DESC` : Prisma.sql`ASC`;
    const offset = (q.page - 1) * PART_PAGE_SIZE;
    const rows = await tx.$queryRaw<PartRow[]>`
      WITH x AS (
        SELECT p.id,
          coalesce((SELECT sum(l.on_hand) FROM stock_levels l WHERE l.part_id = p.id AND l.location_id IN (${stores})), 0) AS on_hand,
          coalesce((SELECT sum(l.on_hand) FROM stock_levels l WHERE l.part_id = p.id AND l.location_id IN (${stores})
                      AND (l.expires_on IS NULL OR l.expires_on >= ${today}::date)), 0) AS usable,
          coalesce((SELECT sum(r.quantity) FROM part_reservations r WHERE r.part_id = p.id AND r.status = 'ACTIVE'
                      AND r.location_id IN (${stores})), 0) AS reserved,
          coalesce((SELECT sum(l.on_hand) FROM stock_levels l WHERE l.part_id = p.id AND l.location_id IN (${stores})
                      AND l.on_hand > 0 AND l.expires_on IS NOT NULL AND l.expires_on <= ${warnUntil}::date), 0) AS expiring,
          coalesce((SELECT sum(l.on_hand) FROM stock_levels l WHERE l.part_id = p.id AND l.location_id IN (${stores})
                      AND l.on_hand > 0 AND l.expires_on IS NOT NULL AND l.expires_on < ${today}::date), 0) AS expired,
          coalesce((SELECT sum(pl.quantity - pl.received_quantity) FROM purchase_request_lines pl
                      JOIN purchase_requests pr ON pr.id = pl.request_id
                      WHERE pl.part_id = p.id AND pr.status IN ('SUBMITTED', 'APPROVED', 'ORDERED', 'PARTIALLY_RECEIVED')
                        AND pr.hospital_id IN (${hospitalsSql})), 0) AS on_order
        FROM parts p
      )
      SELECT p.id, p.part_number, p.name, p.unit::text AS unit, p.min_level, p.target_level, p.status::text AS status,
             p.manufacturer_part_number, m.name AS manufacturer, p.unit_cost::text AS unit_cost, p.currency,
             x.on_hand, x.usable, x.reserved, x.expiring, x.expired, x.on_order, count(*) OVER () AS total
      FROM parts p JOIN x ON x.id = p.id
      LEFT JOIN manufacturers m ON m.id = p.manufacturer_id
      WHERE ${viewSql} ${search}
      ORDER BY ${order} ${dir}, p.part_number
      LIMIT ${PART_PAGE_SIZE} OFFSET ${offset}`;
    const total = n(rows[0]?.total);
    const showCost = can(ctx, "inventory.viewCost");
    return {
      query: q,
      today,
      warnUntil,
      total,
      pageCount: Math.max(1, Math.ceil(total / PART_PAGE_SIZE)),
      parts: rows.map((r) => {
        const available = n(r.usable) - n(r.reserved);
        const target = r.target_level;
        return {
          id: r.id,
          partNumber: r.part_number,
          name: r.name,
          unit: r.unit,
          manufacturer: r.manufacturer,
          manufacturerPartNumber: r.manufacturer_part_number,
          status: r.status,
          minLevel: r.min_level,
          targetLevel: target,
          onHand: n(r.on_hand),
          usable: n(r.usable),
          reserved: n(r.reserved),
          available,
          expiring: n(r.expiring),
          expired: n(r.expired),
          onOrder: n(r.on_order),
          stockState: stockState(available, r.min_level),
          suggestedReorder: suggestedReorder(available, n(r.on_order), r.min_level, target),
          unitCost: showCost ? r.unit_cost : null,
          currency: showCost ? r.currency : null,
        };
      }),
    };
  });
}

export function stockState(available: number, minLevel: number): "out" | "low" | "ok" {
  if (available <= 0) return "out";
  if (available <= minLevel) return "low";
  return "ok";
}

/**
 * Suggested reorder quantity = target level − available − already requested,
 * only when available is at or below the minimum and a target is configured.
 */
export function suggestedReorder(
  available: number,
  onOrder: number,
  minLevel: number,
  target: number | null,
): number | null {
  if (available > minLevel || target === null) return null;
  return Math.max(0, target - Math.max(0, available) - onOrder);
}

export async function getPart(ctx: AccessContext, id: string) {
  await requirePermission(ctx, "inventory.view", { entityType: "part" });
  if (!UUID.test(id)) throw new NotFoundError("Part");
  return withTenant(tenant(ctx), async (tx) => {
    const part = await tx.part.findUnique({
      where: { id },
      include: {
        manufacturer: { select: { id: true, name: true } },
        compatibility: {
          select: {
            id: true,
            model: { select: { id: true, modelName: true, manufacturer: { select: { name: true } } } },
            category: { select: { id: true, name: true } },
            manufacturer: { select: { id: true, name: true } },
          },
        },
        suppliers: {
          select: { supplierPartNumber: true, supplier: { select: { id: true, name: true, status: true } } },
        },
      },
    });
    if (!part) throw new NotFoundError("Part");
    const stores = await tx.stockLocation.findMany({
      where: storeScopeWhere(ctx),
      select: { id: true, code: true, name: true, status: true, hospital: { select: { code: true, timezone: true } } },
      orderBy: [{ hospital: { code: "asc" } }, { code: "asc" }],
    });
    const perStore = await Promise.all(
      stores.map(async (s) => ({ store: s, ...(await stockAt(tx, part.id, s.id, storeToday(s))) })),
    );
    const movements = await tx.stockMovement.findMany({
      where: { partId: part.id, locationId: { in: stores.map((s) => s.id) } },
      orderBy: { createdAt: "desc" },
      take: 50,
      select: {
        id: true,
        type: true,
        quantity: true,
        balanceAfter: true,
        lotNumber: true,
        reference: true,
        reason: true,
        unitCost: true,
        currency: true,
        createdAt: true,
        performedById: true,
        location: { select: { code: true } },
        workOrder: { select: { id: true, number: true } },
      },
    });
    const reservations = await tx.partReservation.findMany({
      where: { partId: part.id, status: "ACTIVE", locationId: { in: stores.map((s) => s.id) } },
      select: {
        id: true,
        quantity: true,
        createdAt: true,
        location: { select: { code: true } },
        workOrder: { select: { id: true, number: true, status: true } },
      },
    });
    const showCost = can(ctx, "inventory.viewCost");
    return {
      part: showCost ? part : { ...part, unitCost: null, currency: null },
      perStore: perStore.filter((p) => p.store.status === "ACTIVE" || p.onHand > 0),
      movements: movements.map((m) => (showCost ? m : { ...m, unitCost: null, currency: null })),
      reservations,
      showCost,
    };
  });
}

/** Choices for part pickers (work orders, purchase requests, stock forms). */
export async function partOptions(ctx: AccessContext) {
  if (!can(ctx, "inventory.view")) return [];
  return withTenant(tenant(ctx), (tx) =>
    tx.part.findMany({
      where: { status: "ACTIVE" },
      select: { id: true, partNumber: true, name: true, unit: true, tracksLots: true, tracksExpiry: true },
      orderBy: { partNumber: "asc" },
      take: 2000,
    }),
  );
}

// ─── Barcode / typed look-up ─────────────────────────────────────────────────

export type PartLookup =
  | { kind: "part"; partId: string }
  | { kind: "several"; parts: { id: string; partNumber: string; name: string }[] }
  | { kind: "archived"; partNumber: string }
  | { kind: "not-found" };

/**
 * Resolves a scanned or typed code on the server: the internal part number
 * (printed as a Code 128 barcode), or a manufacturer part number. Only parts
 * of the user's organisation can match (RLS).
 */
export async function findPartByCode(ctx: AccessContext, rawCode: string): Promise<PartLookup> {
  await requirePermission(ctx, "inventory.view", { entityType: "part" });
  const code = String(rawCode ?? "")
    .trim()
    .slice(0, 80);
  if (!code) return { kind: "not-found" };
  return withTenant(tenant(ctx), async (tx) => {
    const parsed = partNumberSchema.safeParse(code);
    if (parsed.success) {
      const exact = await tx.part.findUnique({
        where: { organizationId_partNumber: { organizationId: ctx.organization.id, partNumber: parsed.data } },
        select: { id: true, status: true, partNumber: true },
      });
      if (exact)
        return exact.status === "ACTIVE"
          ? { kind: "part", partId: exact.id }
          : { kind: "archived", partNumber: exact.partNumber };
    }
    const byMfr = await tx.part.findMany({
      where: { manufacturerPartNumber: { equals: code, mode: "insensitive" }, status: "ACTIVE" },
      select: { id: true, partNumber: true, name: true },
      take: 10,
    });
    if (byMfr.length === 1) return { kind: "part", partId: byMfr[0].id };
    if (byMfr.length > 1) return { kind: "several", parts: byMfr };
    return { kind: "not-found" };
  });
}

// ─── Stock movements: receive, transfer, adjust, write off ──────────────────

type Duplicate = { duplicate: true };
export type StockResult = { duplicate?: boolean; balance?: number };

/** Initial stock or a delivery received (optionally against an ordered purchase request). */
export async function receiveStock(ctx: AccessContext, input: unknown): Promise<StockResult> {
  await requirePermission(ctx, "stock.receive", { entityType: "stock_movement" });
  const data = parseInput(receiveSchema, input);
  const r = await keyed(() =>
    withTenant(tenant(ctx), async (tx) => {
      if (await alreadyRecorded(tx, ctx.organization.id, data.requestKey)) return { duplicate: true } as Duplicate;
      const part = await lockPart(tx, data.partId);
      const store = await loadStore(ctx, tx, data.locationId, "stock.receive");
      lotRules(part, data.lotNumber, data.expiresOn, true);
      if (data.lotNumber) {
        const lot = await tx.stockLevel.findUnique({
          where: {
            organizationId_partId_locationId_lotNumber: {
              organizationId: ctx.organization.id,
              partId: part.id,
              locationId: store.id,
              lotNumber: data.lotNumber,
            },
          },
          select: { expiresOn: true },
        });
        if (lot?.expiresOn && data.expiresOn && lot.expiresOn.toISOString().slice(0, 10) !== data.expiresOn) {
          throw new ValidationError("This lot is already in the store with a different expiry date.", {
            expiresOn: ["Does not match the lot"],
          });
        }
      }
      let purchaseLineId: string | null = null;
      let requestId: string | null = null;
      if (data.purchaseLineId) {
        if (data.initial) throw new ValidationError("Initial stock cannot be received against a purchase request.");
        const line = await tx.purchaseRequestLine.findUnique({
          where: { id: data.purchaseLineId },
          select: {
            id: true,
            partId: true,
            quantity: true,
            receivedQuantity: true,
            request: { select: { id: true, hospitalId: true, status: true, number: true } },
          },
        });
        if (!line || !ctx.hospitals.some((h) => h.id === line.request.hospitalId))
          throw new NotFoundError("Purchase request");
        if (line.partId !== part.id) throw new ValidationError("That purchase request line is for a different part.");
        if (line.request.hospitalId !== store.hospitalId)
          throw new ValidationError("Receive into a store of the hospital that made the request.", {
            locationId: ["Different hospital"],
          });
        if (line.receivedQuantity + data.quantity > line.quantity) {
          throw new ValidationError(
            `Only ${line.quantity - line.receivedQuantity} more can be received on ${line.request.number}.`,
            { quantity: ["More than ordered"] },
          );
        }
        purchaseLineId = line.id;
        requestId = line.request.id;
      }
      const supplierId = data.supplierId
        ? (await tx.supplier.findFirst({ where: { id: data.supplierId }, select: { id: true } }))?.id
        : null;
      if (data.supplierId && !supplierId)
        throw new ValidationError("Choose a supplier from the register.", { supplierId: ["Unknown"] });
      const m = await recordMovement(tx, ctx, {
        partId: part.id,
        locationId: store.id,
        lotNumber: data.lotNumber,
        expiresOn: data.expiresOn ? toDbDate(data.expiresOn) : null,
        type: data.initial ? "INITIAL" : "RECEIPT",
        quantity: data.quantity,
        unitCost: data.unitCost,
        currency: data.currency,
        supplierId,
        purchaseLineId,
        reference: data.reference,
        idempotencyKey: data.requestKey,
      });
      if (requestId) await refreshPurchaseStatus(tx, requestId);
      await audit(tx, {
        organizationId: ctx.organization.id,
        actorUserId: ctx.user.id,
        action: data.initial ? "stock.initial_recorded" : "stock.received",
        entityType: "part",
        entityId: part.id,
        metadata: {
          partNumber: part.part_number,
          store: store.code,
          quantity: data.quantity,
          lot: data.lotNumber || undefined,
          purchaseRequestId: requestId ?? undefined,
        },
        request: ctx.request,
      });
      return { balance: m.balanceAfter };
    }),
  );
  return "duplicate" in r ? { duplicate: true } : r;
}

/** After a receipt: a request becomes partly or fully received from its lines. */
export async function refreshPurchaseStatus(tx: Tx, requestId: string) {
  const lines = await tx.purchaseRequestLine.findMany({
    where: { requestId },
    select: { quantity: true, receivedQuantity: true },
  });
  const all = lines.every((l) => l.receivedQuantity >= l.quantity);
  const any = lines.some((l) => l.receivedQuantity > 0);
  await tx.purchaseRequest.update({
    where: { id: requestId },
    data: { status: all ? "RECEIVED" : any ? "PARTIALLY_RECEIVED" : "ORDERED" },
  });
}

/** Moves stock between two stores as one paired transaction. */
export async function transferStock(ctx: AccessContext, input: unknown): Promise<StockResult> {
  await requirePermission(ctx, "stock.receive", { entityType: "stock_movement" });
  const data = parseInput(transferSchema, input);
  if (data.fromLocationId === data.toLocationId) {
    throw new ValidationError("Choose two different stores.", { toLocationId: ["Same as the source"] });
  }
  const r = await keyed(() =>
    withTenant(tenant(ctx), async (tx) => {
      if (await alreadyRecorded(tx, ctx.organization.id, data.requestKey)) return { duplicate: true } as Duplicate;
      const part = await lockPart(tx, data.partId);
      const from = await loadStore(ctx, tx, data.fromLocationId, "stock.transfer");
      const to = await loadStore(ctx, tx, data.toLocationId, "stock.transfer");
      lotRules(part, data.lotNumber, null, false);
      const stock = await stockAt(tx, part.id, from.id, storeToday(from));
      const lot = stock.lots.find((l) => l.lotNumber === data.lotNumber);
      if (!lot || lot.onHand < data.quantity) {
        throw new ValidationError(
          `Only ${lot?.onHand ?? 0} in ${from.code}${data.lotNumber ? ` (lot ${data.lotNumber})` : ""}.`,
          { quantity: ["Not enough stock"] },
        );
      }
      if (stock.onHand - data.quantity < stock.reserved) {
        throw new ValidationError("Part of this stock is reserved for work orders in this store.", {
          quantity: ["Reserved stock"],
        });
      }
      const transferId = randomUUID();
      const common = {
        partId: part.id,
        lotNumber: data.lotNumber,
        expiresOn: lot.expiresOn,
        transferId,
        reason: data.reason,
      };
      await recordMovement(tx, ctx, {
        ...common,
        locationId: from.id,
        type: "TRANSFER_OUT",
        quantity: -data.quantity,
        reference: `To ${to.code}`,
        idempotencyKey: `${data.requestKey}:out`,
      });
      const m = await recordMovement(tx, ctx, {
        ...common,
        locationId: to.id,
        type: "TRANSFER_IN",
        quantity: data.quantity,
        reference: `From ${from.code}`,
        idempotencyKey: `${data.requestKey}:in`,
      });
      await audit(tx, {
        organizationId: ctx.organization.id,
        actorUserId: ctx.user.id,
        action: "stock.transferred",
        entityType: "part",
        entityId: part.id,
        metadata: { partNumber: part.part_number, from: from.code, to: to.code, quantity: data.quantity, transferId },
        request: ctx.request,
      });
      return { balance: m.balanceAfter };
    }),
  );
  return "duplicate" in r ? { duplicate: true } : r;
}

/**
 * Stock count corrections and write-offs (damaged, expired, lost). A reason is
 * always required. Inventory Managers may change up to the organisation's
 * adjustment limit at once; larger changes need an Engineering Manager.
 */
export async function adjustStock(ctx: AccessContext, input: unknown): Promise<StockResult> {
  await requirePermission(ctx, "stock.adjust", { entityType: "stock_movement" });
  const data = parseInput(adjustSchema, input);
  if (data.writeOff && data.quantity < 0) {
    throw new ValidationError("Enter how many units are written off as a positive number.", {
      quantity: ["Use a positive number"],
    });
  }
  const r = await keyed(() =>
    withTenant(tenant(ctx), async (tx) => {
      if (await alreadyRecorded(tx, ctx.organization.id, data.requestKey)) return { duplicate: true } as Duplicate;
      const settings = await readSettings(tx, ctx.organization.id);
      if (ctx.role !== "ENGINEERING_MANAGER" && Math.abs(data.quantity) > settings.adjustmentLimit) {
        await auditDenied(
          ctx,
          "part",
          data.partId,
          data.writeOff ? "stock.write_off" : "stock.adjust",
          "above_adjustment_limit",
        );
        throw new AuthorizationError(
          data.writeOff ? "stock.write_off" : "stock.adjust",
          `Changes of more than ${settings.adjustmentLimit} units need an Engineering Manager.`,
        );
      }
      const part = await lockPart(tx, data.partId, { active: false });
      const store = await loadStore(ctx, tx, data.locationId, "stock.adjust", false);
      lotRules(part, data.lotNumber, null, false);
      const level = await tx.stockLevel.findUnique({
        where: {
          organizationId_partId_locationId_lotNumber: {
            organizationId: ctx.organization.id,
            partId: part.id,
            locationId: store.id,
            lotNumber: data.lotNumber,
          },
        },
        select: { onHand: true, expiresOn: true },
      });
      if (!level)
        throw new ValidationError("There is no record of this part (and lot) in this store.", {
          lotNumber: ["Unknown lot"],
        });
      const delta = data.writeOff ? -data.quantity : data.quantity;
      if (level.onHand + delta < 0) {
        throw new ValidationError(`Only ${level.onHand} recorded in ${store.code}.`, {
          quantity: ["More than on hand"],
        });
      }
      const m = await recordMovement(tx, ctx, {
        partId: part.id,
        locationId: store.id,
        lotNumber: data.lotNumber,
        expiresOn: level.expiresOn,
        type: data.writeOff ? "WRITE_OFF" : "ADJUSTMENT",
        quantity: delta,
        unitCost: part.unit_cost,
        currency: part.currency,
        reason: data.reason,
        idempotencyKey: data.requestKey,
      });
      await audit(tx, {
        organizationId: ctx.organization.id,
        actorUserId: ctx.user.id,
        action: data.writeOff ? "stock.written_off" : "stock.adjusted",
        entityType: "part",
        entityId: part.id,
        metadata: {
          partNumber: part.part_number,
          store: store.code,
          quantity: delta,
          lot: data.lotNumber || undefined,
        },
        request: ctx.request,
      });
      return { balance: m.balanceAfter };
    }),
  );
  return "duplicate" in r ? { duplicate: true } : r;
}

// ─── Movements and work-order views ──────────────────────────────────────────

export async function listMovements(
  ctx: AccessContext,
  raw: { type?: string; location?: string; page?: string; from?: string; to?: string } = {},
) {
  await requirePermission(ctx, "inventory.view", { entityType: "stock_movement" });
  const page = Math.max(1, Math.min(10000, Number(raw.page) || 1));
  const types = [
    "INITIAL",
    "RECEIPT",
    "ISSUE",
    "RETURN",
    "TRANSFER_OUT",
    "TRANSFER_IN",
    "ADJUSTMENT",
    "WRITE_OFF",
  ] as const;
  const type = types.find((t) => t === raw.type);
  return withTenant(tenant(ctx), async (tx) => {
    const stores = await tx.stockLocation.findMany({
      where: storeScopeWhere(ctx),
      select: { id: true, code: true, name: true },
    });
    const location = raw.location && stores.some((s) => s.id === raw.location) ? raw.location : undefined;
    const where: Prisma.StockMovementWhereInput = {
      locationId: location ? location : { in: stores.map((s) => s.id) },
      ...(type ? { type } : {}),
    };
    const PAGE = 50;
    const [total, rows] = await Promise.all([
      tx.stockMovement.count({ where }),
      tx.stockMovement.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * PAGE,
        take: PAGE,
        select: {
          id: true,
          type: true,
          quantity: true,
          balanceAfter: true,
          lotNumber: true,
          reference: true,
          reason: true,
          createdAt: true,
          performedById: true,
          part: { select: { id: true, partNumber: true, name: true } },
          location: { select: { code: true } },
          workOrder: { select: { id: true, number: true } },
        },
      }),
    ]);
    const { peopleNames } = await import("./work-order-core");
    const names = await peopleNames(
      tx,
      rows.map((r) => r.performedById),
    );
    return { rows, names, total, page, pageCount: Math.max(1, Math.ceil(total / PAGE)), stores, type, location };
  });
}

/** Parts reserved for, or issued to, open work orders in the user's stores. */
export async function partsOnOpenWorkOrders(ctx: AccessContext) {
  await requirePermission(ctx, "inventory.view", { entityType: "part_reservation" });
  return withTenant(tenant(ctx), async (tx) => {
    const stores = (await tx.stockLocation.findMany({ where: storeScopeWhere(ctx), select: { id: true } })).map(
      (s) => s.id,
    );
    const open = ["REQUESTED", "ASSIGNED", "IN_PROGRESS", "ON_HOLD"] as const;
    const [reservations, issued] = await Promise.all([
      tx.partReservation.findMany({
        where: { status: "ACTIVE", locationId: { in: stores } },
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          quantity: true,
          createdAt: true,
          part: { select: { id: true, partNumber: true, name: true } },
          location: { select: { code: true } },
          workOrder: { select: { id: true, number: true, status: true, asset: { select: { assetTag: true } } } },
        },
      }),
      tx.$queryRaw<
        {
          work_order_id: string;
          number: string;
          status: string;
          part_id: string;
          part_number: string;
          name: string;
          net: bigint;
        }[]
      >`
        SELECT w.id AS work_order_id, w.number, w.status::text AS status, p.id AS part_id, p.part_number, p.name, -sum(m.quantity) AS net
        FROM stock_movements m JOIN work_orders w ON w.id = m.work_order_id JOIN parts p ON p.id = m.part_id
        WHERE m.type IN ('ISSUE', 'RETURN') AND m.location_id IN (${Prisma.join(stores.length ? stores : ["00000000-0000-0000-0000-000000000000"])})
          AND w.status::text IN (${Prisma.join([...open])})
        GROUP BY 1, 2, 3, 4, 5, 6 HAVING -sum(m.quantity) > 0
        ORDER BY 2`,
    ]);
    return { reservations, issued: issued.map((i) => ({ ...i, net: n(i.net) })) };
  });
}

// ─── Settings ────────────────────────────────────────────────────────────────

export async function getInventorySettings(ctx: AccessContext) {
  await requirePermission(ctx, "inventory.view", { entityType: "inventory_settings" });
  return withTenant(tenant(ctx), (tx) => readSettings(tx, ctx.organization.id));
}

export async function saveInventorySettings(ctx: AccessContext, input: unknown) {
  await requirePermission(ctx, "inventory.settings", { entityType: "inventory_settings" });
  const { inventorySettingsSchema } = await import("@/lib/validation/inventory");
  const data = parseInput(inventorySettingsSchema, input);
  const clean = {
    warrantyReminderDays: [...new Set(data.warrantyReminderDays)].sort((a, b) => b - a),
    contractReminderDays: [...new Set(data.contractReminderDays)].sort((a, b) => b - a),
    stockExpiryWarningDays: data.stockExpiryWarningDays,
    lifecycleReviewLeadDays: data.lifecycleReviewLeadDays,
    adjustmentLimit: data.adjustmentLimit,
    updatedById: ctx.user.id,
  };
  return withTenant(tenant(ctx), async (tx) => {
    const before = await readSettings(tx, ctx.organization.id);
    await tx.inventorySettings.upsert({
      where: { organizationId: ctx.organization.id },
      create: { organizationId: ctx.organization.id, ...clean },
      update: clean,
    });
    await audit(tx, {
      organizationId: ctx.organization.id,
      actorUserId: ctx.user.id,
      action: "inventory.settings_changed",
      entityType: "inventory_settings",
      entityId: ctx.organization.id,
      metadata: {
        before: {
          warrantyReminderDays: before.warrantyReminderDays,
          contractReminderDays: before.contractReminderDays,
          stockExpiryWarningDays: before.stockExpiryWarningDays,
          lifecycleReviewLeadDays: before.lifecycleReviewLeadDays,
          adjustmentLimit: before.adjustmentLimit,
        },
        after: { ...clean, updatedById: undefined },
      },
      request: ctx.request,
    });
  });
}

/** Choices for the part form: catalogue entries and active suppliers. */
export async function partFormOptions(ctx: AccessContext) {
  await requirePermission(ctx, "inventory.manage", { entityType: "part" });
  return withTenant(tenant(ctx), async (tx) => {
    const [manufacturers, categories, models, suppliers] = await Promise.all([
      tx.manufacturer.findMany({
        where: { status: "ACTIVE" },
        select: { id: true, name: true },
        orderBy: { name: "asc" },
      }),
      tx.equipmentCategory.findMany({
        where: { status: "ACTIVE" },
        select: { id: true, name: true },
        orderBy: { name: "asc" },
      }),
      tx.equipmentModel.findMany({
        where: { status: "ACTIVE" },
        select: { id: true, modelName: true, manufacturer: { select: { name: true } } },
        orderBy: { modelName: "asc" },
      }),
      tx.supplier.findMany({ where: { status: "ACTIVE" }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    ]);
    return { manufacturers, categories, models, suppliers };
  });
}
