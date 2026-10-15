// Equipment asset register: authorization, scope, tenant isolation, barcodes,
// labels, export, audit events and the decommissioning approval rule.
// These call the same service functions the pages and server actions call.
import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { db } from "@/server/db/client";
import { AuthorizationError, NotFoundError, ValidationError } from "@/server/authz/errors";
import {
  archiveAsset,
  changeAssetStatus,
  createAsset,
  decideDecommission,
  exportAssetsCsv,
  findAssetByCode,
  getAsset,
  getAssetsForLabels,
  listAssets,
  listPendingDecommissions,
  requestDecommission,
  restoreAsset,
  updateAsset,
} from "@/server/services/assets";
import { createLocation, createManufacturer } from "@/server/services/equipment-catalog";
import {
  assetId,
  assetRow,
  auditCount,
  coastalAssetInput,
  contextFor,
  departmentId,
  hospitalId,
  modelId,
  orgId,
  owner,
  uniqueCode,
  userByEmail,
} from "../helpers";

afterAll(async () => {
  await db.$disconnect();
  await owner.$disconnect();
});

const C = "coastal-health";
const H = "highland-medical";

async function editInput(tag: string, orgSlug = C, overrides: Record<string, unknown> = {}) {
  const a = await assetRow(orgSlug, tag);
  const d = (v: Date | null) => (v ? v.toISOString().slice(0, 10) : "");
  return {
    id: a.id,
    version: a.updatedAt.toISOString(),
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
    purchaseDate: d(a.purchaseDate),
    commissionedAt: d(a.commissionedAt),
    eolDate: d(a.eolDate),
    confirmDuplicateSerial: false,
    ...overrides,
  };
}

// ─── Creating assets ─────────────────────────────────────────────────────────

describe("creating assets", () => {
  it("a technician registers an asset in scope: barcode, status history and audit events are created", async () => {
    const ctx = await contextFor("amina.warsame@coastal.example");
    const input = await coastalAssetInput();
    const created = await createAsset(ctx, input);
    const row = await owner.asset.findUniqueOrThrow({ where: { id: created.id }, include: { statusHistory: true } });
    expect(row.organizationId).toBe(await orgId(C));
    expect(row.assetTag).toBe(input.assetTag);
    expect(row.statusHistory).toHaveLength(1);
    expect(await auditCount({ action: "asset.created", actorUserId: ctx.user.id })).toBeGreaterThan(0);
    // Barcode creation is audited: the barcode is the asset ID in Code 128.
    const barcodeEvent = await owner.auditLog.findFirstOrThrow({
      where: { action: "asset.barcode_issued", entityId: created.id },
    });
    expect(barcodeEvent.metadata).toEqual({ assetTag: input.assetTag, symbology: "code128" });
  });

  it("an engineering manager and an organisation admin can register assets", async () => {
    for (const email of ["james.otieno@coastal.example", "hodan.ali@coastal.example"]) {
      const ctx = await contextFor(email, C);
      await expect(createAsset(ctx, await coastalAssetInput())).resolves.toHaveProperty("id");
    }
  });

  it("read-only, department, inventory and fault-reporter roles cannot register assets (and it is audited)", async () => {
    for (const email of [
      "fatuma.hassan@coastal.example",
      "peter.kamau@coastal.example",
      "grace.mwangi@coastal.example",
      "lucy.achieng@coastal.example",
    ]) {
      const ctx = await contextFor(email);
      const before = await auditCount({ action: "authz.denied", actorUserId: ctx.user.id, outcome: "DENIED" });
      await expect(createAsset(ctx, await coastalAssetInput())).rejects.toBeInstanceOf(AuthorizationError);
      expect(await auditCount({ action: "authz.denied", actorUserId: ctx.user.id, outcome: "DENIED" })).toBe(
        before + 1,
      );
    }
  });

  it("cannot register an asset in a hospital or department outside the user's scope", async () => {
    const amina = await contextFor("amina.warsame@coastal.example");
    const nchWards = {
      hospitalId: await hospitalId(C, "NCH"),
      departmentId: await departmentId(C, "NCH", "WARDS"),
    };
    await expect(createAsset(amina, await coastalAssetInput(nchWards))).rejects.toBeInstanceOf(NotFoundError);
    const james = await contextFor("james.otieno@coastal.example", C); // Riverside only
    await expect(
      createAsset(
        james,
        await coastalAssetInput({
          hospitalId: await hospitalId(C, "NCH"),
          departmentId: await departmentId(C, "NCH", "ICU"),
        }),
      ),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("cannot register into another organisation's hospital, even with its real ids", async () => {
    const amina = await contextFor("amina.warsame@coastal.example");
    await expect(
      createAsset(
        amina,
        await coastalAssetInput({
          hospitalId: await hospitalId(H, "SRH"),
          departmentId: await departmentId(H, "SRH", "ICU"),
        }),
      ),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("ignores an organisation id smuggled into the form", async () => {
    const hodan = await contextFor("hodan.ali@coastal.example");
    const created = await createAsset(hodan, { ...(await coastalAssetInput()), organizationId: await orgId(H) });
    const row = await owner.asset.findUniqueOrThrow({ where: { id: created.id } });
    expect(row.organizationId).toBe(await orgId(C));
  });

  it("rejects a department that does not belong to the chosen hospital", async () => {
    const amina = await contextFor("amina.warsame@coastal.example");
    const input = await coastalAssetInput({ departmentId: await departmentId(C, "NCH", "ICU") }); // RGH + NCH ICU
    await expect(createAsset(amina, input)).rejects.toBeInstanceOf(ValidationError);
  });

  it("validates required fields, real dates and supported statuses", async () => {
    const amina = await contextFor("amina.warsame@coastal.example");
    const expectFields = async (overrides: Record<string, unknown>, field: string) => {
      const error = await createAsset(amina, await coastalAssetInput(overrides)).catch((e) => e);
      expect(error).toBeInstanceOf(ValidationError);
      expect(Object.keys((error as ValidationError).fieldErrors)).toContain(field);
    };
    await expectFields({ name: "" }, "name");
    await expectFields({ assetTag: "" }, "assetTag");
    await expectFields({ assetTag: "has spaces!" }, "assetTag");
    await expectFields({ modelId: "not-a-uuid" }, "modelId");
    await expectFields({ purchaseDate: "2024-02-30" }, "purchaseDate");
    await expectFields({ purchaseDate: "2999-01-01" }, "purchaseDate");
    await expectFields({ eolDate: "14/10/2030" }, "eolDate");
    await expectFields({ purchaseDate: "2024-05-01", commissionedAt: "2024-04-01" }, "commissionedAt");
    await expectFields({ status: "BROKEN" }, "status");
    // Decommissioned can only be reached through an approved request.
    await expectFields({ status: "DECOMMISSIONED" }, "status");
    await expectFields({ riskClass: "EXTREME" }, "riskClass");
  });

  it("field-level rule: a technician cannot record the purchase cost", async () => {
    const amina = await contextFor("amina.warsame@coastal.example");
    await expect(
      createAsset(amina, await coastalAssetInput({ purchaseCost: "1000.00", purchaseCurrency: "KES" })),
    ).rejects.toBeInstanceOf(AuthorizationError);
    const james = await contextFor("james.otieno@coastal.example", C);
    await expect(
      createAsset(james, await coastalAssetInput({ purchaseCost: "1000.00", purchaseCurrency: "KES" })),
    ).resolves.toHaveProperty("id");
  });

  it("asset IDs must be unique within the organisation, with a clear message", async () => {
    const hodan = await contextFor("hodan.ali@coastal.example");
    const error = await createAsset(hodan, await coastalAssetInput({ assetTag: "INF-0001" })).catch((e) => e);
    expect(error).toBeInstanceOf(ValidationError);
    expect((error as ValidationError).fieldErrors.assetTag).toBeDefined();
  });

  it("another organisation's asset IDs and serial numbers never cause (or reveal) a conflict", async () => {
    const david = await contextFor("david.mutua@highland.example");
    const tag = uniqueCode("HL-");
    await createAsset(david, {
      ...(await coastalAssetInput()),
      assetTag: tag,
      serialNumber: "SHARED-SERIAL-1",
      modelId: await modelId(H, "DM-Infuse 100"),
      hospitalId: await hospitalId(H, "SRH"),
      departmentId: await departmentId(H, "SRH", "ICU"),
    });
    const hodan = await contextFor("hodan.ali@coastal.example");
    await expect(
      createAsset(hodan, await coastalAssetInput({ assetTag: tag, serialNumber: "SHARED-SERIAL-1" })),
    ).resolves.toHaveProperty("id");
  });

  it("a repeated serial number for the same model needs explicit confirmation, without revealing the other asset", async () => {
    const hodan = await contextFor("hodan.ali@coastal.example");
    const error = await createAsset(hodan, await coastalAssetInput({ serialNumber: "DEMO-SN-1001" })).catch((e) => e);
    expect(error).toBeInstanceOf(ValidationError);
    const fe = (error as ValidationError).fieldErrors;
    expect(fe.confirmDuplicateSerial).toBeDefined();
    expect(JSON.stringify(fe)).not.toContain("INF-0001");
    await expect(
      createAsset(hodan, await coastalAssetInput({ serialNumber: "DEMO-SN-1001", confirmDuplicateSerial: true })),
    ).resolves.toHaveProperty("id");
  });

  it("hospital inventory numbers are unique per hospital", async () => {
    const hodan = await contextFor("hodan.ali@coastal.example");
    const inv = uniqueCode("INV");
    await createAsset(hodan, await coastalAssetInput({ inventoryNumber: inv }));
    const error = await createAsset(hodan, await coastalAssetInput({ inventoryNumber: inv })).catch((e) => e);
    expect((error as ValidationError).fieldErrors.inventoryNumber).toBeDefined();
    // The same number in a different hospital is fine.
    await expect(
      createAsset(
        hodan,
        await coastalAssetInput({
          inventoryNumber: inv,
          hospitalId: await hospitalId(C, "NCH"),
          departmentId: await departmentId(C, "NCH", "ICU"),
        }),
      ),
    ).resolves.toHaveProperty("id");
  });
});

// ─── Editing ─────────────────────────────────────────────────────────────────

describe("editing assets", () => {
  it("a technician edits an asset in scope; the audit lists changed field names, not the record", async () => {
    const amina = await contextFor("amina.warsame@coastal.example");
    const result = await updateAsset(amina, await editInput("MON-0002", C, { name: "Transport monitor (ED)" }));
    expect(result.changed).toEqual(["name"]);
    const event = await owner.auditLog.findFirstOrThrow({
      where: { action: "asset.updated", entityId: result.id },
      orderBy: { createdAt: "desc" },
    });
    expect(event.metadata).toEqual({ assetTag: "MON-0002", changed: ["name"] });
  });

  it("status, risk and department changes are recorded as separate audit events and status history", async () => {
    const james = await contextFor("james.otieno@coastal.example", C);
    const id = await assetId(C, "MON-0003");
    await updateAsset(
      james,
      await editInput("MON-0003", C, {
        status: "UNDER_REPAIR",
        riskClass: "HIGH",
        departmentId: await departmentId(C, "RGH", "ICU"),
      }),
    );
    for (const action of ["asset.status_changed", "asset.risk_changed", "asset.reassigned"]) {
      expect(await owner.auditLog.count({ where: { action, entityId: id } })).toBe(1);
    }
    const history = await owner.assetStatusHistory.findMany({ where: { assetId: id }, orderBy: { createdAt: "asc" } });
    expect(history.at(-1)).toMatchObject({ fromStatus: "IN_SERVICE", toStatus: "UNDER_REPAIR" });
  });

  it("read-only users cannot modify, change status or archive", async () => {
    const fatuma = await contextFor("fatuma.hassan@coastal.example");
    await expect(updateAsset(fatuma, await editInput("ECG-0001"))).rejects.toBeInstanceOf(AuthorizationError);
    await expect(
      changeAssetStatus(fatuma, { id: await assetId(C, "ECG-0001"), status: "OUT_OF_SERVICE" }),
    ).rejects.toBeInstanceOf(AuthorizationError);
    await expect(archiveAsset(fatuma, { id: await assetId(C, "ECG-0001") })).rejects.toBeInstanceOf(AuthorizationError);
    const lucy = await contextFor("lucy.achieng@coastal.example");
    await expect(updateAsset(lucy, await editInput("DEF-0101"))).rejects.toBeInstanceOf(AuthorizationError);
  });

  it("cannot move an asset into a department outside the user's scope", async () => {
    const amina = await contextFor("amina.warsame@coastal.example");
    const input = await editInput("ECG-0001", C, {
      hospitalId: await hospitalId(C, "NCH"),
      departmentId: await departmentId(C, "NCH", "WARDS"),
    });
    await expect(updateAsset(amina, input)).rejects.toBeInstanceOf(NotFoundError);
    expect((await assetRow(C, "ECG-0001")).hospitalId).toBe(await hospitalId(C, "RGH"));
  });

  it("cannot edit an asset outside scope, and the attempt is audited", async () => {
    const james = await contextFor("james.otieno@coastal.example", C); // Riverside only
    const id = await assetId(C, "DEF-0101"); // Northlake
    await expect(updateAsset(james, await editInput("DEF-0101"))).rejects.toBeInstanceOf(NotFoundError);
    expect(
      await owner.auditLog.count({
        where: { action: "asset.access_denied", entityId: id, actorUserId: james.user.id },
      }),
    ).toBeGreaterThan(0);
  });

  it("cannot edit another organisation's asset by id", async () => {
    const hodan = await contextFor("hodan.ali@coastal.example");
    await expect(updateAsset(hodan, await editInput("VEN-0001", H))).rejects.toBeInstanceOf(NotFoundError);
  });

  it("a stale form cannot overwrite someone else's newer changes", async () => {
    const hodan = await contextFor("hodan.ali@coastal.example");
    const stale = await editInput("ECG-0001", C, { supplier: "First save" });
    await updateAsset(hodan, stale);
    const error = await updateAsset(hodan, { ...stale, supplier: "Second save" }).catch((e) => e);
    expect(error).toBeInstanceOf(ValidationError);
    expect((error as Error).message).toMatch(/changed this asset/);
    expect((await assetRow(C, "ECG-0001")).supplier).toBe("First save");
  });

  it("a technician keeps the stored cost but cannot change it", async () => {
    const amina = await contextFor("amina.warsame@coastal.example");
    await updateAsset(amina, await editInput("INF-0001", C, { supplier: "Demo supplier" }));
    expect((await assetRow(C, "INF-0001")).purchaseCost?.toFixed(2)).toBe("185000.00");
    await expect(
      updateAsset(amina, await editInput("INF-0001", C, { purchaseCost: "1.00", purchaseCurrency: "KES" })),
    ).rejects.toBeInstanceOf(AuthorizationError);
    expect((await assetRow(C, "INF-0001")).purchaseCost?.toFixed(2)).toBe("185000.00");
  });

  it("a technician cannot escalate an asset straight to decommissioned", async () => {
    const amina = await contextFor("amina.warsame@coastal.example");
    await expect(
      updateAsset(amina, await editInput("ECG-0001", C, { status: "DECOMMISSIONED" })),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      changeAssetStatus(amina, { id: await assetId(C, "ECG-0001"), status: "DECOMMISSIONED" }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("purchase cost is hidden from roles without the cost permission", async () => {
    const id = await assetId(C, "INF-0001");
    const amina = await getAsset(await contextFor("amina.warsame@coastal.example"), id);
    expect(amina.cost).toBeNull();
    expect(amina.costHidden).toBe(true);
    expect(JSON.stringify(amina)).not.toContain("185000");
    const fatuma = await getAsset(await contextFor("fatuma.hassan@coastal.example"), id);
    expect(fatuma.cost).toEqual({ amount: "185000.00", currency: "KES" });
  });
});

// ─── Archive ─────────────────────────────────────────────────────────────────

describe("archiving", () => {
  it("only managers and admins can archive; archived assets keep their history and can be restored", async () => {
    const amina = await contextFor("amina.warsame@coastal.example");
    const james = await contextFor("james.otieno@coastal.example", C);
    const created = await createAsset(james, await coastalAssetInput());
    await expect(archiveAsset(amina, { id: created.id })).rejects.toBeInstanceOf(AuthorizationError);
    await archiveAsset(james, { id: created.id });

    const row = await owner.asset.findUniqueOrThrow({ where: { id: created.id }, include: { statusHistory: true } });
    expect(row.archivedAt).not.toBeNull();
    expect(row.statusHistory.length).toBeGreaterThan(0); // nothing deleted

    const visible = await listAssets(james, { q: created.assetTag });
    expect(visible.total).toBe(0);
    const withArchived = await listAssets(james, { q: created.assetTag, archived: "include" });
    expect(withArchived.total).toBe(1);

    await expect(updateAsset(james, await editInput(created.assetTag))).rejects.toBeInstanceOf(ValidationError);
    await restoreAsset(james, { id: created.id });
    expect((await owner.asset.findUniqueOrThrow({ where: { id: created.id } })).archivedAt).toBeNull();
    expect(
      await owner.auditLog.count({
        where: { entityId: created.id, action: { in: ["asset.archived", "asset.restored"] } },
      }),
    ).toBe(2);
  });
});

// ─── Register: search, filters, sorting, pagination, export ─────────────────

describe("register isolation", () => {
  it("organisation A cannot list organisation B's assets, even when searching for B's serial numbers", async () => {
    const hodan = await contextFor("hodan.ali@coastal.example");
    const coastal = await orgId(C);
    const all = await listAssets(hodan, { archived: "include" });
    const ids = all.rows.map((r) => r.id);
    const rows = await owner.asset.findMany({ where: { id: { in: ids } }, select: { organizationId: true } });
    expect(rows.every((r) => r.organizationId === coastal)).toBe(true);
    const highlandOnlySerial = await listAssets(hodan, { q: "DEMO-SN-3101" });
    expect(highlandOnlySerial.total).toBe(0);
  });

  it("a technician only sees assets in their hospitals and departments", async () => {
    const amina = await contextFor("amina.warsame@coastal.example");
    const tags = (await listAssets(amina, { q: "-01" })).rows.map((r) => r.assetTag);
    expect(tags).toContain("INF-0101"); // Northlake ICU: in scope
    expect(tags).not.toContain("DEF-0101"); // Northlake Emergency: not in scope
    expect(tags).not.toContain("ECG-0101"); // Northlake Wards: not in scope
  });

  it("a Department Head sees only their department", async () => {
    const peter = await contextFor("peter.kamau@coastal.example");
    const result = await listAssets(peter, { archived: "include" });
    const icu = await departmentId(C, "RGH", "ICU");
    const rows = await owner.asset.findMany({
      where: { id: { in: result.rows.map((r) => r.id) } },
      select: { departmentId: true },
    });
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.departmentId === icu)).toBe(true);
  });

  it("filters for an unassigned hospital or department return nothing rather than widening access", async () => {
    const amina = await contextFor("amina.warsame@coastal.example");
    expect((await listAssets(amina, { hospital: await hospitalId(H, "SRH") })).total).toBe(0);
    expect((await listAssets(amina, { department: await departmentId(C, "NCH", "ED") })).total).toBe(0);
  });

  it("sorting and paging cannot be abused: unknown sort fields and huge pages fall back safely", async () => {
    const amina = await contextFor("amina.warsame@coastal.example");
    const baseline = await listAssets(amina, {});
    const weird = await listAssets(amina, { sort: "organizationId", dir: "sideways", page: "99999" });
    expect(weird.query.sort).toBe("assetTag");
    expect(weird.query.dir).toBe("asc");
    expect(weird.page).toBe(weird.pageCount);
    expect(weird.total).toBe(baseline.total);
    const injected = await listAssets(amina, { q: "' OR 1=1 --" });
    expect(injected.total).toBe(0);
  });

  it("pages split the in-scope results without gaps or overlaps", async () => {
    const hodan = await contextFor("hodan.ali@coastal.example");
    // Make sure there is more than one page.
    while ((await listAssets(hodan, { archived: "include" })).total <= 30) {
      await createAsset(hodan, await coastalAssetInput());
    }
    const first = await listAssets(hodan, { archived: "include", sort: "createdAt", page: 1 });
    expect(first.pageCount).toBeGreaterThan(1);
    const seen = new Set<string>();
    for (let page = 1; page <= first.pageCount; page++) {
      for (const r of (await listAssets(hodan, { archived: "include", sort: "createdAt", page })).rows) seen.add(r.id);
    }
    expect(seen.size).toBe(first.total);
  });

  it("search covers manufacturer and model names; filters combine", async () => {
    const hodan = await contextFor("hodan.ali@coastal.example");
    const byManufacturer = await listAssets(hodan, { q: "Sample Clinical" });
    expect(byManufacturer.rows.every((r) => r.model.manufacturer.name.startsWith("Sample Clinical"))).toBe(true);
    expect(byManufacturer.total).toBeGreaterThan(0);
    const highRiskIcu = await listAssets(hodan, { risk: "HIGH", department: await departmentId(C, "RGH", "ICU") });
    expect(highRiskIcu.rows.every((r) => r.riskClass === "HIGH" && r.department.name === "Intensive Care")).toBe(true);
  });

  it("CSV export keeps the same isolation, is permission-checked, audited and safe against formula injection", async () => {
    const hodan = await contextFor("hodan.ali@coastal.example");
    await createAsset(hodan, await coastalAssetInput({ name: '=HYPERLINK("http://x")' }));
    const { csv, count } = await exportAssetsCsv(hodan, {});
    expect(count).toBeGreaterThan(0);
    expect(csv).not.toContain("DEMO-SN-3101"); // Highland serial
    expect(csv).toContain(`"'=HYPERLINK(""http://x"")"`);
    expect(await auditCount({ action: "asset.exported", actorUserId: hodan.user.id })).toBeGreaterThan(0);

    const grace = await contextFor("grace.mwangi@coastal.example"); // Riverside only
    const graceCsv = (await exportAssetsCsv(grace, {})).csv;
    expect(graceCsv).not.toContain("Northlake");
    const amina = await contextFor("amina.warsame@coastal.example");
    await expect(exportAssetsCsv(amina, {})).rejects.toBeInstanceOf(AuthorizationError);
  });

  it("guessing another organisation's asset id gives 'not found' and is audited", async () => {
    const hodan = await contextFor("hodan.ali@coastal.example");
    const target = await assetId(H, "VEN-0001");
    const denied = () =>
      owner.auditLog.count({ where: { action: "asset.access_denied", entityId: target, actorUserId: hodan.user.id } });
    const before = await denied();
    await expect(getAsset(hodan, target)).rejects.toBeInstanceOf(NotFoundError);
    await expect(getAsset(hodan, randomUUID())).rejects.toBeInstanceOf(NotFoundError);
    await expect(getAsset(hodan, "../../etc")).rejects.toBeInstanceOf(NotFoundError);
    expect(await denied()).toBe(before + 1);
  });

  it("a fault reporter can view assets in their department only", async () => {
    const lucy = await contextFor("lucy.achieng@coastal.example");
    await expect(getAsset(lucy, await assetId(C, "DEF-0101"))).resolves.toHaveProperty("assetTag", "DEF-0101");
    await expect(getAsset(lucy, await assetId(C, "INF-0101"))).rejects.toBeInstanceOf(NotFoundError);
  });
});

// ─── Barcodes ────────────────────────────────────────────────────────────────

describe("barcode scanning and labels", () => {
  it("a scanned barcode (asset ID, any case) opens an in-scope asset, and the scan is audited", async () => {
    const amina = await contextFor("amina.warsame@coastal.example");
    const icuPump = await assetId(C, "INF-0101");
    expect(await findAssetByCode(amina, "inf-0101")).toEqual({
      kind: "asset",
      assetId: icuPump,
      matchedBy: "assetTag",
    });
    expect(await owner.auditLog.count({ where: { action: "asset.scanned", entityId: icuPump } })).toBeGreaterThan(0);
  });

  it("scanning does not bypass scope: an out-of-scope asset gives the same answer as an unknown code", async () => {
    const amina = await contextFor("amina.warsame@coastal.example");
    const edDefib = await assetId(C, "DEF-0101"); // Northlake Emergency: not Amina's
    expect(await findAssetByCode(amina, "DEF-0101")).toEqual({ kind: "not-found" });
    expect(await findAssetByCode(amina, "NOPE-9999")).toEqual({ kind: "not-found" });
    expect(
      await owner.auditLog.count({
        where: { action: "asset.access_denied", actorUserId: amina.user.id, entityId: edDefib },
      }),
    ).toBeGreaterThan(0);
  });

  it("malformed and link-like barcodes are refused without a look-up", async () => {
    const amina = await contextFor("amina.warsame@coastal.example");
    for (const bad of ["", "javascript:alert(1)", "https://evil.example/assets/x", "X".repeat(41), "INF\u0000"]) {
      expect(await findAssetByCode(amina, bad)).toEqual({ kind: "not-found" });
    }
  });

  it("another organisation's asset ID never finds that organisation's asset", async () => {
    // DEF-0001 exists only in Coastal; David belongs only to Highland.
    const david = await contextFor("david.mutua@highland.example");
    expect(await findAssetByCode(david, "DEF-0001")).toEqual({ kind: "not-found" });
    // VEN-0001 exists in BOTH organisations: each finds only its own.
    const hodan = await contextFor("hodan.ali@coastal.example");
    const coastalVen = await assetId(C, "VEN-0001");
    const highlandVen = await assetId(H, "VEN-0001");
    expect(await findAssetByCode(hodan, "VEN-0001")).toMatchObject({ assetId: coastalVen });
    expect(await findAssetByCode(david, "VEN-0001")).toMatchObject({ assetId: highlandVen });
  });

  it("a person in two organisations finds the asset of the organisation they are working in", async () => {
    const inCoastal = await contextFor("james.otieno@coastal.example", C);
    const inHighland = await contextFor("james.otieno@coastal.example", H);
    expect(await findAssetByCode(inCoastal, "VEN-0001")).toMatchObject({ assetId: await assetId(C, "VEN-0001") });
    expect(await findAssetByCode(inHighland, "VEN-0001")).toMatchObject({ assetId: await assetId(H, "VEN-0001") });
  });

  it("a hospital's own inventory-number barcode also works, within scope", async () => {
    // Same inventory number in two hospitals (allowed: unique per hospital).
    await owner.asset.update({ where: { id: await assetId(C, "ECG-0001") }, data: { inventoryNumber: "INV-7788" } });
    await owner.asset.update({ where: { id: await assetId(C, "ECG-0101") }, data: { inventoryNumber: "INV-7788" } });
    const amina = await contextFor("amina.warsame@coastal.example"); // sees Riverside, not Northlake wards
    expect(await findAssetByCode(amina, "inv-7788")).toEqual({
      kind: "asset",
      assetId: await assetId(C, "ECG-0001"),
      matchedBy: "inventoryNumber",
    });
    const hodan = await contextFor("hodan.ali@coastal.example"); // sees both
    expect(await findAssetByCode(hodan, "INV-7788")).toEqual({ kind: "several" });
  });

  it("changing an asset ID replaces its barcode: audited, old barcode stops matching", async () => {
    const james = await contextFor("james.otieno@coastal.example", C);
    // A fresh asset, so no shared seed asset is renamed for later tests.
    const created = await createAsset(james, await coastalAssetInput());
    const id = created.id;
    const oldTag = created.assetTag;
    const newTag = uniqueCode("RT-");
    await updateAsset(james, await editInput(oldTag, C, { assetTag: newTag }));
    const event = await owner.auditLog.findFirstOrThrow({ where: { action: "asset.barcode_replaced", entityId: id } });
    expect(event.metadata).toEqual({ from: oldTag, to: newTag, symbology: "code128", reprintLabel: true });
    expect(await findAssetByCode(james, oldTag)).toEqual({ kind: "not-found" });
    expect(await findAssetByCode(james, newTag)).toMatchObject({ assetId: id });
  });

  it("a duplicate asset ID (= duplicate barcode) is refused within the organisation", async () => {
    const james = await contextFor("james.otieno@coastal.example", C);
    await expect(updateAsset(james, await editInput("MON-0001", C, { assetTag: "VEN-0001" }))).rejects.toThrow(
      /already used in your organisation/,
    );
  });

  it("labels include only active, in-scope assets of the user's organisation, and printing is audited", async () => {
    const hodan = await contextFor("hodan.ali@coastal.example");
    const mine = await assetId(C, "MON-0001");
    const theirs = await assetId(H, "MON-0001");
    const { assets } = await getAssetsForLabels(hodan, [mine, theirs, "not-an-id", randomUUID()]);
    expect(assets.map((a) => a.id)).toEqual([mine]);
    // Labels carry name, asset ID and location only.
    expect(Object.keys(assets[0]).sort()).toEqual(["assetTag", "department", "hospital", "id", "name"]);
    expect(await auditCount({ action: "asset.label_printed", actorUserId: hodan.user.id })).toBeGreaterThan(0);
    const fatuma = await contextFor("fatuma.hassan@coastal.example");
    await expect(getAssetsForLabels(fatuma, [mine])).rejects.toBeInstanceOf(AuthorizationError);
  });
});

// ─── Decommissioning approval (decision 8) ──────────────────────────────────

describe("decommissioning approval", () => {
  it("only the NUM of the department may approve when one exists — not the engineering manager", async () => {
    const amina = await contextFor("amina.warsame@coastal.example");
    const james = await contextFor("james.otieno@coastal.example", C);
    const id = await assetId(C, "MON-0001"); // Riverside ICU (NUM: Peter)
    await requestDecommission(amina, { id, reason: "Test: screen failure, beyond repair" });
    const request = await owner.lifecycleEvent.findFirstOrThrow({ where: { assetId: id, status: "PENDING" } });
    await expect(decideDecommission(james, { requestId: request.id, decision: "APPROVE" })).rejects.toBeInstanceOf(
      ValidationError,
    );
    expect((await listPendingDecommissions(james)).some((p) => p.id === request.id)).toBe(false);
    expect((await assetRow(C, "MON-0001")).status).not.toBe("DECOMMISSIONED");
  });

  it("the NUM approves: status becomes decommissioned, history and audit are recorded, the asset becomes read-only", async () => {
    const peter = await contextFor("peter.kamau@coastal.example");
    const id = await assetId(C, "INF-0002");
    const pending = await listPendingDecommissions(peter);
    const request = pending.find((p) => p.asset.id === id)!;
    expect(request.approverKind).toBe("NUM");
    await decideDecommission(peter, { requestId: request.id, decision: "APPROVE" });
    expect((await assetRow(C, "INF-0002")).status).toBe("DECOMMISSIONED");
    const event = await owner.auditLog.findFirstOrThrow({ where: { action: "asset.decommissioned", entityId: id } });
    expect(event.metadata).toMatchObject({ approvedAs: "NUM" });
    const james = await contextFor("james.otieno@coastal.example", C);
    await expect(updateAsset(james, await editInput("INF-0002"))).rejects.toBeInstanceOf(ValidationError);
  });

  it("a rejection needs a reason and leaves the asset unchanged", async () => {
    const peter = await contextFor("peter.kamau@coastal.example");
    const request = await owner.lifecycleEvent.findFirstOrThrow({
      where: { assetId: await assetId(C, "MON-0001"), status: "PENDING" },
    });
    await expect(decideDecommission(peter, { requestId: request.id, decision: "REJECT" })).rejects.toBeInstanceOf(
      ValidationError,
    );
    await decideDecommission(peter, { requestId: request.id, decision: "REJECT", note: "Repair first" });
    expect((await assetRow(C, "MON-0001")).status).toBe("IN_SERVICE");
  });

  it("without a NUM, the engineering manager approves — but never their own request", async () => {
    const james = await contextFor("james.otieno@coastal.example", C);
    const amina = await contextFor("amina.warsame@coastal.example");
    const theatres = await assetRow(C, "SUC-0001"); // Riverside Theatres: no NUM
    await requestDecommission(james, { id: theatres.id, reason: "Test: own request by manager" });
    const own = await owner.lifecycleEvent.findFirstOrThrow({ where: { assetId: theatres.id, status: "PENDING" } });
    await expect(decideDecommission(james, { requestId: own.id, decision: "APPROVE" })).rejects.toThrow(/own request/);
    await expect(
      requestDecommission(amina, { id: theatres.id, reason: "Duplicate request attempt" }),
    ).rejects.toBeInstanceOf(ValidationError); // one pending request per asset

    // Withdraw, then a technician's request can be approved by the manager.
    const { cancelDecommission } = await import("@/server/services/assets");
    await cancelDecommission(james, { id: own.id });
    await requestDecommission(amina, { id: theatres.id, reason: "Test: motor failure" });
    const pending = (await listPendingDecommissions(james)).find((p) => p.asset.id === theatres.id)!;
    expect(pending.approverKind).toBe("ENGINEERING_MANAGER");
    await decideDecommission(james, { requestId: pending.id, decision: "APPROVE" });
    expect((await assetRow(C, "SUC-0001")).status).toBe("DECOMMISSIONED");
  });

  it("without a NUM, a Facility Manager (Department Head for the whole hospital) can approve", async () => {
    // Arrange: a fictional facility manager for Northlake (whole hospital).
    const coastal = await orgId(C);
    const userId = randomUUID();
    await owner.user.create({
      data: { id: userId, name: "Test Facility Manager", email: `fm-${userId}@coastal.example` },
    });
    const m = await owner.membership.create({ data: { organizationId: coastal, userId, role: "DEPARTMENT_HEAD" } });
    await owner.membershipScope.create({
      data: { organizationId: coastal, membershipId: m.id, hospitalId: await hospitalId(C, "NCH") },
    });
    const facility = await contextFor(`fm-${userId}@coastal.example`);
    const hodan = await contextFor("hodan.ali@coastal.example");
    const wardsEcg = await assetRow(C, "ECG-0101"); // Northlake Wards: no NUM
    await requestDecommission(hodan, { id: wardsEcg.id, reason: "Test: obsolete model" });
    const pending = (await listPendingDecommissions(facility)).find((p) => p.asset.id === wardsEcg.id)!;
    expect(pending.approverKind).toBe("FACILITY_MANAGER");
    await decideDecommission(facility, { requestId: pending.id, decision: "APPROVE" });
    expect((await assetRow(C, "ECG-0101")).status).toBe("DECOMMISSIONED");
  });

  it("technicians and auditors cannot approve", async () => {
    const amina = await contextFor("amina.warsame@coastal.example");
    const fatuma = await contextFor("fatuma.hassan@coastal.example");
    const anyRequest = await owner.lifecycleEvent.findFirstOrThrow();
    for (const ctx of [amina, fatuma]) {
      await expect(decideDecommission(ctx, { requestId: anyRequest.id, decision: "APPROVE" })).rejects.toBeInstanceOf(
        AuthorizationError,
      );
    }
  });

  it("organisation B cannot decide organisation A's requests", async () => {
    const david = await contextFor("david.mutua@highland.example");
    const userInB = await userByEmail("david.mutua@highland.example");
    expect(userInB.id).toBe(david.user.id);
    const coastalRequest = await owner.lifecycleEvent.findFirstOrThrow({ where: { organizationId: await orgId(C) } });
    await expect(
      decideDecommission(david, { requestId: coastalRequest.id, decision: "APPROVE" }),
    ).rejects.toBeInstanceOf(AuthorizationError); // org admins are not approvers at all
  });
});

// ─── Catalog ─────────────────────────────────────────────────────────────────

describe("equipment catalog", () => {
  it("manufacturer names are unique per organisation, case-insensitively, but not across organisations", async () => {
    const hodan = await contextFor("hodan.ali@coastal.example");
    const name = `Test Maker ${uniqueCode("")}`;
    await createManufacturer(hodan, { name, country: "ke", supportContact: "" });
    await expect(createManufacturer(hodan, { name: name.toUpperCase(), country: "" })).rejects.toBeInstanceOf(
      ValidationError,
    );
    const david = await contextFor("david.mutua@highland.example");
    await expect(createManufacturer(david, { name, country: "" })).resolves.toHaveProperty("id");
  });

  it("rooms can only be added to departments in the user's scope", async () => {
    const amina = await contextFor("amina.warsame@coastal.example");
    await expect(
      createLocation(amina, {
        hospitalId: await hospitalId(C, "NCH"),
        departmentId: await departmentId(C, "NCH", "ED"),
        name: "ED Bay 9",
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      createLocation(amina, {
        hospitalId: await hospitalId(C, "NCH"),
        departmentId: await departmentId(C, "NCH", "ICU"),
        name: `ICU Bay ${uniqueCode("")}`,
      }),
    ).resolves.toHaveProperty("id");
  });
});
