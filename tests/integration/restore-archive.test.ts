// Undoing an archive (27 Oct 2026): a hospital comes back with the departments archived with it,
// a department archived on its own stays archived, only administrators can do it, and it is audited.
import { afterAll, describe, expect, it } from "vitest";
import { AuthorizationError, ValidationError } from "@/server/authz/errors";
import { db } from "@/server/db/client";
import {
  archiveDepartment,
  archiveHospital,
  createDepartment,
  createHospital,
  listArchived,
  restoreDepartment,
  restoreHospital,
} from "@/server/services/organization-admin";
import { auditCount, contextFor, owner, uniqueCode } from "../helpers";

afterAll(async () => {
  await db.$disconnect();
  await owner.$disconnect();
});

const hodan = () => contextFor("hodan.ali@coastal.example", "coastal-health");

describe("restoring archived hospitals and departments", () => {
  it("restores a hospital with the departments archived together with it, but not one archived earlier", async () => {
    const ctx = await hodan();
    const h = await createHospital(ctx, { name: "Restore Test", code: uniqueCode("RT"), timezone: "Africa/Nairobi" });
    const fresh = await hodan(); // sees the new hospital
    const a = await createDepartment(fresh, { hospitalId: h.id, name: "Dept A", code: "DA" });
    const b = await createDepartment(fresh, { hospitalId: h.id, name: "Dept B", code: "DB" });
    await archiveDepartment(fresh, { id: b.id }); // archived on its own, earlier
    await new Promise((r) => setTimeout(r, 20));
    await archiveHospital(fresh, { id: h.id });

    const listed = await listArchived(await hodan());
    expect(listed.hospitals.map((x) => x.id)).toContain(h.id);

    await restoreHospital(await hodan(), { id: h.id });
    const hospital = await owner.hospital.findUniqueOrThrow({ where: { id: h.id } });
    expect(hospital.status).toBe("ACTIVE");
    expect(hospital.archivedAt).toBeNull();
    expect((await owner.department.findUniqueOrThrow({ where: { id: a.id } })).status).toBe("ACTIVE");
    expect((await owner.department.findUniqueOrThrow({ where: { id: b.id } })).status).toBe("ARCHIVED");
    expect(await auditCount({ action: "hospital.restored", actorUserId: ctx.user.id })).toBeGreaterThan(0);

    // The department archived on its own can then be restored too.
    const after = await listArchived(await hodan());
    expect(after.departments.map((x) => x.id)).toContain(b.id);
    await restoreDepartment(await hodan(), { id: b.id });
    expect((await owner.department.findUniqueOrThrow({ where: { id: b.id } })).status).toBe("ACTIVE");
    expect(await auditCount({ action: "department.restored", actorUserId: ctx.user.id })).toBeGreaterThan(0);
  });

  it("a department cannot be restored while its hospital is still archived", async () => {
    const ctx = await hodan();
    const h = await createHospital(ctx, { name: "Restore Order", code: uniqueCode("RO"), timezone: "Africa/Nairobi" });
    const fresh = await hodan();
    const d = await createDepartment(fresh, { hospitalId: h.id, name: "Dept", code: "DD" });
    await archiveHospital(fresh, { id: h.id });
    await expect(restoreDepartment(await hodan(), { id: d.id })).rejects.toBeInstanceOf(ValidationError);
  });

  it("only administrators can restore", async () => {
    const tech = await contextFor("amina.warsame@coastal.example", "coastal-health");
    await expect(listArchived(tech)).rejects.toBeInstanceOf(AuthorizationError);
    await expect(restoreHospital(tech, { id: "00000000-0000-4000-8000-000000000000" })).rejects.toBeInstanceOf(
      AuthorizationError,
    );
  });
});
