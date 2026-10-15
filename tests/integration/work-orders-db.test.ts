// Work order tables at the database level, checked with the owner role (for
// constraints) and the restricted APP role (for Row-Level Security).
import { afterAll, describe, expect, it } from "vitest";
import { db } from "@/server/db/client";
import { withTenant } from "@/server/db/tenant";
import { assetId, orgId, owner, singleConnectionAppDb, userByEmail } from "../helpers";

afterAll(async () => {
  await db.$disconnect();
  await owner.$disconnect();
});

const TABLES = [
  "work_orders",
  "work_order_counters",
  "work_order_events",
  "work_order_tasks",
  "attachments",
  "downtime_events",
  "notifications",
];

async function coastalWorkOrder() {
  return owner.workOrder.findFirstOrThrow({ where: { organization: { slug: "coastal-health" } } });
}

describe("work order schema", () => {
  it("every new table has RLS enabled AND forced", async () => {
    const rows = await owner.$queryRaw<{ relname: string; on: boolean; forced: boolean }[]>`
      SELECT relname, relrowsecurity AS on, relforcerowsecurity AS forced FROM pg_class
      WHERE relname = ANY(${TABLES})`;
    expect(rows).toHaveLength(TABLES.length);
    expect(rows.every((r) => r.on && r.forced)).toBe(true);
  });

  it("the app role can never delete these records or move a job to another organisation, asset or reporter", async () => {
    const rows = await owner.$queryRaw<{ t: string; del: boolean }[]>`
      SELECT t, has_table_privilege('biomedintel_app', t, 'DELETE') AS del FROM unnest(${TABLES}::text[]) AS t`;
    expect(rows.every((r) => !r.del)).toBe(true);
    for (const column of [
      "organization_id",
      "number",
      "asset_id",
      "hospital_id",
      "department_id",
      "reported_by",
      "created_at",
    ]) {
      const [r] = await owner.$queryRaw<{ upd: boolean }[]>`
        SELECT has_column_privilege('biomedintel_app', 'work_orders', ${column}, 'UPDATE') AS upd`;
      expect(r.upd, column).toBe(false);
    }
  });

  it("timeline, work log and photos are append-only, even for the owner", async () => {
    const wo = await coastalWorkOrder();
    const event = await owner.workOrderEvent.findFirstOrThrow({ where: { workOrderId: wo.id } });
    await expect(owner.workOrderEvent.update({ where: { id: event.id }, data: { note: "changed" } })).rejects.toThrow();
    await expect(owner.workOrderEvent.delete({ where: { id: event.id } })).rejects.toThrow();
    const task = await owner.workOrderTask.findFirstOrThrow({ where: { organization: { slug: "coastal-health" } } });
    await expect(owner.workOrderTask.update({ where: { id: task.id }, data: { minutes: 1 } })).rejects.toThrow();
  });

  it("number format, photo type and size, and in-app notification links are enforced", async () => {
    const wo = await coastalWorkOrder();
    const org = wo.organizationId;
    await expect(
      owner.workOrder.create({
        data: { ...wo, id: undefined, number: "JOB-1", createdAt: undefined, updatedAt: undefined },
      }),
    ).rejects.toThrow();
    const base = {
      organizationId: org,
      workOrderId: wo.id,
      filename: "x.svg",
      sha256: "0".repeat(64),
      width: 1,
      height: 1,
      uploadedById: wo.reportedById,
    };
    await expect(
      owner.attachment.create({ data: { ...base, mime: "image/svg+xml", sizeBytes: 3, content: new Uint8Array(3) } }),
    ).rejects.toThrow();
    await expect(
      owner.attachment.create({ data: { ...base, mime: "image/png", sizeBytes: 99, content: new Uint8Array(3) } }),
    ).rejects.toThrow();
    for (const link of ["https://evil.example", "//evil.example", "javascript:alert(1)"]) {
      await expect(
        owner.notification.create({
          data: { organizationId: org, userId: wo.reportedById, type: "x", title: "x", link },
        }),
      ).rejects.toThrow();
    }
  });

  it("an asset can have only one open downtime period", async () => {
    const def = await assetId("coastal-health", "DEF-0101"); // seed: out of use, downtime open
    await expect(
      owner.downtimeEvent.create({
        data: { organizationId: await orgId("coastal-health"), assetId: def, reason: "Second open period" },
      }),
    ).rejects.toThrow();
  });

  it("composite keys stop a job pointing at another organisation's asset", async () => {
    const wo = await coastalWorkOrder();
    await expect(
      owner.workOrder.create({
        data: {
          organizationId: wo.organizationId,
          number: "WO-2026-99999",
          assetId: await assetId("highland-medical", "VEN-0001"),
          hospitalId: wo.hospitalId,
          departmentId: wo.departmentId,
          priority: "LOW",
          faultDescription: "Cross-tenant attempt",
          reportedById: wo.reportedById,
        },
      }),
    ).rejects.toThrow();
  });
});

describe("work order Row-Level Security (as the app role)", () => {
  it("without tenant context nothing is visible", async () => {
    expect(await db.workOrder.count()).toBe(0);
    expect(await db.workOrderEvent.count()).toBe(0);
    expect(await db.notification.count()).toBe(0);
    expect(await db.attachment.count()).toBe(0);
    expect(await db.downtimeEvent.count()).toBe(0);
  });

  it("organisation A sees only its own jobs and cannot change organisation B's", async () => {
    const hodan = await userByEmail("hodan.ali@coastal.example");
    const coastal = await orgId("coastal-health");
    const highlandJob = await owner.workOrder.findFirstOrThrow({
      where: { organization: { slug: "highland-medical" } },
    });
    await withTenant({ userId: hodan.id, organizationId: coastal }, async (tx) => {
      const rows = await tx.workOrder.findMany({ select: { organizationId: true } });
      expect(rows.length).toBeGreaterThan(0);
      expect(rows.every((r) => r.organizationId === coastal)).toBe(true);
      expect(await tx.workOrder.findUnique({ where: { id: highlandJob.id } })).toBeNull();
      const r = await tx.workOrder.updateMany({ where: { id: highlandJob.id }, data: { priority: "LOW" } });
      expect(r.count).toBe(0);
    });
  });

  it("notifications are visible only to their recipient, even inside the organisation", async () => {
    const coastal = await orgId("coastal-health");
    const james = await userByEmail("james.otieno@coastal.example");
    const amina = await userByEmail("amina.warsame@coastal.example");
    await owner.notification.create({
      data: { organizationId: coastal, userId: james.id, type: "test", title: "For James only", link: "/dashboard" },
    });
    const seenByAmina = await withTenant({ userId: amina.id, organizationId: coastal }, (tx) =>
      tx.notification.findMany({ where: { userId: james.id } }),
    );
    expect(seenByAmina).toHaveLength(0);
    const seenByJames = await withTenant({ userId: james.id, organizationId: coastal }, (tx) =>
      tx.notification.findMany({ where: { title: "For James only" } }),
    );
    expect(seenByJames).toHaveLength(1);
  });

  it("a reused pooled connection does not carry the tenant into the next request", async () => {
    const single = singleConnectionAppDb();
    try {
      const hodan = await userByEmail("hodan.ali@coastal.example");
      const coastal = await orgId("coastal-health");
      const inside = await single.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.user_id', ${hodan.id}, true), set_config('app.org_id', ${coastal}, true)`;
        return tx.workOrder.count();
      });
      expect(inside).toBeGreaterThan(0);
      expect(await single.workOrder.count()).toBe(0);
    } finally {
      await single.$disconnect();
    }
  });
});
