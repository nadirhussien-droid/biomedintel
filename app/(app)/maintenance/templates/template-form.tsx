"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { useKeepValuesSubmit } from "@/components/forms/use-keep-values";
import { InputField } from "@/components/ui/field";
import type { ChecklistItem } from "@/lib/validation/pm";
import { ChecklistEditor, type PickableTemplate } from "../plans/plan-form";
import { err, Feedback, textarea } from "../forms";
import { createTemplateAction, updateTemplateAction } from "./actions";

const STARTER: ChecklistItem[] = [
  {
    key: "insp_1",
    label: "Enclosure, controls and labels undamaged",
    section: "INSPECTION",
    kind: "CHECK",
    required: true,
    unit: null,
    min: null,
    max: null,
    guidance: null,
  },
];

export function TemplateForm({
  defaults,
  templates,
}: {
  defaults: { id?: string; name: string; deviceType: string; description: string; checklist: ChecklistItem[] };
  templates: { label: string; list: PickableTemplate[] }[];
}) {
  const editing = Boolean(defaults.id);
  const [state, formAction, pending] = useActionState(editing ? updateTemplateAction : createTemplateAction, null);
  const { formRef, onSubmit } = useKeepValuesSubmit(formAction, state, { resetOnSuccess: false });
  const [items, setItems] = useState<ChecklistItem[]>(defaults.checklist.length ? defaults.checklist : STARTER);
  return (
    <form ref={formRef} onSubmit={onSubmit} className="flex flex-col gap-5" noValidate>
      {defaults.id ? <input type="hidden" name="id" value={defaults.id} /> : null}
      <input
        type="hidden"
        name="checklist"
        value={JSON.stringify(items.map((i) => ({ ...i, label: i.label.trim() })))}
      />
      <div className="grid gap-3 md:grid-cols-2">
        <InputField
          label="Template name"
          name="name"
          defaultValue={defaults.name}
          maxLength={120}
          required
          placeholder="e.g. Mindray BeneView monitor, annual safety test"
          error={err(state, "name")}
        />
        <InputField
          label="Type of device (optional)"
          name="deviceType"
          defaultValue={defaults.deviceType}
          maxLength={120}
          placeholder="e.g. Patient monitor"
          error={err(state, "deviceType")}
        />
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor="template-description" className="text-sm font-semibold">
          Notes (optional)
        </label>
        <textarea
          id="template-description"
          name="description"
          defaultValue={defaults.description}
          rows={2}
          maxLength={1000}
          className={textarea}
          placeholder="Where the limits come from, for example the manufacturer service manual and revision."
        />
        {err(state, "description") ? (
          <p className="text-danger text-xs font-medium">{err(state, "description")?.join(" ")}</p>
        ) : null}
      </div>
      <ChecklistEditor
        items={items}
        setItems={setItems}
        templates={templates}
        error={
          err(state, "checklist") ??
          (state && !state.ok
            ? Object.entries(state.fieldErrors ?? {})
                .filter(([k]) => k.startsWith("checklist."))
                .flatMap(([, v]) => v)
            : undefined)
        }
      />
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : editing ? "Save changes" : "Save template"}
        </Button>
        <span className="text-ink-muted text-sm">
          A template creates no work. It only fills in the checklist when you make a plan, and the plan still needs
          approval.
        </span>
      </div>
      <Feedback state={state} />
    </form>
  );
}
