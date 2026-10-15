// Reports and analytics over HTTP against a RUNNING server (Stage 7).
// Skipped unless E2E_BASE_URL (and E2E_PASSWORD for signed-in checks) is set.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { owner } from "../helpers";

const BASE = process.env.E2E_BASE_URL;
const PASSWORD = process.env.E2E_PASSWORD;
const PAGES = [
  "/reports",
  "/reports/pm-compliance",
  "/reports/work-orders",
  "/reports/reliability",
  "/reports/safety",
  "/reports/governance",
  "/reports/lifecycle",
  "/reports/scheduled",
];

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

describe.skipIf(!BASE)("reports, signed out", () => {
  it.each(["/reports", "/reports/safety", "/reports/export?report=overview", "/reports/scheduled"])(
    "%s sends a visitor to sign-in",
    async (path) => {
      const res = await fetch(`${BASE}${path}`, { redirect: "manual" });
      expect([302, 303, 307, 308]).toContain(res.status);
      expect(new URL(res.headers.get("location")!, BASE).pathname).toBe("/sign-in");
    },
  );
});

describe.skipIf(!BASE || !PASSWORD)("reports, signed in", () => {
  let amina = ""; // Technician (view, no export, no workload, no financial)
  let fatuma = ""; // Auditor (view, export, financial)
  let lucy = ""; // Fault Reporter (no analytics)
  beforeAll(async () => {
    amina = await signIn("amina.warsame@coastal.example");
    fatuma = await signIn("fatuma.hassan@coastal.example");
    lucy = await signIn("lucy.achieng@coastal.example");
  });

  it("a technician can open every report page", async () => {
    for (const path of PAGES) {
      const res = await fetch(`${BASE}${path}`, { headers: { cookie: amina } });
      expect(res.status, path).toBe(200);
    }
    const dash = await (await fetch(`${BASE}/reports`, { headers: { cookie: amina } })).text();
    expect(dash).toContain("Engineering analytics");
    expect(dash).toContain("Overdue PM");
    expect(dash).not.toContain("Export CSV");
  });

  it("financial figures and per-engineer workload stay hidden from a technician", async () => {
    const life = await (await fetch(`${BASE}/reports/lifecycle`, { headers: { cookie: amina } })).text();
    expect(life).toContain("Your role does not include financial figures");
    const wo = await (await fetch(`${BASE}/reports/work-orders`, { headers: { cookie: amina } })).text();
    expect(wo).not.toContain("Workload by engineer");
    const tech = await owner.user.findFirstOrThrow({ where: { email: "amina.warsame@coastal.example" } });
    const filtered = await fetch(`${BASE}/reports/work-orders?assignee=${tech.id}`, { headers: { cookie: amina } });
    expect(filtered.status).toBe(404);
    const byPerson = await fetch(`${BASE}/reports/pm-compliance?by=assignee`, { headers: { cookie: amina } });
    expect(byPerson.status).toBe(404);
  });

  it("CSV export: refused for a technician, allowed for an auditor, formula-safe with a header", async () => {
    const refused = await fetch(`${BASE}/reports/export?report=overview`, { headers: { cookie: amina } });
    expect(refused.status).toBe(403);
    const ok = await fetch(`${BASE}/reports/export?report=pm-compliance&period=last_12_months`, {
      headers: { cookie: fatuma },
    });
    expect(ok.status).toBe(200);
    expect(ok.headers.get("content-type")).toContain("text/csv");
    expect(ok.headers.get("cache-control")).toBe("no-store");
    const csv = await ok.text();
    expect(csv).toContain('"Report","Preventive maintenance compliance"');
    expect(csv).toContain('"Generated (UTC)"');
    expect(csv).toMatch(/"Period","\d{1,2} \w{3} \d{4} – \d{1,2} \w{3} \d{4}"/);
    expect(csv).not.toMatch(/Highland|HMC/);
    const unknown = await fetch(`${BASE}/reports/export?report=everything`, { headers: { cookie: fatuma } });
    expect(unknown.status).toBe(404);
  });

  it("an auditor sees acquisition cost (and the view is audited)", async () => {
    const before = await owner.auditLog.count({ where: { action: "analytics.financial_viewed" } });
    const life = await (await fetch(`${BASE}/reports/lifecycle`, { headers: { cookie: fatuma } })).text();
    expect(life).toContain("have a cost recorded");
    const after = await owner.auditLog.count({ where: { action: "analytics.financial_viewed" } });
    expect(after).toBe(before + 1);
  });

  it("another organisation's hospital or report is 'not found'", async () => {
    const other = await owner.hospital.findFirstOrThrow({ where: { organization: { slug: "highland-medical" } } });
    for (const path of [`/reports?hospital=${other.id}`, `/reports/safety?hospital=${other.id}`]) {
      const res = await fetch(`${BASE}${path}`, { headers: { cookie: amina } });
      expect(res.status, path).toBe(404);
      expect(await res.text()).not.toContain(other.name);
    }
    const csv = await fetch(`${BASE}/reports/export?report=overview&hospital=${other.id}`, {
      headers: { cookie: fatuma },
    });
    expect(csv.status).toBe(404);
    const snap = await fetch(`${BASE}/reports/scheduled/00000000-0000-4000-8000-000000000000`, {
      headers: { cookie: fatuma },
    });
    expect(snap.status).toBe(404);
  });

  it("a fault reporter has no analytics", async () => {
    const html = await (await fetch(`${BASE}/reports`, { headers: { cookie: lucy } })).text();
    expect(html).toContain("Your role does not include engineering reports");
    expect(html).not.toContain("Overdue PM");
    const csv = await fetch(`${BASE}/reports/export?report=overview`, { headers: { cookie: lucy } });
    expect(csv.status).toBe(403);
  });

  // Managers and admins sign in with MFA; their scheduling is covered by the
  // integration tests and the browser walk-through.
  it("technicians and auditors see scheduled reports but cannot create them", async () => {
    const tech = await (await fetch(`${BASE}/reports/scheduled`, { headers: { cookie: amina } })).text();
    expect(tech).toContain("Scheduled reports");
    expect(tech).not.toContain("New scheduled report");
    const auditor = await (await fetch(`${BASE}/reports/scheduled`, { headers: { cookie: fatuma } })).text();
    expect(auditor).not.toContain("New scheduled report");
  });

  it("the old maintenance report address now opens the single compliance report", async () => {
    const res = await fetch(`${BASE}/maintenance/reports`, { headers: { cookie: fatuma }, redirect: "manual" });
    expect([302, 303, 307, 308]).toContain(res.status);
    expect(new URL(res.headers.get("location")!, BASE).pathname).toBe("/reports/pm-compliance");
  });
});
