// Administrator password reset (27 Oct 2026): a new temporary password, shown once, stored only as a
// hash, the old one stops working, sessions end, it is audited without the password, and only
// administrators can do it (never for themselves).
import { verifyPassword } from "better-auth/crypto";
import { afterAll, describe, expect, it } from "vitest";
import { AuthorizationError, ValidationError } from "@/server/authz/errors";
import { db } from "@/server/db/client";
import { addMember, resetMemberPassword } from "@/server/services/organization-admin";
import { contextFor, hospitalId, owner } from "../helpers";

afterAll(async () => {
  await db.$disconnect();
  await owner.$disconnect();
});

const hodan = () => contextFor("hodan.ali@coastal.example", "coastal-health");
const REASON = "Checked staff ID in person";

async function newMember() {
  const ctx = await hodan();
  const email = `pw.${Date.now()}.${Math.floor(Math.random() * 1e4)}@coastal.example`;
  const added = await addMember(ctx, {
    email,
    name: "Password Test",
    role: "TECHNICIAN",
    orgWide: false,
    hospitalId: await hospitalId("coastal-health", "RGH"),
    departmentId: null,
  });
  const user = await owner.user.findUniqueOrThrow({ where: { email } });
  return { ctx, email, user, membershipId: added.membershipId, first: added.temporaryPassword! };
}

describe("administrator password reset", () => {
  it("gives a new temporary password, stores only a hash, ends sessions and audits without the password", async () => {
    const m = await newMember();
    await owner.session.create({
      data: {
        id: `s-${Date.now()}`,
        token: `t-${Date.now()}`,
        userId: m.user.id,
        expiresAt: new Date(Date.now() + 3600_000),
      },
    });
    const result = await resetMemberPassword(m.ctx, { membershipId: m.membershipId, reason: REASON });
    expect(result.temporaryPassword).toMatch(/^[A-Za-z0-9_-]{24}$/);
    expect(result.temporaryPassword).not.toBe(m.first);

    const account = await owner.account.findFirstOrThrow({ where: { userId: m.user.id, providerId: "credential" } });
    expect(account.password).not.toContain(result.temporaryPassword);
    expect(await verifyPassword({ hash: account.password!, password: result.temporaryPassword })).toBe(true);
    expect(await verifyPassword({ hash: account.password!, password: m.first })).toBe(false);
    expect(await owner.session.count({ where: { userId: m.user.id } })).toBe(0);

    const event = await owner.auditLog.findFirstOrThrow({
      where: { action: "auth.password_reset_by_admin", entityId: m.user.id },
    });
    expect(JSON.stringify(event.metadata)).not.toContain(result.temporaryPassword);
    expect(event.actorUserId).toBe(m.ctx.user.id);
  });

  it("refuses your own account, a missing reason and anyone who is not an administrator", async () => {
    const ctx = await hodan();
    await expect(resetMemberPassword(ctx, { membershipId: ctx.membershipId, reason: REASON })).rejects.toBeInstanceOf(
      ValidationError,
    );
    const m = await newMember();
    await expect(resetMemberPassword(ctx, { membershipId: m.membershipId, reason: "short" })).rejects.toBeInstanceOf(
      ValidationError,
    );
    const tech = await contextFor("amina.warsame@coastal.example", "coastal-health");
    await expect(resetMemberPassword(tech, { membershipId: m.membershipId, reason: REASON })).rejects.toBeInstanceOf(
      AuthorizationError,
    );
  });
});
