// Preventive maintenance pages over HTTP against a RUNNING server (Stage 6).
// Skipped unless E2E_BASE_URL (and E2E_PASSWORD for signed-in checks) is set.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { owner } from "../helpers";

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

afterAll(async () => {
  await owner.$disconnect();
});

describe.skipIf(!BASE)("preventive maintenance, signed out", () => {
  it.each(["/maintenance", "/maintenance/schedule", "/maintenance/reports/export"])(
    "%s sends a visitor to sign-in",
    async (path) => {
      const res = await fetch(`${BASE}${path}`, { redirect: "manual" });
      expect([302, 303, 307, 308]).toContain(res.status);
      expect(new URL(res.headers.get("location")!, BASE).pathname).toBe("/sign-in");
    },
  );

  it("the scheduler endpoint needs its secret (POST or GET)", async () => {
    const post = await fetch(`${BASE}/api/cron/pm-generate`, { method: "POST" });
    expect([401, 503]).toContain(post.status);
    const wrong = await fetch(`${BASE}/api/cron/pm-generate`, {
      method: "POST",
      headers: { authorization: `Bearer ${"x".repeat(40)}` },
    });
    expect([401, 503]).toContain(wrong.status);
    expect(JSON.stringify(await wrong.json())).not.toMatch(/organisations|created/);
    const get = await fetch(`${BASE}/api/cron/pm-generate`);
    expect([401, 503]).toContain(get.status);
  });
});

describe.skipIf(!BASE || !PASSWORD)("preventive maintenance, signed in", () => {
  let amina = "";
  let fatuma = "";
  let lucy = "";
  beforeAll(async () => {
    amina = await signIn("amina.warsame@coastal.example"); // Technician
    fatuma = await signIn("fatuma.hassan@coastal.example"); // Auditor
    lucy = await signIn("lucy.achieng@coastal.example"); // Fault Reporter
  });

  it("a technician sees the overview, schedule, calendar and plans", async () => {
    for (const path of [
      "/maintenance",
      "/maintenance/schedule?view=all",
      "/maintenance/calendar",
      "/maintenance/plans",
    ]) {
      const res = await fetch(`${BASE}${path}`, { headers: { cookie: amina } });
      expect(res.status, path).toBe(200);
    }
    const plans = await (await fetch(`${BASE}/maintenance/plans`, { headers: { cookie: amina } })).text();
    expect(plans).toContain("Infusion pump annual PM and safety test");
    expect(plans).not.toContain("Highland");
    const schedule = await (
      await fetch(`${BASE}/maintenance/schedule?view=all`, { headers: { cookie: amina } })
    ).text();
    expect(schedule).toContain("INF-0001");
  });

  it("an asset page shows its preventive maintenance section", async () => {
    const asset = await owner.asset.findFirstOrThrow({
      where: { assetTag: "INF-0001", organization: { slug: "coastal-health" } },
    });
    const html = await (await fetch(`${BASE}/assets/${asset.id}`, { headers: { cookie: amina } })).text();
    expect(html).toContain('id="pm"');
    expect(html).toContain("Infusion pump annual PM and safety test");
  });

  it("the barcode scan page has a maintenance mode", async () => {
    const html = await (await fetch(`${BASE}/assets/scan?then=pm`, { headers: { cookie: amina } })).text();
    expect(html).toContain("Scan to open a maintenance schedule");
  });

  it("another organisation's plan or hold is 'not found'", async () => {
    const plan = await owner.maintenancePlan.findFirstOrThrow({
      where: { organization: { slug: "highland-medical" } },
    });
    const res = await fetch(`${BASE}/maintenance/plans/${plan.id}`, { headers: { cookie: amina } });
    expect(res.status).toBe(404);
    expect(await res.text()).not.toContain(plan.name);
    const hold = await fetch(`${BASE}/maintenance/holds/00000000-0000-4000-8000-000000000000`, {
      headers: { cookie: amina },
    });
    expect(hold.status).toBe(404);
  });

  it("CSV export: refused for a technician, allowed for an auditor (scope only)", async () => {
    const refused = await fetch(`${BASE}/maintenance/reports/export`, { headers: { cookie: amina } });
    expect(refused.status).toBe(403);
    const ok = await fetch(`${BASE}/maintenance/reports/export`, { headers: { cookie: fatuma } });
    expect(ok.status).toBe(200);
    expect(ok.headers.get("content-type")).toContain("text/csv");
    expect(ok.headers.get("cache-control")).toBe("no-store");
    const csv = await ok.text();
    expect(csv).toContain("Due date");
    expect(csv).not.toMatch(/SRH|LVC/);
  });

  it("a fault reporter does not see maintenance schedules", async () => {
    const html = await (await fetch(`${BASE}/maintenance`, { headers: { cookie: lucy } })).text();
    expect(html).toContain("Your role does not include maintenance schedules");
    expect(html).not.toContain("INF-0001");
  });
});
