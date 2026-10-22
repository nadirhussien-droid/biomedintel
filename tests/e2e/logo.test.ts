// The optional hospital logo route over HTTP against a RUNNING server. Skipped
// unless E2E_BASE_URL and E2E_PASSWORD are set. Checks who may read, upload and
// remove, and that cross-site and signed-out requests are refused. (Setting a
// logo as the Organisation Administrator is covered by the integration test
// and the browser walk-through, which handle the administrator's MFA.)
import { describe, expect, it } from "vitest";

const BASE = process.env.E2E_BASE_URL;
const PASSWORD = process.env.E2E_PASSWORD;

const cache = new Map<string, string>();
async function cookie(email: string): Promise<string> {
  const hit = cache.get(email);
  if (hit) return hit;
  const res = await fetch(`${BASE}/api/auth/sign-in/email`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: BASE! },
    body: JSON.stringify({ email, password: PASSWORD }),
  });
  expect(res.status).toBe(200);
  const jar = res.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .filter((c) => c.split("=")[1] !== "")
    .join("; ");
  cache.set(email, jar);
  return jar;
}

function upload(headers: Record<string, string>) {
  const body = new FormData();
  body.append("logo", new File([new Uint8Array([137, 80, 78, 71])], "logo.png", { type: "image/png" }));
  return fetch(`${BASE}/organization-logo`, { method: "POST", headers, body });
}

describe.skipIf(!BASE || !PASSWORD)("hospital logo route", () => {
  it("a member of an organisation with no logo gets 404, not an error", async () => {
    const c = await cookie("lucy.achieng@coastal.example");
    const res = await fetch(`${BASE}/organization-logo`, { headers: { cookie: c } });
    expect(res.status).toBe(404);
  });

  it("a signed-out request is not served", async () => {
    const res = await fetch(`${BASE}/organization-logo`, { redirect: "manual" });
    expect([302, 303, 307, 308, 401]).toContain(res.status);
  });

  it("only the Organisation Administrator may upload or remove (others get 403)", async () => {
    for (const email of ["lucy.achieng@coastal.example", "amina.warsame@coastal.example"]) {
      const c = await cookie(email);
      expect((await upload({ cookie: c, origin: BASE! })).status).toBe(403);
      expect(
        (await fetch(`${BASE}/organization-logo`, { method: "DELETE", headers: { cookie: c, origin: BASE! } })).status,
      ).toBe(403);
    }
  });

  it("a cross-site upload or removal is refused before anything is read", async () => {
    const c = await cookie("lucy.achieng@coastal.example");
    expect((await upload({ cookie: c, origin: "https://evil.example" })).status).toBe(403);
    expect(
      (
        await fetch(`${BASE}/organization-logo`, {
          method: "DELETE",
          headers: { cookie: c, origin: "https://evil.example" },
        })
      ).status,
    ).toBe(403);
  });

  it("the job sheet prints without a logo, showing the organisation name", async () => {
    const c = await cookie("amina.warsame@coastal.example");
    const list = await (await fetch(`${BASE}/work-orders`, { headers: { cookie: c } })).text();
    const id = /\/work-orders\/([0-9a-f-]{36})/.exec(list)?.[1];
    expect(id).toBeTruthy();
    const html = await (await fetch(`${BASE}/work-orders/${id}/print`, { headers: { cookie: c } })).text();
    expect(html).toContain("Coastal Health Group");
    expect(html).toContain("Work order job sheet");
    expect(html).not.toContain("/organization-logo");
  });
});
