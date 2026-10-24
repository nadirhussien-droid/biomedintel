// Per-hospital IntellAssist model: only platform staff can choose it, the
// database itself refuses anyone else, every change is audited, and the model
// a hospital sees is the one that will be used.
import { randomUUID } from "node:crypto";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { db } from "@/server/db/client";
import { withTenant } from "@/server/db/tenant";
import { AuthorizationError, ValidationError } from "@/server/authz/errors";
import { aiConfig } from "@/server/ai/provider";
import { listOrganizations, setOrganizationAiModel } from "@/server/services/platform";
import { getAiOverview, getEffectiveAiConfig } from "@/server/services/troubleshooting";
import { contextFor, orgId, owner, userByEmail } from "../helpers";

afterAll(async () => {
  await db.$disconnect();
  await owner.$disconnect();
});

const ENV = { ...process.env };
afterEach(() => {
  for (const k of ["AI_PROVIDER", "AI_MODEL", "ANTHROPIC_API_KEY"]) {
    if (ENV[k] === undefined) delete process.env[k];
    else process.env[k] = ENV[k];
  }
});

async function platformAdmin() {
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
  return { id, name: "Test Platform Admin", email: "p", twoFactorEnabled: true, isPlatformAdmin: true };
}

const C = "coastal-health";
const hodan = () => contextFor("hodan.ali@coastal.example", C); // Organisation Administrator
const SONNET = "claude-sonnet-5-5";
const OPUS = "claude-opus-5-5";

describe("hospital model choice", () => {
  it("a hospital model replaces the app default for that hospital only", () => {
    process.env.AI_PROVIDER = "anthropic";
    process.env.ANTHROPIC_API_KEY = "sk-test-not-real";
    process.env.AI_MODEL = SONNET;
    expect(aiConfig().model).toBe(SONNET);
    expect(aiConfig(OPUS).model).toBe(OPUS);
    expect(aiConfig(null).model).toBe(SONNET);
    // A hospital model alone is enough when the app has no default.
    delete process.env.AI_MODEL;
    expect(aiConfig(OPUS)).toMatchObject({ configured: true, model: OPUS });
    expect(aiConfig().configured).toBe(false);
  });

  it("platform staff set it, the change is audited, and the hospital sees it", async () => {
    const admin = await platformAdmin();
    const id = await orgId(C);
    try {
      const r = await setOrganizationAiModel(admin, { organizationId: id, model: OPUS });
      expect(r).toEqual({ changed: true, model: OPUS });
      expect((await listOrganizations(admin)).find((o) => o.id === id)?.aiModel).toBe(OPUS);
      const log = await owner.auditLog.findFirstOrThrow({
        where: { organizationId: id, action: "organization.ai_model_changed" },
        orderBy: { createdAt: "desc" },
      });
      expect(log.metadata).toMatchObject({ from: null, to: OPUS });
      expect(log.actorUserId).toBe(admin.id);

      // Saving the same value again changes nothing and writes no second audit row.
      const before = await owner.auditLog.count({
        where: { organizationId: id, action: "organization.ai_model_changed" },
      });
      expect(await setOrganizationAiModel(admin, { organizationId: id, model: OPUS })).toEqual({
        changed: false,
        model: OPUS,
      });
      expect(
        await owner.auditLog.count({ where: { organizationId: id, action: "organization.ai_model_changed" } }),
      ).toBe(before);

      process.env.AI_PROVIDER = "anthropic";
      process.env.ANTHROPIC_API_KEY = "sk-test-not-real";
      process.env.AI_MODEL = SONNET;
      expect((await getEffectiveAiConfig(await hodan())).model).toBe(OPUS);
      const overview = await getAiOverview(await hodan());
      expect(overview.hospitalModel).toBe(OPUS);
      expect(overview.config.model).toBe(OPUS);
      // Another hospital is not affected.
      expect(
        (await getEffectiveAiConfig(await contextFor("sara.nakato@highland.example", "highland-medical"))).model,
      ).toBe(SONNET);

      // Back to the app default.
      await setOrganizationAiModel(admin, { organizationId: id, model: "default" });
      expect((await getEffectiveAiConfig(await hodan())).model).toBe(SONNET);
    } finally {
      await setOrganizationAiModel(admin, { organizationId: id, model: "default" }).catch(() => undefined);
    }
  });

  it("only known choices are accepted", async () => {
    const admin = await platformAdmin();
    const id = await orgId(C);
    for (const model of ["gpt-4", "claude-sonnet-5-5; drop table", "x".repeat(81)]) {
      await expect(setOrganizationAiModel(admin, { organizationId: id, model })).rejects.toBeInstanceOf(
        ValidationError,
      );
    }
    await expect(setOrganizationAiModel(admin, { organizationId: "not-an-id", model: SONNET })).rejects.toBeInstanceOf(
      ValidationError,
    );
  });

  it("a hospital administrator cannot choose it, in the app or in the database", async () => {
    const id = await orgId(C);
    const org = await userByEmail("hodan.ali@coastal.example", { mfa: true });
    await expect(setOrganizationAiModel(org, { organizationId: id, model: OPUS })).rejects.toBeInstanceOf(
      AuthorizationError,
    );
    // Even a direct database write inside the hospital's own context is refused.
    await expect(
      withTenant({ userId: org.id, organizationId: id }, (tx) =>
        tx.organization.update({ where: { id }, data: { aiModel: OPUS } }),
      ),
    ).rejects.toThrow(/platform administrators/i);
    expect((await owner.organization.findUniqueOrThrow({ where: { id } })).aiModel).toBeNull();
  });
});
