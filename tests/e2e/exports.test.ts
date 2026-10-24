// Excel and PDF downloads over HTTP against a RUNNING server. Skipped unless
// E2E_BASE_URL and E2E_PASSWORD are set. The Auditor (no MFA needed) downloads
// each format; a technician is refused; nothing from Highland appears.
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

const AUDITOR = "fatuma.hassan@coastal.example";
const TECH = "amina.warsame@coastal.example";

describe.skipIf(!BASE || !PASSWORD)("Excel and PDF downloads", () => {
  it.each([
    ["/reports/export?report=work-orders&period=last_12_months", "biomedintel-work-orders-coastal-health-"],
    ["/reports/export?report=pm-compliance&period=last_12_months", "biomedintel-pm-compliance-coastal-health-"],
    ["/maintenance/reports/export?", "biomedintel-pm-coastal-health-"],
    ["/assets/export?", "biomedintel-assets-coastal-health-"],
  ])("%s downloads as Excel and PDF with the right type and name", async (path, prefix) => {
    const c = await cookie(AUDITOR);
    const join = path.endsWith("?") ? "" : "&";
    const xlsx = await fetch(`${BASE}${path}${join}format=xlsx`, { headers: { cookie: c } });
    expect(xlsx.status).toBe(200);
    expect(xlsx.headers.get("content-type")).toContain("spreadsheetml.sheet");
    expect(xlsx.headers.get("content-disposition")).toMatch(new RegExp(`attachment; filename="${prefix}.*\\.xlsx"`));
    const xb = new Uint8Array(await xlsx.arrayBuffer());
    expect(String.fromCharCode(xb[0], xb[1])).toBe("PK"); // a real .xlsx (zip) file
    const pdf = await fetch(`${BASE}${path}${join}format=pdf`, { headers: { cookie: c } });
    expect(pdf.status).toBe(200);
    expect(pdf.headers.get("content-type")).toBe("application/pdf");
    expect(pdf.headers.get("content-disposition")).toMatch(new RegExp(`attachment; filename="${prefix}.*\\.pdf"`));
    const pb = Buffer.from(await pdf.arrayBuffer());
    expect(pb.subarray(0, 5).toString()).toBe("%PDF-");
    expect(pb.toString("latin1")).not.toContain("Highland");
  });

  it("CSV stays the default when no format is given", async () => {
    const c = await cookie(AUDITOR);
    const res = await fetch(`${BASE}/reports/export?report=overview`, { headers: { cookie: c } });
    expect(res.headers.get("content-type")).toBe("text/csv; charset=utf-8");
    expect(res.headers.get("content-disposition")).toMatch(/\.csv"$/);
  });

  it("a technician cannot download any format", async () => {
    const c = await cookie(TECH);
    for (const f of ["xlsx", "pdf"]) {
      expect(
        (await fetch(`${BASE}/reports/export?report=overview&format=${f}`, { headers: { cookie: c } })).status,
      ).toBe(403);
      expect((await fetch(`${BASE}/assets/export?format=${f}`, { headers: { cookie: c } })).status).toBe(403);
      expect((await fetch(`${BASE}/maintenance/reports/export?format=${f}`, { headers: { cookie: c } })).status).toBe(
        403,
      );
    }
  });

  it("report pages offer Excel, PDF and CSV", async () => {
    const c = await cookie(AUDITOR);
    const html = await (await fetch(`${BASE}/reports/work-orders`, { headers: { cookie: c } })).text();
    expect(html).toContain("format=xlsx");
    expect(html).toContain("format=pdf");
    expect(html).toContain('aria-label="Export as Excel"');
  });
});
