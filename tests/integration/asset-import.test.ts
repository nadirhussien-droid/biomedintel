// Bulk upload of assets: preview, import, catalog creation, scope and audit.
import { afterAll, describe, expect, it } from "vitest";
import { db } from "@/server/db/client";
import { AuthorizationError, NotFoundError, ValidationError } from "@/server/authz/errors";
import { importAssets, previewAssetImport } from "@/server/services/asset-import";
import { createAsset, listAssets } from "@/server/services/assets";
import type { ImportRow } from "@/lib/asset-import";
import { coastalAssetInput, contextFor, departmentId, hospitalId, owner, uniqueCode, addTestMember } from "../helpers";

const C = "coastal-health";

afterAll(async () => {
  await db.$disconnect();
  await owner.$disconnect();
});

const amina = () => contextFor("amina.warsame@coastal.example"); // technician, Coastal

function row(over: Partial<ImportRow> = {}): ImportRow {
  return {
    line: 2,
    assetTag: uniqueCode("IMP-"),
    name: "Imported pump",
    manufacturer: "Fictional Maker " + uniqueCode("M"),
    model: "Model " + uniqueCode("X"),
    category: "Imported Category " + uniqueCode("C"),
    serialNumber: null,
    inventoryNumber: null,
    location: null,
    status: null,
    riskClass: null,
    electricalClass: null,
    appliedPartType: null,
    purchaseDate: null,
    supplier: null,
    notes: null,
    ...over,
  };
}

async function where() {
  return { hospitalId: await hospitalId(C, "RGH"), departmentId: await departmentId(C, "RGH", "ICU") };
}

describe("bulk asset upload", () => {
  it("previews without saving, then imports, creating missing catalog entries and keeping asset IDs", async () => {
    const ctx = await amina();
    const w = await where();
    const a = row({ location: "Import Room " + uniqueCode("L"), serialNumber: "SN-" + uniqueCode("S") });
    const b = row({ manufacturer: a.manufacturer, category: a.category }); // same maker and category, new model
    const before = await owner.asset.count({ where: { assetTag: { in: [a.assetTag, b.assetTag] } } });

    const preview = await previewAssetImport(ctx, { ...w, rows: [a, b] });
    expect(preview.counts).toEqual({ new: 2, exists: 0, error: 0 });
    expect(preview.create).toEqual({ manufacturers: 1, categories: 1, models: 2, locations: 1 });
    expect(await owner.asset.count({ where: { assetTag: { in: [a.assetTag, b.assetTag] } } })).toBe(before);
    expect(await owner.manufacturer.count({ where: { name: a.manufacturer } })).toBe(0);

    const result = await importAssets(ctx, { ...w, rows: [a, b], fileName: "test.xlsx", authorisationConfirmed: true });
    expect(result.created).toBe(2);
    expect(result.failed).toEqual([]);
    expect(result.createdCatalog).toEqual({ manufacturers: 1, categories: 1, models: 2, locations: 1 });

    const saved = await owner.asset.findFirstOrThrow({
      where: { assetTag: a.assetTag },
      include: { model: { include: { manufacturer: true, category: true } }, location: true },
    });
    expect(saved.assetTag).toBe(a.assetTag); // kept exactly
    expect(saved.model.manufacturer.name).toBe(a.manufacturer);
    expect(saved.model.category.name).toBe(a.category);
    expect(saved.location?.name).toBe(a.location);
    expect(saved.status).toBe("IN_SERVICE");

    const batch = await owner.auditLog.findFirstOrThrow({
      where: { action: "asset.bulk_imported", actorUserId: ctx.user.id },
      orderBy: { createdAt: "desc" },
    });
    expect(batch.metadata).toMatchObject({ fileName: "test.xlsx", created: 2, authorisationConfirmed: true });
    expect(await owner.auditLog.count({ where: { action: "asset.created", entityId: saved.id } })).toBe(1);
  });

  it("saves electrical class and applied part type, and finds assets that still lack details", async () => {
    const ctx = await amina();
    const w = await where();
    const full = row({
      electricalClass: "Class II",
      appliedPartType: "BF",
      riskClass: "High",
      serialNumber: "SN-" + uniqueCode("S"),
    });
    const bare = row(); // only the four required columns
    const odd = row({ electricalClass: "Class 9", appliedPartType: "XX" });
    const preview = await previewAssetImport(ctx, { ...w, rows: [odd] });
    expect(preview.rows[0]!.problems.concat(preview.rows[0]!.warnings).join(" ")).toMatch(/Electrical class/);

    const result = await importAssets(ctx, {
      ...w,
      rows: [full, bare],
      fileName: "t.xlsx",
      authorisationConfirmed: true,
    });
    expect(result.created).toBe(2);
    expect(result.needDetails).toBe(1);
    const saved = await owner.asset.findFirstOrThrow({ where: { assetTag: full.assetTag } });
    expect(saved.electricalClass).toBe("CLASS_II");
    expect(saved.appliedPartType).toBe("TYPE_BF");
    const empty = await owner.asset.findFirstOrThrow({ where: { assetTag: bare.assetTag } });
    expect(empty.electricalClass).toBeNull();

    const find = (tag: string) => listAssets(ctx, { incomplete: "1", q: tag });
    expect((await find(bare.assetTag)).rows.map((x: { assetTag: string }) => x.assetTag)).toEqual([bare.assetTag]);
    expect((await find(full.assetTag)).rows).toEqual([]);
  });

  it("skips assets already in the register, so uploading the same file twice is safe", async () => {
    const ctx = await amina();
    const w = await where();
    const a = row();
    await importAssets(ctx, { ...w, rows: [a], fileName: "x.csv", authorisationConfirmed: true });
    const again = await importAssets(ctx, { ...w, rows: [a], fileName: "x.csv", authorisationConfirmed: true });
    expect(again.created).toBe(0);
    expect(again.skippedExisting).toBe(1);
    expect(await owner.asset.count({ where: { assetTag: a.assetTag } })).toBe(1);
  });

  it("reuses existing manufacturers and models, ignoring capital letters", async () => {
    const ctx = await amina();
    const w = await where();
    const existing = await owner.equipmentModel.findFirstOrThrow({
      where: { organization: { slug: C }, modelName: "DM-Infuse 100" },
      include: { manufacturer: true, category: true },
    });
    const r = row({
      manufacturer: existing.manufacturer.name.toUpperCase(),
      model: existing.modelName.toLowerCase(),
      category: existing.category.name.toUpperCase(),
    });
    const preview = await previewAssetImport(ctx, { ...w, rows: [r] });
    expect(preview.create).toEqual({ manufacturers: 0, categories: 0, models: 0, locations: 0 });
    const result = await importAssets(ctx, { ...w, rows: [r], fileName: "x.csv", authorisationConfirmed: true });
    expect(result.created).toBe(1);
    const saved = await owner.asset.findFirstOrThrow({ where: { assetTag: r.assetTag } });
    expect(saved.modelId).toBe(existing.id);
  });

  it("rejects bad rows in the preview and still imports the good ones", async () => {
    const ctx = await amina();
    const w = await where();
    const good = row();
    const noTag = row({ assetTag: "" });
    const badTag = row({ assetTag: "BAD TAG!" });
    const twice = row({ assetTag: good.assetTag });
    const shortName = row({ manufacturer: "X" });
    const preview = await previewAssetImport(ctx, { ...w, rows: [good, noTag, badTag, twice, shortName] });
    expect(preview.counts).toEqual({ new: 1, exists: 0, error: 4 });
    const result = await importAssets(ctx, {
      ...w,
      rows: [good, noTag, badTag, twice, shortName],
      fileName: "x.csv",
      authorisationConfirmed: true,
    });
    expect(result.created).toBe(1);
    expect(result.failed).toHaveLength(4);
  });

  it("flags repeated serial numbers and inventory numbers", async () => {
    const ctx = await amina();
    const w = await where();
    const first = row({ serialNumber: "DUP-" + uniqueCode("S"), inventoryNumber: "INV-" + uniqueCode("I") });
    const second = row({
      manufacturer: first.manufacturer,
      model: first.model,
      category: first.category,
      serialNumber: first.serialNumber,
    });
    const third = row({ inventoryNumber: first.inventoryNumber });
    const preview = await previewAssetImport(ctx, { ...w, rows: [first, second, third] });
    expect(preview.rows[1]!.outcome).toBe("NEW");
    expect(preview.rows[1]!.warnings.join(" ")).toMatch(/Serial number/);
    expect(preview.rows[2]!.outcome).toBe("ERROR");
    expect(preview.rows[2]!.problems.join(" ")).toMatch(/Inventory number/);
    const result = await importAssets(ctx, {
      ...w,
      rows: [first, second, third],
      fileName: "x.csv",
      authorisationConfirmed: true,
    });
    expect(result.created).toBe(2); // the repeated serial is allowed after the warning
  });

  it("ignores unusable status, risk and date values instead of failing the row", async () => {
    const ctx = await amina();
    const w = await where();
    const r = row({ status: "Complete", riskClass: "Severe", purchaseDate: "next year" });
    const preview = await previewAssetImport(ctx, { ...w, rows: [r] });
    expect(preview.counts.new).toBe(1);
    expect(preview.notes.join(" ")).toMatch(/Complete/);
    const ok = row({ status: "Out of service", riskClass: "high", purchaseDate: "2024-03-15" });
    await importAssets(ctx, { ...w, rows: [ok], fileName: "x.csv", authorisationConfirmed: true });
    const saved = await owner.asset.findFirstOrThrow({ where: { assetTag: ok.assetTag } });
    expect(saved.status).toBe("OUT_OF_SERVICE");
    expect(saved.riskClass).toBe("HIGH");
    expect(saved.purchaseDate?.toISOString().slice(0, 10)).toBe("2024-03-15");
  });

  it("will not save without the authorisation tick", async () => {
    const ctx = await amina();
    const w = await where();
    const r = row();
    await expect(
      importAssets(ctx, { ...w, rows: [r], fileName: "x.csv", authorisationConfirmed: false }),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(await owner.asset.count({ where: { assetTag: r.assetTag } })).toBe(0);
  });

  it("is refused outside the person's hospitals, for roles that cannot register assets, and for other organisations", async () => {
    const james = await contextFor("james.otieno@coastal.example", C); // Riverside only
    const nch = { hospitalId: await hospitalId(C, "NCH"), departmentId: await departmentId(C, "NCH", "WARDS") };
    await expect(previewAssetImport(james, { ...nch, rows: [row()] })).rejects.toBeInstanceOf(NotFoundError);

    const reporter = await contextFor(await addTestMember(C, "FAULT_REPORTER", [{ hospital: "RGH" }]), C);
    await expect(previewAssetImport(reporter, { ...(await where()), rows: [row()] })).rejects.toBeInstanceOf(
      AuthorizationError,
    );

    const david = await contextFor("david.mutua@highland.example");
    await expect(previewAssetImport(david, { ...(await where()), rows: [row()] })).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  it("uses the same asset rules as the single form (an imported ID cannot be reused)", async () => {
    const ctx = await amina();
    const w = await where();
    const r = row();
    await importAssets(ctx, { ...w, rows: [r], fileName: "x.csv", authorisationConfirmed: true });
    await expect(createAsset(ctx, await coastalAssetInput({ assetTag: r.assetTag }))).rejects.toBeInstanceOf(
      ValidationError,
    );
  });
});
