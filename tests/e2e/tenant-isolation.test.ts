// Stage 10: cross-organisation attack suite over HTTP, against a RUNNING
// server. Skipped unless E2E_BASE_URL and E2E_PASSWORD are set.
//
// Coastal Health records of every kind are created in the test database
// (marked with the word CANARY). Then Highland users — David (Organisation
// Administrator, MFA set up here) and Sara (Technician) — try to reach them
// through direct links, changed ids, query parameters, file downloads,
// exports, barcode look-ups and uploads. Every attempt must return "not
// found" (or an empty result) and no CANARY text. The reverse direction
// (Coastal → Highland) is checked too.
import { randomUUID } from "node:crypto";
import { authenticator } from "otplib";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { owner } from "../helpers";

const BASE = process.env.E2E_BASE_URL;
const PASSWORD = process.env.E2E_PASSWORD;
const CANARY = "CANARY";
// Text that appears only in Coastal Health's records. (Highland deliberately
// reuses some asset tags such as VEN-0001, and numbers its own jobs, so tags
// and job numbers are NOT unique markers.)
const COASTAL_ONLY = [
  CANARY,
  "Riverside General",
  "Northlake Community",
  "DEMO-SN-3001",
  "WO-2026-00002",
  "WO-2026-00003",
  "BAT-0001 ·",
  "DM-Infuse 100 troubleshooting",
];
const leaks = (body: string) => COASTAL_ONLY.filter((m) => body.includes(m));

type Jar = string;
function merge(previous: Jar, res: Response): Jar {
  const jar = new Map(
    previous
      .split("; ")
      .filter(Boolean)
      .map((p) => [p.slice(0, p.indexOf("=")), p.slice(p.indexOf("=") + 1)] as [string, string]),
  );
  for (const line of res.headers.getSetCookie()) {
    const pair = line.split(";")[0];
    const name = pair.slice(0, pair.indexOf("="));
    const value = pair.slice(pair.indexOf("=") + 1);
    if (value === "" || /max-age=0/i.test(line)) jar.delete(name);
    else jar.set(name, value);
  }
  return [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
}
async function post(path: string, body: unknown, cookie = ""): Promise<Response> {
  return fetch(`${BASE}/api/auth${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: BASE!, cookie },
    body: JSON.stringify(body),
  });
}
async function signIn(email: string): Promise<Jar> {
  const res = await post("/sign-in/email", { email, password: PASSWORD });
  expect(res.status).toBe(200);
  return merge("", res);
}
/** Signs in a privileged user and sets up MFA for them, as the app requires. */
async function signInWithMfa(email: string): Promise<Jar> {
  let jar = await signIn(email);
  const enable = await post("/two-factor/enable", { password: PASSWORD }, jar);
  expect(enable.status).toBe(200);
  const secret = new URL(((await enable.json()) as { totpURI: string }).totpURI).searchParams.get("secret")!;
  const verify = await post("/two-factor/verify-totp", { code: authenticator.generate(secret) }, jar);
  expect(verify.status).toBe(200);
  jar = merge(jar, verify);
  return jar;
}
async function get(path: string, cookie: Jar) {
  const res = await fetch(`${BASE}${path}`, { headers: { cookie }, redirect: "manual" });
  return { status: res.status, body: await res.text(), headers: res.headers };
}

afterAll(async () => {
  await owner.$disconnect();
});

describe.skipIf(!BASE || !PASSWORD)("tenant isolation over HTTP (Stage 10)", () => {
  let david = ""; // Highland Organisation Administrator
  let sara = ""; // Highland Technician
  let amina = ""; // Coastal Technician
  const c: Record<string, string> = {}; // Coastal ids
  const h: Record<string, string> = {}; // Highland ids

  beforeAll(async () => {
    const coastal = await owner.organization.findUniqueOrThrow({ where: { slug: "coastal-health" } });
    const highland = await owner.organization.findUniqueOrThrow({ where: { slug: "highland-medical" } });
    const user = async (email: string) => (await owner.user.findUniqueOrThrow({ where: { email } })).id;
    const james = await user("james.otieno@coastal.example");
    const vent = await owner.asset.findFirstOrThrow({ where: { organizationId: coastal.id, assetTag: "VEN-0001" } });
    const wo = await owner.workOrder.findFirstOrThrow({
      where: { organizationId: coastal.id, number: "WO-2026-00002" },
    });
    const rgh = await owner.hospital.findFirstOrThrow({ where: { organizationId: coastal.id, code: "RGH" } });
    Object.assign(c, {
      asset: vent.id,
      model: vent.modelId,
      workOrder: wo.id,
      plan: (await owner.maintenancePlan.findFirstOrThrow({ where: { organizationId: coastal.id } })).id,
      part: (await owner.part.findFirstOrThrow({ where: { organizationId: coastal.id, partNumber: "BAT-0001" } })).id,
      supplier: (await owner.supplier.findFirstOrThrow({ where: { organizationId: coastal.id } })).id,
      hospital: rgh.id,
    });
    const doc = await owner.knowledgeDocument.findFirstOrThrow({ where: { organizationId: coastal.id } });
    c.document = doc.id;
    c.version = doc.currentVersionId!;
    // Records the seed does not contain, created directly (fictional, CANARY-marked).
    const png = Buffer.from(
      "89504e470d0a1a0a0000000d4948445200000001000000010806000000" +
        "1f15c4890000000d49444154789c6360000002000154a24f5d0000000049454e44ae426082",
      "hex",
    );
    c.photo = (
      await owner.attachment.create({
        data: {
          organizationId: coastal.id,
          workOrderId: wo.id,
          filename: "canary.png",
          mime: "image/png",
          sizeBytes: png.length,
          sha256: "0".repeat(64),
          width: 1,
          height: 1,
          content: png,
          uploadedById: james,
        },
      })
    ).id;
    c.hold = (
      await owner.safetyHold.create({
        data: {
          organizationId: coastal.id,
          assetId: vent.id,
          failedWorkOrderId: wo.id,
          failureSummary: `${CANARY} earth bond failure`,
          placedById: james,
        },
      })
    ).id;
    c.session = (
      await owner.troubleshootingSession.create({
        data: {
          organizationId: coastal.id,
          number: "TS-2026-09999",
          assetId: vent.id,
          workOrderId: wo.id,
          hospitalId: vent.hospitalId,
          departmentId: vent.departmentId,
          faultDescription: `${CANARY} troubleshooting fault`,
          startedById: james,
        },
      })
    ).id;
    c.purchase = (
      await owner.purchaseRequest.create({
        data: {
          organizationId: coastal.id,
          number: "PR-2026-9999",
          hospitalId: rgh.id,
          justification: `${CANARY} purchase`,
          requestedById: james,
        },
      })
    ).id;
    c.snapshot = (
      await owner.reportSnapshot.create({
        data: {
          organizationId: coastal.id,
          kind: "OVERVIEW",
          periodFrom: new Date("2026-09-01"),
          periodTo: new Date("2026-09-30"),
          periodKey: `canary-${randomUUID().slice(0, 8)}`,
          data: { note: CANARY },
          generatedById: james,
        },
      })
    ).id;
    const hWo = await owner.workOrder.findFirstOrThrow({ where: { organizationId: highland.id } });
    Object.assign(h, { workOrder: hWo.id, asset: hWo.assetId });

    sara = await signIn("sara.nakato@highland.example");
    amina = await signIn("amina.warsame@coastal.example");
    david = await signInWithMfa("david.mutua@highland.example");
  });

  const pages = () => [
    `/assets/${c.asset}`,
    `/assets/${c.asset}/edit`,
    `/work-orders/${c.workOrder}`,
    `/work-orders/${c.workOrder}/print`,
    `/work-orders/${c.workOrder}/photos/${c.photo}`,
    `/maintenance/plans/${c.plan}`,
    `/maintenance/plans/${c.plan}/edit`,
    `/maintenance/holds/${c.hold}`,
    `/inventory/parts/${c.part}`,
    `/inventory/parts/${c.part}/edit`,
    `/inventory/purchasing/${c.purchase}`,
    `/suppliers/${c.supplier}`,
    `/suppliers/${c.supplier}/edit`,
    `/knowledge/${c.document}`,
    `/knowledge/${c.document}/edit`,
    `/knowledge/files/${c.version}`,
    `/knowledge/files/${c.version}?download=1`,
    `/assist/${c.session}`,
    `/reports/scheduled/${c.snapshot}`,
  ];

  it("direct links to another organisation's records are 'not found' for an administrator and a technician", async () => {
    const failures: string[] = [];
    for (const [who, jar] of [
      ["david", david],
      ["sara", sara],
    ] as const) {
      for (const path of pages()) {
        const r = await get(path, jar);
        const leaked = leaks(r.body);
        if (r.status !== 404 || leaked.length) failures.push(`${who} ${path} → ${r.status} ${leaked.join(",")}`);
      }
    }
    expect(failures).toEqual([]);
  });

  it("another organisation's ids in query parameters, filters and barcode look-ups reveal nothing", async () => {
    const probes = [
      `/assets/labels?id=${c.asset}`,
      `/assist/new?asset=${c.asset}`,
      `/assist/new?asset=${h.asset}&workOrder=${c.workOrder}`,
      `/work-orders/new?asset=${c.asset}`,
      `/inventory/purchasing/new?part=${c.part}`,
      `/knowledge?model=${c.model}`,
      `/assets?hospital=${c.hospital}`,
      `/assets/scan?code=VEN-0001`,
      `/inventory?code=BAT-0001`,
      `/assist?asset=${c.asset}`,
    ];
    const failures: string[] = [];
    for (const path of probes) {
      const r = await get(path, david);
      const leaked = leaks(r.body);
      if (r.status >= 500 || leaked.length) failures.push(`${path} → ${r.status} ${leaked.join(",")}`);
    }
    expect(failures).toEqual([]);
  });

  it("exports contain only the signed-in organisation's records", async () => {
    for (const path of [
      "/assets/export",
      "/reports/export?report=work-orders&period=last_12_months",
      "/maintenance/reports/export",
    ]) {
      const r = await get(path, david);
      expect(r.status, path).toBeLessThan(500);
      expect(leaks(r.body), path).toEqual([]);
    }
  });

  it("uploading a new version to another organisation's document is refused and saves nothing", async () => {
    const before = await owner.knowledgeVersion.count({ where: { documentId: c.document } });
    const form = new FormData();
    form.set("body", "# Injected\nShould never be stored.");
    const res = await fetch(`${BASE}/knowledge/${c.document}/versions`, {
      method: "POST",
      body: form,
      headers: { cookie: david, origin: BASE! },
    });
    expect([403, 404]).toContain(res.status);
    expect(await owner.knowledgeVersion.count({ where: { documentId: c.document } })).toBe(before);
    const photo = new FormData();
    photo.set("photos", new Blob([Buffer.from("not really an image")], { type: "image/png" }), "x.png");
    const p = await fetch(`${BASE}/work-orders/${c.workOrder}/photos`, {
      method: "POST",
      body: photo,
      headers: { cookie: david, origin: BASE! },
    });
    expect([400, 403, 404, 422]).toContain(p.status);
    expect(await owner.attachment.count({ where: { workOrderId: c.workOrder } })).toBe(1);
  });

  it("the reverse direction is isolated too (Coastal technician → Highland records)", async () => {
    for (const path of [`/work-orders/${h.workOrder}`, `/assets/${h.asset}`]) {
      expect((await get(path, amina)).status, path).toBe(404);
    }
  });

  it("an organisation cookie naming another organisation is ignored", async () => {
    const coastal = await owner.organization.findUniqueOrThrow({ where: { slug: "coastal-health" } });
    const r = await get(`/assets/${c.asset}`, `${sara}; bi_org=${coastal.id}`);
    expect(r.status).toBe(404);
    const list = await get("/assets", `${sara}; bi_org=${coastal.id}`);
    expect(leaks(list.body)).toEqual([]);
    expect(list.body).toContain("Summit Regional"); // still Highland's own list
  });
});
