// Knowledge base and IntellAssist over HTTP against a RUNNING server (Stage 9).
// Skipped unless E2E_BASE_URL (and E2E_PASSWORD) is set. Uses the fictional
// seeded "DM-Infuse 100 troubleshooting guide (fictional demo)".
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { owner } from "../helpers";
import { buildDemoPdf } from "@/scripts/lib/demo-pdf";

const BASE = process.env.E2E_BASE_URL;
const PASSWORD = process.env.E2E_PASSWORD;
const SEEDED = "DM-Infuse 100 troubleshooting guide (fictional demo)";

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

describe.skipIf(!BASE)("knowledge and IntellAssist, signed out", () => {
  it.each([
    "/knowledge",
    "/knowledge/new",
    "/assist",
    "/assist/settings",
    "/knowledge/files/00000000-0000-4000-8000-000000000000",
  ])("%s sends a visitor to sign-in", async (path) => {
    const res = await fetch(`${BASE}${path}`, { redirect: "manual" });
    expect([302, 303, 307, 308]).toContain(res.status);
    expect(new URL(res.headers.get("location")!, BASE).pathname).toBe("/sign-in");
  });

  it("the upload route sends a signed-out visitor to sign-in without saving anything", async () => {
    const body = new FormData();
    body.set("title", "Signed-out upload attempt");
    const res = await fetch(`${BASE}/knowledge/upload`, {
      method: "POST",
      body,
      redirect: "manual",
      headers: { origin: BASE! },
    });
    expect([302, 303, 307, 308]).toContain(res.status);
    expect(await owner.knowledgeDocument.count({ where: { title: "Signed-out upload attempt" } })).toBe(0);
  });
});

describe.skipIf(!BASE || !PASSWORD)("knowledge and IntellAssist, signed in", () => {
  let amina = ""; // Technician
  let fatuma = ""; // Auditor
  let lucy = ""; // Fault Reporter
  let peter = ""; // Department Head
  let versionId = "";
  let documentId = "";
  let otherVersionId = "";
  beforeAll(async () => {
    amina = await signIn("amina.warsame@coastal.example");
    fatuma = await signIn("fatuma.hassan@coastal.example");
    lucy = await signIn("lucy.achieng@coastal.example");
    peter = await signIn("peter.kamau@coastal.example");
    const doc = await owner.knowledgeDocument.findFirstOrThrow({ where: { title: SEEDED } });
    documentId = doc.id;
    versionId = doc.currentVersionId!;
    // A document in ANOTHER organisation (fictional), to test isolation.
    const highland = await owner.organization.findUniqueOrThrow({ where: { slug: "highland-medical" } });
    const someone = await owner.membership.findFirstOrThrow({ where: { organizationId: highland.id } });
    const existing = await owner.knowledgeDocument.findFirst({
      where: { organizationId: highland.id, title: "Highland only note (demo)" },
    });
    if (existing) otherVersionId = existing.currentVersionId!;
    else {
      const d = await owner.knowledgeDocument.create({
        data: {
          organizationId: highland.id,
          title: "Highland only note (demo)",
          docType: "ENGINEERING_NOTE",
          createdById: someone.userId,
          updatedById: someone.userId,
        },
      });
      const bytes = Buffer.from("Highland secret note (demo)");
      const v = await owner.knowledgeVersion.create({
        data: {
          organizationId: highland.id,
          documentId: d.id,
          versionNo: 1,
          filename: "note.txt",
          mime: "text/plain",
          sizeBytes: bytes.length,
          sha256: "0".repeat(64),
          uploadedById: someone.userId,
        },
      });
      await owner.knowledgeFile.create({ data: { organizationId: highland.id, versionId: v.id, content: bytes } });
      await owner.knowledgeDocument.update({ where: { id: d.id }, data: { currentVersionId: v.id } });
      otherVersionId = v.id;
    }
  });

  it("a technician can search the knowledge base and find a documented error code", async () => {
    const list = await fetch(`${BASE}/knowledge`, { headers: { cookie: amina } });
    expect(list.status).toBe(200);
    const html = await list.text();
    expect(html).toContain(SEEDED);
    expect(html).not.toContain("Highland only note");
    const code = await (await fetch(`${BASE}/knowledge?code=p-110`, { headers: { cookie: amina } })).text();
    expect(code).toContain("P-110");
    expect(code).toContain("Downstream occlusion");
    const text = await (
      await fetch(`${BASE}/knowledge?q=occlusion+pressure+sensor`, { headers: { cookie: amina } })
    ).text();
    expect(text).toMatch(/Open page (<!-- -->)?2/);
    expect((await fetch(`${BASE}/knowledge/${documentId}`, { headers: { cookie: amina } })).status).toBe(200);
  });

  it("opening a file is served safely and audited", async () => {
    const before = await owner.auditLog.count({ where: { action: "knowledge.file_opened", entityId: documentId } });
    const res = await fetch(`${BASE}/knowledge/files/${versionId}`, { headers: { cookie: amina } });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/pdf");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("content-security-policy")).toBe("default-src 'none'; frame-ancestors 'none'");
    expect(res.headers.get("content-disposition")).toMatch(/^inline/);
    expect(
      Buffer.from(await res.arrayBuffer())
        .subarray(0, 5)
        .toString(),
    ).toBe("%PDF-");
    const dl = await fetch(`${BASE}/knowledge/files/${versionId}?download=1`, { headers: { cookie: amina } });
    expect(dl.headers.get("content-disposition")).toMatch(/^attachment/);
    await dl.arrayBuffer();
    const after = await owner.auditLog.count({ where: { action: "knowledge.file_opened", entityId: documentId } });
    expect(after).toBe(before + 1);
    expect(
      await owner.auditLog.count({ where: { action: "knowledge.file_downloaded", entityId: documentId } }),
    ).toBeGreaterThan(0);
  });

  it("another organisation's file is not found, and a malformed id is not found", async () => {
    expect((await fetch(`${BASE}/knowledge/files/${otherVersionId}`, { headers: { cookie: amina } })).status).toBe(404);
    expect((await fetch(`${BASE}/knowledge/files/not-a-uuid`, { headers: { cookie: amina } })).status).toBe(404);
  });

  it("roles without knowledge access are refused the pages and the files", async () => {
    for (const cookie of [lucy, peter]) {
      const page = await (await fetch(`${BASE}/knowledge`, { headers: { cookie } })).text();
      expect(page).toContain("does not include the technical knowledge base");
      expect(page).not.toContain(SEEDED);
      expect((await fetch(`${BASE}/knowledge/files/${versionId}`, { headers: { cookie } })).status).toBe(403);
      const assist = await (await fetch(`${BASE}/assist`, { headers: { cookie } })).text();
      expect(assist).toContain("does not include troubleshooting sessions");
    }
  });

  it("an auditor can read the knowledge base and AI usage but cannot upload or change the AI setting", async () => {
    expect((await fetch(`${BASE}/knowledge`, { headers: { cookie: fatuma } })).status).toBe(200);
    const settings = await (await fetch(`${BASE}/assist/settings`, { headers: { cookie: fatuma } })).text();
    expect(settings).toContain("Usage this month");
    expect(settings).toContain("Only an Organisation Administrator can change this");
    expect(settings).not.toMatch(/sk-ant|ANTHROPIC_API_KEY=/);
    const body = new FormData();
    body.set("title", "Auditor upload attempt");
    body.set("docType", "ENGINEERING_NOTE");
    body.set("accessLevel", "ENGINEERING");
    body.set("body", "# Note\nShould be refused.");
    const res = await fetch(`${BASE}/knowledge/upload`, {
      method: "POST",
      body,
      headers: { cookie: fatuma, origin: BASE! },
    });
    expect(res.status).toBe(403);
    expect(await owner.knowledgeDocument.count({ where: { title: "Auditor upload attempt" } })).toBe(0);
  });

  it("the upload route refuses a cross-site or origin-less request from a signed-in user", async () => {
    const body = new FormData();
    body.set("title", "Cross-site upload attempt");
    body.set("docType", "ENGINEERING_NOTE");
    body.set("accessLevel", "ENGINEERING");
    body.set("body", "# Note\nShould be refused.");
    expect((await fetch(`${BASE}/knowledge/upload`, { method: "POST", body, headers: { cookie: amina } })).status).toBe(
      403,
    );
    const evil = await fetch(`${BASE}/knowledge/upload`, {
      method: "POST",
      body,
      headers: { cookie: amina, origin: "https://evil.example" },
    });
    expect(evil.status).toBe(403);
    expect(await owner.knowledgeDocument.count({ where: { title: "Cross-site upload attempt" } })).toBe(0);
  });

  it("a technician's upload is saved as a draft and an executable file is refused", async () => {
    const good = new FormData();
    good.set("title", "E2E typed note (demo)");
    good.set("docType", "ENGINEERING_NOTE");
    good.set("accessLevel", "ENGINEERING");
    good.set("body", "# Check\nThe demo note text.");
    const res = await fetch(`${BASE}/knowledge/upload`, {
      method: "POST",
      body: good,
      headers: { cookie: amina, origin: BASE! },
    });
    expect(res.status).toBe(201);
    const json = (await res.json()) as { ok: boolean; id: string; index: string };
    expect(json.ok).toBe(true);
    expect(json.index).toBe("INDEXED");
    const saved = await owner.knowledgeDocument.findUniqueOrThrow({ where: { id: json.id } });
    expect(saved.reviewStatus).toBe("DRAFT");
    // Text is always served as sandboxed plain text, never as a web page.
    const file = await fetch(`${BASE}/knowledge/files/${saved.currentVersionId}`, { headers: { cookie: amina } });
    expect(file.headers.get("content-type")).toBe("text/plain; charset=utf-8");
    expect(file.headers.get("content-security-policy")).toContain("sandbox");
    expect(await file.text()).toContain("The demo note text.");

    const bad = new FormData();
    bad.set("title", "E2E executable (demo)");
    bad.set("docType", "ENGINEERING_NOTE");
    bad.set("accessLevel", "ENGINEERING");
    bad.set("file", new Blob([new Uint8Array([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00])]), "manual.pdf");
    const refused = await fetch(`${BASE}/knowledge/upload`, {
      method: "POST",
      body: bad,
      headers: { cookie: amina, origin: BASE! },
    });
    expect(refused.status).toBe(422);
    expect(await owner.knowledgeDocument.count({ where: { title: "E2E executable (demo)" } })).toBe(0);
  });

  it("a document larger than 10 MB (under the 20 MB limit) is accepted whole and fully searchable", async () => {
    // Stage 10 fix: the request proxy used to keep only the first 10 MB of the body.
    const pages = Array.from({ length: 1200 }, (_, p) => [
      `Fictional large manual (e2e) page ${p + 1}`,
      ...Array.from(
        { length: 48 },
        (_, l) => `Section ${p + 1}.${l}: fictional check of the demo pressure sensor ${"x".repeat(160)}`,
      ),
    ]);
    const pdf = buildDemoPdf(pages, "Fictional large manual (e2e)");
    expect(pdf.length).toBeGreaterThan(10 * 1024 * 1024);
    expect(pdf.length).toBeLessThan(20 * 1024 * 1024);
    const body = new FormData();
    body.set("title", "E2E large manual (demo)");
    body.set("docType", "SERVICE_MANUAL");
    body.set("accessLevel", "ENGINEERING");
    body.set("file", new Blob([Buffer.from(pdf)], { type: "application/pdf" }), "large.pdf");
    const res = await fetch(`${BASE}/knowledge/upload`, {
      method: "POST",
      body,
      headers: { cookie: amina, origin: BASE! },
    });
    expect(res.status).toBe(201);
    const json = (await res.json()) as { index: string; id: string };
    expect(json.index).toBe("INDEXED");
    const doc = await owner.knowledgeDocument.findUniqueOrThrow({ where: { id: json.id } });
    const v = await owner.knowledgeVersion.findUniqueOrThrow({ where: { id: doc.currentVersionId! } });
    expect(v.pageCount).toBe(1200);
    expect(v.sizeBytes).toBe(pdf.length);
    // Every page was read: the last page has passages and no cut-off note was needed
    // (the 4,000-passage cut-off note itself is covered in tests/unit/hardening.test.ts).
    expect(v.indexNote).toBeNull();
    const lastPage = await owner.knowledgeChunk.aggregate({ where: { versionId: v.id }, _max: { pageTo: true } });
    expect(lastPage._max.pageTo).toBe(1200);
  }, 120_000);

  it("a technician can open IntellAssist; AI is off by default and nothing leaks the key", async () => {
    const res = await fetch(`${BASE}/assist`, { headers: { cookie: amina } });
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("IntellAssist");
    expect(html).not.toMatch(/sk-ant/);
    // The technician cannot reach the AI setting.
    const s = await (await fetch(`${BASE}/assist/settings`, { headers: { cookie: amina } })).text();
    expect(s).toContain("does not include AI settings");
  });
});
