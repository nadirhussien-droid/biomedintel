// Changing your own password over HTTP against a RUNNING server (Stage 11
// pilot fix). Skipped unless E2E_BASE_URL and E2E_PASSWORD are set. Uses the
// fictional fault reporter and always restores the original password.
import { afterAll, describe, expect, it } from "vitest";
import { owner } from "../helpers";

const BASE = process.env.E2E_BASE_URL;
const PASSWORD = process.env.E2E_PASSWORD;
const EMAIL = "lucy.achieng@coastal.example";
const NEW_PASSWORD = "E2E-changed-Passw0rd-2026";

function cookieOf(res: Response): string {
  return res.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .filter((c) => c.split("=")[1] !== "")
    .join("; ");
}

async function signIn(password: string): Promise<{ status: number; cookie: string }> {
  const res = await fetch(`${BASE}/api/auth/sign-in/email`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: BASE! },
    body: JSON.stringify({ email: EMAIL, password }),
  });
  return { status: res.status, cookie: cookieOf(res) };
}

function changePassword(cookie: string, currentPassword: string, newPassword: string) {
  return fetch(`${BASE}/api/auth/change-password`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: BASE!, cookie },
    body: JSON.stringify({ currentPassword, newPassword, revokeOtherSessions: true }),
  });
}

let changed = false;
afterAll(async () => {
  if (changed && BASE) {
    const s = await signIn(NEW_PASSWORD);
    if (s.status === 200) await changePassword(s.cookie, NEW_PASSWORD, PASSWORD!);
  }
  await owner.$disconnect();
});

describe.skipIf(!BASE || !PASSWORD)("changing your own password", () => {
  it("needs the current password, replaces it, signs out other sessions and is audited", async () => {
    const first = await signIn(PASSWORD!);
    const second = await signIn(PASSWORD!); // another device
    expect(first.status).toBe(200);

    expect((await changePassword(first.cookie, "not-the-password-123", NEW_PASSWORD)).status).not.toBe(200);

    const before = await owner.auditLog.count({ where: { action: "auth.password_changed" } });
    const ok = await changePassword(first.cookie, PASSWORD!, NEW_PASSWORD);
    expect(ok.status).toBe(200);
    changed = true;
    expect(await owner.auditLog.count({ where: { action: "auth.password_changed" } })).toBe(before + 1);

    // The other device is signed out; the old password no longer works.
    const other = await fetch(`${BASE}/dashboard`, { headers: { cookie: second.cookie }, redirect: "manual" });
    expect([302, 303, 307, 308]).toContain(other.status);
    expect((await signIn(PASSWORD!)).status).toBe(401);

    // Restore the shared test password for the other HTTP test files.
    const again = await signIn(NEW_PASSWORD);
    expect(again.status).toBe(200);
    expect((await changePassword(again.cookie, NEW_PASSWORD, PASSWORD!)).status).toBe(200);
    changed = false;
  });

  it("the Account security page offers it", async () => {
    const s = await signIn(PASSWORD!);
    const html = await (await fetch(`${BASE}/account/security`, { headers: { cookie: s.cookie } })).text();
    expect(html).toContain("Change password");
  });
});
