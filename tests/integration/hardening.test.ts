// Stage 10 security fixes, through Better Auth's real HTTP handler:
//   • per-account limits on failed sign-ins and MFA codes that cannot be
//     dodged by sending a different (forged) IP address each time;
//   • an organisation cannot reset the MFA of someone who also belongs to
//     another organisation;
//   • password reset answers identically when email cannot be delivered.
import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { authenticator } from "otplib";
import { auth } from "@/server/auth/auth";
import { db } from "@/server/db/client";
import { SIGN_IN_LIMIT } from "@/server/auth/throttle";

const MFA_LOCK_AFTER = 10; // Better Auth two-factor default (account lockout)
import { resetMemberMfa } from "@/server/services/organization-admin";
import { ValidationError } from "@/server/authz/errors";
import { TEST_PASSWORD } from "../constants";
import { auditCount, contextFor, owner } from "../helpers";

afterAll(async () => {
  await db.$disconnect();
  await owner.$disconnect();
});

const BASE = process.env.BETTER_AUTH_URL ?? "http://localhost:3000";
let ip = 0;

async function call(path: string, body?: unknown, cookie?: string) {
  ip += 1; // a different claimed IP address on EVERY request
  const headers: Record<string, string> = {
    "content-type": "application/json",
    origin: BASE,
    "x-forwarded-for": `203.0.113.${ip % 250}`,
  };
  if (cookie) headers.cookie = cookie;
  return auth.handler(
    new Request(`${BASE}/api/auth${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  );
}
function cookiesFrom(res: Response, previous = ""): string {
  const jar = new Map(
    previous
      .split("; ")
      .filter(Boolean)
      .map((p) => [p.slice(0, p.indexOf("=")), p.slice(p.indexOf("=") + 1)] as [string, string]),
  );
  for (const line of res.headers.getSetCookie()) {
    const pair = line.split(";")[0];
    const [name, value] = [pair.slice(0, pair.indexOf("=")), pair.slice(pair.indexOf("=") + 1)];
    if (value === "" || /max-age=0/i.test(line)) jar.delete(name);
    else jar.set(name, value);
  }
  return [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
}

beforeEach(async () => {
  await owner.$executeRaw`DELETE FROM auth_throttles`;
});

describe("per-account sign-in limit", () => {
  it(`blocks the account after ${SIGN_IN_LIMIT} failed passwords, even with a new IP each time and the right password`, async () => {
    const email = "lucy.achieng@coastal.example";
    for (let i = 0; i < SIGN_IN_LIMIT; i++) {
      const r = await call("/sign-in/email", { email, password: `wrong-password-${i}` });
      expect(r.status).toBe(401);
    }
    const blocked = await call("/sign-in/email", { email, password: TEST_PASSWORD });
    expect(blocked.status).toBe(429);
    expect(JSON.stringify(await blocked.json())).toContain("Too many attempts");
    expect(blocked.headers.getSetCookie().some((c) => c.startsWith("biomedintel.session_token="))).toBe(false);
    expect(await auditCount({ action: "auth.sign_in_throttled", outcome: "DENIED" })).toBeGreaterThan(0);
    // The table stores a hash, never the email address.
    const rows = await owner.$queryRaw<{ key: string }[]>`SELECT key FROM auth_throttles`;
    expect(JSON.stringify(rows)).not.toContain("lucy");
  });

  it("answers an unknown email the same way (no account enumeration)", async () => {
    const email = "nobody-here@nowhere.example";
    for (let i = 0; i < SIGN_IN_LIMIT; i++)
      expect((await call("/sign-in/email", { email, password: "x".repeat(12) })).status).toBe(401);
    expect((await call("/sign-in/email", { email, password: "x".repeat(12) })).status).toBe(429);
  });

  it("a successful sign-in clears the count", async () => {
    const email = "peter.kamau@coastal.example";
    for (let i = 0; i < SIGN_IN_LIMIT - 1; i++)
      await call("/sign-in/email", { email, password: `wrong-${i}-xxxxxxxx` });
    expect((await call("/sign-in/email", { email, password: TEST_PASSWORD })).status).toBe(200);
    const rows = await owner.$queryRaw<{ n: bigint }[]>`SELECT count(*) AS n FROM auth_throttles`;
    expect(Number(rows[0].n)).toBe(0);
  });
});

describe("per-account MFA lock (Better Auth)", () => {
  it(`locks MFA verification after ${MFA_LOCK_AFTER} wrong codes across sign-ins, even with the right code`, async () => {
    const email = "mary.njeri@coastal.example";
    let cookie = cookiesFrom(await call("/sign-in/email", { email, password: TEST_PASSWORD }));
    const enable = await call("/two-factor/enable", { password: TEST_PASSWORD }, cookie);
    const secret = new URL(((await enable.json()) as { totpURI: string }).totpURI).searchParams.get("secret")!;
    const verify = await call("/two-factor/verify-totp", { code: authenticator.generate(secret) }, cookie);
    expect(verify.status).toBe(200);
    cookie = "";

    // Each wrong guess comes from a NEW password sign-in (a fresh MFA challenge)
    // and a new IP address, which is how an attacker would try to get round limits.
    for (let i = 0; i < MFA_LOCK_AFTER; i++) {
      const pending = cookiesFrom(await call("/sign-in/email", { email, password: TEST_PASSWORD }));
      const wrong = await call("/two-factor/verify-totp", { code: "000000" }, pending);
      expect(wrong.status).toBeGreaterThanOrEqual(400);
      expect(wrong.status).not.toBe(429);
    }
    const pending = cookiesFrom(await call("/sign-in/email", { email, password: TEST_PASSWORD }));
    const blocked = await call("/two-factor/verify-totp", { code: authenticator.generate(secret) }, pending);
    expect(blocked.status).toBe(429);
    expect(await auth.api.getSession({ headers: new Headers({ cookie: cookiesFrom(blocked, pending) }) })).toBeNull();
    const user = await owner.user.findUniqueOrThrow({ where: { email } });
    expect((await owner.twoFactor.findFirstOrThrow({ where: { userId: user.id } })).lockedUntil).not.toBeNull();
    expect(await auditCount({ action: "auth.mfa_verify_failed", outcome: "FAILURE" })).toBeGreaterThanOrEqual(
      MFA_LOCK_AFTER + 1,
    );

    // When the lock has expired (simulated), the right code works again.
    await owner.twoFactor.updateMany({
      where: { userId: user.id },
      data: { lockedUntil: new Date(Date.now() - 1000) },
    });
    const again = cookiesFrom(await call("/sign-in/email", { email, password: TEST_PASSWORD }));
    const ok = await call("/two-factor/verify-totp", { code: authenticator.generate(secret) }, again);
    expect(ok.status).toBe(200);
  });
});

describe("cross-organisation MFA reset is refused", () => {
  it("neither organisation can remove the authenticator of a person who belongs to both", async () => {
    // James is an Engineering Manager at Coastal and an Auditor at Highland (fictional seed).
    const james = await owner.user.findUniqueOrThrow({ where: { email: "james.otieno@coastal.example" } });
    await owner.user.update({ where: { id: james.id }, data: { twoFactorEnabled: true } });
    await owner.twoFactor.create({
      data: { id: randomUUID(), userId: james.id, secret: "encrypted-test-value", backupCodes: "encrypted-test-value" },
    });
    const sessionsBefore = await owner.session.count({ where: { userId: james.id } });

    const highland = await owner.organization.findUniqueOrThrow({ where: { slug: "highland-medical" } });
    const coastal = await owner.organization.findUniqueOrThrow({ where: { slug: "coastal-health" } });
    const inHighland = await owner.membership.findFirstOrThrow({
      where: { userId: james.id, organizationId: highland.id },
    });
    const inCoastal = await owner.membership.findFirstOrThrow({
      where: { userId: james.id, organizationId: coastal.id },
    });
    const reason = "Identity confirmed in person (test)";

    const david = await contextFor("david.mutua@highland.example", "highland-medical");
    await expect(resetMemberMfa(david, { membershipId: inHighland.id, reason })).rejects.toBeInstanceOf(
      ValidationError,
    );
    const hodan = await contextFor("hodan.ali@coastal.example", "coastal-health");
    await expect(resetMemberMfa(hodan, { membershipId: inCoastal.id, reason })).rejects.toBeInstanceOf(ValidationError);

    expect(await owner.twoFactor.count({ where: { userId: james.id } })).toBe(1);
    expect((await owner.user.findUniqueOrThrow({ where: { id: james.id } })).twoFactorEnabled).toBe(true);
    expect(await owner.session.count({ where: { userId: james.id } })).toBe(sessionsBefore);
    expect(await auditCount({ action: "auth.mfa_reset_refused", outcome: "DENIED" })).toBe(2);

    // A Highland administrator cannot use another organisation's membership id either.
    await expect(resetMemberMfa(david, { membershipId: inCoastal.id, reason })).rejects.toThrow();
    expect(await owner.twoFactor.count({ where: { userId: james.id } })).toBe(1);
  });
});

describe("password reset without an email provider", () => {
  it("answers identically for known and unknown emails when email cannot be delivered (production)", async () => {
    vi.stubEnv("NODE_ENV", "production");
    try {
      const known = await call("/request-password-reset", {
        email: "amina.warsame@coastal.example",
        redirectTo: "/reset-password",
      });
      const unknown = await call("/request-password-reset", {
        email: "nobody@nowhere.example",
        redirectTo: "/reset-password",
      });
      expect(known.status).toBe(200);
      expect(unknown.status).toBe(200);
      expect(await known.json()).toEqual(await unknown.json());
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

// Hosted databases: the migration owner usually cannot have BYPASSRLS. These
// catalogue checks keep the fixes from migrations 20261016000200/0300 in place
// for every future table and function (found in the hosted simulation: without
// them the daily job sees no organisations and the MFA guard answers "no").
describe("works on a managed host where the owner cannot bypass row-level security", () => {
  it("every table with row-level security has a read policy for its owner (and only for its owner)", async () => {
    const rows = await owner.$queryRaw<{ table: string; ok: boolean }[]>`
      SELECT t.relname AS "table",
             EXISTS (SELECT 1 FROM pg_policies p
                     WHERE p.schemaname = 'public' AND p.tablename = t.relname
                       AND p.policyname = t.relname || '_owner_read' AND p.cmd = 'SELECT'
                       AND p.roles = ARRAY[pg_get_userbyid(t.relowner)]::name[]) AS ok
      FROM pg_class t JOIN pg_namespace n ON n.oid = t.relnamespace
      WHERE n.nspname = 'public' AND t.relkind = 'r' AND t.relrowsecurity`;
    expect(rows.length).toBeGreaterThan(50);
    expect(rows.filter((r) => !r.ok).map((r) => r.table)).toEqual([]);
  });

  it("the app role is never given an owner read policy and still cannot bypass row-level security", async () => {
    const [r] = await owner.$queryRaw<{ policies: bigint; bypass: boolean }[]>`
      SELECT (SELECT count(*) FROM pg_policies WHERE 'biomedintel_app' = ANY (roles) AND policyname LIKE '%_owner_read') AS policies,
             (SELECT rolbypassrls FROM pg_roles WHERE rolname = 'biomedintel_app') AS bypass`;
    expect(Number(r.policies)).toBe(0);
    expect(r.bypass).toBe(false);
  });

  it("every function has a fixed search_path and every SECURITY DEFINER function belongs to the table owner", async () => {
    const rows = await owner.$queryRaw<{ name: string; fixed: boolean; definer: boolean; owned: boolean }[]>`
      SELECT p.proname AS name,
             EXISTS (SELECT 1 FROM unnest(coalesce(p.proconfig, '{}')) c WHERE c LIKE 'search_path=%') AS fixed,
             p.prosecdef AS definer,
             p.proowner = (SELECT relowner FROM pg_class WHERE relname = 'organizations' AND relkind = 'r') AS owned
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.prokind = 'f'`;
    expect(rows.filter((r) => !r.fixed).map((r) => r.name)).toEqual([]);
    expect(rows.filter((r) => r.definer && !r.owned).map((r) => r.name)).toEqual([]);
  });
});
