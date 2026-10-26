// Removing a staff member's role (26 Oct 2026): the membership is marked REVOKED, never deleted,
// the person loses access, past records stay, and adding them again restores them.
import { afterAll, describe, expect, it } from "vitest";
import { AuthorizationError } from "@/server/authz/errors";
import { ValidationError } from "@/server/authz/errors";
import { db } from "@/server/db/client";
import { addMember, listMembers, removeMember } from "@/server/services/organization-admin";
import { auditCount, contextFor, hospitalId, owner } from "../helpers";

afterAll(async () => {
  await db.$disconnect();
  await owner.$disconnect();
});

const hodan = () => contextFor("hodan.ali@coastal.example", "coastal-health");

async function newMember(email: string) {
  const ctx = await hodan();
  await addMember(ctx, {
    email,
    name: "Removal Test",
    role: "TECHNICIAN",
    orgWide: false,
    hospitalId: await hospitalId("coastal-health", "RGH"),
    departmentId: null,
  });
  return owner.membership.findFirstOrThrow({ where: { user: { email } } });
}

describe("removing a staff member's role", () => {
  it("revokes the membership, keeps the record, audits it and ends their access", async () => {
    const ctx = await hodan();
    const email = `remove.${Date.now()}@coastal.example`;
    const m = await newMember(email);
    await removeMember(ctx, { membershipId: m.id });
    const after = await owner.membership.findUniqueOrThrow({ where: { id: m.id } });
    expect(after.status).toBe("REVOKED");
    expect(await auditCount({ action: "membership.revoked", actorUserId: ctx.user.id })).toBeGreaterThan(0);
    await expect(contextFor(email)).rejects.toThrow(/no access/);
    expect((await listMembers(ctx)).find((x) => x.id === m.id)?.status).toBe("REVOKED");
  });

  it("adding the same person again restores their access with the new role", async () => {
    const ctx = await hodan();
    const email = `restore.${Date.now()}@coastal.example`;
    const m = await newMember(email);
    await removeMember(ctx, { membershipId: m.id });
    await addMember(ctx, {
      email,
      name: "Removal Test",
      role: "AUDITOR",
      orgWide: true,
      hospitalId: null,
      departmentId: null,
    });
    const after = await owner.membership.findUniqueOrThrow({ where: { id: m.id } });
    expect(after.status).toBe("ACTIVE");
    expect(after.role).toBe("AUDITOR");
    expect(await owner.membershipScope.count({ where: { membershipId: m.id } })).toBe(0);
    expect(await auditCount({ action: "membership.restored", actorUserId: ctx.user.id })).toBeGreaterThan(0);
  });

  it("nobody can remove their own role", async () => {
    const ctx = await hodan();
    await expect(removeMember(ctx, { membershipId: ctx.membershipId })).rejects.toBeInstanceOf(ValidationError);
    expect((await owner.membership.findUniqueOrThrow({ where: { id: ctx.membershipId } })).status).toBe("ACTIVE");
  });

  it("only administrators can remove a role", async () => {
    const tech = await contextFor("amina.warsame@coastal.example", "coastal-health");
    const target = await owner.membership.findFirstOrThrow({
      where: { organizationId: tech.organization.id, role: "INVENTORY_MANAGER", status: "ACTIVE" },
    });
    await expect(removeMember(tech, { membershipId: target.id })).rejects.toBeInstanceOf(AuthorizationError);
    expect((await owner.membership.findUniqueOrThrow({ where: { id: target.id } })).status).toBe("ACTIVE");
  });
});
