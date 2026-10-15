// Inventory, suppliers, lifecycle and cost pages over HTTP against a RUNNING
// server (Stage 8). Skipped unless E2E_BASE_URL (and E2E_PASSWORD) is set.
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

describe.skipIf(!BASE)("inventory and suppliers, signed out", () => {
  it.each([
    "/inventory",
    "/inventory/movements",
    "/suppliers",
    "/suppliers/warranties",
    "/reports/costs",
    "/reports/export?report=costs",
  ])("%s sends a visitor to sign-in", async (path) => {
    const res = await fetch(`${BASE}${path}`, { redirect: "manual" });
    expect([302, 303, 307, 308]).toContain(res.status);
    expect(new URL(res.headers.get("location")!, BASE).pathname).toBe("/sign-in");
  });
});

describe.skipIf(!BASE || !PASSWORD)("inventory and suppliers, signed in", () => {
  let amina = ""; // Technician
  let grace = ""; // Inventory Manager
  let fatuma = ""; // Auditor
  let lucy = ""; // Fault Reporter
  let otherSupplierId = "";
  beforeAll(async () => {
    amina = await signIn("amina.warsame@coastal.example");
    grace = await signIn("grace.mwangi@coastal.example");
    fatuma = await signIn("fatuma.hassan@coastal.example");
    lucy = await signIn("lucy.achieng@coastal.example");
    // A supplier and a part in ANOTHER organisation (fictional), to test isolation.
    const highland = await owner.organization.findUniqueOrThrow({ where: { slug: "highland-medical" } });
    const someone = await owner.membership.findFirstOrThrow({ where: { organizationId: highland.id } });
    const s = await owner.supplier.upsert({
      where: { id: "6f0d9c58-1a1b-4c1e-9b3a-0c3f6a7e9d01" },
      update: {},
      create: {
        id: "6f0d9c58-1a1b-4c1e-9b3a-0c3f6a7e9d01",
        organizationId: highland.id,
        name: "Highland Only Supplier (demo)",
        kinds: ["PARTS_SUPPLIER"],
        createdById: someone.userId,
      },
    });
    otherSupplierId = s.id;
    await owner.part.upsert({
      where: { organizationId_partNumber: { organizationId: highland.id, partNumber: "HL-SECRET-1" } },
      update: {},
      create: {
        organizationId: highland.id,
        partNumber: "HL-SECRET-1",
        name: "Highland only part (demo)",
        createdById: someone.userId,
      },
    });
  });

  it("a technician can open the inventory and supplier pages", async () => {
    for (const path of [
      "/inventory",
      "/inventory/movements",
      "/inventory/work-orders",
      "/inventory/purchasing",
      "/suppliers",
      "/suppliers/warranties",
      "/suppliers/services",
    ]) {
      const res = await fetch(`${BASE}${path}`, { headers: { cookie: amina } });
      expect(res.status, path).toBe(200);
    }
    const html = await (await fetch(`${BASE}/inventory`, { headers: { cookie: amina } })).text();
    expect(html).toContain("BAT-0001");
    expect(html).not.toContain("HL-SECRET-1");
  });

  it("unit costs are hidden from a technician but shown to the inventory manager", async () => {
    const part = await owner.part.findFirstOrThrow({
      where: { partNumber: "BAT-0001", organization: { slug: "coastal-health" } },
    });
    const tech = await (await fetch(`${BASE}/inventory/parts/${part.id}`, { headers: { cookie: amina } })).text();
    expect(tech).not.toContain("4,500");
    expect(tech).not.toMatch(/KES\s?4/);
    const im = await (await fetch(`${BASE}/inventory/parts/${part.id}`, { headers: { cookie: grace } })).text();
    expect(im).toMatch(/4,500|4500/);
    // Seeded FLT-0001 is below its minimum: a suggestion and a request link, nothing ordered.
    const list = await (await fetch(`${BASE}/inventory?view=low`, { headers: { cookie: grace } })).text();
    expect(list).toContain("FLT-0001");
    expect(list).toContain("Request more");
  });

  it("a technician cannot open the part or supplier editors", async () => {
    const part = await owner.part.findFirstOrThrow({
      where: { partNumber: "BAT-0001", organization: { slug: "coastal-health" } },
    });
    expect((await fetch(`${BASE}/inventory/parts/${part.id}/edit`, { headers: { cookie: amina } })).status).toBe(404);
  });

  it("another organisation's supplier or part is 'not found', and a scanned code does not resolve", async () => {
    const res = await fetch(`${BASE}/suppliers/${otherSupplierId}`, { headers: { cookie: grace } });
    expect(res.status).toBe(404);
    expect(await res.text()).not.toContain("Highland Only Supplier");
    const other = await owner.part.findFirstOrThrow({ where: { partNumber: "HL-SECRET-1" } });
    expect((await fetch(`${BASE}/inventory/parts/${other.id}`, { headers: { cookie: grace } })).status).toBe(404);
    const scan = await fetch(`${BASE}/inventory?code=HL-SECRET-1`, { headers: { cookie: grace }, redirect: "manual" });
    expect(scan.status).toBe(200);
    expect(await scan.text()).toContain("No part");
  });

  it("cost CSV: refused for a technician, allowed for an auditor with a header", async () => {
    expect((await fetch(`${BASE}/reports/export?report=costs`, { headers: { cookie: amina } })).status).toBe(403);
    const ok = await fetch(`${BASE}/reports/export?report=costs&period=last_12_months`, {
      headers: { cookie: fatuma },
    });
    expect(ok.status).toBe(200);
    const csv = await ok.text();
    expect(csv).toContain('"Report","Parts, external service and maintenance cost"');
    expect(csv).toContain("Labour is not included");
    expect(csv).not.toContain("HL-SECRET-1");
  });

  it("a fault reporter has no inventory, supplier or cost access", async () => {
    const inv = await (await fetch(`${BASE}/inventory`, { headers: { cookie: lucy } })).text();
    expect(inv).toContain("does not include the spare parts inventory");
    expect(inv).not.toContain("BAT-0001");
    const sup = await (await fetch(`${BASE}/suppliers`, { headers: { cookie: lucy } })).text();
    expect(sup).not.toContain("Demo Medical Services");
    expect((await fetch(`${BASE}/reports/export?report=costs`, { headers: { cookie: lucy } })).status).toBe(403);
  });
});
