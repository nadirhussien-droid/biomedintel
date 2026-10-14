// Database schema constraints, checked as the OWNER role (which bypasses RLS),
// so these prove the rules are enforced by the database itself.
import { afterAll, describe, expect, it } from "vitest";
import { departmentId, hospitalId, orgId, owner, uniqueCode } from "../helpers";

afterAll(() => owner.$disconnect());

describe("schema constraints", () => {
  it("hospital codes are unique inside an organisation but may repeat across organisations", async () => {
    const coastal = await orgId("coastal-health");
    const highland = await orgId("highland-medical");
    await expect(
      owner.hospital.create({ data: { organizationId: coastal, name: "Duplicate", code: "RGH" } }),
    ).rejects.toThrow();
    const ok = await owner.hospital.create({
      data: { organizationId: highland, name: "Same code, other org", code: "RGH" },
    });
    expect(ok.code).toBe("RGH");
  });

  it("a department cannot belong to a hospital in another organisation (composite foreign key)", async () => {
    const coastal = await orgId("coastal-health");
    const highlandHospital = await hospitalId("highland-medical", "SRH");
    await expect(
      owner.department.create({
        data: { organizationId: coastal, hospitalId: highlandHospital, name: "Cross-tenant", code: "XT" },
      }),
    ).rejects.toThrow();
  });

  it("a membership scope cannot pair a hospital with another hospital's department", async () => {
    const coastal = await orgId("coastal-health");
    const membership = await owner.membership.findFirstOrThrow({
      where: { organizationId: coastal, role: "TECHNICIAN" },
    });
    const rgh = await hospitalId("coastal-health", "RGH");
    const nchIcu = await departmentId("coastal-health", "NCH", "ICU");
    await expect(
      owner.membershipScope.create({
        data: { organizationId: coastal, membershipId: membership.id, hospitalId: rgh, departmentId: nchIcu },
      }),
    ).rejects.toThrow();
  });

  it("the same (hospital, whole-hospital) scope cannot be added twice", async () => {
    const coastal = await orgId("coastal-health");
    const membership = await owner.membership.findFirstOrThrow({
      where: { organizationId: coastal, role: "ENGINEERING_MANAGER" },
    });
    const rgh = await hospitalId("coastal-health", "RGH");
    await expect(
      owner.membershipScope.create({
        data: { organizationId: coastal, membershipId: membership.id, hospitalId: rgh, departmentId: null },
      }),
    ).rejects.toThrow();
  });

  it("rejects badly formatted codes and slugs", async () => {
    const coastal = await orgId("coastal-health");
    await expect(
      owner.hospital.create({ data: { organizationId: coastal, name: "Bad", code: "bad code" } }),
    ).rejects.toThrow();
    await expect(owner.organization.create({ data: { name: "Bad", slug: "Bad Slug!" } })).rejects.toThrow();
  });

  it("archived status and archived_at must agree", async () => {
    const coastal = await orgId("coastal-health");
    await expect(
      owner.hospital.create({
        data: { organizationId: coastal, name: "Inconsistent", code: uniqueCode("INC"), status: "ARCHIVED" },
      }),
    ).rejects.toThrow();
  });

  it("only SUPER_ADMIN is a valid platform role", async () => {
    const u = await owner.user.findFirstOrThrow();
    await expect(owner.user.update({ where: { id: u.id }, data: { platformRole: "GOD_MODE" } })).rejects.toThrow();
  });

  it("organisations, hospitals and memberships cannot be deleted while records point at them", async () => {
    const coastal = await orgId("coastal-health");
    await expect(owner.organization.delete({ where: { id: coastal } })).rejects.toThrow();
  });

  it("audit records cannot be updated, deleted or truncated — even by the owner role", async () => {
    await owner.auditLog.create({ data: { action: "test.immutable" } });
    const row = await owner.auditLog.findFirstOrThrow({ where: { action: "test.immutable" } });
    await expect(owner.auditLog.update({ where: { id: row.id }, data: { action: "tampered" } })).rejects.toThrow(
      /append-only/,
    );
    await expect(owner.auditLog.delete({ where: { id: row.id } })).rejects.toThrow(/append-only/);
    await expect(owner.$executeRawUnsafe("TRUNCATE audit_logs")).rejects.toThrow(/append-only/);
  });
});
