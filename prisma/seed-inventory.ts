// Fictional suppliers, stores, spare parts and opening stock for development (Stage 8).
//
// FICTIONAL DEMONSTRATION DATA: no real company, part number, price or
// contract. Opening stock is recorded as INITIAL stock movements, exactly as a
// person would record it, so stock levels come from the movement log.
import { randomUUID } from "node:crypto";
import type { PrismaClient } from "../server/db/generated/client";
import { addDays, localToday, toDbDate } from "../lib/pm/dates";

export async function seedInventory(
  db: PrismaClient,
  organizationId: string,
  slug: string,
  users: Map<string, string>,
) {
  if (slug !== "coastal-health") return;
  const grace = users.get("grace.mwangi@coastal.example")!; // Inventory Manager
  const james = users.get("james.otieno@coastal.example")!; // Engineering Manager
  const hospitals = await db.hospital.findMany({
    where: { organizationId },
    select: { id: true, code: true, timezone: true },
  });
  const rgh = hospitals.find((h) => h.code === "RGH")!;
  const nch = hospitals.find((h) => h.code === "NCH")!;
  const today = localToday(rgh.timezone);
  const model = (name: string) =>
    db.equipmentModel.findFirstOrThrow({
      where: { organizationId, modelName: name },
      select: { id: true, manufacturerId: true },
    });
  const category = (name: string) =>
    db.equipmentCategory.findFirstOrThrow({ where: { organizationId, name }, select: { id: true } });

  const service = await db.supplier.create({
    data: {
      organizationId,
      name: "Demo Medical Services Ltd (demo)",
      kinds: ["MANUFACTURER", "SERVICE_PROVIDER"],
      contactName: "Demo Service Desk",
      email: "service@demo-medical.example",
      phone: "+254 700 000 000",
      address: "Fictional address, Nairobi",
      serviceCategories: ["Infusion pumps", "Repairs", "Warranty service"],
      notes: "Fictional supplier for demonstration.",
      createdById: james,
    },
  });
  const parts = await db.supplier.create({
    data: {
      organizationId,
      name: "Example Parts Supply (demo)",
      kinds: ["PARTS_SUPPLIER"],
      contactName: "Demo Orders",
      email: "orders@example-parts.example",
      serviceCategories: ["Batteries", "Consumables", "Filters"],
      createdById: grace,
    },
  });
  const inf = await model("DM-Infuse 100");
  await db.supplierManufacturer.create({
    data: { organizationId, supplierId: service.id, manufacturerId: inf.manufacturerId },
  });

  // Link the first seeded infusion pump warranty to the supplier register (details as recorded, fictional).
  const infWarranty = await db.warranty.findFirst({
    where: { organizationId, asset: { assetTag: "INF-0001" }, kind: "WARRANTY" },
    select: { id: true },
  });
  if (infWarranty) {
    await db.warranty.update({
      where: { id: infWarranty.id },
      data: {
        supplierId: service.id,
        reference: "DEMO-WTY-0001",
        coversParts: true,
        coversLabour: null,
        exclusions: "Fictional: damage from liquid ingress or drops is excluded.",
        documentReference: "Fictional: shared drive › Biomedical › Warranties",
      },
    });
  }

  const rghStore = await db.stockLocation.create({
    data: {
      organizationId,
      hospitalId: rgh.id,
      code: "RGH-BME",
      name: "RGH biomedical workshop store",
      createdById: grace,
    },
  });
  await db.stockLocation.create({
    data: { organizationId, hospitalId: nch.id, code: "NCH-BME", name: "NCH biomedical store", createdById: grace },
  });

  const mon = await category("Patient monitor");
  const def = await model("SC-Shock 2");
  const ven = await model("EB-Breathe 300");
  const battery = await db.part.create({
    data: {
      organizationId,
      partNumber: "BAT-0001",
      name: "Infusion pump battery pack (demo)",
      manufacturerId: inf.manufacturerId,
      manufacturerPartNumber: "DM-BAT-100",
      minLevel: 2,
      targetLevel: 6,
      unitCost: "4500.00",
      currency: "KES",
      createdById: grace,
    },
  });
  const pads = await db.part.create({
    data: {
      organizationId,
      partNumber: "PAD-0001",
      name: "Defibrillator electrode pads, adult (demo)",
      manufacturerId: def.manufacturerId,
      unit: "PAIR",
      minLevel: 4,
      targetLevel: 10,
      unitCost: "1800.00",
      currency: "KES",
      tracksLots: true,
      tracksExpiry: true,
      createdById: grace,
    },
  });
  const filter = await db.part.create({
    data: {
      organizationId,
      partNumber: "FLT-0001",
      name: "Ventilator inlet filter (demo)",
      manufacturerId: ven.manufacturerId,
      minLevel: 5,
      targetLevel: 12,
      createdById: grace,
    },
  });
  const spo2 = await db.part.create({
    data: {
      organizationId,
      partNumber: "SPO2-0001",
      name: "SpO2 finger sensor, reusable (demo)",
      minLevel: 2,
      targetLevel: 5,
      unitCost: "2500.00",
      currency: "KES",
      createdById: grace,
    },
  });

  await db.partCompatibility.createMany({
    data: [
      { organizationId, partId: battery.id, modelId: inf.id },
      { organizationId, partId: pads.id, modelId: def.id },
      { organizationId, partId: filter.id, modelId: ven.id },
      { organizationId, partId: spo2.id, categoryId: mon.id },
    ],
  });
  await db.partSupplier.createMany({
    data: [
      { organizationId, partId: battery.id, supplierId: parts.id, supplierPartNumber: "EPS-7781" },
      { organizationId, partId: pads.id, supplierId: parts.id },
    ],
  });

  // Opening stock (INITIAL movements; the database trigger keeps the levels).
  const initial = async (
    partId: string,
    quantity: number,
    extra: { lotNumber?: string; expiresOn?: string; unitCost?: string } = {},
  ) =>
    db.stockMovement.create({
      data: {
        organizationId,
        partId,
        locationId: rghStore.id,
        type: "INITIAL",
        quantity,
        lotNumber: extra.lotNumber ?? "",
        expiresOn: extra.expiresOn ? toDbDate(extra.expiresOn) : null,
        unitCost: extra.unitCost ?? null,
        currency: extra.unitCost ? "KES" : null,
        reason: "Opening stock count (fictional)",
        idempotencyKey: `seed-${randomUUID()}`,
        performedById: grace,
      },
    });
  await initial(battery.id, 3, { unitCost: "4500.00" });
  await initial(pads.id, 6, { lotNumber: "DEMO-LOT-A", expiresOn: addDays(today, 40), unitCost: "1800.00" });
  await initial(filter.id, 1);
}
