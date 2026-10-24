import { describe, expect, it } from "vitest";
import { TEST_TEMPLATES } from "@/lib/pm/test-templates";
import { checklistSchema, hasElectricalSafety } from "@/lib/validation/pm";

describe("checklist templates by equipment type", () => {
  it("each template is a valid checklist with electrical safety items", () => {
    for (const t of TEST_TEMPLATES) {
      expect(checklistSchema.safeParse(t.items).success, t.name).toBe(true);
      expect(hasElectricalSafety(t.items), t.name).toBe(true);
    }
  });

  it("ECG monitors and ventilators have different functional tests", () => {
    const keys = (id: string) => new Set(TEST_TEMPLATES.find((t) => t.id === id)!.items.map((i) => i.key));
    expect(keys("ventilator").has("func_vt")).toBe(true);
    expect(keys("ecg-monitor").has("func_vt")).toBe(false);
    expect(keys("ecg-monitor").has("func_nibp")).toBe(true);
    expect(keys("ventilator").has("func_nibp")).toBe(false);
  });

  it("only the two common electrical limits are pre-filled; every other limit is left for qualified staff", () => {
    for (const t of TEST_TEMPLATES)
      for (const i of t.items.filter((x) => x.kind === "MEASUREMENT" && (x.min !== null || x.max !== null)))
        expect(["es_pe", "es_leak"], `${t.name} ${i.key}`).toContain(i.key);
  });

  it("never generates measured values", () => {
    for (const t of TEST_TEMPLATES) for (const i of t.items) expect(Object.keys(i)).not.toContain("value");
  });
});
