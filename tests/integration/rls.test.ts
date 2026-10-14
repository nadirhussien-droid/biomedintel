// Row-Level Security and tenant isolation, checked as the restricted APP role —
// the same database role the web application uses.
import { afterAll, describe, expect, it } from "vitest";
import { db, assertRestrictedDatabaseRole } from "@/server/db/client";
import { withTenant } from "@/server/db/tenant";
import { hospitalId, orgId, owner, singleConnectionAppDb, userByEmail } from "../helpers";

afterAll(async () => {
  await db.$disconnect();
  await owner.$disconnect();
});

describe("database role", () => {
  it("the app connects with a role that cannot bypass RLS", async () => {
    await expect(assertRestrictedDatabaseRole(db)).resolves.toBeUndefined();
  });

  it("the start-up check refuses a role that can bypass RLS (the owner role)", async () => {
    await expect(assertRestrictedDatabaseRole(owner)).rejects.toThrow(/bypass Row-Level Security/);
  });
});

describe("missing or invalid tenant context denies access", () => {
  it("returns no tenant rows at all without a context", async () => {
    expect(await db.hospital.count()).toBe(0);
    expect(await db.department.count()).toBe(0);
    expect(await db.membership.count()).toBe(0);
    expect(await db.organization.count()).toBe(0);
    expect(await db.membershipScope.count()).toBe(0);
  });

  it("refuses a malformed organisation id or a missing user", async () => {
    const amina = await userByEmail("amina.warsame@coastal.example");
    await expect(withTenant({ userId: amina.id, organizationId: "not-a-uuid" }, async () => 1)).rejects.toThrow(
      /invalid organisation/,
    );
    await expect(withTenant({ userId: "", organizationId: null }, async () => 1)).rejects.toThrow(/authenticated user/);
  });

  it("cannot insert a hospital without tenant context", async () => {
    const coastal = await orgId("coastal-health");
    await expect(
      db.hospital.create({ data: { organizationId: coastal, name: "No context", code: "NOCTX" } }),
    ).rejects.toThrow();
  });
});

describe("organisation A cannot see organisation B", () => {
  it("only returns rows of the organisation in context", async () => {
    const hodan = await userByEmail("hodan.ali@coastal.example");
    const coastal = await orgId("coastal-health");
    const rows = await withTenant({ userId: hodan.id, organizationId: coastal }, (tx) =>
      tx.hospital.findMany({ select: { organizationId: true } }),
    );
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.organizationId === coastal)).toBe(true);
  });

  it("a guessed record id from another organisation is invisible and cannot be changed", async () => {
    const hodan = await userByEmail("hodan.ali@coastal.example");
    const coastal = await orgId("coastal-health");
    const highlandHospital = await hospitalId("highland-medical", "SRH");
    await withTenant({ userId: hodan.id, organizationId: coastal }, async (tx) => {
      expect(await tx.hospital.findUnique({ where: { id: highlandHospital } })).toBeNull();
      const updated = await tx.hospital.updateMany({ where: { id: highlandHospital }, data: { name: "Hijacked" } });
      expect(updated.count).toBe(0);
    });
    const after = await owner.hospital.findUniqueOrThrow({ where: { id: highlandHospital } });
    expect(after.name).toBe("Summit Regional Hospital");
  });

  it("cannot write a row into another organisation", async () => {
    const hodan = await userByEmail("hodan.ali@coastal.example");
    const coastal = await orgId("coastal-health");
    const highland = await orgId("highland-medical");
    await expect(
      withTenant({ userId: hodan.id, organizationId: coastal }, (tx) =>
        tx.hospital.create({ data: { organizationId: highland, name: "Planted", code: "PLANT" } }),
      ),
    ).rejects.toThrow();
    expect(await owner.hospital.count({ where: { code: "PLANT" } })).toBe(0);
  });

  it("a user sees only their own memberships when no organisation is chosen", async () => {
    const james = await userByEmail("james.otieno@coastal.example");
    const rows = await withTenant({ userId: james.id, organizationId: null }, (tx) =>
      tx.membership.findMany({ select: { userId: true } }),
    );
    expect(rows).toHaveLength(2); // Coastal manager + Highland auditor
    expect(rows.every((r) => r.userId === james.id)).toBe(true);
  });

  it("audit records of another organisation are invisible", async () => {
    const david = await userByEmail("david.mutua@highland.example");
    const highland = await orgId("highland-medical");
    const coastal = await orgId("coastal-health");
    await owner.auditLog.create({ data: { organizationId: coastal, action: "test.coastal_only" } });
    const seen = await withTenant({ userId: david.id, organizationId: highland }, (tx) =>
      tx.auditLog.count({ where: { action: "test.coastal_only" } }),
    );
    expect(seen).toBe(0);
  });
});

describe("pooled connections never leak tenant context", () => {
  it("context set in one transaction is gone for the next query on the same connection", async () => {
    const single = singleConnectionAppDb(); // exactly one pooled connection
    try {
      const hodan = await userByEmail("hodan.ali@coastal.example");
      const david = await userByEmail("david.mutua@highland.example");
      const coastal = await orgId("coastal-health");
      const highland = await orgId("highland-medical");

      const inTx = await single.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.user_id', ${hodan.id}, true), set_config('app.org_id', ${coastal}, true)`;
        return tx.hospital.count();
      });
      expect(inTx).toBeGreaterThan(0);

      // Same physical connection, no transaction: the setting must be empty and nothing visible.
      const [{ setting }] = await single.$queryRaw<
        { setting: string | null }[]
      >`SELECT current_setting('app.org_id', true) AS setting`;
      expect(setting ?? "").toBe("");
      expect(await single.hospital.count()).toBe(0);

      // A second tenant on the same connection sees only its own rows.
      const highlandRows = await single.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.user_id', ${david.id}, true), set_config('app.org_id', ${highland}, true)`;
        return tx.hospital.findMany({ select: { organizationId: true } });
      });
      expect(highlandRows.length).toBeGreaterThan(0);
      expect(highlandRows.every((r) => r.organizationId === highland)).toBe(true);
    } finally {
      await single.$disconnect();
    }
  });

  it("a failed transaction does not leave its context behind", async () => {
    const single = singleConnectionAppDb();
    try {
      const hodan = await userByEmail("hodan.ali@coastal.example");
      const coastal = await orgId("coastal-health");
      await expect(
        single.$transaction(async (tx) => {
          await tx.$executeRaw`SELECT set_config('app.user_id', ${hodan.id}, true), set_config('app.org_id', ${coastal}, true)`;
          throw new Error("boom");
        }),
      ).rejects.toThrow("boom");
      expect(await single.hospital.count()).toBe(0);
    } finally {
      await single.$disconnect();
    }
  });
});

describe("database privileges of the app role", () => {
  it("cannot change or delete audit records", async () => {
    const hodan = await userByEmail("hodan.ali@coastal.example");
    const coastal = await orgId("coastal-health");
    await expect(
      withTenant({ userId: hodan.id, organizationId: coastal }, (tx) =>
        tx.auditLog.updateMany({ where: {}, data: { action: "tampered" } }),
      ),
    ).rejects.toThrow();
    await expect(
      withTenant({ userId: hodan.id, organizationId: coastal }, (tx) => tx.auditLog.deleteMany({ where: {} })),
    ).rejects.toThrow();
  });

  it("cannot make anyone a Platform Super Administrator", async () => {
    const amina = await userByEmail("amina.warsame@coastal.example");
    await expect(db.user.update({ where: { id: amina.id }, data: { platformRole: "SUPER_ADMIN" } })).rejects.toThrow();
    const after = await owner.user.findUniqueOrThrow({ where: { id: amina.id } });
    expect(after.platformRole).toBeNull();
  });

  it("cannot delete hospitals or memberships (archive only)", async () => {
    const hodan = await userByEmail("hodan.ali@coastal.example");
    const coastal = await orgId("coastal-health");
    await expect(
      withTenant({ userId: hodan.id, organizationId: coastal }, (tx) =>
        tx.hospital.deleteMany({ where: { code: "NCH" } }),
      ),
    ).rejects.toThrow();
  });
});
