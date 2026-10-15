// Lifecycle, warranties, inventory, purchasing and suppliers (Stage 8).
//
// A separate fictional organisation ("Inventory Test Health") with known
// stock so every quantity can be checked exactly: receipts, reservations,
// issues, returns, transfers, adjustments and write-offs; negative stock,
// duplicate and concurrent operations; purchase approvals and receipts;
// warranty states and claims; lifecycle rules; reminders without duplicates;
// cost reporting; permissions and tenant isolation.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/server/db/client";
import { withTenant } from "@/server/db/tenant";
import { AuthorizationError, NotFoundError, ValidationError } from "@/server/authz/errors";
import { resolveAccess, type AccessContext } from "@/server/authz/access";
import {
  adjustStock,
  createStore,
  findPartByCode,
  getPart,
  listParts,
  receiveStock,
  saveInventorySettings,
  savePart,
  setPartArchived,
  stockState,
  suggestedReorder,
  transferStock,
} from "@/server/services/inventory";
import {
  getWorkOrderParts,
  issueParts,
  recordPartUnavailable,
  releaseReservation,
  reserveParts,
  returnParts,
} from "@/server/services/work-order-parts";
import {
  cancelPurchaseRequest,
  createPurchaseRequest,
  decidePurchaseRequest,
  getPurchaseRequest,
  markPurchaseOrdered,
  submitPurchaseRequest,
} from "@/server/services/purchasing";
import { getSupplier, listSuppliers, saveSupplier, setSupplierArchived } from "@/server/services/suppliers";
import {
  createExternalService,
  listServicesForWorkOrder,
  updateExternalService,
} from "@/server/services/external-services";
import {
  archiveWarranty,
  createClaim,
  getAssetWarranties,
  listWarranties,
  updateClaimStatus,
  updateWarranty,
  warrantyForAsset,
  warrantyState,
} from "@/server/services/warranties";
import {
  getAssetLifecycle,
  lifecycleStage,
  recordDisposal,
  recordReplacementReview,
} from "@/server/services/lifecycle";
import { reminderBucket, runInventoryReminders } from "@/server/services/inventory-reminders";
import { getCostReport } from "@/server/services/cost-analytics";
import { exportAnalyticsCsv } from "@/server/services/analytics";
import { addWarranty, changeAssetStatus } from "@/server/services/assets";
import { cancelWorkOrder } from "@/server/services/work-orders";
import { addDays, localToday } from "@/lib/pm/dates";
import { owner } from "../helpers";

afterAll(async () => {
  await db.$disconnect();
  await owner.$disconnect();
});

const TODAY = localToday("Africa/Nairobi");
const key = () => randomUUID();

type Fx = {
  orgId: string;
  otherOrgId: string;
  h1: string;
  h2: string;
  d1: string;
  manager: string;
  manager2: string;
  inv: string;
  tech: string;
  tech2: string;
  auditor: string;
  reporter: string;
  admin: string;
  other: string;
  s1: string;
  s1b: string;
  s2: string;
  otherStore: string;
  otherPart: string;
  p1: string;
  p2: string;
  assets: Record<string, string>;
  supplier: string;
  wo1: string;
  wo2: string;
  wo3: string;
};
let fx: Fx;

async function user(
  orgId: string,
  role: string,
  opts: { orgWide?: boolean; hospital?: string; department?: string } = {},
) {
  const id = randomUUID();
  await owner.user.create({
    data: {
      id,
      name: `IT ${role.toLowerCase()} ${id.slice(0, 4)}`,
      email: `it-${id.slice(0, 8)}@inventory.example`,
      emailVerified: true,
    },
  });
  const m = await owner.membership.create({
    data: { organizationId: orgId, userId: id, role: role as never, orgWide: Boolean(opts.orgWide) },
  });
  if (opts.hospital) {
    await owner.membershipScope.create({
      data: {
        organizationId: orgId,
        membershipId: m.id,
        hospitalId: opts.hospital,
        departmentId: opts.department ?? null,
      },
    });
  }
  return id;
}

async function ctx(userId: string, org?: string): Promise<AccessContext> {
  const u = await owner.user.findUniqueOrThrow({ where: { id: userId } });
  const c = await resolveAccess(
    { id: u.id, name: u.name, email: u.email, twoFactorEnabled: true, isPlatformAdmin: false },
    org ?? fx.orgId,
  );
  if (!c) throw new Error("no access");
  return c;
}

let woSeq = 0;
async function wo(data: Record<string, unknown> = {}) {
  woSeq++;
  return (
    await owner.workOrder.create({
      data: {
        organizationId: fx.orgId,
        number: `WO-2026-${String(woSeq).padStart(5, "0")}`,
        hospitalId: fx.h1,
        departmentId: fx.d1,
        assetId: fx.assets.A1,
        type: "CORRECTIVE",
        priority: "HIGH",
        status: "ASSIGNED",
        faultDescription: "Fictional inventory test job",
        reportedById: fx.reporter,
        assignedToId: fx.tech,
        ...data,
      } as never,
    })
  ).id;
}

async function onHand(partId: string, locationId: string) {
  const r = await owner.stockLevel.aggregate({ where: { partId, locationId }, _sum: { onHand: true } });
  return r._sum.onHand ?? 0;
}

beforeAll(async () => {
  const org = await owner.organization.create({
    data: { name: "Inventory Test Health", slug: `inventory-${randomUUID().slice(0, 6)}`, country: "KE" },
  });
  const h1 = await owner.hospital.create({
    data: { organizationId: org.id, name: "IT Nairobi Hospital", code: "ITN", timezone: "Africa/Nairobi" },
  });
  const h2 = await owner.hospital.create({
    data: { organizationId: org.id, name: "IT Mombasa Hospital", code: "ITM", timezone: "Africa/Nairobi" },
  });
  const d1 = await owner.department.create({
    data: { organizationId: org.id, hospitalId: h1.id, name: "ICU", code: "ICU" },
  });
  const d2 = await owner.department.create({
    data: { organizationId: org.id, hospitalId: h2.id, name: "Ward", code: "WARD" },
  });
  const otherOrg = await owner.organization.create({
    data: { name: "Other Test Org", slug: `other-${randomUUID().slice(0, 6)}`, country: "KE" },
  });
  const oh = await owner.hospital.create({
    data: { organizationId: otherOrg.id, name: "Other Hospital", code: "OTH", timezone: "Africa/Nairobi" },
  });

  fx = { orgId: org.id, otherOrgId: otherOrg.id, h1: h1.id, h2: h2.id, d1: d1.id } as Fx;
  fx.manager = await user(org.id, "ENGINEERING_MANAGER", { hospital: h1.id });
  fx.manager2 = await user(org.id, "ENGINEERING_MANAGER", { orgWide: true });
  fx.inv = await user(org.id, "INVENTORY_MANAGER", { hospital: h1.id });
  fx.tech = await user(org.id, "TECHNICIAN", { hospital: h1.id, department: d1.id });
  fx.tech2 = await user(org.id, "TECHNICIAN", { hospital: h1.id, department: d1.id });
  fx.auditor = await user(org.id, "AUDITOR", { orgWide: true });
  fx.reporter = await user(org.id, "FAULT_REPORTER", { hospital: h1.id, department: d1.id });
  fx.admin = await user(org.id, "ORG_ADMIN", { orgWide: true });
  fx.other = await user(otherOrg.id, "ENGINEERING_MANAGER", { orgWide: true });

  const mf = await owner.manufacturer.create({ data: { organizationId: org.id, name: "IT Devices (demo)" } });
  const cat = await owner.equipmentCategory.create({ data: { organizationId: org.id, name: "Infusion pump" } });
  const model = await owner.equipmentModel.create({
    data: {
      organizationId: org.id,
      manufacturerId: mf.id,
      categoryId: cat.id,
      modelName: "IT-Pump",
      expectedLifeYears: 8,
    },
  });
  const asset = async (tag: string, extra: Record<string, unknown> = {}) =>
    (
      await owner.asset.create({
        data: {
          organizationId: org.id,
          hospitalId: h1.id,
          departmentId: d1.id,
          modelId: model.id,
          assetTag: tag,
          name: `Pump ${tag}`,
          ...extra,
        } as never,
      })
    ).id;
  fx.assets = {
    A1: await asset("IT-A1", { purchaseDate: new Date("2020-01-10T00:00:00Z") }),
    A2: await asset("IT-A2"),
    DEC: await asset("IT-DEC"),
    A4: await asset("IT-A4", { hospitalId: h2.id, departmentId: d2.id }),
  };
  await owner.asset.update({ where: { id: fx.assets.DEC }, data: { status: "DECOMMISSIONED" } });

  // Stores (two in Nairobi, one in Mombasa) and the other organisation's store and part.
  const mgr = await ctx(fx.manager);
  fx.s1 = (await createStore(mgr, { hospitalId: h1.id, code: "MAIN", name: "Main biomed store" })).id;
  fx.s1b = (await createStore(mgr, { hospitalId: h1.id, code: "ICU-CUP", name: "ICU cupboard" })).id;
  fx.s2 = (
    await owner.stockLocation.create({
      data: { organizationId: org.id, hospitalId: h2.id, code: "MSA", name: "Mombasa store", createdById: fx.manager2 },
    })
  ).id;
  fx.otherStore = (
    await owner.stockLocation.create({
      data: { organizationId: otherOrg.id, hospitalId: oh.id, code: "X", name: "Other store", createdById: fx.other },
    })
  ).id;
  fx.otherPart = (
    await owner.part.create({
      data: { organizationId: otherOrg.id, partNumber: "SECRET-1", name: "Other org part", createdById: fx.other },
    })
  ).id;

  const sup = await saveSupplier(await ctx(fx.inv), {
    name: "Demo Medical Supplies Ltd",
    kinds: ["DISTRIBUTOR", "SERVICE_PROVIDER"],
    contactName: "Fictional Contact",
    email: "service@demo-supplies.example",
    phone: "+254 700 000 000",
    serviceCategories: "Infusion pumps, Batteries",
    manufacturerIds: [mf.id],
  });
  fx.supplier = sup.id;

  const invCtx = await ctx(fx.inv);
  fx.p1 = (
    await savePart(invCtx, {
      partNumber: "bat-it-01",
      name: "Pump battery pack",
      manufacturerId: mf.id,
      manufacturerPartNumber: "MFR-BAT-77",
      unit: "EACH",
      minLevel: "2",
      targetLevel: "10",
      unitCost: "12.50",
      currency: "usd",
      modelIds: [model.id],
      supplierIds: [fx.supplier],
    })
  ).id;
  fx.p2 = (
    await savePart(invCtx, {
      partNumber: "TUBE-SET-1",
      name: "Administration set (sterile)",
      unit: "BOX",
      minLevel: "1",
      tracksLots: "on",
      tracksExpiry: "on",
      categoryIds: [cat.id],
    })
  ).id;
  fx.wo1 = await wo();
  fx.wo2 = await wo({ assignedToId: fx.manager });
  fx.wo3 = await wo();
});

// ─── Units ───────────────────────────────────────────────────────────────────

describe("definitions", () => {
  it("stock state and suggested reorder", () => {
    expect(stockState(0, 2)).toBe("out");
    expect(stockState(-1, 2)).toBe("out");
    expect(stockState(2, 2)).toBe("low");
    expect(stockState(3, 2)).toBe("ok");
    expect(suggestedReorder(1, 0, 2, 10)).toBe(9);
    expect(suggestedReorder(1, 4, 2, 10)).toBe(5);
    expect(suggestedReorder(1, 20, 2, 10)).toBe(0);
    expect(suggestedReorder(5, 0, 2, 10)).toBeNull(); // not low
    expect(suggestedReorder(0, 0, 2, null)).toBeNull(); // no target configured
  });

  it("warranty state comes from the recorded dates only", () => {
    expect(warrantyState(null, "2027-03-31", "2026-10-15", 90)).toBe("active");
    expect(warrantyState(null, "2026-11-30", "2026-10-15", 90)).toBe("expiring");
    expect(warrantyState(null, "2026-10-15", "2026-10-15", 90)).toBe("expiring");
    expect(warrantyState(null, "2026-10-14", "2026-10-15", 90)).toBe("expired");
    expect(warrantyState("2026-11-01", "2028-01-01", "2026-10-15", 90)).toBe("not_started");
  });

  it("reminder buckets: one reminder per threshold window, never several at once", () => {
    expect(reminderBucket(95, [90, 60, 30])).toBeNull();
    expect(reminderBucket(90, [90, 60, 30])).toBe(90);
    expect(reminderBucket(61, [90, 60, 30])).toBe(90);
    expect(reminderBucket(20, [90, 60, 30])).toBe(30);
    expect(reminderBucket(0, [90, 60, 30])).toBe(30);
    expect(reminderBucket(-1, [90, 60, 30])).toBeNull();
  });

  it("lifecycle stage is derived from the existing status and safety records", () => {
    const base = {
      status: "IN_SERVICE",
      commissionedOn: null,
      replacementReview: null,
      openHold: false,
      pendingDecommission: false,
      faultAwaitingAssessment: false,
      today: "2026-10-15",
    };
    expect(lifecycleStage(base).key).toBe("in_service");
    expect(lifecycleStage({ ...base, commissionedOn: "2026-11-01" }).key).toBe("awaiting_commissioning");
    expect(lifecycleStage({ ...base, replacementReview: "DUE" }).key).toBe("replacement_review");
    expect(lifecycleStage({ ...base, status: "OUT_OF_SERVICE" }).key).toBe("unavailable");
    expect(lifecycleStage({ ...base, status: "OUT_OF_SERVICE", faultAwaitingAssessment: true }).key).toBe(
      "awaiting_assessment",
    );
    expect(lifecycleStage({ ...base, status: "UNDER_REPAIR" }).key).toBe("under_repair");
    expect(lifecycleStage({ ...base, status: "OUT_OF_SERVICE", openHold: true }).label).toBe(
      "Failed Safety Test — Do Not Use",
    );
    expect(lifecycleStage({ ...base, status: "DECOMMISSIONED", openHold: true }).key).toBe("decommissioned");
  });
});

// ─── Catalogue and stock ─────────────────────────────────────────────────────

describe("parts catalogue", () => {
  it("only inventory managers and engineering managers manage parts; part numbers are unique and fixed", async () => {
    await expect(
      savePart(await ctx(fx.tech), { partNumber: "X-1", name: "Nope", unit: "EACH", minLevel: "0" }),
    ).rejects.toBeInstanceOf(AuthorizationError);
    const part = await owner.part.findUniqueOrThrow({ where: { id: fx.p1 } });
    expect(part.partNumber).toBe("BAT-IT-01"); // normalised for the barcode
    await expect(
      savePart(await ctx(fx.inv), { partNumber: "BAT-IT-01", name: "Duplicate", unit: "EACH", minLevel: "0" }),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      savePart(await ctx(fx.inv), { id: fx.p1, partNumber: "BAT-IT-02", name: "Renamed", unit: "EACH", minLevel: "2" }),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      savePart(await ctx(fx.inv), {
        partNumber: "EXP-ONLY",
        name: "Bad",
        unit: "EACH",
        minLevel: "0",
        tracksExpiry: "on",
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });
});

describe("stock movements", () => {
  it("receiving stock: recorded once even if the form is submitted twice", async () => {
    const inv = await ctx(fx.inv);
    const k = key();
    expect(
      await receiveStock(inv, {
        requestKey: k,
        partId: fx.p1,
        locationId: fx.s1,
        initial: "on",
        quantity: "5",
        supplierId: fx.supplier,
      }),
    ).toMatchObject({ balance: 5 });
    expect(
      await receiveStock(inv, { requestKey: k, partId: fx.p1, locationId: fx.s1, initial: "on", quantity: "5" }),
    ).toEqual({ duplicate: true });
    expect(await onHand(fx.p1, fx.s1)).toBe(5);
    expect(await owner.stockMovement.count({ where: { partId: fx.p1 } })).toBe(1);
  });

  it("concurrent duplicates of the same submission are recorded once", async () => {
    const inv = await ctx(fx.inv);
    const k = key();
    const results = await Promise.all(
      [1, 2, 3].map(() =>
        receiveStock(inv, {
          requestKey: k,
          partId: fx.p1,
          locationId: fx.s1b,
          quantity: "2",
          unitCost: "11.00",
          currency: "USD",
        }),
      ),
    );
    expect(results.filter((r) => !r.duplicate)).toHaveLength(1);
    expect(await onHand(fx.p1, fx.s1b)).toBe(2);
  });

  it("who may receive, and only into stores of their hospitals", async () => {
    await expect(
      receiveStock(await ctx(fx.tech), { requestKey: key(), partId: fx.p1, locationId: fx.s1, quantity: "1" }),
    ).rejects.toBeInstanceOf(AuthorizationError);
    await expect(
      receiveStock(await ctx(fx.inv), { requestKey: key(), partId: fx.p1, locationId: fx.s2, quantity: "1" }),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      receiveStock(await ctx(fx.inv), { requestKey: key(), partId: fx.otherPart, locationId: fx.s1, quantity: "1" }),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      receiveStock(await ctx(fx.inv), { requestKey: key(), partId: fx.p1, locationId: fx.otherStore, quantity: "1" }),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      receiveStock(await ctx(fx.inv), { requestKey: key(), partId: fx.p1, locationId: fx.s1, quantity: "0" }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("lots and expiry dates are required where the part tracks them", async () => {
    const inv = await ctx(fx.inv);
    await expect(
      receiveStock(inv, { requestKey: key(), partId: fx.p2, locationId: fx.s1, quantity: "4" }),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      receiveStock(inv, { requestKey: key(), partId: fx.p2, locationId: fx.s1, quantity: "4", lotNumber: "L1" }),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      receiveStock(inv, { requestKey: key(), partId: fx.p1, locationId: fx.s1, quantity: "1", lotNumber: "L1" }),
    ).rejects.toBeInstanceOf(ValidationError);
    await receiveStock(inv, {
      requestKey: key(),
      partId: fx.p2,
      locationId: fx.s1,
      quantity: "4",
      lotNumber: "L1",
      expiresOn: addDays(TODAY, 30),
    });
    await receiveStock(inv, {
      requestKey: key(),
      partId: fx.p2,
      locationId: fx.s1,
      quantity: "3",
      lotNumber: "L0",
      expiresOn: addDays(TODAY, -5),
      initial: "on",
    });
    await expect(
      receiveStock(inv, {
        requestKey: key(),
        partId: fx.p2,
        locationId: fx.s1,
        quantity: "1",
        lotNumber: "L1",
        expiresOn: addDays(TODAY, 99),
      }),
    ).rejects.toBeInstanceOf(ValidationError);
    const view = await getPart(inv, fx.p2);
    const main = view.perStore.find((s) => s.store.id === fx.s1)!;
    expect(main).toMatchObject({ onHand: 7, usable: 4, reserved: 0, available: 4 });
  });
});

describe("parts on work orders", () => {
  it("reserving: only the assigned technician (or a manager), never more than available", async () => {
    const tech = await ctx(fx.tech);
    await reserveParts(tech, {
      requestKey: key(),
      workOrderId: fx.wo1,
      partId: fx.p1,
      locationId: fx.s1,
      quantity: "3",
    });
    await expect(
      reserveParts(tech, { requestKey: key(), workOrderId: fx.wo1, partId: fx.p1, locationId: fx.s1, quantity: "3" }),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      reserveParts(await ctx(fx.tech2), {
        requestKey: key(),
        workOrderId: fx.wo1,
        partId: fx.p1,
        locationId: fx.s1,
        quantity: "1",
      }),
    ).rejects.toBeInstanceOf(AuthorizationError);
    await expect(
      reserveParts(await ctx(fx.auditor), {
        requestKey: key(),
        workOrderId: fx.wo1,
        partId: fx.p1,
        locationId: fx.s1,
        quantity: "1",
      }),
    ).rejects.toBeInstanceOf(AuthorizationError);
    await expect(
      reserveParts(tech, { requestKey: key(), workOrderId: fx.wo1, partId: fx.p1, locationId: fx.s2, quantity: "1" }),
    ).rejects.toBeInstanceOf(NotFoundError);
    const view = await getPart(await ctx(fx.inv), fx.p1);
    expect(view.perStore.find((s) => s.store.id === fx.s1)).toMatchObject({ onHand: 5, reserved: 3, available: 2 });
  });

  it("transfers cannot take reserved stock; a transfer is one paired movement", async () => {
    const inv = await ctx(fx.inv);
    await expect(
      transferStock(inv, {
        requestKey: key(),
        partId: fx.p1,
        fromLocationId: fx.s1,
        toLocationId: fx.s1b,
        quantity: "3",
      }),
    ).rejects.toBeInstanceOf(ValidationError);
    await transferStock(inv, {
      requestKey: key(),
      partId: fx.p1,
      fromLocationId: fx.s1,
      toLocationId: fx.s1b,
      quantity: "2",
    });
    expect(await onHand(fx.p1, fx.s1)).toBe(3);
    expect(await onHand(fx.p1, fx.s1b)).toBe(4);
    const pair = await owner.stockMovement.findMany({
      where: { partId: fx.p1, type: { in: ["TRANSFER_OUT", "TRANSFER_IN"] } },
    });
    expect(pair).toHaveLength(2);
    expect(pair[0].transferId).toBe(pair[1].transferId);
    expect(pair.reduce((s, m) => s + m.quantity, 0)).toBe(0);
  });

  it("issuing a reservation updates stock atomically and only once; the job and device are not changed", async () => {
    const tech = await ctx(fx.tech);
    const res = await owner.partReservation.findFirstOrThrow({ where: { workOrderId: fx.wo1, status: "ACTIVE" } });
    const k = key();
    await issueParts(tech, { requestKey: k, workOrderId: fx.wo1, reservationId: res.id });
    expect(await issueParts(tech, { requestKey: k, workOrderId: fx.wo1, reservationId: res.id })).toEqual({
      duplicate: true,
    });
    expect(await onHand(fx.p1, fx.s1)).toBe(0);
    expect((await owner.partReservation.findUniqueOrThrow({ where: { id: res.id } })).status).toBe("ISSUED");
    expect((await owner.workOrder.findUniqueOrThrow({ where: { id: fx.wo1 } })).status).toBe("ASSIGNED");
    expect((await owner.asset.findUniqueOrThrow({ where: { id: fx.assets.A1 } })).status).toBe("IN_SERVICE");
    const events = await owner.workOrderEvent.findMany({
      where: { workOrderId: fx.wo1, kind: { in: ["PARTS_RESERVED", "PARTS_ISSUED"] } },
    });
    expect(events).toHaveLength(2);
  });

  it("stock can never go negative: refused by the service and by the database", async () => {
    await expect(
      issueParts(await ctx(fx.tech), {
        requestKey: key(),
        workOrderId: fx.wo1,
        partId: fx.p1,
        locationId: fx.s1,
        quantity: "1",
      }),
    ).rejects.toBeInstanceOf(ValidationError);
    // Even a direct database insert by the owner is refused by the trigger.
    await expect(
      owner.stockMovement.create({
        data: {
          organizationId: fx.orgId,
          partId: fx.p1,
          locationId: fx.s1,
          type: "ADJUSTMENT",
          quantity: -1,
          reason: "test direct",
          idempotencyKey: key(),
          performedById: fx.manager,
        },
      }),
    ).rejects.toThrow();
    // The application role cannot write stock levels at all.
    await expect(
      withTenant(
        { userId: fx.manager, organizationId: fx.orgId },
        (tx) => tx.$executeRaw`UPDATE stock_levels SET on_hand = 99`,
      ),
    ).rejects.toThrow(/permission denied/);
    expect(await onHand(fx.p1, fx.s1)).toBe(0);
  });

  it("concurrent issues of the last units: one succeeds, never both", async () => {
    // ICU cupboard has 4: two jobs each try to take 3 at the same moment.
    const m = await ctx(fx.manager);
    const outcomes = await Promise.allSettled([
      issueParts(m, { requestKey: key(), workOrderId: fx.wo2, partId: fx.p1, locationId: fx.s1b, quantity: "3" }),
      issueParts(m, { requestKey: key(), workOrderId: fx.wo3, partId: fx.p1, locationId: fx.s1b, quantity: "3" }),
    ]);
    expect(outcomes.filter((o) => o.status === "fulfilled")).toHaveLength(1);
    const rejected = outcomes.find((o) => o.status === "rejected") as PromiseRejectedResult;
    expect(rejected.reason).toBeInstanceOf(ValidationError);
    expect(await onHand(fx.p1, fx.s1b)).toBe(1);
  });

  it("returns: only what was issued to the job, back into stock", async () => {
    const tech = await ctx(fx.tech);
    await expect(
      returnParts(tech, { requestKey: key(), workOrderId: fx.wo1, partId: fx.p1, locationId: fx.s1, quantity: "4" }),
    ).rejects.toBeInstanceOf(ValidationError);
    await returnParts(tech, {
      requestKey: key(),
      workOrderId: fx.wo1,
      partId: fx.p1,
      locationId: fx.s1,
      quantity: "1",
      reason: "Not needed",
    });
    expect(await onHand(fx.p1, fx.s1)).toBe(1);
    const parts = await getWorkOrderParts(tech, fx.wo1);
    expect(parts!.used).toEqual([expect.objectContaining({ net: 2 })]);
    expect(parts!.partsCost).toBeNull(); // technicians do not see costs
    const mgrView = await getWorkOrderParts(await ctx(fx.manager), fx.wo1);
    expect(mgrView!.partsCost).toEqual([{ currency: "USD", total: 25 }]);
  });

  it("first-expiry-first-out from usable lots; expired lots are never issued", async () => {
    const tech = await ctx(fx.tech);
    await issueParts(tech, { requestKey: key(), workOrderId: fx.wo1, partId: fx.p2, locationId: fx.s1, quantity: "2" });
    const lots = await owner.stockLevel.findMany({
      where: { partId: fx.p2, locationId: fx.s1 },
      orderBy: { lotNumber: "asc" },
    });
    expect(lots.map((l) => [l.lotNumber, l.onHand])).toEqual([
      ["L0", 3],
      ["L1", 2],
    ]);
    await expect(
      issueParts(tech, { requestKey: key(), workOrderId: fx.wo1, partId: fx.p2, locationId: fx.s1, quantity: "3" }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("a part that is not available is recorded in the job timeline without changing stock", async () => {
    const before = await owner.stockMovement.count();
    await recordPartUnavailable(await ctx(fx.tech), {
      workOrderId: fx.wo1,
      partId: fx.p1,
      description: "Battery out of stock at both stores",
      quantity: "1",
    });
    expect(await owner.stockMovement.count()).toBe(before);
    expect(await owner.workOrderEvent.count({ where: { workOrderId: fx.wo1, kind: "PARTS_UNAVAILABLE" } })).toBe(1);
  });

  it("cancelling a job releases reservations but does NOT return issued parts", async () => {
    const m = await ctx(fx.manager);
    const job = await wo({ assignedToId: fx.manager });
    await receiveStock(await ctx(fx.inv), { requestKey: key(), partId: fx.p1, locationId: fx.s1, quantity: "4" });
    await reserveParts(m, { requestKey: key(), workOrderId: job, partId: fx.p1, locationId: fx.s1, quantity: "2" });
    await issueParts(m, { requestKey: key(), workOrderId: job, partId: fx.p1, locationId: fx.s1, quantity: "1" });
    await cancelWorkOrder(m, { id: job, reason: "Device replaced under contract" });
    expect(await owner.partReservation.count({ where: { workOrderId: job, status: "ACTIVE" } })).toBe(0);
    expect(await owner.partReservation.count({ where: { workOrderId: job, status: "RELEASED" } })).toBe(1);
    expect(await owner.stockMovement.count({ where: { workOrderId: job, type: "RETURN" } })).toBe(0);
    expect(await onHand(fx.p1, fx.s1)).toBe(4); // 1 + 4 − 1 issued; the reservation is free again
    await expect(
      reserveParts(m, { requestKey: key(), workOrderId: job, partId: fx.p1, locationId: fx.s1, quantity: "1" }),
    ).rejects.toBeInstanceOf(ValidationError);
    // The actual return can still be recorded afterwards.
    await returnParts(m, { requestKey: key(), workOrderId: job, partId: fx.p1, locationId: fx.s1, quantity: "1" });
    expect(await onHand(fx.p1, fx.s1)).toBe(5);
  });

  it("releasing a reservation is recorded once", async () => {
    const m = await ctx(fx.manager);
    await reserveParts(m, { requestKey: key(), workOrderId: fx.wo2, partId: fx.p1, locationId: fx.s1, quantity: "1" });
    const r = await owner.partReservation.findFirstOrThrow({ where: { workOrderId: fx.wo2, status: "ACTIVE" } });
    await releaseReservation(m, { reservationId: r.id });
    expect(await releaseReservation(m, { reservationId: r.id })).toEqual({ duplicate: true });
  });
});

describe("adjustments and write-offs", () => {
  it("need a reason; inventory managers are limited; history is preserved", async () => {
    const inv = await ctx(fx.inv);
    await expect(
      adjustStock(inv, { requestKey: key(), partId: fx.p1, locationId: fx.s1, quantity: "-1", reason: "" }),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      adjustStock(await ctx(fx.tech), {
        requestKey: key(),
        partId: fx.p1,
        locationId: fx.s1,
        quantity: "-1",
        reason: "Count difference",
      }),
    ).rejects.toBeInstanceOf(AuthorizationError);
    await adjustStock(inv, {
      requestKey: key(),
      partId: fx.p1,
      locationId: fx.s1,
      quantity: "-1",
      reason: "Annual count: one missing",
    });
    expect(await onHand(fx.p1, fx.s1)).toBe(4);
    await expect(
      adjustStock(inv, {
        requestKey: key(),
        partId: fx.p1,
        locationId: fx.s1,
        quantity: "50",
        reason: "Found a box in storage",
      }),
    ).rejects.toBeInstanceOf(AuthorizationError);
    await adjustStock(await ctx(fx.manager), {
      requestKey: key(),
      partId: fx.p1,
      locationId: fx.s1,
      quantity: "11",
      reason: "Found a box in storage",
    });
    expect(await onHand(fx.p1, fx.s1)).toBe(15);
    await adjustStock(inv, {
      requestKey: key(),
      partId: fx.p2,
      locationId: fx.s1,
      lotNumber: "L0",
      writeOff: "on",
      quantity: "3",
      reason: "Expired lot",
    });
    await expect(
      adjustStock(inv, {
        requestKey: key(),
        partId: fx.p2,
        locationId: fx.s1,
        lotNumber: "L1",
        writeOff: "on",
        quantity: "9",
        reason: "Damaged",
      }),
    ).rejects.toBeInstanceOf(ValidationError);
    const writeOff = await owner.stockMovement.findFirstOrThrow({ where: { partId: fx.p2, type: "WRITE_OFF" } });
    expect(writeOff.quantity).toBe(-3);
    // Movements are append-only, even for the database owner.
    await expect(
      owner.stockMovement.update({ where: { id: writeOff.id }, data: { reason: "changed" } }),
    ).rejects.toThrow();
    await expect(owner.stockMovement.delete({ where: { id: writeOff.id } })).rejects.toThrow();
    // The level always equals the sum of movements.
    const sum = await owner.stockMovement.aggregate({
      where: { partId: fx.p1, locationId: fx.s1 },
      _sum: { quantity: true },
    });
    expect(sum._sum.quantity).toBe(await onHand(fx.p1, fx.s1));
  });

  it("the adjustment limit is configurable by managers and audited", async () => {
    await expect(
      saveInventorySettings(await ctx(fx.inv), {
        warrantyReminderDays: "90",
        contractReminderDays: "60",
        stockExpiryWarningDays: "30",
        lifecycleReviewLeadDays: "30",
        adjustmentLimit: "100",
      }),
    ).rejects.toBeInstanceOf(AuthorizationError);
    await expect(
      saveInventorySettings(await ctx(fx.manager), {
        warrantyReminderDays: "400",
        contractReminderDays: "60",
        stockExpiryWarningDays: "30",
        lifecycleReviewLeadDays: "30",
        adjustmentLimit: "5",
      }),
    ).rejects.toBeInstanceOf(ValidationError);
    await saveInventorySettings(await ctx(fx.manager), {
      warrantyReminderDays: "30, 90, 60",
      contractReminderDays: "90 30",
      stockExpiryWarningDays: "60",
      lifecycleReviewLeadDays: "30",
      adjustmentLimit: "10",
    });
    const s = await owner.inventorySettings.findUniqueOrThrow({ where: { organizationId: fx.orgId } });
    expect(s.warrantyReminderDays).toEqual([90, 60, 30]);
    expect(
      await owner.auditLog.count({ where: { organizationId: fx.orgId, action: "inventory.settings_changed" } }),
    ).toBe(1);
  });
});

describe("inventory views and part look-up", () => {
  it("low, out-of-stock, reserved and expiring views", async () => {
    const inv = await ctx(fx.inv);
    const all = await listParts(inv, {});
    const p1 = all.parts.find((p) => p.id === fx.p1)!;
    expect(p1).toMatchObject({ onHand: 16, available: 16, stockState: "ok" });
    expect(p1.unitCost).toBe("12.50");
    expect((await listParts(await ctx(fx.tech), {})).parts.find((p) => p.id === fx.p1)!.unitCost).toBeNull();
    const expiring = await listParts(inv, { view: "expiring" });
    expect(expiring.parts.map((p) => p.id)).toEqual([fx.p2]);
    const store = await listParts(inv, { location: fx.s1b, view: "low" });
    expect(store.parts.map((p) => p.id)).toEqual([fx.p1]); // 1 available, minimum 2
    expect(store.parts[0].suggestedReorder).toBe(9);
    await expect(listParts(inv, { location: fx.s2 })).rejects.toBeInstanceOf(NotFoundError);
  });

  it("barcode / typed look-up is resolved on the server within the organisation", async () => {
    const tech = await ctx(fx.tech);
    expect(await findPartByCode(tech, "bat-it-01")).toEqual({ kind: "part", partId: fx.p1 });
    expect(await findPartByCode(tech, " MFR-BAT-77 ")).toEqual({ kind: "part", partId: fx.p1 });
    expect(await findPartByCode(tech, "SECRET-1")).toEqual({ kind: "not-found" });
    expect(await findPartByCode(tech, "NOPE")).toEqual({ kind: "not-found" });
    await expect(findPartByCode(await ctx(fx.reporter), "BAT-IT-01")).rejects.toBeInstanceOf(AuthorizationError);
  });

  it("a part with stock cannot be archived", async () => {
    await expect(setPartArchived(await ctx(fx.inv), { id: fx.p1, archived: true })).rejects.toBeInstanceOf(
      ValidationError,
    );
  });
});

// ─── Purchasing ──────────────────────────────────────────────────────────────

describe("purchase requests", () => {
  let pr = "";
  it("draft → submitted by the requester → approved by a second person", async () => {
    const tech = await ctx(fx.tech);
    const r = await createPurchaseRequest(tech, {
      hospitalId: fx.h1,
      supplierId: fx.supplier,
      justification: "Battery stock below minimum",
      lines: [{ partId: fx.p1, quantity: "10", estimatedUnitCost: "12.50", currency: "USD" }],
    });
    pr = r.id;
    expect(r.number).toMatch(/^PR-\d{4}-0001$/);
    await expect(submitPurchaseRequest(await ctx(fx.tech2), { id: pr })).rejects.toBeInstanceOf(AuthorizationError);
    await submitPurchaseRequest(tech, { id: pr });
    await expect(decidePurchaseRequest(tech, { id: pr, approve: "on" })).rejects.toBeInstanceOf(AuthorizationError);
    await expect(decidePurchaseRequest(await ctx(fx.inv), { id: pr, approve: "on" })).rejects.toBeInstanceOf(
      AuthorizationError,
    );
    const stockBefore = await onHand(fx.p1, fx.s1);
    await decidePurchaseRequest(await ctx(fx.manager), { id: pr, approve: "on" });
    expect((await owner.purchaseRequest.findUniqueOrThrow({ where: { id: pr } })).status).toBe("APPROVED");
    expect(await onHand(fx.p1, fx.s1)).toBe(stockBefore); // approval is not stock
    // Lines are frozen once submitted (database trigger).
    await expect(
      owner.purchaseRequestLine.updateMany({ where: { requestId: pr }, data: { quantity: 99 } }),
    ).rejects.toThrow();
  });

  it("nobody approves their own request (service and database)", async () => {
    const m = await ctx(fx.manager);
    const r = await createPurchaseRequest(m, { hospitalId: fx.h1, lines: [{ partId: fx.p2, quantity: "2" }] });
    await submitPurchaseRequest(m, { id: r.id });
    await expect(decidePurchaseRequest(m, { id: r.id, approve: "on" })).rejects.toBeInstanceOf(AuthorizationError);
    await expect(
      owner.purchaseRequest.update({
        where: { id: r.id },
        data: { status: "APPROVED", decidedById: fx.manager, decidedAt: new Date() },
      }),
    ).rejects.toThrow();
    await expect(decidePurchaseRequest(await ctx(fx.manager2), { id: r.id, approve: "" })).rejects.toBeInstanceOf(
      ValidationError,
    ); // rejection needs a reason
    await decidePurchaseRequest(await ctx(fx.manager2), { id: r.id, approve: "", note: "Use existing stock first" });
    await expect(cancelPurchaseRequest(m, { id: r.id, reason: "x" })).rejects.toBeInstanceOf(ValidationError);
  });

  it("stock increases only with receipts against an ORDERED request, never beyond the quantity", async () => {
    const inv = await ctx(fx.inv);
    const line = await owner.purchaseRequestLine.findFirstOrThrow({ where: { requestId: pr } });
    await expect(
      receiveStock(inv, {
        requestKey: key(),
        partId: fx.p1,
        locationId: fx.s1,
        quantity: "4",
        purchaseLineId: line.id,
      }),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(markPurchaseOrdered(await ctx(fx.tech), { id: pr, orderReference: "LPO-123" })).rejects.toBeInstanceOf(
      AuthorizationError,
    );
    await markPurchaseOrdered(inv, { id: pr, orderReference: "LPO-123" });
    const before = await onHand(fx.p1, fx.s1);
    await receiveStock(inv, {
      requestKey: key(),
      partId: fx.p1,
      locationId: fx.s1,
      quantity: "4",
      purchaseLineId: line.id,
      unitCost: "12.00",
      currency: "USD",
    });
    expect((await owner.purchaseRequest.findUniqueOrThrow({ where: { id: pr } })).status).toBe("PARTIALLY_RECEIVED");
    await expect(
      receiveStock(inv, {
        requestKey: key(),
        partId: fx.p1,
        locationId: fx.s1,
        quantity: "7",
        purchaseLineId: line.id,
      }),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      receiveStock(inv, {
        requestKey: key(),
        partId: fx.p1,
        locationId: fx.s2,
        quantity: "1",
        purchaseLineId: line.id,
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
    await receiveStock(inv, {
      requestKey: key(),
      partId: fx.p1,
      locationId: fx.s1,
      quantity: "6",
      purchaseLineId: line.id,
    });
    expect(await onHand(fx.p1, fx.s1)).toBe(before + 10);
    const done = await getPurchaseRequest(await ctx(fx.manager), pr);
    expect(done.request.status).toBe("RECEIVED");
    expect(done.request.lines[0].receivedQuantity).toBe(10);
    expect(done.estimate).toEqual([{ currency: "USD", total: 125 }]);
    expect((await getPurchaseRequest(await ctx(fx.tech), pr)).estimate).toBeNull();
    // Even the database owner cannot receive against a request that was not ordered.
    const draft = await createPurchaseRequest(await ctx(fx.tech), {
      hospitalId: fx.h1,
      lines: [{ partId: fx.p1, quantity: "1" }],
    });
    const dl = await owner.purchaseRequestLine.findFirstOrThrow({ where: { requestId: draft.id } });
    await expect(
      owner.stockMovement.create({
        data: {
          organizationId: fx.orgId,
          partId: fx.p1,
          locationId: fx.s1,
          type: "RECEIPT",
          quantity: 1,
          purchaseLineId: dl.id,
          idempotencyKey: key(),
          performedById: fx.inv,
        },
      }),
    ).rejects.toThrow();
  });

  it("other hospitals and organisations cannot see requests", async () => {
    await expect(getPurchaseRequest(await ctx(fx.other, fx.otherOrgId), pr)).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      createPurchaseRequest(await ctx(fx.tech), { hospitalId: fx.h2, lines: [{ partId: fx.p1, quantity: "1" }] }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});

// ─── Suppliers and external service ──────────────────────────────────────────

describe("suppliers", () => {
  it("permissions, unique names and tenant isolation", async () => {
    await expect(saveSupplier(await ctx(fx.tech), { name: "Nope", kinds: ["OTHER"] })).rejects.toBeInstanceOf(
      AuthorizationError,
    );
    await expect(
      saveSupplier(await ctx(fx.inv), { name: "demo medical supplies LTD", kinds: ["OTHER"] }),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      saveSupplier(await ctx(fx.inv), { name: "Bad Email Co", kinds: ["OTHER"], email: "not-an-email" }),
    ).rejects.toBeInstanceOf(ValidationError);
    const s = await getSupplier(await ctx(fx.tech), fx.supplier);
    expect(s.supplier.manufacturers).toHaveLength(1);
    expect(s.parts.map((p) => p.part.id)).toContain(fx.p1);
    await expect(getSupplier(await ctx(fx.other, fx.otherOrgId), fx.supplier)).rejects.toBeInstanceOf(NotFoundError);
    expect((await listSuppliers(await ctx(fx.other, fx.otherOrgId))).suppliers).toHaveLength(0);
    await expect(getSupplier(await ctx(fx.reporter), fx.supplier)).rejects.toBeInstanceOf(AuthorizationError);
    const extra = await saveSupplier(await ctx(fx.inv), { name: "Short-lived Co", kinds: ["OTHER"] });
    await setSupplierArchived(await ctx(fx.inv), { id: extra.id, archived: true });
    expect((await listSuppliers(await ctx(fx.inv))).suppliers.map((x) => x.id)).not.toContain(extra.id);
  });
});

describe("external service on work orders", () => {
  it("dates and statuses are validated; performance only when both dates exist; costs are financial", async () => {
    const tech = await ctx(fx.tech);
    const svc = await createExternalService(tech, {
      workOrderId: fx.wo1,
      supplierId: fx.supplier,
      description: "Return pump to agent for motor replacement",
      requestedOn: addDays(TODAY, -10),
      expectedBy: addDays(TODAY, -3),
    });
    await expect(
      createExternalService(await ctx(fx.tech2), {
        workOrderId: fx.wo1,
        supplierId: fx.supplier,
        description: "Not mine",
        requestedOn: TODAY,
      }),
    ).rejects.toBeInstanceOf(AuthorizationError);
    await expect(
      createExternalService(tech, {
        workOrderId: fx.wo1,
        supplierId: fx.supplier,
        description: "Bad dates",
        requestedOn: TODAY,
        expectedBy: addDays(TODAY, -1),
      }),
    ).rejects.toBeInstanceOf(ValidationError);
    const base = {
      id: svc.id,
      supplierReference: "AG-77",
      dispatchedOn: addDays(TODAY, -9),
      expectedBy: addDays(TODAY, -3),
    };
    await expect(updateExternalService(tech, { ...base, status: "COMPLETED" })).rejects.toBeInstanceOf(ValidationError);
    await expect(
      updateExternalService(tech, { ...base, status: "IN_PROGRESS", completedOn: TODAY }),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      updateExternalService(tech, { ...base, status: "COMPLETED", completedOn: addDays(TODAY, -20) }),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      updateExternalService(tech, { ...base, status: "COMPLETED", completedOn: addDays(TODAY, 5) }),
    ).rejects.toBeInstanceOf(ValidationError);
    // A technician cannot set the (financial) cost.
    await updateExternalService(tech, {
      ...base,
      status: "COMPLETED",
      completedOn: addDays(TODAY, -1),
      serviceReportRef: "SR-9",
      cost: "300.00",
      currency: "USD",
    });
    expect((await owner.externalService.findUniqueOrThrow({ where: { id: svc.id } })).cost).toBeNull();
    await updateExternalService(await ctx(fx.manager), {
      ...base,
      status: "COMPLETED",
      completedOn: addDays(TODAY, -1),
      serviceReportRef: "SR-9",
      cost: "300.00",
      currency: "USD",
    });
    await expect(
      updateExternalService(await ctx(fx.manager), { ...base, status: "IN_PROGRESS" }),
    ).rejects.toBeInstanceOf(ValidationError);
    const list = await listServicesForWorkOrder(await ctx(fx.manager), fx.wo1);
    expect(list!.rows[0]).toMatchObject({ onTime: false });
    expect(String(list!.rows[0].cost)).toBe("300");
    expect((await listServicesForWorkOrder(tech, fx.wo1))!.rows[0].cost).toBeNull();
    // The supplier finishing its part does not complete the job.
    expect((await owner.workOrder.findUniqueOrThrow({ where: { id: fx.wo1 } })).status).toBe("ASSIGNED");
  });
});

// ─── Warranties and claims ───────────────────────────────────────────────────

describe("warranties and claims", () => {
  let warrantyId = "";
  it("records the Stage 8 details, validates dates, and lists active / expiring / expired / missing", async () => {
    const m = await ctx(fx.manager);
    await addWarranty(m, {
      assetId: fx.assets.A1,
      kind: "WARRANTY",
      provider: "Demo Medical Supplies Ltd",
      startsOn: addDays(TODAY, -300),
      endsOn: addDays(TODAY, 20),
      supplierId: fx.supplier,
      reference: "WTY-1",
      coversParts: "yes",
      coversLabour: "no",
      exclusions: "Batteries and accessories",
    });
    await addWarranty(m, {
      assetId: fx.assets.A2,
      kind: "SERVICE_CONTRACT",
      provider: "Demo Medical Supplies Ltd",
      endsOn: addDays(TODAY, 400),
      responseTargetHours: "48",
    });
    await addWarranty(m, {
      assetId: fx.assets.A2,
      kind: "WARRANTY",
      provider: "Old cover",
      endsOn: addDays(TODAY, -1),
    });
    await expect(
      addWarranty(m, {
        assetId: fx.assets.A1,
        kind: "WARRANTY",
        provider: "Bad",
        startsOn: TODAY,
        endsOn: addDays(TODAY, -1),
      }),
    ).rejects.toBeInstanceOf(ValidationError);
    const w = await owner.warranty.findFirstOrThrow({ where: { assetId: fx.assets.A1 } });
    warrantyId = w.id;
    expect(w).toMatchObject({ coversParts: true, coversLabour: false, supplierId: fx.supplier });
    await expect(
      updateWarranty(m, { id: w.id, provider: "X Co", endsOn: addDays(TODAY, 20), responseTargetHours: "24" }),
    ).rejects.toBeInstanceOf(ValidationError);
    const lists = await listWarranties(m, { view: "expiring" });
    expect(lists.counts).toMatchObject({ expiring: 1, expired: 1, contracts: 1 });
    expect(lists.rows.map((r) => r.id)).toEqual([w.id]);
    expect((await listWarranties(m, { view: "missing" })).missing.map((a) => a.id)).not.toContain(fx.assets.A1);
    await expect(listWarranties(await ctx(fx.reporter), {})).rejects.toBeInstanceOf(AuthorizationError);
    const forJob = await warrantyForAsset(await ctx(fx.tech), fx.assets.A1);
    expect(forJob!.rows[0]).toMatchObject({ state: "active", coversParts: true, coversLabour: false });
    expect(await warrantyForAsset(await ctx(fx.reporter), fx.assets.A1)).toBeNull();
  });

  it("claim statuses follow the real sequence; decided claims are final; history is kept", async () => {
    const m = await ctx(fx.manager);
    await expect(
      createClaim(await ctx(fx.tech), { warrantyId, description: "Battery failure" }),
    ).rejects.toBeInstanceOf(AuthorizationError);
    const c = await createClaim(m, {
      warrantyId,
      workOrderId: fx.wo1,
      description: "Battery pack failed after 10 months",
      amountClaimed: "25.00",
      currency: "USD",
    });
    await expect(
      updateClaimStatus(m, { claimId: c.id, status: "ACCEPTED", date: TODAY, outcome: "ok" }),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(updateClaimStatus(m, { claimId: c.id, status: "SUBMITTED" })).rejects.toBeInstanceOf(ValidationError);
    await updateClaimStatus(m, {
      claimId: c.id,
      status: "SUBMITTED",
      date: addDays(TODAY, -5),
      claimReference: "CLM-55",
      evidence: "Service report SR-9 and photos",
    });
    await expect(
      updateClaimStatus(m, { claimId: c.id, status: "ACCEPTED", date: addDays(TODAY, -6), outcome: "Accepted" }),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      updateClaimStatus(m, {
        claimId: c.id,
        status: "REJECTED",
        date: TODAY,
        outcome: "Out of scope",
        amountRecovered: "10",
      }),
    ).rejects.toBeInstanceOf(ValidationError);
    await updateClaimStatus(m, {
      claimId: c.id,
      status: "PARTIALLY_ACCEPTED",
      date: TODAY,
      outcome: "Parts replaced free; labour charged",
      amountRecovered: "25.00",
    });
    await expect(updateClaimStatus(m, { claimId: c.id, status: "WITHDRAWN" })).rejects.toBeInstanceOf(ValidationError);
    const view = await getAssetWarranties(m, fx.assets.A1);
    expect(view!.claims[0].events.map((e) => e.toStatus)).toEqual(["DRAFT", "SUBMITTED", "PARTIALLY_ACCEPTED"]);
    expect((await getAssetWarranties(await ctx(fx.tech), fx.assets.A1))!.claims[0].amountRecovered).toBeNull();
    await expect(owner.warrantyClaimEvent.deleteMany({ where: { claimId: c.id } })).rejects.toThrow();
    await expect(archiveWarranty(m, { id: warrantyId })).resolves.toBeUndefined();
  });
});

// ─── Lifecycle ───────────────────────────────────────────────────────────────

describe("lifecycle", () => {
  it("replacement review is recorded and never changes the device status", async () => {
    await expect(
      recordReplacementReview(await ctx(fx.tech), { assetId: fx.assets.A2, outcome: "DUE", reason: "Age review" }),
    ).rejects.toBeInstanceOf(AuthorizationError);
    await expect(
      recordReplacementReview(await ctx(fx.manager), {
        assetId: fx.assets.A2,
        outcome: "DUE",
        nextReviewOn: addDays(TODAY, -1),
        reason: "Age review",
      }),
    ).rejects.toBeInstanceOf(ValidationError);
    await recordReplacementReview(await ctx(fx.manager), {
      assetId: fx.assets.A2,
      outcome: "IN_REVIEW",
      nextReviewOn: addDays(TODAY, 10),
      reason: "Parts support ending",
    });
    const a = await owner.asset.findUniqueOrThrow({ where: { id: fx.assets.A2 } });
    expect(a).toMatchObject({ status: "IN_SERVICE", replacementReview: "IN_REVIEW" });
    const life = await getAssetLifecycle(await ctx(fx.tech), fx.assets.A2);
    expect(life.stage.key).toBe("replacement_review");
    expect(life.history.map((h) => h.title)).toEqual(
      expect.arrayContaining(["Replacement review: Under review", "Warranty recorded: Old cover"]),
    );
  });

  it("disposal only for decommissioned devices, once; decommissioned devices can never be re-activated", async () => {
    const m = await ctx(fx.manager);
    await expect(
      recordDisposal(m, { assetId: fx.assets.A2, method: "RECYCLED", effectiveOn: TODAY, reason: "E-waste" }),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      recordDisposal(m, {
        assetId: fx.assets.DEC,
        method: "RECYCLED",
        effectiveOn: addDays(TODAY, 2),
        reason: "E-waste",
      }),
    ).rejects.toBeInstanceOf(ValidationError);
    await recordDisposal(m, {
      assetId: fx.assets.DEC,
      method: "RECYCLED",
      effectiveOn: TODAY,
      reference: "EW-2026-14",
      reason: "Certified e-waste contractor",
    });
    await expect(
      recordDisposal(m, { assetId: fx.assets.DEC, method: "SOLD", effectiveOn: TODAY, reason: "Again" }),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      changeAssetStatus(m, { id: fx.assets.DEC, status: "IN_SERVICE", reason: "Back" }),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      recordReplacementReview(m, { assetId: fx.assets.DEC, outcome: "RETAIN", reason: "Keep" }),
    ).rejects.toBeInstanceOf(ValidationError);
    // Last line of defence: the database refuses even the owner.
    await expect(owner.asset.update({ where: { id: fx.assets.DEC }, data: { status: "IN_SERVICE" } })).rejects.toThrow(
      /decommissioned/,
    );
    await expect(
      owner.lifecycleEvent.create({
        data: {
          organizationId: fx.orgId,
          assetId: fx.assets.A2,
          eventType: "DISPOSAL",
          status: "RECORDED",
          disposalMethod: "SOLD",
          reason: "Sneaky disposal",
          requestedById: fx.manager,
          decidedAt: new Date(),
        },
      }),
    ).rejects.toThrow();
    const life = await getAssetLifecycle(m, fx.assets.DEC);
    expect(life.stage.key).toBe("decommissioned");
    expect(life.disposal).toMatchObject({ disposalMethod: "RECYCLED", reference: "EW-2026-14" });
  });
});

// ─── Reminders ───────────────────────────────────────────────────────────────

describe("reminders", () => {
  it("are sent once to the right people, in the right organisation, without costs", async () => {
    // A lifecycle review due, an overdue supplier job (from above is completed; add an open one), low stock and an expiring lot exist.
    const low = await savePart(await ctx(fx.inv), {
      partNumber: "FUSE-2A",
      name: "Fuse 2 A",
      unit: "PACK",
      minLevel: "5",
    });
    await receiveStock(await ctx(fx.inv), {
      requestKey: key(),
      partId: low.id,
      locationId: fx.s1b,
      quantity: "2",
      initial: "on",
    });
    await createExternalService(await ctx(fx.manager), {
      workOrderId: fx.wo2,
      supplierId: fx.supplier,
      description: "Calibration at agent",
      requestedOn: addDays(TODAY, -8),
      expectedBy: addDays(TODAY, -2),
    });
    const first = await runInventoryReminders({ organizationIds: [fx.orgId] });
    expect(first[0].failed).toBe(false);
    const notes = await owner.notification.findMany({
      where: {
        organizationId: fx.orgId,
        type: {
          in: [
            "warranty.expiring",
            "contract.expiring",
            "stock.low",
            "stock.out",
            "stock.expiring",
            "stock.expired",
            "service.overdue",
            "lifecycle.review_due",
          ],
        },
      },
    });
    const types = new Set(notes.map((n) => n.type));
    expect(types).toEqual(new Set(["stock.low", "stock.expiring", "service.overdue", "lifecycle.review_due"]));
    // (The 20-day warranty was archived above, so no warranty reminder is due.)
    const recipients = new Set(notes.map((n) => n.userId));
    expect(recipients.has(fx.tech2)).toBe(false);
    expect(recipients.has(fx.reporter)).toBe(false);
    expect(recipients.has(fx.other)).toBe(false);
    expect(
      notes
        .filter((n) => n.type === "stock.low")
        .map((n) => n.userId)
        .sort(),
    ).toEqual([fx.inv, fx.manager, fx.manager2].sort());
    expect(notes.every((n) => !/USD|12\.5|300/.test(`${n.title} ${n.body}`))).toBe(true);
    const second = await runInventoryReminders({ organizationIds: [fx.orgId] });
    expect(second[0].sent).toBe(0);
  });

  it("warranty expiry: one reminder per window", async () => {
    const m = await ctx(fx.manager);
    await addWarranty(m, {
      assetId: fx.assets.A2,
      kind: "WARRANTY",
      provider: "Fresh cover",
      endsOn: addDays(TODAY, 20),
    });
    await runInventoryReminders({ organizationIds: [fx.orgId] });
    const w = await owner.notification.findMany({ where: { organizationId: fx.orgId, type: "warranty.expiring" } });
    expect(w.map((n) => n.userId).sort()).toEqual([fx.admin, fx.manager, fx.manager2].sort());
    expect(w[0].title).toBe("Warranty for IT-A2 ends in 20 days");
    await runInventoryReminders({ organizationIds: [fx.orgId] });
    expect(await owner.notification.count({ where: { organizationId: fx.orgId, type: "warranty.expiring" } })).toBe(3);
  });
});

// ─── Reporting ───────────────────────────────────────────────────────────────

describe("parts and cost reporting", () => {
  it("costs only from recorded figures, per currency, for financial roles (audited)", async () => {
    const period = { period: "custom", from: addDays(TODAY, -30), to: TODAY };
    const before = await owner.auditLog.count({
      where: { organizationId: fx.orgId, action: "analytics.financial_viewed" },
    });
    const r = await getCostReport(await ctx(fx.auditor), period);
    expect(
      await owner.auditLog.count({ where: { organizationId: fx.orgId, action: "analytics.financial_viewed" } }),
    ).toBe(before + 1);
    // BAT-IT-01 net used on jobs: wo1 2, wo2 or wo3 3, cancelled job 0 → 5 at 12.50 = 62.50 USD; TUBE-SET-1 has no cost recorded.
    expect(r.consumption.find((c) => c.part_number === "BAT-IT-01")!.used).toBe(5);
    expect(r.costs!.partsByCurrency).toEqual([{ currency: "USD", total: "62.50" }]);
    expect(r.costs!.unpricedIssues).toBe(1);
    expect(r.costs!.serviceByCurrency).toEqual([{ currency: "USD", total: "300.00", records: 1 }]);
    const a1 = r.costs!.byAsset.find((x) => x.asset_tag === "IT-A1")!;
    expect(a1).toMatchObject({ currency: "USD", service: "300.00" });
    expect(r.writeOffs.map((w) => [w.part_number, w.units])).toEqual([["TUBE-SET-1", 3]]);
    expect(r.supplierHistory[0]).toMatchObject({ requests: 2, completed: 1, withDates: 1, onTime: 0 });
    expect(r.claims).toEqual([{ status: "PARTIALLY_ACCEPTED", claims: 1 }]);
    expect(r.costs!.recovered).toEqual([{ currency: "USD", total: "25.00" }]);
    const tech = await getCostReport(await ctx(fx.tech), period);
    expect(tech.costs).toBeNull();
    expect(tech.consumption.length).toBeGreaterThan(0);
    const csv = await exportAnalyticsCsv(await ctx(fx.auditor), "costs", period);
    expect(csv.csv).toContain('"Parts, external service and maintenance cost"');
    expect(csv.csv).toContain('"IT-A1"');
    await expect(exportAnalyticsCsv(await ctx(fx.tech), "costs", period)).rejects.toBeInstanceOf(AuthorizationError);
  });

  it("another organisation sees none of this organisation's stock (RLS)", async () => {
    const seen = await withTenant({ userId: fx.other, organizationId: fx.otherOrgId }, (tx) =>
      Promise.all([
        tx.stockMovement.count({ where: { partId: fx.p1 } }),
        tx.stockLevel.count({ where: { partId: fx.p1 } }),
        tx.part.count({ where: { id: fx.p1 } }),
      ]),
    );
    expect(seen).toEqual([0, 0, 0]);
    await expect(getPart(await ctx(fx.other, fx.otherOrgId), fx.p1)).rejects.toBeInstanceOf(NotFoundError);
  });
});
