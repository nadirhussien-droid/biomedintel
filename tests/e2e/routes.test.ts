// HTTP checks against a RUNNING BiomedIntel.ai server (production build).
// Skipped unless E2E_BASE_URL is set, e.g.:
//   npm run build && npm run start      (in one terminal)
//   E2E_BASE_URL=http://localhost:3000 npm test -- tests/e2e   (in another)
// The server must use the same database as the tests' seed users (see README).
import { describe, expect, it } from "vitest";

const BASE = process.env.E2E_BASE_URL;
const PASSWORD = process.env.E2E_PASSWORD;

function splitPair(pair: string): [string, string] {
  const i = pair.indexOf("=");
  return [pair.slice(0, i), pair.slice(i + 1)];
}

async function signIn(email: string): Promise<string> {
  const res = await fetch(`${BASE}/api/auth/sign-in/email`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: BASE! },
    body: JSON.stringify({ email, password: PASSWORD }),
  });
  expect(res.status).toBe(200);
  return res.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .filter((c) => splitPair(c)[1] !== "")
    .join("; ");
}

describe.skipIf(!BASE)("protected routes over HTTP", () => {
  const protectedPaths = [
    "/dashboard",
    "/admin",
    "/assets",
    "/work-orders",
    "/settings",
    "/platform",
    "/account/security",
  ];

  it.each(protectedPaths)("%s redirects a signed-out visitor to /sign-in", async (path) => {
    const res = await fetch(`${BASE}${path}`, { redirect: "manual" });
    expect([302, 303, 307, 308]).toContain(res.status);
    expect(new URL(res.headers.get("location")!, BASE).pathname).toBe("/sign-in");
  });

  it("a forged session cookie does not open the dashboard", async () => {
    const res = await fetch(`${BASE}/dashboard`, {
      redirect: "manual",
      headers: { cookie: "biomedintel.session_token=forged.value" },
    });
    expect([302, 303, 307, 308]).toContain(res.status);
    expect(new URL(res.headers.get("location")!, BASE).pathname).toBe("/sign-in");
  });

  it("the sign-in page is public and sends security headers", async () => {
    const res = await fetch(`${BASE}/sign-in`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
    expect(res.headers.get("x-frame-options")).toBe("DENY");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("x-request-id")).toMatch(/[0-9a-f-]{36}/);
    expect(res.headers.get("x-powered-by")).toBeNull();
    expect(await res.text()).toContain("BiomedIntel.ai");
  });

  it("public sign-up is closed", async () => {
    const res = await fetch(`${BASE}/api/auth/sign-up/email`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: BASE! },
      body: JSON.stringify({ email: "intruder@evil.example", password: "Intruder-password-1", name: "Intruder" }),
    });
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  describe.skipIf(!PASSWORD)("signed in", () => {
    it("a technician reaches the dashboard but is sent away from administration", async () => {
      const cookie = await signIn("amina.warsame@coastal.example");
      const dash = await fetch(`${BASE}/dashboard`, { headers: { cookie }, redirect: "manual" });
      expect(dash.status).toBe(200);
      const html = await dash.text();
      expect(html).toContain("Engineering dashboard");
      // Stage 6: the last demo figures were replaced by live preventive maintenance data.
      expect(html).not.toContain("Fictional demonstration data");
      expect(html).toContain("Preventive maintenance");
      expect(html).toContain("PM compliance");
      expect(html).not.toContain("Highland Medical Network"); // another tenant

      const admin = await fetch(`${BASE}/admin`, { headers: { cookie }, redirect: "manual" });
      expect([302, 303, 307, 308]).toContain(admin.status);
      expect(new URL(admin.headers.get("location")!, BASE).pathname).toBe("/dashboard");
    });

    it("an administrator without MFA is sent to set it up before seeing any data", async () => {
      const cookie = await signIn("david.mutua@highland.example");
      const res = await fetch(`${BASE}/dashboard`, { headers: { cookie }, redirect: "manual" });
      expect([302, 303, 307, 308]).toContain(res.status);
      expect(new URL(res.headers.get("location")!, BASE).pathname).toBe("/account/security");
    });

    it("a hospital cookie for another organisation is ignored", async () => {
      const cookie = await signIn("amina.warsame@coastal.example");
      const res = await fetch(`${BASE}/dashboard`, {
        headers: {
          cookie: `${cookie}; bi_hospital=00000000-0000-4000-8000-000000000000; bi_org=00000000-0000-4000-8000-000000000000`,
        },
      });
      expect(res.status).toBe(200);
      expect(await res.text()).toContain("Coastal Health Group");
    });
  });
});
