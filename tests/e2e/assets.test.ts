// Stage 4 HTTP checks against a RUNNING server that uses the TEST database
// (see README → Running the tests). Skipped unless E2E_BASE_URL is set.
// Signs in only once (sign-in is rate-limited to 5 per minute).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { assetRow, owner } from "../helpers";

const BASE = process.env.E2E_BASE_URL;
const PASSWORD = process.env.E2E_PASSWORD;
const isRedirect = (status: number) => [302, 303, 307, 308].includes(status);

afterAll(async () => {
  await owner.$disconnect();
});

describe.skipIf(!BASE)("asset pages, signed out", () => {
  it("a work order link also returns to that job after sign-in", async () => {
    const job = await owner.workOrder.findFirstOrThrow({ where: { organization: { slug: "coastal-health" } } });
    const res = await fetch(`${BASE}/work-orders/${job.id}`, { redirect: "manual" });
    const location = new URL(res.headers.get("location")!, BASE);
    expect(location.pathname).toBe("/sign-in");
    expect(location.searchParams.get("next")).toBe(`/work-orders/${job.id}`);
  });

  it("send a visitor to sign-in, remembering only the asset page address and showing nothing about it", async () => {
    const pump = await assetRow("coastal-health", "INF-0101");
    const res = await fetch(`${BASE}/assets/${pump.id}`, { redirect: "manual" });
    expect(isRedirect(res.status)).toBe(true);
    const location = new URL(res.headers.get("location")!, BASE);
    expect(location.pathname).toBe("/sign-in");
    expect(location.searchParams.get("next")).toBe(`/assets/${pump.id}`);
    const page = await (await fetch(location)).text();
    expect(page).not.toContain("INF-0101");
    expect(page).not.toContain(pump.name);
  });

  it("the retired QR link route remembers nothing", async () => {
    const res = await fetch(`${BASE}/a/AAAAAAAAAAAAAAAAAAAAAA`, { redirect: "manual" });
    expect(isRedirect(res.status)).toBe(true);
    expect(new URL(res.headers.get("location")!, BASE).searchParams.get("next")).toBeNull();
  });

  it("ignores a 'next' address that points anywhere else", async () => {
    const page = await (await fetch(`${BASE}/sign-in?next=https://evil.example/phish`)).text();
    // Next.js records the requested URL in its page data as plain text; what
    // matters is that nothing links or redirects there and no scan banner shows.
    expect(page).not.toMatch(/href="https?:\/\/evil\.example/);
  });

  it("allows the camera (optional barcode scanning) for this site only", async () => {
    const res = await fetch(`${BASE}/sign-in`);
    expect(res.headers.get("permissions-policy")).toContain("camera=(self)");
  });
});

describe.skipIf(!BASE || !PASSWORD)("equipment pages, signed in as a technician", () => {
  let cookie = "";

  beforeAll(async () => {
    const res = await fetch(`${BASE}/api/auth/sign-in/email`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: BASE! },
      body: JSON.stringify({ email: "amina.warsame@coastal.example", password: PASSWORD }),
    });
    expect(res.status).toBe(200);
    cookie = res.headers
      .getSetCookie()
      .map((c) => c.split(";")[0])
      .filter((c) => !c.endsWith("="))
      .join("; ");
  });

  const get = (path: string) => fetch(`${BASE}${path}`, { headers: { cookie }, redirect: "manual" });

  it("an in-scope asset page shows its Code 128 barcode and asset ID, and no QR code", async () => {
    const pump = await assetRow("coastal-health", "INF-0101");
    const page = await (await get(`/assets/${pump.id}`)).text();
    expect(page).toContain("INF-0101");
    expect(page).toContain("Code 128 barcode for asset INF-0101");
    expect(page).not.toMatch(/QR code/i);
  });

  it("the retired QR link route no longer exists", async () => {
    const res = await get(`/a/AAAAAAAAAAAAAAAAAAAAAA`);
    expect(res.status).toBe(404);
  });

  it("the scan page is ready for a handheld scanner and does not start the camera by itself", async () => {
    const page = await (await get(`/assets/scan`)).text();
    expect(page).toContain("Scan with a barcode scanner, or type the asset ID");
    expect(page).toMatch(/<input[^>]*id="manual-code"[^>]*autofocus|<input[^>]*autofocus[^>]*id="manual-code"/i);
    expect(page).toContain("Start camera");
  });

  it("guessing another organisation's asset address shows 'not found'", async () => {
    const theirs = await assetRow("highland-medical", "VEN-0001");
    const res = await get(`/assets/${theirs.id}`);
    expect(res.status).toBe(404);
    const page = await res.text();
    expect(page).toContain("Asset not found");
    expect(page).not.toContain(theirs.serialNumber!);
  });

  it("the register finds an asset by its barcode value, but never another organisation's equipment", async () => {
    const found = await (await get(`/assets?hospital=all&q=INF-0101`)).text();
    expect(found).toContain("INF-0101");
    const page = await (await get(`/assets?hospital=all&q=DEMO-SN-3101`)).text();
    expect(page).toContain("No equipment matches these filters");
  });

  it("the register stays closed until someone searches, filters or asks for the full list", async () => {
    const closed = await (await get(`/assets?hospital=all&department=all`)).text();
    expect(closed).toContain("Search or choose a filter to see equipment");
    expect(closed).not.toContain("INF-0101");
    const all = await (await get(`/assets?all=1&hospital=all&department=all`)).text();
    expect(all).not.toContain("Search or choose a filter to see equipment");
    expect(all).toContain("INF-0101");
  });

  it("prints labels only for permitted assets, with a Code 128 barcode and no internal details", async () => {
    const mine = await assetRow("coastal-health", "INF-0101");
    const theirs = await assetRow("highland-medical", "VEN-0001");
    const res = await get(`/assets/labels?id=${mine.id}&id=${theirs.id}`);
    expect(res.status).toBe(200);
    const page = (await res.text()).replaceAll("<!-- -->", "");
    expect(page).toContain("1 label ready");
    expect(page).toContain("Code 128 barcode for INF-0101");
    expect(page).not.toMatch(/QR code/i);
    expect(page).toContain("@page");
    expect(page).not.toContain(mine.serialNumber!);
    expect(page).not.toContain("VEN-0001");
  });

  // ─── Work orders (Stage 5) ─────────────────────────────────────────────────

  it("the work order list and a job in scope open; the job sheet carries the asset barcode", async () => {
    const job = await owner.workOrder.findFirstOrThrow({
      where: { organization: { slug: "coastal-health" }, asset: { assetTag: "VEN-0001" } },
    });
    const list = await (await get(`/work-orders?view=all&all=1`)).text();
    expect(list).toContain(job.number);
    const page = await (await get(`/work-orders/${job.id}`)).text();
    expect(page).toContain(job.number);
    expect(page).toContain("VEN-0001");
    const sheet = await (await get(`/work-orders/${job.id}/print`)).text();
    expect(sheet).toContain("Code 128 barcode for asset VEN-0001");
    expect(sheet).toContain(`Code 128 barcode for ${job.number}`);
  });

  it("another organisation's job, and an out-of-scope job, are 'not found'", async () => {
    const theirs = await owner.workOrder.findFirstOrThrow({ where: { organization: { slug: "highland-medical" } } });
    const outOfScope = await owner.workOrder.findFirstOrThrow({
      where: { organization: { slug: "coastal-health" }, asset: { assetTag: "DEF-0101" } },
    });
    for (const id of [theirs.id, outOfScope.id]) {
      const res = await get(`/work-orders/${id}`);
      expect(res.status).toBe(404);
      const page = await res.text();
      expect(page).toContain("Work order not found");
      expect(page).not.toContain(theirs.number);
    }
    expect((await get(`/work-orders/${theirs.id}/photos/${theirs.id}`)).status).toBe(404);
  });

  it("photo uploads are refused from other sites, without a file, or when too large", async () => {
    const job = await owner.workOrder.findFirstOrThrow({
      where: { organization: { slug: "coastal-health" }, asset: { assetTag: "VEN-0001" } },
    });
    const post = (headers: Record<string, string>, body?: BodyInit) =>
      fetch(`${BASE}/work-orders/${job.id}/photos`, { method: "POST", headers: { cookie, ...headers }, body });
    expect((await post({ origin: "https://evil.example" }, new FormData())).status).toBe(403);
    expect((await post({}, new FormData())).status).toBe(403); // no Origin header
    const tooBig = new FormData();
    tooBig.append("photo", new Blob([new Uint8Array(6 * 1024 * 1024)], { type: "image/jpeg" }), "big.jpg");
    expect((await post({ origin: BASE! }, tooBig)).status).toBe(413);
    const notImage = new FormData();
    notImage.append("photo", new Blob(["<script>alert(1)</script>"], { type: "image/jpeg" }), "x.jpg");
    const res = await post({ origin: BASE! }, notImage);
    expect(res.status).toBe(422);
  });

  it("the notifications page opens and the header shows the bell", async () => {
    const page = await (await get(`/notifications`)).text();
    expect(page).toContain("Notifications");
    expect(page).toMatch(/aria-label="Notifications/);
  });

  it("CSV export is refused for a technician (no export permission)", async () => {
    const res = await get(`/assets/export`);
    expect(res.status).toBe(403);
  });
});
