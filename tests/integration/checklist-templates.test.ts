// Saved checklist templates (27 Oct 2026): create, edit, archive and restore your own templates,
// names stay unique, bad checklists are refused, only managers can change them, and they appear
// in the plan form picker next to the built-in starters.
import { afterAll, describe, expect, it } from "vitest";
import { AuthorizationError, ValidationError } from "@/server/authz/errors";
import { db } from "@/server/db/client";
import {
  createTemplate,
  getOwnTemplate,
  listOwnTemplates,
  setTemplateArchived,
  templateOptions,
  updateTemplate,
} from "@/server/services/checklist-templates";
import { planFormOptions } from "@/server/services/pm-plans";
import { TEST_TEMPLATES } from "@/lib/pm/test-templates";
import { auditCount, contextFor, owner } from "../helpers";

afterAll(async () => {
  await db.$disconnect();
  await owner.$disconnect();
});

const hodan = () => contextFor("hodan.ali@coastal.example", "coastal-health");
const highland = () => contextFor("david.mutua@highland.example");

const item = (key: string, label: string, extra: Record<string, unknown> = {}) => ({
  key,
  label,
  section: "FUNCTIONAL",
  kind: "CHECK",
  required: true,
  ...extra,
});
const unique = (p: string) => `${p} ${Date.now()}-${Math.floor(Math.random() * 1e5)}`;

describe("checklist templates", () => {
  it("saves, edits, archives and restores a template, with an audit trail", async () => {
    const ctx = await hodan();
    const name = unique("Monitor annual");
    const { id } = await createTemplate(ctx, {
      name,
      deviceType: "Patient monitor",
      description: "From service manual rev C",
      checklist: [
        item("a1", "Alarms work"),
        item("m1", "Heart rate", { kind: "MEASUREMENT", unit: "bpm", min: 55, max: 65 }),
      ],
    });
    const saved = await getOwnTemplate(ctx, id);
    expect(saved.name).toBe(name);
    expect(saved.items).toHaveLength(2);
    expect(saved.items[1].max).toBe(65);

    await updateTemplate(ctx, id, {
      name,
      deviceType: "Patient monitor",
      description: null,
      checklist: [item("a1", "Alarms work")],
    });
    expect((await getOwnTemplate(ctx, id)).items).toHaveLength(1);

    await setTemplateArchived(ctx, id, true);
    expect((await listOwnTemplates(ctx)).find((t) => t.id === id)?.status).toBe("ARCHIVED");
    expect((await templateOptions(ctx)).own.some((t) => t.id === id)).toBe(false);
    await expect(
      updateTemplate(ctx, id, { name, deviceType: null, description: null, checklist: [item("a1", "Alarms work")] }),
    ).rejects.toBeInstanceOf(ValidationError);

    await setTemplateArchived(ctx, id, false);
    expect((await templateOptions(ctx)).own.some((t) => t.id === id)).toBe(true);
    for (const a of ["pm.template_created", "pm.template_updated", "pm.template_archived", "pm.template_restored"])
      expect(await auditCount({ action: a, actorUserId: ctx.user.id }), a).toBeGreaterThan(0);
  });

  it("refuses duplicate names (any capitals) and invalid checklists", async () => {
    const ctx = await hodan();
    const name = unique("Duplicate test");
    await createTemplate(ctx, { name, checklist: [item("a1", "Alarms work")] });
    await expect(
      createTemplate(ctx, { name: name.toUpperCase(), checklist: [item("a1", "Alarms work")] }),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(createTemplate(ctx, { name: unique("Empty"), checklist: [] })).rejects.toBeInstanceOf(ValidationError);
    await expect(
      createTemplate(ctx, {
        name: unique("Bad limits"),
        checklist: [item("m1", "Pressure", { kind: "MEASUREMENT", unit: "mmHg", min: 9, max: 1 })],
      }),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(createTemplate(ctx, { name: "ab", checklist: [item("a1", "Alarms work")] })).rejects.toBeInstanceOf(
      ValidationError,
    );
  });

  it("only managers can change templates, and each organisation sees only its own", async () => {
    const tech = await contextFor("amina.warsame@coastal.example", "coastal-health");
    await expect(
      createTemplate(tech, { name: unique("Tech try"), checklist: [item("a1", "x1x")] }),
    ).rejects.toBeInstanceOf(AuthorizationError);
    const ctx = await hodan();
    const { id } = await createTemplate(ctx, { name: unique("Coastal only"), checklist: [item("a1", "Alarms work")] });
    await expect(setTemplateArchived(tech, id, true)).rejects.toBeInstanceOf(AuthorizationError);
    // a technician can read the list (to use templates), another organisation cannot see it
    expect((await listOwnTemplates(tech)).some((t) => t.id === id)).toBe(true);
    expect((await listOwnTemplates(await highland())).some((t) => t.id === id)).toBe(false);
    await expect(getOwnTemplate(await highland(), id)).rejects.toThrow();
  });

  it("shows saved templates beside the starters in the plan form", async () => {
    const ctx = await hodan();
    const name = unique("Picker test");
    await createTemplate(ctx, { name, checklist: [item("a1", "Alarms work")] });
    const options = await planFormOptions(ctx);
    const groups = options.templates ?? [];
    expect(groups.find((g) => g.label === "Starter templates")?.list.length).toBe(TEST_TEMPLATES.length);
    expect(groups.find((g) => g.label === "Your saved templates")?.list.some((t) => t.name === name)).toBe(true);
  });
});
