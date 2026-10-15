// Work Order Management (Stage 5): reporting from a barcode, scope and tenant
// isolation, the technician workflow and sign-off rule, photos, downtime,
// notifications and audit events. Calls the same services the pages use.
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { afterAll, describe, expect, it } from "vitest";
import { db } from "@/server/db/client";
import { AuthorizationError, NotFoundError, ValidationError } from "@/server/authz/errors";
import { archiveAsset, createAsset, findAssetByCode, requestDecommission } from "@/server/services/assets";
import {
  addWorkOrderNote,
  addWorkOrderPhoto,
  assignWorkOrder,
  cancelWorkOrder,
  completeWorkOrder,
  getWorkOrder,
  getWorkOrderPhoto,
  holdWorkOrder,
  listWorkOrders,
  logWork,
  reopenWorkOrder,
  reportFault,
  reviewWorkOrder,
  setWorkOrderPriority,
  startWorkOrder,
  takeWorkOrder,
} from "@/server/services/work-orders";
import { countMyUnread, listMyNotifications, markRead } from "@/server/services/notifications";
import {
  addTestMember,
  assetId,
  coastalAssetInput,
  contextFor,
  departmentId,
  modelId,
  owner,
  userByEmail,
} from "../helpers";

const C = "coastal-health";
const H = "highland-medical";

afterAll(async () => {
  await db.$disconnect();
  await owner.$disconnect();
});

const james = () => contextFor("james.otieno@coastal.example", C); // Engineering Manager, Riverside
const amina = () => contextFor("amina.warsame@coastal.example"); // Technician, Riverside + Northlake ICU/Theatres
const peter = () => contextFor("peter.kamau@coastal.example"); // Department Head (NUM), Riverside ICU
const lucy = () => contextFor("lucy.achieng@coastal.example"); // Fault Reporter, Northlake Emergency
const hodan = () => contextFor("hodan.ali@coastal.example"); // Organization Administrator

/** A fresh Riverside ICU asset so each test controls its own state. */
async function freshAsset(kind: "pump" | "monitor" = "pump") {
  const input =
    kind === "pump"
      ? await coastalAssetInput() // infusion pump: safety-critical category, High risk
      : await coastalAssetInput({ modelId: await modelId(C, "EB-Vitals 5"), riskClass: "MEDIUM" });
  const created = await createAsset(await james(), input);
  return { id: created.id, tag: created.assetTag };
}

const SIGN_OFF = {
  diagnosis: "Fictional test: worn connector",
  resolution: "Fictional test: connector replaced, tested",
  outcome: "REPAIRED",
  functionalCheck: "PASS",
  electricalSafetyCheck: "PASS",
  checkNotes: "",
  declaration: true,
};

/** Reports, assigns to Amina and starts a job on a fresh asset. */
async function jobInProgress(opts: { outOfUse?: boolean; kind?: "pump" | "monitor" } = {}) {
  const asset = await freshAsset(opts.kind);
  const wo = await reportFault(await peter(), {
    assetId: asset.id,
    faultDescription: "Fictional test fault: alarm sounds without cause",
    outOfUse: opts.outOfUse ?? false,
  });
  const aminaUser = await userByEmail("amina.warsame@coastal.example");
  await assignWorkOrder(await james(), { id: wo.id, assigneeId: aminaUser.id });
  await startWorkOrder(await amina(), { id: wo.id });
  return { asset, wo };
}

// ─── Reporting ───────────────────────────────────────────────────────────────

describe("reporting a fault from a scanned barcode", () => {
  it("a Fault Reporter scans an in-scope device and reports it; safety-critical rules apply", async () => {
    const ctx = await lucy();
    const scan = await findAssetByCode(ctx, "DEF-0101"); // Northlake Emergency defibrillator
    expect(scan.kind).toBe("asset");
    const assetIdFromScan = scan.kind === "asset" ? scan.assetId : "";
    const result = await reportFault(ctx, {
      assetId: assetIdFromScan,
      faultDescription: "Fictional test: pads connector loose",
      outOfUse: false,
      confirmDuplicate: true, // the seed already has an open job on DEF-0101
    });
    expect(result.number).toMatch(/^WO-\d{4}-\d{5}$/);
    const wo = await owner.workOrder.findUniqueOrThrow({ where: { id: result.id } });
    expect(wo).toMatchObject({
      status: "REQUESTED",
      type: "CORRECTIVE",
      safetyCritical: true,
      priority: "HIGH",
      reportedById: ctx.user.id,
      assetId: assetIdFromScan,
    });
    expect(wo.dueAt!.getTime() - wo.createdAt.getTime()).toBe(24 * 3600_000);
    expect(await owner.auditLog.count({ where: { action: "workorder.requested", entityId: wo.id } })).toBe(1);
    expect(await owner.workOrderEvent.count({ where: { workOrderId: wo.id, kind: "CREATED" } })).toBe(1);
  });

  it("a scanned barcode never bypasses scope: out-of-scope and other-organisation assets are 'not found'", async () => {
    const reporter = await lucy();
    // Riverside ICU pump: not in Lucy's scope (Northlake Emergency only).
    await expect(
      reportFault(reporter, { assetId: await assetId(C, "INF-0001"), faultDescription: "Fictional test fault" }),
    ).rejects.toBeInstanceOf(NotFoundError);
    // Another organisation's asset id.
    await expect(
      reportFault(await hodan(), { assetId: await assetId(H, "VEN-0001"), faultDescription: "Fictional test fault" }),
    ).rejects.toBeInstanceOf(NotFoundError);
    expect(
      await owner.auditLog.count({
        where: { action: "workorder.access_denied", actorUserId: reporter.user.id, outcome: "DENIED" },
      }),
    ).toBeGreaterThan(0);
  });

  it("unknown and malformed identifiers are refused safely", async () => {
    const ctx = await peter();
    await expect(
      reportFault(ctx, { assetId: randomUUID(), faultDescription: "Fictional test fault" }),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      reportFault(ctx, { assetId: "INF-0001", faultDescription: "Fictional test fault" }),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      reportFault(ctx, { assetId: await assetId(C, "MON-0001"), faultDescription: "bad" }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("auditors and inventory managers cannot report faults", async () => {
    for (const email of ["fatuma.hassan@coastal.example", "grace.mwangi@coastal.example"]) {
      await expect(
        reportFault(await contextFor(email), {
          assetId: await assetId(C, "MON-0001"),
          faultDescription: "Fictional test",
        }),
      ).rejects.toBeInstanceOf(AuthorizationError);
    }
  });

  it("archived assets cannot have faults reported", async () => {
    const asset = await freshAsset("monitor");
    await archiveAsset(await james(), { id: asset.id });
    await expect(
      reportFault(await james(), { assetId: asset.id, faultDescription: "Fictional test fault" }),
    ).rejects.toThrow(/archived/);
  });

  it("taking a device out of use marks it Out of service, starts downtime, and alerts managers and admins", async () => {
    const asset = await freshAsset("pump");
    const before = await countMyUnread(await james());
    const wo = await reportFault(await peter(), {
      assetId: asset.id,
      faultDescription: "Fictional test: occlusion alarm with no occlusion",
      outOfUse: true,
    });
    const row = await owner.asset.findUniqueOrThrow({ where: { id: asset.id } });
    expect(row.status).toBe("OUT_OF_SERVICE");
    const history = await owner.assetStatusHistory.findFirstOrThrow({
      where: { assetId: asset.id, workOrderId: wo.id },
    });
    expect(history).toMatchObject({ fromStatus: "IN_SERVICE", toStatus: "OUT_OF_SERVICE" });
    expect(await owner.downtimeEvent.count({ where: { assetId: asset.id, endedAt: null } })).toBe(1);
    expect((await owner.workOrder.findUniqueOrThrow({ where: { id: wo.id } })).priority).toBe("URGENT");
    expect(await countMyUnread(await james())).toBe(before + 1);
    const hodanNotes = await listMyNotifications(await hodan());
    expect(hodanNotes.some((n) => n.link === `/work-orders/${wo.id}` && n.title.startsWith("SAFETY-CRITICAL"))).toBe(
      true,
    );
  });

  it("a second open job on the same device must be confirmed", async () => {
    const asset = await freshAsset("monitor");
    const first = await reportFault(await peter(), {
      assetId: asset.id,
      faultDescription: "Fictional test: first fault",
    });
    await expect(
      reportFault(await peter(), { assetId: asset.id, faultDescription: "Fictional test: second fault" }),
    ).rejects.toThrow(new RegExp(first.number));
    const second = await reportFault(await peter(), {
      assetId: asset.id,
      faultDescription: "Fictional test: second fault",
      confirmDuplicate: true,
    });
    expect(second.number).not.toBe(first.number);
  });

  it("numbers are sequential per organisation and independent between organisations", async () => {
    const a = await reportFault(await peter(), {
      assetId: (await freshAsset("monitor")).id,
      faultDescription: "Fictional test fault A",
    });
    const b = await reportFault(await peter(), {
      assetId: (await freshAsset("monitor")).id,
      faultDescription: "Fictional test fault B",
    });
    const seq = (n: string) => Number(n.split("-")[2]);
    expect(seq(b.number)).toBe(seq(a.number) + 1);
    const highland = await owner.workOrder.findMany({ where: { organization: { slug: H } }, select: { number: true } });
    expect(highland.map((w) => w.number)).toEqual([`WO-${new Date().getUTCFullYear()}-00001`]);
  });
});

// ─── Assignment ──────────────────────────────────────────────────────────────

describe("assignment", () => {
  it("managers assign technicians who cover the department; others are refused", async () => {
    const asset = await freshAsset("monitor");
    const wo = await reportFault(await peter(), { assetId: asset.id, faultDescription: "Fictional test fault" });
    const sara = await userByEmail("sara.nakato@highland.example"); // other organisation
    const grace = await userByEmail("grace.mwangi@coastal.example"); // inventory manager
    for (const assigneeId of [sara.id, grace.id, "not-a-user"]) {
      await expect(assignWorkOrder(await james(), { id: wo.id, assigneeId })).rejects.toBeInstanceOf(ValidationError);
    }
    const aminaUser = await userByEmail("amina.warsame@coastal.example");
    await assignWorkOrder(await james(), { id: wo.id, assigneeId: aminaUser.id });
    const row = await owner.workOrder.findUniqueOrThrow({ where: { id: wo.id } });
    expect(row).toMatchObject({ status: "ASSIGNED", assignedToId: aminaUser.id });
    const notes = await listMyNotifications(await amina());
    expect(notes.some((n) => n.type === "workorder.assigned" && n.link === `/work-orders/${wo.id}`)).toBe(true);
  });

  it("technicians cannot assign or re-prioritise, but can take an unassigned job once", async () => {
    const asset = await freshAsset("monitor");
    const wo = await reportFault(await peter(), { assetId: asset.id, faultDescription: "Fictional test fault" });
    const tech = await amina();
    await expect(assignWorkOrder(tech, { id: wo.id, assigneeId: tech.user.id })).rejects.toBeInstanceOf(
      AuthorizationError,
    );
    await expect(setWorkOrderPriority(tech, { id: wo.id, priority: "LOW" })).rejects.toBeInstanceOf(AuthorizationError);
    await takeWorkOrder(tech, { id: wo.id });
    await expect(takeWorkOrder(await james(), { id: wo.id })).rejects.toThrow(/already been taken/);
  });

  it("safety-critical jobs cannot be lowered below High priority", async () => {
    const asset = await freshAsset("pump");
    const wo = await reportFault(await peter(), { assetId: asset.id, faultDescription: "Fictional test fault" });
    await expect(setWorkOrderPriority(await james(), { id: wo.id, priority: "LOW" })).rejects.toBeInstanceOf(
      ValidationError,
    );
    await setWorkOrderPriority(await james(), { id: wo.id, priority: "URGENT" });
    const row = await owner.workOrder.findUniqueOrThrow({ where: { id: wo.id } });
    expect(row.dueAt!.getTime() - row.createdAt.getTime()).toBe(4 * 3600_000);
  });
});

// ─── The work and sign-off by the technician ─────────────────────────────────

describe("technician workflow and sign-off", () => {
  it("only the assigned technician can start, log work, hold and sign off — others are refused and audited", async () => {
    const asset = await freshAsset("monitor");
    const wo = await reportFault(await peter(), { assetId: asset.id, faultDescription: "Fictional test fault" });
    const aminaUser = await userByEmail("amina.warsame@coastal.example");
    await assignWorkOrder(await james(), { id: wo.id, assigneeId: aminaUser.id });
    const otherTechEmail = await addTestMember(C, "TECHNICIAN", [{ hospital: "RGH" }]);
    const other = await contextFor(otherTechEmail);
    await expect(startWorkOrder(other, { id: wo.id })).rejects.toBeInstanceOf(AuthorizationError);
    await expect(startWorkOrder(await james(), { id: wo.id })).rejects.toBeInstanceOf(AuthorizationError); // manager is not the assignee
    await startWorkOrder(await amina(), { id: wo.id });
    await expect(logWork(other, { id: wo.id, description: "Not my job", minutes: 10 })).rejects.toBeInstanceOf(
      AuthorizationError,
    );
    await expect(completeWorkOrder(other, { id: wo.id, ...SIGN_OFF })).rejects.toBeInstanceOf(AuthorizationError);
    await expect(completeWorkOrder(await james(), { id: wo.id, ...SIGN_OFF })).rejects.toBeInstanceOf(
      AuthorizationError,
    );
    expect(
      await owner.auditLog.count({ where: { action: "workorder.access_denied", entityId: wo.id, outcome: "DENIED" } }),
    ).toBeGreaterThanOrEqual(4);
    await logWork(await amina(), { id: wo.id, description: "Fictional test: replaced cable", minutes: 30 });
    await holdWorkOrder(await amina(), { id: wo.id, reason: "Waiting for a part" });
    await startWorkOrder(await amina(), { id: wo.id }); // resume
    await completeWorkOrder(await amina(), { id: wo.id, ...SIGN_OFF });
    const row = await owner.workOrder.findUniqueOrThrow({ where: { id: wo.id } });
    expect(row).toMatchObject({ status: "COMPLETED", completedById: aminaUser.id, signOffDeclaration: true });
    const kinds = (
      await owner.workOrderEvent.findMany({ where: { workOrderId: wo.id }, orderBy: { createdAt: "asc" } })
    ).map((e) => e.kind);
    expect(kinds).toEqual(["CREATED", "ASSIGNED", "STARTED", "WORK_LOGGED", "ON_HOLD", "RESUMED", "COMPLETED"]);
  });

  it("a repaired sign-off returns the device to service and ends downtime", async () => {
    const { asset, wo } = await jobInProgress({ outOfUse: true });
    expect((await owner.asset.findUniqueOrThrow({ where: { id: asset.id } })).status).toBe("UNDER_REPAIR");
    const result = await completeWorkOrder(await amina(), { id: wo.id, ...SIGN_OFF });
    expect(result.returnedToService).toBe(true);
    expect((await owner.asset.findUniqueOrThrow({ where: { id: asset.id } })).status).toBe("IN_SERVICE");
    expect(await owner.downtimeEvent.count({ where: { assetId: asset.id, endedAt: null } })).toBe(0);
    expect(await owner.auditLog.count({ where: { action: "workorder.completed", entityId: wo.id } })).toBe(1);
    expect(await owner.auditLog.count({ where: { action: "asset.returned_to_service", entityId: asset.id } })).toBe(1);
    // Safety-critical self-signed job: managers are asked to review.
    const notes = await listMyNotifications(await james());
    expect(notes.some((n) => n.type === "workorder.completed" && n.link === `/work-orders/${wo.id}`)).toBe(true);
  });

  it("a device cannot be signed off as repaired with a failed check, and the declaration is required", async () => {
    const { wo } = await jobInProgress();
    const tech = await amina();
    await expect(completeWorkOrder(tech, { id: wo.id, ...SIGN_OFF, functionalCheck: "FAIL" })).rejects.toBeInstanceOf(
      ValidationError,
    );
    await expect(
      completeWorkOrder(tech, { id: wo.id, ...SIGN_OFF, electricalSafetyCheck: "FAIL" }),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      completeWorkOrder(tech, { id: wo.id, ...SIGN_OFF, electricalSafetyCheck: "NOT_APPLICABLE" }),
    ).rejects.toThrow(); // needs a note
    await expect(completeWorkOrder(tech, { id: wo.id, ...SIGN_OFF, declaration: false })).rejects.toBeInstanceOf(
      ValidationError,
    );
    expect((await owner.workOrder.findUniqueOrThrow({ where: { id: wo.id } })).status).toBe("IN_PROGRESS");
  });

  it("'not repairable' keeps the device out of service", async () => {
    const { asset, wo } = await jobInProgress({ outOfUse: true });
    await completeWorkOrder(await amina(), {
      id: wo.id,
      ...SIGN_OFF,
      outcome: "NOT_REPAIRABLE",
      functionalCheck: "FAIL",
      electricalSafetyCheck: "FAIL",
    });
    expect((await owner.asset.findUniqueOrThrow({ where: { id: asset.id } })).status).toBe("OUT_OF_SERVICE");
    expect(await owner.downtimeEvent.count({ where: { assetId: asset.id, endedAt: null } })).toBe(1);
  });

  it("the database itself refuses a sign-off by anyone but the assigned technician, or 'repaired' with a failed check", async () => {
    const { wo } = await jobInProgress();
    const james_ = await userByEmail("james.otieno@coastal.example");
    const base = {
      status: "COMPLETED" as const,
      completedAt: new Date(),
      outcome: "REPAIRED" as const,
      resolution: "x",
      functionalCheck: "PASS" as const,
      electricalSafetyCheck: "PASS" as const,
      signOffDeclaration: true,
    };
    await expect(
      owner.workOrder.update({ where: { id: wo.id }, data: { ...base, completedById: james_.id } }),
    ).rejects.toThrow();
    const aminaUser = await userByEmail("amina.warsame@coastal.example");
    await expect(
      owner.workOrder.update({
        where: { id: wo.id },
        data: { ...base, completedById: aminaUser.id, functionalCheck: "FAIL" },
      }),
    ).rejects.toThrow();
  });
});

// ─── Managers after sign-off; cancelling ─────────────────────────────────────

describe("review, reopen and cancel", () => {
  it("a manager reviews a self-signed safety-critical job; technicians cannot", async () => {
    const { wo } = await jobInProgress();
    await completeWorkOrder(await amina(), { id: wo.id, ...SIGN_OFF });
    const review = await listWorkOrders(await james(), { view: "review" });
    expect(review.rows.some((r) => r.id === wo.id)).toBe(true);
    await expect(reviewWorkOrder(await amina(), { id: wo.id })).rejects.toBeInstanceOf(AuthorizationError);
    await reviewWorkOrder(await james(), { id: wo.id });
    await expect(reviewWorkOrder(await hodan(), { id: wo.id })).rejects.toThrow(/already been reviewed/);
    const after = await listWorkOrders(await james(), { view: "review" });
    expect(after.rows.some((r) => r.id === wo.id)).toBe(false);
  });

  it("reopening puts the device back under repair and restarts downtime", async () => {
    const { asset, wo } = await jobInProgress({ outOfUse: true });
    await completeWorkOrder(await amina(), { id: wo.id, ...SIGN_OFF });
    await expect(reopenWorkOrder(await amina(), { id: wo.id, reason: "Alarm again" })).rejects.toBeInstanceOf(
      AuthorizationError,
    );
    await reopenWorkOrder(await james(), { id: wo.id, reason: "Fictional test: alarm returned" });
    const row = await owner.workOrder.findUniqueOrThrow({ where: { id: wo.id } });
    expect(row).toMatchObject({ status: "IN_PROGRESS", reopenCount: 1, completedById: null, outcome: null });
    expect((await owner.asset.findUniqueOrThrow({ where: { id: asset.id } })).status).toBe("UNDER_REPAIR");
    expect(await owner.downtimeEvent.count({ where: { assetId: asset.id, endedAt: null } })).toBe(1);
  });

  it("a reporter can cancel only their own unassigned report; managers can cancel open jobs", async () => {
    const asset = await freshAsset("monitor");
    const mine = await reportFault(await peter(), { assetId: asset.id, faultDescription: "Fictional test fault" });
    await cancelWorkOrder(await peter(), { id: mine.id, reason: "Reported by mistake" });
    const other = await reportFault(await peter(), {
      assetId: (await freshAsset("monitor")).id,
      faultDescription: "Fictional test fault",
    });
    const aminaUser = await userByEmail("amina.warsame@coastal.example");
    await assignWorkOrder(await james(), { id: other.id, assigneeId: aminaUser.id });
    await expect(cancelWorkOrder(await peter(), { id: other.id, reason: "No longer needed" })).rejects.toBeInstanceOf(
      AuthorizationError,
    );
    await cancelWorkOrder(await james(), { id: other.id, reason: "Duplicate" });
    expect((await owner.workOrder.findUniqueOrThrow({ where: { id: other.id } })).status).toBe("CANCELLED");
  });
});

// ─── Visibility and tenant isolation ─────────────────────────────────────────

describe("work order visibility", () => {
  it("Fault Reporters see only jobs they reported", async () => {
    const ctx = await lucy();
    const { rows } = await listWorkOrders(ctx, { view: "all" });
    expect(rows.length).toBeGreaterThan(0);
    const reporters = await owner.workOrder.findMany({ where: { id: { in: rows.map((r) => r.id) } } });
    expect(reporters.every((w) => w.reportedById === ctx.user.id)).toBe(true);
  });

  it("a Department Head sees only their department's jobs", async () => {
    const ctx = await peter();
    const icu = await departmentId(C, "RGH", "ICU");
    const { rows } = await listWorkOrders(ctx, { view: "all" });
    const full = await owner.workOrder.findMany({ where: { id: { in: rows.map((r) => r.id) } } });
    expect(full.length).toBeGreaterThan(0);
    expect(full.every((w) => w.departmentId === icu)).toBe(true);
  });

  it("organisation A cannot list, search, open or act on organisation B's jobs", async () => {
    const highlandJob = await owner.workOrder.findFirstOrThrow({ where: { organization: { slug: H } } });
    const ctx = await hodan();
    const { rows } = await listWorkOrders(ctx, { view: "all", q: highlandJob.number });
    expect(rows.every((r) => r.id !== highlandJob.id)).toBe(true);
    await expect(getWorkOrder(ctx, highlandJob.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(cancelWorkOrder(ctx, { id: highlandJob.id, reason: "Not mine" })).rejects.toBeInstanceOf(
      NotFoundError,
    );
    await expect(addWorkOrderNote(ctx, { id: highlandJob.id, note: "Hello" })).rejects.toBeInstanceOf(NotFoundError);
  });

  it("the list can be searched by the asset's barcode value", async () => {
    const { rows } = await listWorkOrders(await amina(), { view: "all", q: "VEN-0001" });
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.asset.assetTag === "VEN-0001")).toBe(true);
  });

  it("an out-of-scope job is 'not found' even inside the same organisation", async () => {
    const nch = await owner.workOrder.findFirstOrThrow({
      where: { organization: { slug: C }, asset: { assetTag: "DEF-0101" } },
    });
    await expect(getWorkOrder(await peter(), nch.id)).rejects.toBeInstanceOf(NotFoundError);
  });
});

// ─── Photos ──────────────────────────────────────────────────────────────────

async function jpegWithGps(): Promise<Uint8Array> {
  const buf = await sharp({ create: { width: 320, height: 240, channels: 3, background: "#4a6177" } })
    .jpeg()
    .withExif({ IFD0: { Artist: "Fictional camera owner", Make: "TestCam" } })
    .toBuffer();
  return new Uint8Array(buf);
}

describe("photos", () => {
  it("accepts a real photo, re-encodes it and strips its metadata", async () => {
    const asset = await freshAsset("monitor");
    const wo = await reportFault(await peter(), { assetId: asset.id, faultDescription: "Fictional test fault" });
    const original = await jpegWithGps();
    expect((await sharp(original).metadata()).exif).toBeDefined();
    const photo = await addWorkOrderPhoto(await peter(), wo.id, { name: "../../etc/err<or>.jpeg", bytes: original });
    const stored = await getWorkOrderPhoto(await peter(), wo.id, photo.id);
    expect(stored.mime).toBe("image/jpeg");
    expect(stored.filename).toBe("error.jpg");
    expect((await sharp(Buffer.from(stored.content)).metadata()).exif).toBeUndefined();
    expect(await owner.auditLog.count({ where: { action: "workorder.photo_added", entityId: wo.id } })).toBe(1);
  });

  it("refuses files that are not real images, whatever their name", async () => {
    const asset = await freshAsset("monitor");
    const wo = await reportFault(await peter(), { assetId: asset.id, faultDescription: "Fictional test fault" });
    const fake = new TextEncoder().encode("<script>alert(1)</script>");
    await expect(addWorkOrderPhoto(await peter(), wo.id, { name: "photo.jpg", bytes: fake })).rejects.toBeInstanceOf(
      ValidationError,
    );
    const gif = await sharp({ create: { width: 8, height: 8, channels: 3, background: "#000" } })
      .gif()
      .toBuffer();
    await expect(
      addWorkOrderPhoto(await peter(), wo.id, { name: "a.gif", bytes: new Uint8Array(gif) }),
    ).rejects.toThrow(/JPEG, PNG or WebP/);
    const big = new Uint8Array(5 * 1024 * 1024 + 1);
    await expect(addWorkOrderPhoto(await peter(), wo.id, { name: "big.jpg", bytes: big })).rejects.toThrow(/5 MB/);
  });

  it("allows at most 5 photos per job", async () => {
    const asset = await freshAsset("monitor");
    const wo = await reportFault(await peter(), { assetId: asset.id, faultDescription: "Fictional test fault" });
    const png = new Uint8Array(
      await sharp({ create: { width: 16, height: 16, channels: 3, background: "#55d6c2" } })
        .png()
        .toBuffer(),
    );
    for (let i = 0; i < 5; i++) await addWorkOrderPhoto(await peter(), wo.id, { name: `p${i}.png`, bytes: png });
    await expect(addWorkOrderPhoto(await peter(), wo.id, { name: "p6.png", bytes: png })).rejects.toThrow(/at most 5/);
  });

  it("only the reporter, the assignee or a manager may add photos; other tenants cannot see them", async () => {
    const asset = await freshAsset("monitor");
    const wo = await reportFault(await peter(), { assetId: asset.id, faultDescription: "Fictional test fault" });
    const png = new Uint8Array(
      await sharp({ create: { width: 16, height: 16, channels: 3, background: "#102d46" } })
        .png()
        .toBuffer(),
    );
    await expect(addWorkOrderPhoto(await amina(), wo.id, { name: "x.png", bytes: png })).rejects.toBeInstanceOf(
      AuthorizationError,
    ); // in scope, but not reporter/assignee/manager
    const photo = await addWorkOrderPhoto(await james(), wo.id, { name: "x.png", bytes: png });
    const david = await contextFor("david.mutua@highland.example");
    await expect(getWorkOrderPhoto(david, wo.id, photo.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(addWorkOrderPhoto(david, wo.id, { name: "x.png", bytes: png })).rejects.toBeInstanceOf(NotFoundError);
  });
});

// ─── Notifications ───────────────────────────────────────────────────────────

describe("notifications", () => {
  it("each person sees and marks only their own notifications", async () => {
    const jamesCtx = await james();
    const aminaCtx = await amina();
    const mine = await listMyNotifications(jamesCtx);
    expect(mine.length).toBeGreaterThan(0);
    const aminaSees = await listMyNotifications(aminaCtx);
    expect(aminaSees.some((n) => mine.some((m) => m.id === n.id))).toBe(false);
    // Amina cannot mark James's notification as read.
    expect(await markRead(aminaCtx, { id: mine[0].id })).toBe(0);
    expect(await markRead(jamesCtx, { id: mine[0].id })).toBe(1);
    await markRead(jamesCtx, { id: "all" });
    expect(await countMyUnread(jamesCtx)).toBe(0);
  });
});

// ─── Link with decommissioning (Stage 4) ─────────────────────────────────────

describe("decommissioning and open jobs", () => {
  it("an asset with an open work order cannot be put forward for decommissioning", async () => {
    const asset = await freshAsset("monitor");
    const wo = await reportFault(await peter(), { assetId: asset.id, faultDescription: "Fictional test fault" });
    await expect(
      requestDecommission(await amina(), { id: asset.id, reason: "Fictional test: end of life" }),
    ).rejects.toThrow(new RegExp(`open work orders \\(${wo.number}\\)`));
    await cancelWorkOrder(await james(), { id: wo.id, reason: "Test" });
    await requestDecommission(await amina(), { id: asset.id, reason: "Fictional test: end of life" });
    const approvers = await listMyNotifications(await peter());
    expect(approvers.some((n) => n.type === "asset.decommission_requested" && n.link === `/assets/${asset.id}`)).toBe(
      true,
    );
  });
});
