// Equipment tables: constraints, Row-Level Security and connection reuse,
// checked directly in PostgreSQL (owner role to arrange, app role to attack).
import { afterAll, describe, expect, it } from "vitest";
import { db } from "@/server/db/client";
import { withTenant } from "@/server/db/tenant";
import {
  assetId,
  assetRow,
  departmentId,
  hospitalId,
  locationId,
  modelId,
  orgId,
  owner,
  singleConnectionAppDb,
  uniqueCode,
  userByEmail,
} from "../helpers";

afterAll(async () => {
  await db.$disconnect();
  await owner.$disconnect();
});

const EQUIPMENT_TABLES = [
  "locations",
  "manufacturers",
  "equipment_categories",
  "equipment_models",
  "assets",
  "asset_status_history",
  "warranties",
  "lifecycle_events",
];

async function coastalBase() {
  const org = await orgId("coastal-health");
  return {
    organizationId: org,
    hospitalId: await hospitalId("coastal-health", "RGH"),
    departmentId: await departmentId("coastal-health", "RGH", "ICU"),
    modelId: await modelId("coastal-health", "DM-Infuse 100"),
    name: "Constraint test",
  };
}

describe("equipment schema", () => {
  it("every equipment table has RLS enabled AND forced", async () => {
    const rows = await owner.$queryRaw<{ relname: string; relrowsecurity: boolean; relforcerowsecurity: boolean }[]>`
      SELECT relname, relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname = ANY(${EQUIPMENT_TABLES})`;
    expect(rows).toHaveLength(EQUIPMENT_TABLES.length);
    for (const r of rows) expect([r.relname, r.relrowsecurity, r.relforcerowsecurity]).toEqual([r.relname, true, true]);
  });

  it("the app role can never delete equipment records or move them to another organisation", async () => {
    const [p] = await owner.$queryRaw<{ del: boolean; org_upd: boolean; hist_upd: boolean }[]>`
      SELECT has_table_privilege('biomedintel_app', 'assets', 'DELETE') AS del,
             has_column_privilege('biomedintel_app', 'assets', 'organization_id', 'UPDATE') AS org_upd,
             has_table_privilege('biomedintel_app', 'asset_status_history', 'UPDATE') AS hist_upd`;
    expect(p).toEqual({ del: false, org_upd: false, hist_upd: false });
  });

  it("asset IDs are unique per organisation, not globally (both seed organisations use INF-0001)", async () => {
    const a = await assetRow("coastal-health", "INF-0001");
    const b = await assetRow("highland-medical", "INF-0001");
    expect(a.id).not.toBe(b.id);
    // …and serial numbers are not unique at all (the seed reuses DEMO-SN-1001).
    expect(a.serialNumber).toBe(b.serialNumber);
    const base = await coastalBase();
    await expect(owner.asset.create({ data: { ...base, assetTag: "INF-0001" } })).rejects.toThrow();
  });

  it("rejects malformed asset IDs (the barcode value) in the database itself", async () => {
    const base = await coastalBase();
    for (const bad of ["bad tag!", "inf-0412", "INF 0412", "X".repeat(41), "-INF"]) {
      await expect(owner.asset.create({ data: { ...base, assetTag: bad } })).rejects.toThrow();
    }
  });

  it("rejects a cost without currency and commissioning before purchase", async () => {
    const base = await coastalBase();
    await expect(
      owner.asset.create({ data: { ...base, assetTag: uniqueCode("C"), purchaseCost: "10.00" } }),
    ).rejects.toThrow();
    await expect(
      owner.asset.create({
        data: {
          ...base,
          assetTag: uniqueCode("D"),
          purchaseDate: new Date("2024-05-01"),
          commissionedAt: new Date("2024-04-01"),
        },
      }),
    ).rejects.toThrow();
  });

  it("composite keys stop a department from another hospital, or a room from another department", async () => {
    const base = await coastalBase();
    const nchIcu = await departmentId("coastal-health", "NCH", "ICU"); // ICU of a DIFFERENT hospital
    await expect(
      owner.asset.create({ data: { ...base, assetTag: uniqueCode("E"), departmentId: nchIcu } }),
    ).rejects.toThrow();
    const theatreRoom = await locationId("coastal-health", "Theatre 1"); // a THEATRES room
    await expect(
      owner.asset.create({ data: { ...base, assetTag: uniqueCode("F"), locationId: theatreRoom } }),
    ).rejects.toThrow();
  });

  it("an asset cannot reference another organisation's model", async () => {
    const base = await coastalBase();
    const highlandModel = await modelId("highland-medical", "DM-Infuse 100");
    await expect(
      owner.asset.create({ data: { ...base, assetTag: uniqueCode("G"), modelId: highlandModel } }),
    ).rejects.toThrow();
  });

  it("status history is append-only, even for the owner", async () => {
    const id = await assetId("coastal-health", "MON-0001");
    const row = await owner.assetStatusHistory.findFirstOrThrow({ where: { assetId: id } });
    await expect(owner.assetStatusHistory.update({ where: { id: row.id }, data: { reason: "x" } })).rejects.toThrow(
      /append-only/,
    );
  });

  it("a decommissioning request can never be decided by the person who requested it", async () => {
    // Its own request, so the test does not depend on other test files.
    const amina = await userByEmail("amina.warsame@coastal.example");
    const pending = await owner.lifecycleEvent.create({
      data: {
        organizationId: await orgId("coastal-health"),
        assetId: await assetId("coastal-health", "VEN-0001"),
        eventType: "DECOMMISSION",
        reason: "Constraint test request",
        requestedById: amina.id,
      },
    });
    await expect(
      owner.lifecycleEvent.update({
        where: { id: pending.id },
        data: { status: "APPROVED", decidedById: pending.requestedById, decidedAt: new Date() },
      }),
    ).rejects.toThrow();
    await owner.lifecycleEvent.update({
      where: { id: pending.id },
      data: { status: "CANCELLED", decidedAt: new Date() },
    });
  });
});

describe("equipment Row-Level Security (as the app role)", () => {
  it("without tenant context no equipment rows are visible", async () => {
    expect(await db.asset.count()).toBe(0);
    expect(await db.equipmentModel.count()).toBe(0);
    expect(await db.lifecycleEvent.count()).toBe(0);
    expect(await db.assetStatusHistory.count()).toBe(0);
  });

  it("organisation A sees only its own assets", async () => {
    const hodan = await userByEmail("hodan.ali@coastal.example");
    const coastal = await orgId("coastal-health");
    const rows = await withTenant({ userId: hodan.id, organizationId: coastal }, (tx) =>
      tx.asset.findMany({ select: { organizationId: true } }),
    );
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.organizationId === coastal)).toBe(true);
  });

  it("a guessed asset id from organisation B is invisible and cannot be changed", async () => {
    const hodan = await userByEmail("hodan.ali@coastal.example");
    const coastal = await orgId("coastal-health");
    const highlandAsset = await assetId("highland-medical", "VEN-0001");
    const result = await withTenant({ userId: hodan.id, organizationId: coastal }, async (tx) => ({
      found: await tx.asset.findUnique({ where: { id: highlandAsset } }),
      updated: await tx.asset.updateMany({ where: { id: highlandAsset }, data: { name: "Hijacked" } }),
      history: await tx.assetStatusHistory.count({ where: { assetId: highlandAsset } }),
    }));
    expect(result).toEqual({ found: null, updated: { count: 0 }, history: 0 });
    expect((await assetRow("highland-medical", "VEN-0001")).name).not.toBe("Hijacked");
  });

  it("cannot insert an asset into organisation B while acting in organisation A", async () => {
    const hodan = await userByEmail("hodan.ali@coastal.example");
    const coastal = await orgId("coastal-health");
    const highland = await orgId("highland-medical");
    const target = {
      hospitalId: await hospitalId("highland-medical", "SRH"),
      departmentId: await departmentId("highland-medical", "SRH", "ICU"),
      modelId: await modelId("highland-medical", "DM-Infuse 100"),
    };
    await expect(
      withTenant({ userId: hodan.id, organizationId: coastal }, (tx) =>
        tx.asset.create({
          data: {
            organizationId: highland,
            ...target,
            assetTag: uniqueCode("X"),
            name: "Cross-tenant insert",
          },
        }),
      ),
    ).rejects.toThrow();
  });

  it("the retired QR code columns and look-up function are gone; asset IDs remain", async () => {
    const columns = await owner.$queryRaw<{ column_name: string }[]>`
      SELECT column_name FROM information_schema.columns WHERE table_name = 'assets'`;
    const names = columns.map((c) => c.column_name);
    expect(names).toContain("asset_tag");
    expect(names).not.toContain("qr_token");
    expect(names).not.toContain("qr_token_issued_at");
    const fn = await owner.$queryRaw<{ n: number }[]>`
      SELECT count(*)::int AS n FROM pg_proc WHERE proname = 'app_resolve_asset_qr'`;
    expect(fn[0].n).toBe(0);
  });

  it("a barcode value (asset ID) used by two organisations only finds the current organisation's asset", async () => {
    const hodan = await userByEmail("hodan.ali@coastal.example");
    const coastal = await orgId("coastal-health");
    const rows = await withTenant({ userId: hodan.id, organizationId: coastal }, (tx) =>
      tx.asset.findMany({ where: { assetTag: "VEN-0001" }, select: { organizationId: true } }),
    );
    expect(rows).toEqual([{ organizationId: coastal }]);
    // Without tenant context the same look-up finds nothing at all.
    expect(await db.asset.count({ where: { assetTag: "VEN-0001" } })).toBe(0);
  });

  it("a reused pooled connection does not carry the tenant into the next request", async () => {
    const single = singleConnectionAppDb();
    try {
      const hodan = await userByEmail("hodan.ali@coastal.example");
      const david = await userByEmail("david.mutua@highland.example");
      const coastal = await orgId("coastal-health");
      const highland = await orgId("highland-medical");
      const coastalCount = await single.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.user_id', ${hodan.id}, true), set_config('app.org_id', ${coastal}, true)`;
        return tx.asset.count();
      });
      expect(coastalCount).toBeGreaterThan(0);
      expect(await single.asset.count()).toBe(0); // same connection, after the transaction
      // A failed transaction must not leave its context behind either.
      await expect(
        single.$transaction(async (tx) => {
          await tx.$executeRaw`SELECT set_config('app.user_id', ${hodan.id}, true), set_config('app.org_id', ${coastal}, true)`;
          throw new Error("boom");
        }),
      ).rejects.toThrow("boom");
      expect(await single.asset.count()).toBe(0);
      const highlandRows = await single.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.user_id', ${david.id}, true), set_config('app.org_id', ${highland}, true)`;
        return tx.asset.findMany({ select: { organizationId: true } });
      });
      expect(highlandRows.length).toBeGreaterThan(0);
      expect(highlandRows.every((r) => r.organizationId === highland)).toBe(true);
    } finally {
      await single.$disconnect();
    }
  });
});
