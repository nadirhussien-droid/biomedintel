// Test equipment register and calibration records.
//
// Test equipment is the tools a team tests other devices with (safety analysers,
// defibrillator testers and so on). A calibration record says when a tool was
// calibrated, by whom, with what result and when it is next due, and can carry
// the certificate as a PDF. Records and certificates are never changed or
// deleted; a mistake is corrected by adding a new record. Everything is audited.
import { createHash } from "node:crypto";
import { withTenant, type Tx } from "../db/tenant";
import { audit } from "../audit/audit";
import { requirePermission, type AccessContext } from "../authz/access";
import { NotFoundError, ValidationError } from "../authz/errors";
import { isUniqueViolation, parseInput } from "../validation";
import {
  MAX_CERTIFICATE_BYTES,
  calibrationSchema,
  calibrationState,
  dueDateFor,
  testEquipmentSchema,
  type CalState,
} from "@/lib/validation/testing";

const tenant = (ctx: AccessContext) => ({ userId: ctx.user.id, organizationId: ctx.organization.id });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const day = (d: Date) => d.toISOString().slice(0, 10);

export type CertificateUpload = { name: string; bytes: Uint8Array };

/** A certificate must be a real PDF of at most 5 MB. The file name is never trusted. */
function checkCertificate(file: CertificateUpload) {
  if (file.bytes.byteLength === 0)
    throw new ValidationError("The certificate file is empty.", { certificate: ["Empty"] });
  if (file.bytes.byteLength > MAX_CERTIFICATE_BYTES)
    throw new ValidationError("The certificate must be 5 MB or smaller.", { certificate: ["Too large"] });
  const head = new TextDecoder().decode(file.bytes.slice(0, 5));
  if (head !== "%PDF-")
    throw new ValidationError("The certificate must be a PDF file.", { certificate: ["Not a PDF"] });
  return {
    filename: file.name.replace(/[^A-Za-z0-9._ -]/g, "_").slice(-120) || "certificate.pdf",
    sizeBytes: file.bytes.byteLength,
    sha256: createHash("sha256").update(file.bytes).digest("hex"),
  };
}

export type TestEquipmentRow = {
  id: string;
  name: string;
  kind: string;
  manufacturer: string;
  model: string;
  serialNumber: string;
  equipmentTag: string | null;
  status: string;
  heldBy: string | null;
  latest: { calibratedOn: string; dueOn: string; result: string; hasCertificate: boolean } | null;
  state: CalState;
};

export async function listTestEquipment(ctx: AccessContext): Promise<TestEquipmentRow[]> {
  await requirePermission(ctx, "testing.view", { entityType: "test_equipment" });
  return withTenant(tenant(ctx), async (tx) => {
    const rows = await tx.testEquipment.findMany({
      orderBy: [{ status: "asc" }, { name: "asc" }],
      select: {
        id: true,
        name: true,
        kind: true,
        manufacturer: true,
        model: true,
        serialNumber: true,
        equipmentTag: true,
        status: true,
        heldBy: true,
        calibrations: {
          orderBy: [{ calibratedOn: "desc" }, { createdAt: "desc" }],
          take: 1,
          select: { calibratedOn: true, dueOn: true, result: true, certificate: { select: { recordId: true } } },
        },
      },
    });
    return rows.map(({ calibrations, ...r }) => {
      const c = calibrations[0];
      const latest = c
        ? {
            calibratedOn: day(c.calibratedOn),
            dueOn: day(c.dueOn),
            result: c.result,
            hasCertificate: c.certificate !== null,
          }
        : null;
      return { ...r, latest, state: calibrationState(latest) };
    });
  });
}

export async function getTestEquipment(ctx: AccessContext, id: string) {
  await requirePermission(ctx, "testing.view", { entityType: "test_equipment", entityId: id });
  if (!UUID.test(id)) throw new NotFoundError("Test equipment");
  return withTenant(tenant(ctx), async (tx) => {
    const item = await tx.testEquipment.findUnique({
      where: { id },
      include: {
        calibrations: {
          orderBy: [{ calibratedOn: "desc" }, { createdAt: "desc" }],
          select: {
            id: true,
            calibratedOn: true,
            dueOn: true,
            certificateNumber: true,
            laboratory: true,
            accreditation: true,
            traceableTo: true,
            result: true,
            notes: true,
            createdAt: true,
            certificate: { select: { filename: true, sizeBytes: true } },
          },
        },
      },
    });
    if (!item) throw new NotFoundError("Test equipment");
    const records = item.calibrations.map((c) => ({
      ...c,
      calibratedOn: day(c.calibratedOn),
      dueOn: day(c.dueOn),
      createdAt: c.createdAt,
    }));
    const latest = records[0] ? { dueOn: records[0].dueOn, result: records[0].result } : null;
    const { calibrations: _unused, ...rest } = item;
    void _unused;
    return { ...rest, records, state: calibrationState(latest) };
  });
}

export async function createTestEquipment(ctx: AccessContext, input: unknown) {
  await requirePermission(ctx, "testing.manage", { entityType: "test_equipment" });
  const data = parseInput(testEquipmentSchema, input);
  try {
    return await withTenant(tenant(ctx), async (tx) => {
      const row = await tx.testEquipment.create({
        data: { organizationId: ctx.organization.id, ...data, createdById: ctx.user.id },
        select: { id: true, name: true },
      });
      await audit(tx, {
        organizationId: ctx.organization.id,
        actorUserId: ctx.user.id,
        action: "test_equipment.created",
        entityType: "test_equipment",
        entityId: row.id,
        metadata: { name: row.name, kind: data.kind, serialNumber: data.serialNumber },
        request: ctx.request,
      });
      return row;
    });
  } catch (error) {
    if (isUniqueViolation(error))
      throw new ValidationError("That equipment ID is already used.", {
        equipmentTag: ["Already used in your organisation"],
      });
    throw error;
  }
}

export async function updateTestEquipment(ctx: AccessContext, id: string, input: unknown) {
  await requirePermission(ctx, "testing.manage", { entityType: "test_equipment", entityId: id });
  if (!UUID.test(id)) throw new NotFoundError("Test equipment");
  const data = parseInput(testEquipmentSchema, input);
  try {
    return await withTenant(tenant(ctx), async (tx) => {
      const before = await tx.testEquipment.findUnique({ where: { id } });
      if (!before) throw new NotFoundError("Test equipment");
      const changed = (Object.keys(data) as (keyof typeof data)[]).filter((k) => before[k] !== data[k]);
      if (changed.length === 0) return { id, changed: [] as string[] };
      await tx.testEquipment.update({ where: { id }, data: { ...data, updatedById: ctx.user.id } });
      await audit(tx, {
        organizationId: ctx.organization.id,
        actorUserId: ctx.user.id,
        action: "test_equipment.updated",
        entityType: "test_equipment",
        entityId: id,
        metadata: {
          changed,
          ...(changed.includes("status") ? { statusFrom: before.status, statusTo: data.status } : {}),
        },
        request: ctx.request,
      });
      return { id, changed: changed as string[] };
    });
  } catch (error) {
    if (isUniqueViolation(error))
      throw new ValidationError("That equipment ID is already used.", {
        equipmentTag: ["Already used in your organisation"],
      });
    throw error;
  }
}

/** Record a calibration, with its certificate PDF if there is one. */
export async function addCalibration(ctx: AccessContext, input: unknown, certificate?: CertificateUpload | null) {
  await requirePermission(ctx, "testing.manage", { entityType: "calibration_record" });
  const data = parseInput(calibrationSchema, input);
  const file =
    certificate && certificate.bytes.byteLength > 0
      ? { ...checkCertificate(certificate), bytes: certificate.bytes }
      : null;
  try {
    return await withTenant(tenant(ctx), async (tx) => {
      const item = await tx.testEquipment.findUnique({
        where: { id: data.testEquipmentId },
        select: { id: true, calibrationIntervalMonths: true },
      });
      if (!item) throw new NotFoundError("Test equipment");
      const dueOn = dueDateFor(data.calibratedOn, data.dueOn, item.calibrationIntervalMonths);
      const record = await tx.calibrationRecord.create({
        data: {
          organizationId: ctx.organization.id,
          testEquipmentId: item.id,
          calibratedOn: new Date(`${data.calibratedOn}T00:00:00Z`),
          dueOn: new Date(`${dueOn}T00:00:00Z`),
          certificateNumber: data.certificateNumber,
          laboratory: data.laboratory,
          accreditation: data.accreditation,
          traceableTo: data.traceableTo,
          result: data.result,
          notes: data.notes,
          createdById: ctx.user.id,
        },
        select: { id: true },
      });
      if (file) {
        await tx.calibrationCertificate.create({
          data: {
            organizationId: ctx.organization.id,
            recordId: record.id,
            filename: file.filename,
            mime: "application/pdf",
            sizeBytes: file.sizeBytes,
            sha256: file.sha256,
            content: Buffer.from(file.bytes),
            uploadedById: ctx.user.id,
          },
        });
      }
      await audit(tx, {
        organizationId: ctx.organization.id,
        actorUserId: ctx.user.id,
        action: "calibration.recorded",
        entityType: "test_equipment",
        entityId: item.id,
        metadata: {
          recordId: record.id,
          calibratedOn: data.calibratedOn,
          dueOn,
          result: data.result,
          certificateNumber: data.certificateNumber,
          certificateAttached: Boolean(file),
        },
        request: ctx.request,
      });
      return { id: record.id, testEquipmentId: item.id, dueOn };
    });
  } catch (error) {
    if (isUniqueViolation(error))
      throw new ValidationError("This certificate number is already recorded for this equipment.", {
        certificateNumber: ["Already recorded"],
      });
    throw error;
  }
}

/** Attach a certificate to a record that has none yet. A certificate is never replaced. */
export async function addCertificate(ctx: AccessContext, recordId: string, certificate: CertificateUpload) {
  await requirePermission(ctx, "testing.manage", { entityType: "calibration_record", entityId: recordId });
  if (!UUID.test(recordId)) throw new NotFoundError("Calibration record");
  const file = checkCertificate(certificate);
  try {
    return await withTenant(tenant(ctx), async (tx) => {
      const record = await tx.calibrationRecord.findUnique({
        where: { id: recordId },
        select: { id: true, testEquipmentId: true, certificate: { select: { recordId: true } } },
      });
      if (!record) throw new NotFoundError("Calibration record");
      if (record.certificate)
        throw new ValidationError("This record already has a certificate. Add a new calibration record to correct it.");
      await tx.calibrationCertificate.create({
        data: {
          organizationId: ctx.organization.id,
          recordId,
          filename: file.filename,
          mime: "application/pdf",
          sizeBytes: file.sizeBytes,
          sha256: file.sha256,
          content: Buffer.from(certificate.bytes),
          uploadedById: ctx.user.id,
        },
      });
      await audit(tx, {
        organizationId: ctx.organization.id,
        actorUserId: ctx.user.id,
        action: "calibration.certificate_added",
        entityType: "test_equipment",
        entityId: record.testEquipmentId,
        metadata: { recordId, sha256: file.sha256, sizeBytes: file.sizeBytes },
        request: ctx.request,
      });
      return { testEquipmentId: record.testEquipmentId };
    });
  } catch (error) {
    if (isUniqueViolation(error)) throw new ValidationError("This record already has a certificate.");
    throw error;
  }
}

/** The certificate file for download or viewing. Every access is audited. */
export async function readCertificate(ctx: AccessContext, recordId: string, how: "open" | "download") {
  await requirePermission(ctx, "testing.view", { entityType: "calibration_record", entityId: recordId });
  if (!UUID.test(recordId)) throw new NotFoundError("Certificate");
  return withTenant(tenant(ctx), async (tx) => {
    const f = await tx.calibrationCertificate.findUnique({
      where: { recordId },
      select: { filename: true, content: true, record: { select: { testEquipmentId: true } } },
    });
    if (!f) throw new NotFoundError("Certificate");
    await audit(tx, {
      organizationId: ctx.organization.id,
      actorUserId: ctx.user.id,
      action: `calibration.certificate_${how === "open" ? "opened" : "downloaded"}`,
      entityType: "test_equipment",
      entityId: f.record.testEquipmentId,
      metadata: { recordId },
      request: ctx.request,
    });
    return { filename: f.filename, content: f.content };
  });
}

/**
 * The test equipment for a job's electrical safety checks. It must exist in this
 * organisation, be in use, and have a calibration on record that did not fail.
 * An overdue calibration is allowed (the safety report says so clearly).
 * Runs inside the caller's transaction.
 */
export async function requireUsableTestEquipment(tx: Tx, id: unknown): Promise<string> {
  if (typeof id !== "string" || !UUID.test(id))
    throw new ValidationError("Choose the test equipment you used for the electrical safety checks.", {
      testEquipmentId: ["Required"],
    });
  const item = await tx.testEquipment.findUnique({
    where: { id },
    select: {
      id: true,
      status: true,
      calibrations: {
        orderBy: [{ calibratedOn: "desc" }, { createdAt: "desc" }],
        take: 1,
        select: { dueOn: true, result: true },
      },
    },
  });
  if (!item) throw new ValidationError("That test equipment was not found.", { testEquipmentId: ["Unknown"] });
  if (item.status !== "IN_USE")
    throw new ValidationError("That test equipment is not in use. Choose another tool.", {
      testEquipmentId: ["Not in use"],
    });
  const latest = item.calibrations[0]
    ? { dueOn: day(item.calibrations[0].dueOn), result: item.calibrations[0].result }
    : null;
  const state = calibrationState(latest);
  if (state === "NOT_CALIBRATED")
    throw new ValidationError("That test equipment has no calibration recorded. Add its calibration first.", {
      testEquipmentId: ["No calibration recorded"],
    });
  if (state === "FAILED")
    throw new ValidationError("That test equipment failed its last calibration and must not be used.", {
      testEquipmentId: ["Failed calibration"],
    });
  return item.id;
}

/** In-use tools that can be chosen for a job (name and calibration state), for the sign-off form. */
export async function listUsableTestEquipment(ctx: AccessContext) {
  const all = await listTestEquipment(ctx);
  return all
    .filter((i) => i.status === "IN_USE" && (i.state === "CURRENT" || i.state === "DUE_SOON" || i.state === "OVERDUE"))
    .map((i) => ({
      id: i.id,
      label: `${i.name} (${i.manufacturer} ${i.model}, serial ${i.serialNumber})`,
      state: i.state,
      dueOn: i.latest?.dueOn ?? null,
    }));
}

/**
 * The calibration that was in force for a tool on a given day: the latest record
 * made on or before that day. Used by the safety test report. Callers have
 * already been allowed to see the job, so no extra permission is checked here;
 * row-level security still limits everything to the organisation.
 */
export async function calibrationInForce(ctx: AccessContext, testEquipmentId: string, onDay: string) {
  return withTenant(tenant(ctx), async (tx) => {
    const r = await tx.calibrationRecord.findFirst({
      where: { testEquipmentId, calibratedOn: { lte: new Date(`${onDay}T00:00:00Z`) } },
      orderBy: [{ calibratedOn: "desc" }, { createdAt: "desc" }],
      select: {
        calibratedOn: true,
        dueOn: true,
        certificateNumber: true,
        laboratory: true,
        accreditation: true,
        result: true,
      },
    });
    if (!r) return null;
    return {
      calibratedOn: day(r.calibratedOn),
      dueOn: day(r.dueOn),
      certificateNumber: r.certificateNumber,
      laboratory: r.laboratory,
      accreditation: r.accreditation,
      result: r.result,
      expiredAtTest: day(r.dueOn) < onDay,
    };
  });
}

/** The next due date of the schedule a planned job belongs to, if it has one and it is later than this job. */
export async function nextScheduledDue(ctx: AccessContext, occurrenceId: string | null) {
  if (!occurrenceId) return null;
  return withTenant(tenant(ctx), async (tx) => {
    const current = await tx.pmOccurrence.findUnique({
      where: { id: occurrenceId },
      select: { seq: true, dueOn: true, schedule: { select: { nextDueOn: true, nextSeq: true, status: true } } },
    });
    if (!current || current.schedule.nextSeq <= current.seq) return null;
    return day(current.schedule.nextDueOn);
  });
}
