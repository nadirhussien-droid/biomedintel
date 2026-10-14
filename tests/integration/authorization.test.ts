// Server-side authorization: roles, scope, self-escalation, validation and the
// audit events they produce. These call the same service functions the server
// actions call.
import { afterAll, describe, expect, it } from "vitest";
import { db } from "@/server/db/client";
import { resolveAccess, listUserOrganizations } from "@/server/authz/access";
import { AuthorizationError, NotFoundError, ValidationError } from "@/server/authz/errors";
import {
  addMember,
  archiveDepartment,
  changeMemberRole,
  createDepartment,
  createHospital,
  getHospital,
  listMembers,
} from "@/server/services/organization-admin";
import { createOrganization } from "@/server/services/platform";
import { auditCount, contextFor, departmentId, hospitalId, orgId, owner, uniqueCode, userByEmail } from "../helpers";
import { randomUUID } from "node:crypto";

afterAll(async () => {
  await db.$disconnect();
  await owner.$disconnect();
});

describe("access resolution", () => {
  it("a technician gets exactly the hospitals and departments in their scope", async () => {
    const ctx = await contextFor("amina.warsame@coastal.example");
    expect(ctx.role).toBe("TECHNICIAN");
    expect(ctx.hospitals.map((h) => h.code).sort()).toEqual(["NCH", "RGH"]);
    const nch = ctx.hospitals.find((h) => h.code === "NCH")!;
    expect(nch.departments).not.toBe("ALL");
    expect(nch.departments).toHaveLength(2);
    expect(ctx.hospitals.find((h) => h.code === "RGH")!.departments).toBe("ALL");
  });

  it("one person can hold different roles in two organisations", async () => {
    const coastal = await contextFor("james.otieno@coastal.example", "coastal-health");
    const highland = await contextFor("james.otieno@coastal.example", "highland-medical");
    expect(coastal.role).toBe("ENGINEERING_MANAGER");
    expect(highland.role).toBe("AUDITOR");
  });

  it("a preferred organisation the user does not belong to is ignored", async () => {
    const amina = await userByEmail("amina.warsame@coastal.example", { mfa: true });
    const ctx = await resolveAccess(amina, await orgId("highland-medical"));
    expect(ctx?.organization.slug).toBe("coastal-health");
  });

  it("a user without any membership gets no access", async () => {
    const id = randomUUID();
    await owner.user.create({ data: { id, name: "No Membership", email: `nobody-${id}@coastal.example` } });
    const ctx = await resolveAccess({
      id,
      name: "No Membership",
      email: "x",
      twoFactorEnabled: true,
      isPlatformAdmin: false,
    });
    expect(ctx).toBeNull();
    expect(await listUserOrganizations(id)).toEqual([]);
  });

  it("administrators and managers are flagged as requiring MFA; technicians are not", async () => {
    expect((await contextFor("hodan.ali@coastal.example")).mfaRequired).toBe(true);
    expect((await contextFor("james.otieno@coastal.example", "coastal-health")).mfaRequired).toBe(true);
    expect((await contextFor("amina.warsame@coastal.example")).mfaRequired).toBe(false);
  });
});

describe("role permissions are enforced on the server", () => {
  it("an Organization Administrator with MFA can create a hospital, and it is audited", async () => {
    const ctx = await contextFor("hodan.ali@coastal.example");
    const code = uniqueCode("NEW");
    const hospital = await createHospital(ctx, { name: "Harbour View Hospital", code, timezone: "Africa/Nairobi" });
    expect(hospital.code).toBe(code);
    expect(await auditCount({ action: "hospital.created", actorUserId: ctx.user.id })).toBeGreaterThan(0);
  });

  it("an administrator WITHOUT MFA is refused even though the role allows it", async () => {
    const ctx = await contextFor("hodan.ali@coastal.example", undefined, { mfa: false });
    await expect(
      createHospital(ctx, { name: "No MFA", code: uniqueCode("NOMFA"), timezone: "Africa/Nairobi" }),
    ).rejects.toBeInstanceOf(AuthorizationError);
  });

  it("a read-only auditor cannot create or change anything", async () => {
    const ctx = await contextFor("fatuma.hassan@coastal.example");
    const before = await auditCount({ action: "authz.denied", actorUserId: ctx.user.id, outcome: "DENIED" });
    await expect(
      createHospital(ctx, { name: "Auditor attempt", code: "AUD1", timezone: "Africa/Nairobi" }),
    ).rejects.toBeInstanceOf(AuthorizationError);
    const target = (await listMembers(ctx)).find((m) => m.role === "TECHNICIAN")!;
    await expect(changeMemberRole(ctx, { membershipId: target.id, role: "ORG_ADMIN" })).rejects.toBeInstanceOf(
      AuthorizationError,
    );
    expect(await auditCount({ action: "authz.denied", actorUserId: ctx.user.id, outcome: "DENIED" })).toBe(before + 2);
  });

  it("a fault reporter cannot view members or create departments", async () => {
    const ctx = await contextFor("lucy.achieng@coastal.example");
    await expect(listMembers(ctx)).rejects.toBeInstanceOf(AuthorizationError);
    await expect(
      createDepartment(ctx, { hospitalId: await hospitalId("coastal-health", "NCH"), name: "Sneaky", code: "SNK" }),
    ).rejects.toBeInstanceOf(AuthorizationError);
  });

  it("a technician cannot grant themselves administrator privileges", async () => {
    const ctx = await contextFor("amina.warsame@coastal.example");
    await expect(changeMemberRole(ctx, { membershipId: ctx.membershipId, role: "ORG_ADMIN" })).rejects.toBeInstanceOf(
      AuthorizationError,
    );
    const membership = await owner.membership.findUniqueOrThrow({ where: { id: ctx.membershipId } });
    expect(membership.role).toBe("TECHNICIAN");
    expect(await auditCount({ action: "authz.denied", actorUserId: ctx.user.id, outcome: "DENIED" })).toBeGreaterThan(
      0,
    );
  });

  it("an administrator cannot change their own role either", async () => {
    const ctx = await contextFor("hodan.ali@coastal.example");
    await expect(changeMemberRole(ctx, { membershipId: ctx.membershipId, role: "AUDITOR" })).rejects.toBeInstanceOf(
      ValidationError,
    );
  });

  it("an administrator can change another member's role, and it is audited", async () => {
    const admin = await contextFor("hodan.ali@coastal.example");
    const grace = await owner.membership.findFirstOrThrow({
      where: { organizationId: admin.organization.id, role: "INVENTORY_MANAGER" },
    });
    const updated = await changeMemberRole(admin, { membershipId: grace.id, role: "TECHNICIAN" });
    expect(updated.role).toBe("TECHNICIAN");
    expect(await auditCount({ action: "membership.role_changed", actorUserId: admin.user.id })).toBeGreaterThan(0);
    await changeMemberRole(admin, { membershipId: grace.id, role: "INVENTORY_MANAGER" }); // restore
  });

  it("an administrator cannot change a membership that belongs to another organisation", async () => {
    const admin = await contextFor("hodan.ali@coastal.example");
    const highlandMember = await owner.membership.findFirstOrThrow({
      where: { organizationId: await orgId("highland-medical"), role: "TECHNICIAN" },
    });
    await expect(
      changeMemberRole(admin, { membershipId: highlandMember.id, role: "ORG_ADMIN" }),
    ).rejects.toBeInstanceOf(NotFoundError);
    expect((await owner.membership.findUniqueOrThrow({ where: { id: highlandMember.id } })).role).toBe("TECHNICIAN");
  });
});

describe("hospital and department scope", () => {
  it("a manager cannot open a hospital they are not assigned to", async () => {
    const ctx = await contextFor("james.otieno@coastal.example", "coastal-health");
    await expect(getHospital(ctx, await hospitalId("coastal-health", "RGH"))).resolves.toMatchObject({ code: "RGH" });
    await expect(getHospital(ctx, await hospitalId("coastal-health", "NCH"))).rejects.toBeInstanceOf(NotFoundError);
  });

  it("a guessed id from another organisation looks exactly like a missing record", async () => {
    const ctx = await contextFor("james.otieno@coastal.example", "coastal-health");
    await expect(getHospital(ctx, await hospitalId("highland-medical", "SRH"))).rejects.toBeInstanceOf(NotFoundError);
    await expect(getHospital(ctx, randomUUID())).rejects.toBeInstanceOf(NotFoundError);
  });

  it("an administrator cannot archive another organisation's department", async () => {
    const ctx = await contextFor("hodan.ali@coastal.example");
    const target = await departmentId("highland-medical", "SRH", "ICU");
    await expect(archiveDepartment(ctx, { id: target })).rejects.toBeInstanceOf(NotFoundError);
    expect((await owner.department.findUniqueOrThrow({ where: { id: target } })).status).toBe("ACTIVE");
  });
});

describe("input validation", () => {
  it("rejects invalid input with field messages and writes nothing", async () => {
    const ctx = await contextFor("hodan.ali@coastal.example");
    const before = await owner.hospital.count();
    const error = await createHospital(ctx, { name: "X", code: "bad code!", timezone: "Mars/Olympus" }).catch((e) => e);
    expect(error).toBeInstanceOf(ValidationError);
    expect(Object.keys((error as ValidationError).fieldErrors).sort()).toEqual(["code", "name", "timezone"]);
    expect(await owner.hospital.count()).toBe(before);
  });

  it("rejects a non-UUID id instead of passing it to the database", async () => {
    const ctx = await contextFor("hodan.ali@coastal.example");
    await expect(getHospital(ctx, "1 OR 1=1")).rejects.toBeInstanceOf(ValidationError);
  });

  it("rejects a duplicate hospital code with a friendly message", async () => {
    const ctx = await contextFor("hodan.ali@coastal.example");
    await expect(createHospital(ctx, { name: "Copy", code: "RGH", timezone: "Africa/Nairobi" })).rejects.toThrow(
      /already used/,
    );
  });
});

describe("adding members", () => {
  it("creates a login with a one-time temporary password and a scoped membership", async () => {
    const ctx = await contextFor("hodan.ali@coastal.example");
    const email = `new.tech.${Date.now()}@coastal.example`;
    const result = await addMember(ctx, {
      email,
      name: "New Technician",
      role: "TECHNICIAN",
      orgWide: false,
      hospitalId: await hospitalId("coastal-health", "RGH"),
      departmentId: null,
    });
    expect(result.temporaryPassword).toMatch(/^[A-Za-z0-9_-]{24}$/);
    const account = await owner.account.findFirstOrThrow({ where: { user: { email } } });
    expect(account.password).not.toContain(result.temporaryPassword!); // stored only as a hash
    const newCtx = await contextFor(email);
    expect(newCtx.hospitals.map((h) => h.code)).toEqual(["RGH"]);
    expect(await auditCount({ action: "membership.created", actorUserId: ctx.user.id })).toBeGreaterThan(0);
  });

  it("cannot scope a new member to another organisation's hospital", async () => {
    const ctx = await contextFor("hodan.ali@coastal.example");
    await expect(
      addMember(ctx, {
        email: `x.${Date.now()}@coastal.example`,
        name: "Cross Tenant",
        role: "TECHNICIAN",
        orgWide: false,
        hospitalId: await hospitalId("highland-medical", "SRH"),
        departmentId: null,
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("platform administration", () => {
  it("an ordinary user cannot create organisations", async () => {
    const user = await userByEmail("hodan.ali@coastal.example", { mfa: true });
    await expect(
      createOrganization(user, {
        name: "Rogue Org",
        slug: "rogue-org",
        country: "KE",
        adminEmail: "a@rogue.example",
        adminName: "Rogue Admin",
      }),
    ).rejects.toBeInstanceOf(AuthorizationError);
  });

  it("a Platform Super Administrator with MFA can create an organisation and its first administrator", async () => {
    const id = randomUUID();
    await owner.user.create({
      data: {
        id,
        name: "Test Platform Admin",
        email: `platform-${id}@biomedintel.example`,
        platformRole: "SUPER_ADMIN",
        twoFactorEnabled: true,
      },
    });
    const admin = { id, name: "Test Platform Admin", email: "p", twoFactorEnabled: true, isPlatformAdmin: true };
    const slug = `lakeside-${Date.now()}`;
    const result = await createOrganization(admin, {
      name: "Lakeside Health Trust",
      slug,
      country: "TZ",
      adminEmail: `admin.${slug}@lakeside.example`,
      adminName: "Neema Mollel",
    });
    expect(result.organization.slug).toBe(slug);
    expect(result.temporaryPassword).toBeTruthy();
    // The platform administrator is NOT a member, so gets no access to the new organisation's data.
    expect(await resolveAccess(admin, result.organization.id)).toBeNull();
  });
});
