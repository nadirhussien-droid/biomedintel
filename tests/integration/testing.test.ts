// Test equipment register and calibration records: rules, permissions, isolation, history protection.
import { afterAll, describe, expect, it } from "vitest";
import { db } from "@/server/db/client";
import { AuthorizationError, NotFoundError, ValidationError } from "@/server/authz/errors";
import {
  addCalibration,
  addCertificate,
  createTestEquipment,
  getTestEquipment,
  listTestEquipment,
  readCertificate,
  updateTestEquipment,
} from "@/server/services/testing";
import { addTestMember, contextFor, owner, uniqueCode } from "../helpers";

const C = "coastal-health";
afterAll(async () => {
  await db.$disconnect();
  await owner.$disconnect();
});

const amina = () => contextFor("amina.warsame@coastal.example"); // technician
const pdf = (size = 200) => ({
  name: "cert 2026.pdf",
  bytes: new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, ...new Array(size).fill(65)]),
});

function equipment(over: Record<string, unknown> = {}) {
  return {
    name: "Fictional safety analyser",
    kind: "SAFETY_ANALYSER",
    manufacturer: "Fictional Maker",
    model: "SA-100",
    serialNumber: uniqueCode("SN"),
    equipmentTag: "",
    measures: "Leakage current",
    calibrationIntervalMonths: "12",
    heldBy: "",
    location: "",
    status: "IN_USE",
    notes: "",
    ...over,
  };
}
const cal = (id: string, over: Record<string, unknown> = {}) => ({
  testEquipmentId: id,
  calibratedOn: "2026-10-01",
  dueOn: "",
  certificateNumber: uniqueCode("CERT"),
  laboratory: "Fictional Calibration Lab",
  accreditation: "ISO/IEC 17025",
  traceableTo: "",
  result: "PASS",
  notes: "",
  ...over,
});

describe("test equipment and calibration", () => {
  it("registers a tool, records a calibration with a certificate, and audits both", async () => {
    const ctx = await amina();
    const e = await createTestEquipment(ctx, equipment());
    const empty = await getTestEquipment(ctx, e.id);
    expect(empty.state).toBe("NOT_CALIBRATED");

    const r = await addCalibration(ctx, cal(e.id), pdf());
    expect(r.dueOn).toBe("2027-10-01"); // 12 months after the calibration date
    const item = await getTestEquipment(ctx, e.id);
    expect(item.state).toBe("CURRENT");
    expect(item.records[0]!.certificate?.filename).toBe("cert 2026.pdf");
    const file = await readCertificate(ctx, r.id, "download");
    expect(Buffer.from(file.content).subarray(0, 5).toString()).toBe("%PDF-");
    for (const action of ["test_equipment.created", "calibration.recorded", "calibration.certificate_downloaded"]) {
      expect(await owner.auditLog.count({ where: { action, entityId: e.id } })).toBe(1);
    }
    const listed = (await listTestEquipment(ctx)).find((x) => x.id === e.id)!;
    expect(listed.latest?.hasCertificate).toBe(true);
  });

  it("a failed calibration marks the tool as not to be used, and an old one as overdue", async () => {
    const ctx = await amina();
    const failed = await createTestEquipment(ctx, equipment());
    await addCalibration(ctx, cal(failed.id, { result: "FAIL" }));
    expect((await getTestEquipment(ctx, failed.id)).state).toBe("FAILED");
    const old = await createTestEquipment(ctx, equipment());
    await addCalibration(ctx, cal(old.id, { calibratedOn: "2024-01-10" }));
    expect((await getTestEquipment(ctx, old.id)).state).toBe("OVERDUE");
  });

  it("accepts only real PDFs up to 5 MB", async () => {
    const ctx = await amina();
    const e = await createTestEquipment(ctx, equipment());
    await expect(
      addCalibration(ctx, cal(e.id), { name: "x.pdf", bytes: new TextEncoder().encode("<html>") }),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(addCalibration(ctx, cal(e.id), pdf(5 * 1024 * 1024))).rejects.toBeInstanceOf(ValidationError);
    expect(await owner.calibrationRecord.count({ where: { testEquipmentId: e.id } })).toBe(0);
  });

  it("adds a missing certificate once, never replaces it", async () => {
    const ctx = await amina();
    const e = await createTestEquipment(ctx, equipment());
    const r = await addCalibration(ctx, cal(e.id));
    await addCertificate(ctx, r.id, pdf());
    await expect(addCertificate(ctx, r.id, pdf())).rejects.toBeInstanceOf(ValidationError);
  });

  it("keeps calibration history: records and certificates cannot be changed or deleted", async () => {
    const ctx = await amina();
    const e = await createTestEquipment(ctx, equipment());
    const r = await addCalibration(ctx, cal(e.id), pdf());
    await expect(owner.calibrationRecord.update({ where: { id: r.id }, data: { result: "FAIL" } })).rejects.toThrow();
    await expect(owner.calibrationRecord.delete({ where: { id: r.id } })).rejects.toThrow();
    await expect(owner.calibrationCertificate.delete({ where: { recordId: r.id } })).rejects.toThrow();
    await expect(db.$executeRaw`DELETE FROM test_equipment WHERE id = ${e.id}::uuid`).rejects.toThrow();
  });

  it("rejects duplicate IDs and certificate numbers, and edits are audited", async () => {
    const ctx = await amina();
    const tag =
      "TE-" +
      uniqueCode("T")
        .replace(/[^A-Z0-9]/g, "")
        .slice(0, 8);
    const e = await createTestEquipment(ctx, equipment({ equipmentTag: tag.toLowerCase() }));
    await expect(createTestEquipment(ctx, equipment({ equipmentTag: tag }))).rejects.toBeInstanceOf(ValidationError);
    const c = cal(e.id);
    await addCalibration(ctx, c);
    await expect(addCalibration(ctx, c)).rejects.toBeInstanceOf(ValidationError);
    const edited = await updateTestEquipment(
      ctx,
      e.id,
      equipment({
        equipmentTag: tag,
        status: "OUT_OF_SERVICE",
        serialNumber: (await getTestEquipment(ctx, e.id)).serialNumber,
        name: "Fictional safety analyser",
        measures: "Leakage current",
      }),
    );
    expect(edited.changed).toContain("status");
    expect(await owner.auditLog.count({ where: { action: "test_equipment.updated", entityId: e.id } })).toBe(1);
  });

  it("is private to the organisation and respects roles", async () => {
    const ctx = await amina();
    const e = await createTestEquipment(ctx, equipment());
    const david = await contextFor("david.mutua@highland.example");
    await expect(getTestEquipment(david, e.id)).rejects.toBeInstanceOf(NotFoundError);
    expect((await listTestEquipment(david)).some((x) => x.id === e.id)).toBe(false);

    const auditor = await contextFor(await addTestMember(C, "AUDITOR", [{ hospital: "RGH" }]), C);
    expect((await listTestEquipment(auditor)).some((x) => x.id === e.id)).toBe(true);
    await expect(createTestEquipment(auditor, equipment())).rejects.toBeInstanceOf(AuthorizationError);
    const reporter = await contextFor(await addTestMember(C, "FAULT_REPORTER", [{ hospital: "RGH" }]), C);
    await expect(listTestEquipment(reporter)).rejects.toBeInstanceOf(AuthorizationError);
  });
});
