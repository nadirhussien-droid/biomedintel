// Stage 10: log redaction, migration safety check, client IP and
// production configuration rules.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { describeError, redact, redactText } from "@/server/log";
import { scanMigrations, unreviewed } from "@/scripts/lib/migration-safety";
import { clientIp } from "@/server/request-ip";
import { isLocalHost } from "@/scripts/lib/admin-db";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("structured logs never contain secrets", () => {
  it("removes secret-looking fields at any depth", () => {
    const out = redact({
      password: "Test-only-password-123",
      nested: { apiKey: "abc", sessionToken: "t", cookie: "c", totp: "123456", ok: "kept" },
      list: [{ authorization: "Bearer x" }],
    }) as Record<string, unknown>;
    const text = JSON.stringify(out);
    expect(text).not.toContain("Test-only-password-123");
    expect(text).not.toContain("123456");
    expect(text).toContain("kept");
    expect(text.match(/\[redacted\]/g)?.length).toBe(6);
  });

  it("removes API keys, bearer tokens, reset links and database passwords inside text", () => {
    const text = redactText(
      "key sk-ant-api03-ABCDEFGH12345678 auth Bearer abcdefghijklmnop url /reset-password?token=XYZ123&x=1 db postgresql://biomedintel_app:supersecret@host/db",
    );
    expect(text).not.toContain("ABCDEFGH12345678");
    expect(text).not.toContain("abcdefghijklmnop");
    expect(text).not.toContain("XYZ123");
    expect(text).not.toContain("supersecret");
    expect(text).toContain("x=1");
  });

  it("describes errors safely and cuts long values", () => {
    const e = Object.assign(new Error(`failed for sk-ant-SECRETSECRET ${"x".repeat(5000)}`), { code: "P2002" });
    const d = describeError(e);
    expect(d.errorCode).toBe("P2002");
    expect(String(d.errorMessage)).not.toContain("SECRETSECRET");
    expect(String(d.errorMessage).length).toBeLessThanOrEqual(2001);
  });
});

describe("migration safety check", () => {
  function tempMigrations(files: Record<string, string>, reviewed?: object) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bi-mig-"));
    for (const [name, sql] of Object.entries(files)) {
      fs.mkdirSync(path.join(dir, name));
      fs.writeFileSync(path.join(dir, name, "migration.sql"), sql);
    }
    if (reviewed) fs.writeFileSync(path.join(dir, "reviewed-destructive.json"), JSON.stringify(reviewed));
    return dir;
  }

  it("flags data loss and weakened protections, ignoring comments and function bodies", () => {
    const dir = tempMigrations({
      "1_safe": `-- DROP TABLE "x" is only a comment\nCREATE TABLE "a" ("id" int);\nCREATE FUNCTION f() RETURNS trigger LANGUAGE plpgsql AS $$\nBEGIN\n  DELETE FROM "a";\nEND $$;`,
      "2_bad": `ALTER TABLE "assets" DROP COLUMN "serial_number";\nALTER TABLE "assets" NO FORCE ROW LEVEL SECURITY;\nTRUNCATE "work_orders";`,
    });
    const found = scanMigrations(dir);
    expect(found.map((f) => f.migration)).toEqual(["2_bad", "2_bad", "2_bad"]);
    expect(found.map((f) => f.kind)).toEqual(["DATA_LOSS", "WEAKENS_PROTECTION", "DATA_LOSS"]);
    expect(unreviewed(dir)).toHaveLength(3);
    const ok = tempMigrations(
      { "2_bad": `ALTER TABLE "assets" DROP COLUMN "x";` },
      { "2_bad": { reason: "test", approvedBy: "test", date: "2026-10-16" } },
    );
    expect(unreviewed(ok)).toHaveLength(0);
  });

  it("the project's own migrations have no unreviewed destructive statements", () => {
    expect(unreviewed(path.join(process.cwd(), "prisma/migrations"))).toEqual([]);
  });
});

describe("client IP and database hosts", () => {
  it("reads only the configured proxy header, first address, and never trusts others", () => {
    vi.stubEnv("TRUSTED_IP_HEADER", "x-real-ip");
    expect(clientIp(new Headers({ "x-forwarded-for": "1.1.1.1", "x-real-ip": "2.2.2.2" }))).toBe("2.2.2.2");
    vi.stubEnv("TRUSTED_IP_HEADER", "");
    expect(clientIp(new Headers({ "x-forwarded-for": "3.3.3.3, 10.0.0.1" }))).toBe("3.3.3.3");
    expect(clientIp(new Headers())).toBeNull();
  });

  it("treats only this computer as a local database host", () => {
    expect(isLocalHost("localhost")).toBe(true);
    expect(isLocalHost("")).toBe(true);
    expect(isLocalHost("dpg-abc123.oregon-postgres.render.com")).toBe(false);
    expect(isLocalHost("db.example.com")).toBe(false);
  });
});

describe("production configuration", () => {
  const base = {
    DATABASE_URL: "postgresql://u:p@localhost:5432/x",
    BETTER_AUTH_SECRET: "a-real-secret-that-is-long-enough-1234567890",
    BETTER_AUTH_URL: "https://staging.example.com",
  };

  it("refuses to start in production with MFA for privileged roles switched off", async () => {
    for (const [k, v] of Object.entries(base)) vi.stubEnv(k, v);
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("REQUIRE_MFA_FOR_PRIVILEGED_ROLES", "false");
    const { serverEnv } = await import("@/server/env");
    expect(() => serverEnv()).toThrow(/not allowed in production/);
  });

  it("refuses the placeholder secret in production, and accepts a proper configuration", async () => {
    for (const [k, v] of Object.entries(base)) vi.stubEnv(k, v);
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("REQUIRE_MFA_FOR_PRIVILEGED_ROLES", "true");
    vi.stubEnv("BETTER_AUTH_SECRET", "CHANGE_ME_TO_A_LONG_RANDOM_VALUE_xxxxxxxx");
    await expect((async () => (await import("@/server/env")).serverEnv())()).rejects.toThrow(/placeholder/);
    vi.resetModules();
    vi.stubEnv("BETTER_AUTH_SECRET", base.BETTER_AUTH_SECRET);
    const { serverEnv } = await import("@/server/env");
    expect(serverEnv().REQUIRE_MFA_FOR_PRIVILEGED_ROLES).toBe(true);
  });
});

describe("published permissions matrix", () => {
  it("docs/PERMISSIONS.md matches the permissions the code enforces (run npm run docs:permissions)", async () => {
    const { permissionsMarkdown } = await import("@/scripts/lib/permissions-matrix");
    expect(fs.readFileSync(path.join(process.cwd(), "docs/PERMISSIONS.md"), "utf8")).toBe(permissionsMarkdown());
  });
});

// Stage 10 fix: a long document cut short by the passage limit must say so.
import { MAX_CHUNKS, passageLimitNote, toPassages } from "@/server/knowledge/extract";
import { scramVerifier } from "@/scripts/db/create-app-role";

describe("knowledge passage limit is reported, never silent", () => {
  const words = (n: number) => Array.from({ length: n }, (_, i) => `word${i}`).join(" ");
  it("gives no note when the whole document fits", () => {
    expect(passageLimitNote(toPassages([{ page: 1, heading: null, text: words(500) }]))).toBeNull();
  });
  it("names the last searchable page when the limit is reached", () => {
    const pages = Array.from({ length: 1500 }, (_, i) => ({ page: i + 1, heading: null, text: words(600) }));
    const passages = toPassages(pages);
    expect(passages).toHaveLength(MAX_CHUNKS);
    const last = passages[passages.length - 1].pageTo;
    expect(last).toBeLessThan(1500);
    expect(passageLimitNote(passages)).toContain(`pages 1–${last}`);
    expect(passageLimitNote(passages)).toContain("not searched");
  });
});

describe("database password for the app user is sent as a SCRAM verifier", () => {
  it("has PostgreSQL's SCRAM-SHA-256 format and never contains the password", () => {
    const v = scramVerifier("abcdefghijklmnopqrstuvwx1234");
    expect(v).toMatch(/^SCRAM-SHA-256\$4096:[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]{44}:[A-Za-z0-9+/=]{44}$/);
    expect(v).not.toContain("abcdefghijklmnopqrstuvwx1234");
    expect(scramVerifier("same-password-123456789012")).not.toBe(scramVerifier("same-password-123456789012")); // random salt
  });
});
