// The Help panel's content: every page and role gets help, the right topic
// wins, bold text is never HTML, and every **bold** name in the help is a word
// that really appears on the app's screens (so help cannot drift from the UI).
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { boldParts, helpFor, HELP_TOPICS, type HelpRole } from "@/lib/help/topics";

const ROLES: HelpRole[] = [
  "ORG_ADMIN",
  "ENGINEERING_MANAGER",
  "TECHNICIAN",
  "INVENTORY_MANAGER",
  "DEPARTMENT_HEAD",
  "AUDITOR",
  "FAULT_REPORTER",
];
const UUID = "0f3c2a9e-1b2c-4d5e-8f90-123456789abc";

function sourceText(): string {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.(tsx|ts)$/.test(e.name) && !p.includes(`${path.sep}help${path.sep}topics`))
        out.push(fs.readFileSync(p, "utf8"));
    }
  };
  for (const d of ["app", "components", "lib/validation"]) walk(path.join(process.cwd(), d));
  return out.join("\n").toLowerCase();
}

describe("help topics", () => {
  it("picks the topic written for the role on each page", () => {
    expect(helpFor(`/work-orders/${UUID}`, "TECHNICIAN").id).toBe("job-technician");
    expect(helpFor(`/work-orders/${UUID}`, "ENGINEERING_MANAGER").id).toBe("job-manager");
    expect(helpFor(`/work-orders/${UUID}`, "FAULT_REPORTER").id).toBe("job-follow");
    expect(helpFor("/work-orders/new", "FAULT_REPORTER").id).toBe("report-fault");
    expect(helpFor("/work-orders", "TECHNICIAN").id).toBe("jobs-list");
    expect(helpFor("/assets/new", "TECHNICIAN").id).toBe("asset-new");
    expect(helpFor(`/assets/${UUID}`, "AUDITOR").id).toBe("asset-register");
    expect(helpFor("/maintenance/plans/new", "ENGINEERING_MANAGER").id).toBe("plan-form");
    expect(helpFor(`/maintenance/plans/${UUID}/edit`, "ORG_ADMIN").id).toBe("plan-form");
    expect(helpFor(`/maintenance/plans/${UUID}`, "ENGINEERING_MANAGER").id).toBe("plan-detail");
    expect(helpFor(`/maintenance/plans/${UUID}`, "AUDITOR").id).toBe("maintenance");
    expect(helpFor("/maintenance/holds", "TECHNICIAN").id).toBe("safety-holds");
    expect(helpFor("/reports/work-orders?period=this_month", "AUDITOR").id).toBe("reports");
    expect(helpFor("/admin", "ORG_ADMIN").id).toBe("admin");
    expect(helpFor("/admin", "AUDITOR").id).toBe("general");
    expect(helpFor("/notifications", "TECHNICIAN").id).toBe("general");
  });

  it("every role gets help on every page, never an empty panel", () => {
    const pages = [
      "/dashboard",
      "/work-orders",
      `/work-orders/${UUID}`,
      "/assets",
      "/maintenance",
      "/reports",
      "/inventory",
      "/x",
    ];
    for (const role of ROLES) for (const p of pages) expect(helpFor(p, role).steps.length).toBeGreaterThan(0);
  });

  it("steps are short and their bold markers are balanced", () => {
    for (const t of HELP_TOPICS) {
      expect(t.steps.length).toBeGreaterThanOrEqual(3);
      expect(t.steps.length).toBeLessThanOrEqual(6);
      for (const s of t.steps) {
        expect((s.match(/\*\*/g) ?? []).length % 2).toBe(0);
        expect(s.length).toBeLessThan(220);
      }
    }
  });

  it("bold text is plain text, never markup", () => {
    expect(boldParts("Press **<b>x</b>** now")).toEqual([
      { text: "Press ", bold: false },
      { text: "<b>x</b>", bold: true },
      { text: " now", bold: false },
    ]);
  });

  it("every bold name in the help appears on the app's screens", () => {
    const src = sourceText();
    const missing: string[] = [];
    for (const t of HELP_TOPICS)
      for (const s of t.steps)
        for (const p of boldParts(s).filter((x) => x.bold))
          if (!src.includes(p.text.toLowerCase())) missing.push(`${t.id}: ${p.text}`);
    expect(missing).toEqual([]);
  });
});
