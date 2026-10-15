// Authentication through Better Auth's real HTTP handler (the same code that
// serves /api/auth in the running app).
import { afterAll, describe, expect, it } from "vitest";
import { authenticator } from "otplib";
import { auth } from "@/server/auth/auth";
import { db } from "@/server/db/client";
import { TEST_PASSWORD } from "../constants";
import { auditCount, contextFor, owner } from "../helpers";
import { resetMemberMfa } from "@/server/services/organization-admin";
import { AuthorizationError, ValidationError } from "@/server/authz/errors";

afterAll(async () => {
  await db.$disconnect();
  await owner.$disconnect();
});

const BASE = process.env.BETTER_AUTH_URL ?? "http://localhost:3000";

async function call(path: string, body?: unknown, cookie?: string) {
  const headers: Record<string, string> = { "content-type": "application/json", origin: BASE };
  if (cookie) headers.cookie = cookie;
  return auth.handler(
    new Request(`${BASE}/api/auth${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  );
}

/** Turns Set-Cookie headers into a Cookie header for the next request. */
function splitPair(pair: string): [string, string] {
  const i = pair.indexOf("=");
  return [pair.slice(0, i), pair.slice(i + 1)];
}

function cookiesFrom(res: Response, previous = ""): string {
  const jar = new Map(previous.split("; ").filter(Boolean).map(splitPair));
  for (const line of res.headers.getSetCookie()) {
    const [name, value] = splitPair(line.split(";")[0]);
    if (value === "" || /max-age=0/i.test(line)) jar.delete(name);
    else jar.set(name, value);
  }
  return [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
}

describe("sign-in and sessions", () => {
  it("signs in with the right password and sets a secure, HTTP-only session cookie", async () => {
    const res = await call("/sign-in/email", { email: "amina.warsame@coastal.example", password: TEST_PASSWORD });
    expect(res.status).toBe(200);
    const setCookie = res.headers.getSetCookie().find((c) => c.startsWith("biomedintel.session_token="));
    expect(setCookie).toBeDefined();
    expect(setCookie).toMatch(/HttpOnly/i);
    expect(setCookie).toMatch(/SameSite=Lax/i);

    const session = await auth.api.getSession({ headers: new Headers({ cookie: cookiesFrom(res) }) });
    expect(session?.user.email).toBe("amina.warsame@coastal.example");
    const hours = (session!.session.expiresAt.getTime() - Date.now()) / 3_600_000;
    expect(hours).toBeGreaterThan(11.9);
    expect(hours).toBeLessThanOrEqual(12);
    expect(await auditCount({ action: "auth.sign_in", actorUserId: session!.user.id })).toBeGreaterThan(0);
  });

  it("rejects a wrong password with a generic error and audits the failure", async () => {
    const before = await auditCount({ action: "auth.sign_in_failed", outcome: "FAILURE" });
    const res = await call("/sign-in/email", {
      email: "amina.warsame@coastal.example",
      password: "wrong-password-123",
    });
    expect(res.status).toBe(401);
    expect(res.headers.getSetCookie().some((c) => c.startsWith("biomedintel.session_token="))).toBe(false);
    expect(await auditCount({ action: "auth.sign_in_failed", outcome: "FAILURE" })).toBe(before + 1);
    const logged = await owner.auditLog.findFirstOrThrow({
      where: { action: "auth.sign_in_failed" },
      orderBy: { createdAt: "desc" },
    });
    expect(JSON.stringify(logged.metadata)).not.toContain("wrong-password");
  });

  it("does not accept a forged or tampered session cookie", async () => {
    const forged = await auth.api.getSession({
      headers: new Headers({ cookie: "biomedintel.session_token=forged.value" }),
    });
    expect(forged).toBeNull();
  });

  it("signing out ends the session on the server", async () => {
    const signIn = await call("/sign-in/email", { email: "peter.kamau@coastal.example", password: TEST_PASSWORD });
    const cookie = cookiesFrom(signIn);
    expect(await auth.api.getSession({ headers: new Headers({ cookie }) })).not.toBeNull();
    const out = await call("/sign-out", {}, cookie);
    expect(out.status).toBe(200);
    expect(await auth.api.getSession({ headers: new Headers({ cookie }) })).toBeNull();
  });

  it("has no public sign-up", async () => {
    const res = await call("/sign-up/email", {
      email: "intruder@evil.example",
      password: "Intruder-password-1",
      name: "Intruder",
    });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(await owner.user.count({ where: { email: "intruder@evil.example" } })).toBe(0);
  });

  it("a signed-in user cannot make themselves a Platform Super Administrator", async () => {
    const signIn = await call("/sign-in/email", { email: "lucy.achieng@coastal.example", password: TEST_PASSWORD });
    const cookie = cookiesFrom(signIn);
    const res = await call("/update-user", { name: "Lucy Achieng", platformRole: "SUPER_ADMIN" }, cookie);
    expect(res.status).toBeGreaterThanOrEqual(400);
    const user = await owner.user.findUniqueOrThrow({ where: { email: "lucy.achieng@coastal.example" } });
    expect(user.platformRole).toBeNull();
  });
});

describe("multi-factor authentication (authenticator app)", () => {
  it("enrols a user, then requires the 6-digit code before a session exists", async () => {
    const email = "grace.mwangi@coastal.example";
    const first = await call("/sign-in/email", { email, password: TEST_PASSWORD });
    let cookie = cookiesFrom(first);

    const enable = await call("/two-factor/enable", { password: TEST_PASSWORD }, cookie);
    expect(enable.status).toBe(200);
    const { totpURI, backupCodes } = (await enable.json()) as { totpURI: string; backupCodes: string[] };
    expect(backupCodes.length).toBeGreaterThan(0);
    const secret = new URL(totpURI).searchParams.get("secret")!;

    const wrong = await call("/two-factor/verify-totp", { code: "000000" }, cookie);
    expect(wrong.status).toBeGreaterThanOrEqual(400);

    const verify = await call("/two-factor/verify-totp", { code: authenticator.generate(secret) }, cookie);
    expect(verify.status).toBe(200);
    cookie = cookiesFrom(verify, cookie);
    expect((await owner.user.findUniqueOrThrow({ where: { email } })).twoFactorEnabled).toBe(true);

    // Next sign-in: password alone does NOT create a session.
    const second = await call("/sign-in/email", { email, password: TEST_PASSWORD });
    expect(second.status).toBe(200);
    expect(((await second.json()) as { twoFactorRedirect?: boolean }).twoFactorRedirect).toBe(true);
    const pendingCookie = cookiesFrom(second);
    // Better Auth clears the session cookie here; whatever the browser holds is not a valid session.
    expect(await auth.api.getSession({ headers: new Headers({ cookie: pendingCookie }) })).toBeNull();

    const done = await call("/two-factor/verify-totp", { code: authenticator.generate(secret) }, pendingCookie);
    expect(done.status).toBe(200);
    const session = await auth.api.getSession({ headers: new Headers({ cookie: cookiesFrom(done, pendingCookie) }) });
    expect(session?.user.email).toBe(email);
  });
});

describe("MFA storage, recovery and audit (Stage 6, decision of 15 Oct 2026)", () => {
  const email = "fatuma.hassan@coastal.example"; // Auditor: MFA encouraged, enrolled here

  it("stores the authenticator secret and backup codes encrypted, and audits every step without codes", async () => {
    const before = {
      enrolled: await auditCount({ action: "auth.mfa_enrolled" }),
      failed: await auditCount({ action: "auth.mfa_verify_failed", outcome: "FAILURE" }),
    };
    let cookie = cookiesFrom(await call("/sign-in/email", { email, password: TEST_PASSWORD }));
    const enable = await call("/two-factor/enable", { password: TEST_PASSWORD }, cookie);
    const { totpURI, backupCodes } = (await enable.json()) as { totpURI: string; backupCodes: string[] };
    const secret = new URL(totpURI).searchParams.get("secret")!;

    // At rest: neither the secret nor any backup code appears in plain text.
    const user = await owner.user.findUniqueOrThrow({ where: { email } });
    const row = await owner.twoFactor.findFirstOrThrow({ where: { userId: user.id } });
    expect(row.secret).not.toContain(secret);
    expect(row.secret).not.toBe(secret);
    for (const code of backupCodes) expect(row.backupCodes).not.toContain(code);

    await call("/two-factor/verify-totp", { code: "123456" }, cookie);
    const verify = await call("/two-factor/verify-totp", { code: authenticator.generate(secret) }, cookie);
    expect(verify.status).toBe(200);
    cookie = cookiesFrom(verify, cookie);
    expect(await auditCount({ action: "auth.mfa_enrolled" })).toBe(before.enrolled + 1);
    expect(await auditCount({ action: "auth.mfa_verify_failed", outcome: "FAILURE" })).toBe(before.failed + 1);

    // A "trust this device" request is refused: a code is needed at every sign-in.
    const second = await call("/sign-in/email", { email, password: TEST_PASSWORD });
    const pending = cookiesFrom(second);
    const trusted = await call(
      "/two-factor/verify-totp",
      { code: authenticator.generate(secret), trustDevice: true },
      pending,
    );
    expect(trusted.status).toBe(400);

    // Recovery with a backup code is audited as recovery.
    const used = await call("/two-factor/verify-backup-code", { code: backupCodes[0] }, pending);
    expect(used.status).toBe(200);
    expect(await auditCount({ action: "auth.mfa_backup_code_used", actorUserId: user.id })).toBe(1);
    const fresh = cookiesFrom(used, pending);
    const regen = await call("/two-factor/generate-backup-codes", { password: TEST_PASSWORD }, fresh);
    expect(regen.status).toBe(200);
    expect(await auditCount({ action: "auth.mfa_backup_codes_regenerated", actorUserId: user.id })).toBe(1);

    // No audit record ever contains a one-time code, backup code or the secret.
    const logs = await owner.auditLog.findMany({ where: { action: { startsWith: "auth.mfa" } } });
    const text = JSON.stringify(logs);
    expect(text).not.toContain(secret);
    for (const code of backupCodes) expect(text).not.toContain(code);
    expect(text).not.toContain("123456");
  });

  it("an organisation administrator can reset a member's authenticator (recovery); nobody else can", async () => {
    const user = await owner.user.findUniqueOrThrow({ where: { email } });
    const membership = await owner.membership.findFirstOrThrow({ where: { userId: user.id } });
    const input = { membershipId: membership.id, reason: "Identity confirmed in person by the admin (test)" };
    await expect(resetMemberMfa(await contextFor("amina.warsame@coastal.example"), input)).rejects.toBeInstanceOf(
      AuthorizationError,
    );
    const hodan = await contextFor("hodan.ali@coastal.example");
    await expect(
      resetMemberMfa(hodan, { membershipId: hodan.membershipId, reason: input.reason }),
    ).rejects.toBeInstanceOf(ValidationError);
    await resetMemberMfa(hodan, input);
    expect((await owner.user.findUniqueOrThrow({ where: { email } })).twoFactorEnabled).toBe(false);
    expect(await owner.twoFactor.count({ where: { userId: user.id } })).toBe(0);
    expect(await owner.session.count({ where: { userId: user.id } })).toBe(0);
    expect(await auditCount({ action: "auth.mfa_reset_by_admin" })).toBe(1);
  });
});

describe("password reset", () => {
  it("answers the same way for unknown emails and never creates a session", async () => {
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
    expect(unknown.headers.getSetCookie().some((c) => c.startsWith("biomedintel.session_token="))).toBe(false);
  });

  it("stores the reset token with a 30-minute expiry", async () => {
    const row = await owner.verification.findFirstOrThrow({
      where: { identifier: { startsWith: "reset-password" } },
      orderBy: { createdAt: "desc" },
    });
    const minutes = (row.expiresAt.getTime() - Date.now()) / 60_000;
    expect(minutes).toBeGreaterThan(29);
    expect(minutes).toBeLessThanOrEqual(30);
  });
});
