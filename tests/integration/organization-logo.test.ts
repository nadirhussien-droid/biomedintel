// Optional hospital logo (printed on job sheets): who may set it, what files
// are accepted, isolation between organisations, and the database rules.
import { afterAll, describe, expect, it } from "vitest";
import sharp from "sharp";
import { db } from "@/server/db/client";
import { AuthorizationError, NotFoundError, ValidationError } from "@/server/authz/errors";
import { getLogoImage, getLogoInfo, removeLogo, setLogo } from "@/server/services/organization-logo";
import { contextFor, orgId, owner, singleConnectionAppDb, userByEmail } from "../helpers";

afterAll(async () => {
  await db.$disconnect();
  await owner.$disconnect();
});

const png = (w = 300, h = 120, color = "#102d46") =>
  sharp({ create: { width: w, height: h, channels: 3, background: color } })
    .png()
    .toBuffer();
const jpeg = () =>
  sharp({ create: { width: 200, height: 100, channels: 3, background: "#55d6c2" } })
    .jpeg()
    .toBuffer();

describe("hospital logo", () => {
  it("starts with no logo, and job sheets then show the name only", async () => {
    const hodan = await contextFor("hodan.ali@coastal.example", "coastal-health");
    expect(await getLogoInfo(hodan)).toBeNull();
    await expect(getLogoImage(hodan)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("only an Organisation Administrator may set or remove it; the refusal is audited", async () => {
    const amina = await contextFor("amina.warsame@coastal.example", "coastal-health");
    const james = await contextFor("james.otieno@coastal.example", "coastal-health");
    const fatuma = await contextFor("fatuma.hassan@coastal.example", "coastal-health");
    const bytes = new Uint8Array(await png());
    for (const ctx of [amina, james, fatuma]) {
      const where = { action: "authz.denied", actorUserId: ctx.user.id, outcome: "DENIED" as const };
      const before = await owner.auditLog.count({ where });
      await expect(setLogo(ctx, { name: "logo.png", bytes })).rejects.toBeInstanceOf(AuthorizationError);
      await expect(removeLogo(ctx)).rejects.toBeInstanceOf(AuthorizationError);
      expect(await owner.auditLog.count({ where })).toBe(before + 2);
    }
  });

  it("accepts a PNG, re-encodes it, and lets every member of the organisation read it", async () => {
    const hodan = await contextFor("hodan.ali@coastal.example", "coastal-health");
    const { sha256 } = await setLogo(hodan, {
      name: "../../My Hospital Logo!.png",
      bytes: new Uint8Array(await png(2000, 800)),
    });
    const amina = await contextFor("amina.warsame@coastal.example", "coastal-health");
    const info = await getLogoInfo(amina);
    expect(info?.sha256).toBe(sha256);
    // Path parts and punctuation are stripped from the stored file name.
    expect(info?.filename).toBe("My Hospital Logo.png");
    const image = await getLogoImage(amina);
    expect(image.mime).toBe("image/png");
    const meta = await sharp(Buffer.from(image.content)).metadata();
    expect(meta.width).toBeLessThanOrEqual(800);
    expect(meta.height).toBeLessThanOrEqual(400);
    expect(await owner.auditLog.count({ where: { action: "organization.logo_set", actorUserId: hodan.user.id } })).toBe(
      1,
    );
  });

  it("accepts a JPEG as a replacement; the newest upload is the current logo and history is kept", async () => {
    const hodan = await contextFor("hodan.ali@coastal.example", "coastal-health");
    await setLogo(hodan, { name: "second.jpg", bytes: new Uint8Array(await jpeg()) });
    expect((await getLogoImage(hodan)).mime).toBe("image/jpeg");
    expect(await owner.organizationLogo.count({ where: { organizationId: hodan.organization.id } })).toBe(2);
  });

  it("refuses SVG, GIF, text, empty and oversize files", async () => {
    const hodan = await contextFor("hodan.ali@coastal.example", "coastal-health");
    const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
    const gif = new Uint8Array(
      await sharp({ create: { width: 10, height: 10, channels: 3, background: "#fff" } })
        .gif()
        .toBuffer(),
    );
    for (const bytes of [
      svg,
      gif,
      new TextEncoder().encode("not an image"),
      new Uint8Array(0),
      new Uint8Array(2 * 1024 * 1024 + 1),
    ]) {
      await expect(setLogo(hodan, { name: "x.png", bytes })).rejects.toBeInstanceOf(ValidationError);
    }
    // Nothing was stored by the refused uploads.
    expect(await owner.organizationLogo.count({ where: { organizationId: hodan.organization.id } })).toBe(2);
  });

  it("another organisation cannot see it, and has no logo of its own", async () => {
    const david = await contextFor("david.mutua@highland.example", "highland-medical");
    expect(await getLogoInfo(david)).toBeNull();
    await expect(getLogoImage(david)).rejects.toBeInstanceOf(NotFoundError);
    // Even direct database access with the other organisation's context sees no rows.
    const single = singleConnectionAppDb();
    try {
      const u = await userByEmail("david.mutua@highland.example");
      const highland = await orgId("highland-medical");
      const rows = await single.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.user_id', ${u.id}, true), set_config('app.org_id', ${highland}, true)`;
        return tx.organizationLogo.count();
      });
      expect(rows).toBe(0);
    } finally {
      await single.$disconnect();
    }
  });

  it("Highland cannot write a row for Coastal, and the app role cannot update or delete rows", async () => {
    const single = singleConnectionAppDb();
    try {
      const u = await userByEmail("david.mutua@highland.example");
      const highland = await orgId("highland-medical");
      const coastal = await orgId("coastal-health");
      await expect(
        single.$transaction(async (tx) => {
          await tx.$executeRaw`SELECT set_config('app.user_id', ${u.id}, true), set_config('app.org_id', ${highland}, true)`;
          await tx.organizationLogo.create({ data: { organizationId: coastal, kind: "REMOVED", changedById: u.id } });
        }),
      ).rejects.toThrow();
    } finally {
      await single.$disconnect();
    }
    const [r] = await owner.$queryRaw<{ upd: boolean; del: boolean; rls: boolean; forced: boolean }[]>`
      SELECT has_table_privilege('biomedintel_app', 'organization_logos', 'UPDATE') AS upd,
             has_table_privilege('biomedintel_app', 'organization_logos', 'DELETE') AS del,
             (SELECT relrowsecurity FROM pg_class WHERE relname = 'organization_logos') AS rls,
             (SELECT relforcerowsecurity FROM pg_class WHERE relname = 'organization_logos') AS forced`;
    expect(r).toEqual({ upd: false, del: false, rls: true, forced: true });
  });

  it("the database itself refuses an invalid row and any change to history", async () => {
    const coastal = await orgId("coastal-health");
    const hodan = await userByEmail("hodan.ali@coastal.example");
    await expect(
      owner.organizationLogo.create({
        data: { organizationId: coastal, kind: "SET", changedById: hodan.id },
      }),
    ).rejects.toThrow();
    await expect(
      owner.organizationLogo.create({
        data: {
          organizationId: coastal,
          kind: "SET",
          filename: "a.svg",
          mime: "image/svg+xml",
          sizeBytes: 3,
          sha256: "a".repeat(64),
          width: 1,
          height: 1,
          content: Buffer.from("abc"),
          changedById: hodan.id,
        },
      }),
    ).rejects.toThrow();
    await expect(owner.organizationLogo.deleteMany({ where: { organizationId: coastal } })).rejects.toThrow();
    await expect(
      owner.organizationLogo.updateMany({ where: { organizationId: coastal }, data: { kind: "REMOVED" } }),
    ).rejects.toThrow();
  });

  it("removing the logo works once, is audited, and nothing is deleted", async () => {
    const hodan = await contextFor("hodan.ali@coastal.example", "coastal-health");
    await removeLogo(hodan);
    expect(await getLogoInfo(hodan)).toBeNull();
    await expect(getLogoImage(hodan)).rejects.toBeInstanceOf(NotFoundError);
    await expect(removeLogo(hodan)).rejects.toBeInstanceOf(ValidationError);
    expect(await owner.organizationLogo.count({ where: { organizationId: hodan.organization.id } })).toBe(3);
    expect(await owner.auditLog.count({ where: { action: "organization.logo_removed" } })).toBe(1);
  });
});
