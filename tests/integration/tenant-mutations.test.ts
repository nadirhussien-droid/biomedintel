// Stage 10: cross-organisation WRITE attempts through the real services.
//
// Highland users with full roles in their own organisation (Organisation
// Administrator, Engineering Manager, Inventory Manager, Technician) try to
// change Coastal Health records by passing Coastal ids — the same thing a
// tampered form submission would do. Every attempt must fail with "not found"
// (or be refused before reaching the record) and nothing in Coastal's data
// may change. A cross-tenant write is a release blocker.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/server/db/client";
import { NotFoundError, ValidationError } from "@/server/authz/errors";
import type { AccessContext } from "@/server/authz/access";
import { archiveAsset, changeAssetStatus } from "@/server/services/assets";
import { assignWorkOrder, cancelWorkOrder } from "@/server/services/work-orders";
import { approveRelease } from "@/server/services/safety-holds";
import { enrolAssets, pausePlan } from "@/server/services/pm-plans";
import { receiveStock } from "@/server/services/inventory";
import { reserveParts } from "@/server/services/work-order-parts";
import { saveSupplier } from "@/server/services/suppliers";
import { decidePurchaseRequest } from "@/server/services/purchasing";
import { addErrorCode, approveDocument, readVersionFile, setDocumentStatus } from "@/server/services/knowledge";
import { addEntry, askAi, startSession } from "@/server/services/troubleshooting";
import { createClaim } from "@/server/services/warranties";
import { createReportSchedule, getReportSnapshot } from "@/server/services/report-schedules";
import { contextFor, owner } from "../helpers";

afterAll(async () => {
  await db.$disconnect();
  await owner.$disconnect();
});

const c: Record<string, string> = {};
const h: Record<string, string> = {};
let admin: AccessContext, manager: AccessContext, stores: AccessContext, tech: AccessContext;
let fingerprint = "";

/** Everything about Coastal that an attack could change, as one string. */
async function coastalFingerprint(orgId: string): Promise<string> {
  const rows = await owner.$queryRaw<{ f: string }[]>`
    SELECT concat_ws('|',
      (SELECT string_agg(id::text || status::text || updated_at::text, ',' ORDER BY id) FROM assets WHERE organization_id = ${orgId}::uuid),
      (SELECT string_agg(id::text || status::text || coalesce(assigned_to::text,'') || updated_at::text, ',' ORDER BY id) FROM work_orders WHERE organization_id = ${orgId}::uuid),
      (SELECT string_agg(id::text || status::text || updated_at::text, ',' ORDER BY id) FROM safety_holds WHERE organization_id = ${orgId}::uuid),
      (SELECT string_agg(id::text || status::text || updated_at::text, ',' ORDER BY id) FROM maintenance_plans WHERE organization_id = ${orgId}::uuid),
      (SELECT count(*)::text FROM pm_schedules WHERE organization_id = ${orgId}::uuid),
      (SELECT count(*)::text FROM stock_movements WHERE organization_id = ${orgId}::uuid),
      (SELECT count(*)::text FROM part_reservations WHERE organization_id = ${orgId}::uuid),
      (SELECT string_agg(id::text || name || updated_at::text, ',' ORDER BY id) FROM suppliers WHERE organization_id = ${orgId}::uuid),
      (SELECT string_agg(id::text || status::text || updated_at::text, ',' ORDER BY id) FROM purchase_requests WHERE organization_id = ${orgId}::uuid),
      (SELECT string_agg(id::text || review_status::text || status::text || updated_at::text, ',' ORDER BY id) FROM knowledge_documents WHERE organization_id = ${orgId}::uuid),
      (SELECT count(*)::text FROM knowledge_error_codes WHERE organization_id = ${orgId}::uuid),
      (SELECT count(*)::text FROM troubleshooting_entries WHERE organization_id = ${orgId}::uuid),
      (SELECT count(*)::text FROM troubleshooting_sessions WHERE organization_id = ${orgId}::uuid),
      (SELECT count(*)::text FROM warranty_claims WHERE organization_id = ${orgId}::uuid),
      (SELECT count(*)::text FROM report_schedules WHERE organization_id = ${orgId}::uuid)
    ) AS f`;
  return rows[0].f;
}

beforeAll(async () => {
  const coastal = await owner.organization.findUniqueOrThrow({ where: { slug: "coastal-health" } });
  const highland = await owner.organization.findUniqueOrThrow({ where: { slug: "highland-medical" } });
  const james = (await owner.user.findUniqueOrThrow({ where: { email: "james.otieno@coastal.example" } })).id;
  const vent = await owner.asset.findFirstOrThrow({ where: { organizationId: coastal.id, assetTag: "VEN-0001" } });
  const wo = await owner.workOrder.findFirstOrThrow({ where: { organizationId: coastal.id, number: "WO-2026-00002" } });
  const rgh = await owner.hospital.findFirstOrThrow({ where: { organizationId: coastal.id, code: "RGH" } });
  const doc = await owner.knowledgeDocument.findFirstOrThrow({ where: { organizationId: coastal.id } });
  Object.assign(c, {
    org: coastal.id,
    asset: vent.id,
    workOrder: wo.id,
    hospital: rgh.id,
    plan: (await owner.maintenancePlan.findFirstOrThrow({ where: { organizationId: coastal.id } })).id,
    part: (await owner.part.findFirstOrThrow({ where: { organizationId: coastal.id, partNumber: "BAT-0001" } })).id,
    store: (await owner.stockLocation.findFirstOrThrow({ where: { organizationId: coastal.id } })).id,
    supplier: (await owner.supplier.findFirstOrThrow({ where: { organizationId: coastal.id } })).id,
    warranty: (await owner.warranty.findFirstOrThrow({ where: { organizationId: coastal.id } })).id,
    document: doc.id,
    version: doc.currentVersionId!,
    amina: (await owner.user.findUniqueOrThrow({ where: { email: "amina.warsame@coastal.example" } })).id,
  });
  c.hold = (
    await owner.safetyHold.create({
      data: {
        organizationId: coastal.id,
        assetId: vent.id,
        failedWorkOrderId: wo.id,
        failureSummary: "Isolation test hold",
        placedById: james,
      },
    })
  ).id;
  c.session = (
    await owner.troubleshootingSession.create({
      data: {
        organizationId: coastal.id,
        number: "TS-2026-09998",
        assetId: vent.id,
        workOrderId: wo.id,
        hospitalId: vent.hospitalId,
        departmentId: vent.departmentId,
        faultDescription: "Isolation test session",
        startedById: james,
      },
    })
  ).id;
  c.purchase = (
    await owner.purchaseRequest.create({
      data: {
        organizationId: coastal.id,
        number: "PR-2026-9998",
        hospitalId: rgh.id,
        status: "SUBMITTED",
        submittedAt: new Date(),
        requestedById: james,
      },
    })
  ).id;
  c.snapshot = (
    await owner.reportSnapshot.create({
      data: {
        organizationId: coastal.id,
        kind: "OVERVIEW",
        periodFrom: new Date("2026-09-01"),
        periodTo: new Date("2026-09-30"),
        periodKey: "iso-test",
        data: {},
        generatedById: james,
      },
    })
  ).id;

  // Highland people with FULL roles in Highland (fictional, created for this test).
  for (const [email, role] of [
    ["isolation.manager@highland.example", "ENGINEERING_MANAGER"],
    ["isolation.stores@highland.example", "INVENTORY_MANAGER"],
  ] as const) {
    const id = randomUUID();
    await owner.user.create({
      data: { id, name: email.split("@")[0], email, emailVerified: true, createdAt: new Date(), updatedAt: new Date() },
    });
    await owner.membership.create({ data: { organizationId: highland.id, userId: id, role, orgWide: true } });
  }
  admin = await contextFor("david.mutua@highland.example", "highland-medical");
  manager = await contextFor("isolation.manager@highland.example", "highland-medical");
  stores = await contextFor("isolation.stores@highland.example", "highland-medical");
  tech = await contextFor("sara.nakato@highland.example", "highland-medical");
  const hPlan = await owner.maintenancePlan.findFirstOrThrow({ where: { organizationId: highland.id } });
  const hWo = await owner.workOrder.findFirstOrThrow({ where: { organizationId: highland.id } });
  Object.assign(h, { plan: hPlan.id, workOrder: hWo.id, asset: hWo.assetId });
  fingerprint = await coastalFingerprint(c.org);
});

/** The attempt must be refused as "not found" (or, for a referenced id, as invalid). */
async function refused(attempt: Promise<unknown>, allowValidation = false) {
  const error = await attempt.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error, "the call succeeded").not.toBeNull();
  const ok = error instanceof NotFoundError || (allowValidation && error instanceof ValidationError);
  expect(ok, `unexpected ${(error as Error)?.name}: ${(error as Error)?.message}`).toBe(true);
}

describe("Highland cannot change Coastal records by passing Coastal ids", () => {
  it("equipment: status change and archive", async () => {
    await refused(changeAssetStatus(manager, { id: c.asset, status: "OUT_OF_SERVICE", reason: "Isolation attack" }));
    await refused(archiveAsset(manager, { id: c.asset, reason: "Isolation attack" }));
  });

  it("work orders: assign and cancel", async () => {
    await refused(assignWorkOrder(manager, { id: c.workOrder, assigneeId: tech.user.id }));
    await refused(cancelWorkOrder(manager, { id: c.workOrder, reason: "Isolation attack" }));
  });

  it("safety: a Failed Safety Test hold cannot be released by another organisation", async () => {
    await refused(approveRelease(manager, { id: c.hold, note: "Isolation attack approval", confirm: true }));
    expect((await owner.safetyHold.findUniqueOrThrow({ where: { id: c.hold } })).status).toBe("AWAITING_REPAIR");
  });

  it("preventive maintenance: pausing their plan, or enrolling their device in our plan", async () => {
    await refused(pausePlan(manager, { id: c.plan, reason: "Isolation attack pause" }));
    await refused(enrolAssets(manager, { id: h.plan, firstDueOn: "2026-11-01", assetIds: [c.asset] }), true);
  });

  it("inventory: receiving into their store, reserving their part on our job", async () => {
    await refused(
      receiveStock(stores, {
        requestKey: randomUUID(),
        partId: c.part,
        locationId: c.store,
        initial: "on",
        quantity: "5",
      }),
      true,
    );
    await refused(
      reserveParts(stores, {
        requestKey: randomUUID(),
        workOrderId: h.workOrder,
        partId: c.part,
        locationId: c.store,
        quantity: "1",
      }),
      true,
    );
  });

  it("suppliers, purchasing and warranty claims", async () => {
    await refused(saveSupplier(stores, { id: c.supplier, name: "Hijacked supplier", kinds: ["DISTRIBUTOR"] }));
    await refused(decidePurchaseRequest(manager, { id: c.purchase, approve: "on" }));
    await refused(
      createClaim(manager, {
        warrantyId: c.warranty,
        description: "Isolation attack claim",
        amountClaimed: "1.00",
        currency: "USD",
      }),
    );
  });

  it("knowledge base: approve, withdraw, add codes, open files", async () => {
    await refused(approveDocument(manager, { id: c.document, authorisation: "Isolation attack", confirm: "on" }));
    await refused(setDocumentStatus(manager, { id: c.document, status: "WITHDRAWN", reason: "Isolation attack" }));
    await refused(addErrorCode(manager, { documentId: c.document, code: "X-1", meaning: "Injected meaning" }));
    await refused(readVersionFile(manager, c.version, "download"));
  });

  it("troubleshooting and AI: entries, new sessions, AI requests on their devices", async () => {
    await refused(addEntry(manager, { sessionId: c.session, kind: "NOTE", text: "Injected note" }));
    await refused(startSession(manager, { assetId: c.asset, faultDescription: "Isolation attack fault" }));
    await refused(askAi(manager, { sessionId: c.session, allowUnverified: "on" }));
  });

  it("reports: scheduling for their hospital, reading their snapshot", async () => {
    await refused(
      createReportSchedule(admin, {
        name: "Spy",
        kind: "OVERVIEW",
        frequency: "WEEKLY",
        hospitalId: c.hospital,
        recipientIds: [admin.user.id],
      }),
      true,
    );
    await refused(
      createReportSchedule(admin, { name: "Spy 2", kind: "OVERVIEW", frequency: "WEEKLY", recipientIds: [c.amina] }),
      true,
    );
    await refused(getReportSnapshot(admin, c.snapshot));
  });

  it("nothing in Coastal's data changed", async () => {
    expect(await coastalFingerprint(c.org)).toBe(fingerprint);
  });
});
