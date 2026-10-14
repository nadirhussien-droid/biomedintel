// The permission matrix and small helpers, without a database.
import { describe, expect, it } from "vitest";
import { PERMISSIONS, roleCan, type Action } from "@/server/authz/permissions";
import { MEMBERSHIP_ROLES, roleRequiresMfa } from "@/server/authz/roles";
import { sanitizeMetadata } from "@/server/audit/audit";
import { addMemberSchema, createHospitalSchema } from "@/lib/validation/admin";

const WRITE_ACTIONS: Action[] = [
  "hospital.create",
  "hospital.archive",
  "department.create",
  "department.archive",
  "member.add",
  "member.changeRole",
];

describe("permission matrix", () => {
  it("only Organization Administrators may change organisation structure or members", () => {
    for (const action of WRITE_ACTIONS) {
      expect([...PERMISSIONS[action]]).toEqual(["ORG_ADMIN"]);
    }
  });

  it("read-only auditors have no write permission at all", () => {
    for (const action of WRITE_ACTIONS) expect(roleCan("AUDITOR", action)).toBe(false);
    expect(roleCan("AUDITOR", "audit.view")).toBe(true);
  });

  it("fault reporters can only see the dashboard and their hospitals", () => {
    const allowed = (Object.keys(PERMISSIONS) as Action[]).filter((a) => roleCan("FAULT_REPORTER", a));
    expect(allowed.sort()).toEqual(["dashboard.view", "hospital.view"]);
  });

  it("denies unknown actions by default", () => {
    expect(roleCan("ORG_ADMIN", "asset.delete" as Action)).toBe(false);
  });

  it("every role can open the dashboard", () => {
    for (const role of MEMBERSHIP_ROLES) expect(roleCan(role, "dashboard.view")).toBe(true);
  });

  it("MFA is required for platform admins, organisation admins and engineering managers only", () => {
    expect(roleRequiresMfa(null, true)).toBe(true);
    expect(roleRequiresMfa("ORG_ADMIN", false)).toBe(true);
    expect(roleRequiresMfa("ENGINEERING_MANAGER", false)).toBe(true);
    for (const role of ["TECHNICIAN", "INVENTORY_MANAGER", "DEPARTMENT_HEAD", "AUDITOR", "FAULT_REPORTER"] as const) {
      expect(roleRequiresMfa(role, false)).toBe(false);
    }
  });
});

describe("audit metadata sanitising", () => {
  it("redacts secrets even when a developer passes them by mistake", () => {
    const out = sanitizeMetadata({ name: "ICU", password: "x", nested: { apiKey: "k", sessionToken: "t" } }) as Record<
      string,
      unknown
    >;
    expect(out).toEqual({
      name: "ICU",
      password: "[redacted]",
      nested: { apiKey: "[redacted]", sessionToken: "[redacted]" },
    });
  });
});

describe("validation schemas", () => {
  it("normalises codes and rejects unknown time zones", () => {
    expect(createHospitalSchema.parse({ name: "Riverside", code: " rgh ", timezone: "Africa/Nairobi" }).code).toBe(
      "RGH",
    );
    expect(createHospitalSchema.safeParse({ name: "Riverside", code: "RGH", timezone: "Nowhere/Fake" }).success).toBe(
      false,
    );
  });

  it("requires Organization Administrators to cover the whole organisation", () => {
    const r = addMemberSchema.safeParse({
      email: "a@b.example",
      name: "Ab Cd",
      role: "ORG_ADMIN",
      orgWide: false,
      hospitalId: null,
      departmentId: null,
    });
    expect(r.success).toBe(false);
  });
});
