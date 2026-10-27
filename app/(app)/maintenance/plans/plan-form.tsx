"use client";

import { useActionState, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { useKeepValuesSubmit } from "@/components/forms/use-keep-values";
import { FieldShell, InputField, SelectField } from "@/components/ui/field";
import { intervalLabel, type IntervalUnitValue } from "@/lib/pm/dates";
import { TEST_TEMPLATES } from "@/lib/pm/test-templates";
import {
  CHECKLIST_SECTIONS,
  INTERVAL_PRESETS,
  INTERVAL_SOURCE_LABELS,
  INTERVAL_SOURCES,
  INTERVAL_UNIT_LABELS,
  INTERVAL_UNITS,
  PLAN_WORK_TYPES,
  SECTION_LABELS,
  TARGET_KINDS,
  TARGET_LABELS,
  WORK_TYPE_LABELS,
  type ChecklistItem,
} from "@/lib/validation/pm";
import { PRIORITIES, PRIORITY_LABELS } from "@/lib/validation/work-orders";
import { createPlanAction, updatePlanAction } from "../actions";
import { err, Feedback, textarea } from "../forms";

type Model = {
  id: string;
  modelName: string;
  manufacturer: { name: string };
  category: { name: string };
  manufacturerPmIntervalCount: number | null;
  manufacturerPmIntervalUnit: string | null;
  manufacturerPmReference: string | null;
};

export type PlanFormOptions = {
  hospitals: { id: string; code: string; name: string }[];
  orgWide: boolean;
  models: Model[];
  categories: { id: string; name: string; defaultPmIntervalMonths: number | null }[];
  departments: { id: string; name: string; hospitalId: string }[];
  assets: { id: string; assetTag: string; name: string; hospitalId: string }[];
  assignees: { userId: string; name: string; role: string }[];
  templates?: { label: string; list: PickableTemplate[] }[];
};

export type PlanDefaults = {
  id?: string;
  name: string;
  description: string;
  hospitalId: string;
  workType: string;
  targetKind: string;
  targetId: string;
  intervalCount: number;
  intervalUnit: string;
  intervalSource: string;
  sourceReference: string;
  justification: string;
  startsOn: string;
  endsOn: string;
  leadDays: number;
  graceDays: number;
  estimatedMinutes: string;
  defaultAssigneeId: string;
  requiredCompetency: string;
  priority: string;
  documentReference: string;
  instructions: string;
  checklist: ChecklistItem[];
  /** After approval the type and target are fixed. */
  locked?: boolean;
};

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
  {
    key: "func_1",
    label: "Functional test as per manufacturer procedure",
    section: "FUNCTIONAL",
    kind: "CHECK",
    required: true,
    unit: null,
    min: null,
    max: null,
    guidance: null,
  },
];

let counter = 0;
const newKey = (section: string) =>
  `${section.slice(0, 4).toLowerCase()}_${Date.now().toString(36)}${(counter++).toString(36)}`;

export type PickableTemplate = { id: string; name: string; description: string; items: ChecklistItem[] };

export function ChecklistEditor({
  items,
  setItems,
  error,
  templates,
}: {
  items: ChecklistItem[];
  setItems: (i: ChecklistItem[]) => void;
  error?: string[];
  /** Built-in starters and the organisation's saved templates. Defaults to the built-in starters. */
  templates?: { label: string; list: PickableTemplate[] }[];
}) {
  const groups = templates ?? [{ label: "Starter templates", list: TEST_TEMPLATES }];
  const all = groups.flatMap((g) => g.list);
  const update = (i: number, patch: Partial<ChecklistItem>) =>
    setItems(items.map((it, k) => (k === i ? { ...it, ...patch } : it)));
  const move = (i: number, d: number) => {
    const j = i + d;
    if (j < 0 || j >= items.length) return;
    const next = [...items];
    [next[i], next[j]] = [next[j], next[i]];
    setItems(next);
  };
  const num = (v: string) => (v.trim() === "" ? null : Number(v));
  const [template, setTemplate] = useState("");
  return (
    <fieldset className="flex flex-col gap-3">
      <legend className="text-sm font-semibold">Checklist</legend>
      <div className="bg-surface flex flex-wrap items-end gap-2 rounded-md p-3">
        <div className="flex min-w-60 flex-1 flex-col gap-1">
          <label htmlFor="template-pick" className="text-sm font-semibold">
            Start from a template for this type of equipment
          </label>
          <select
            id="template-pick"
            value={template}
            onChange={(e) => setTemplate(e.target.value)}
            className="border-line-strong text-ink min-h-11 rounded-sm border bg-white px-3 text-sm"
          >
            <option value="">Choose a template…</option>
            {groups.map((g) => (
              <optgroup key={g.label} label={g.label}>
                {g.list.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </div>
        <Button
          variant="secondary"
          disabled={!template}
          onClick={() => {
            const t = all.find((x) => x.id === template);
            if (t) setItems(t.items.map((it) => ({ ...it })));
          }}
        >
          Replace checklist with template
        </Button>
        <p className="text-ink-muted w-full text-xs">
          {all.find((x) => x.id === template)?.description ??
            "Templates are starting points. Different devices (for example an ECG monitor and a ventilator) need different tests and values: edit the items and limits from the manufacturer manual before approving the plan."}
        </p>
      </div>
      <p className="text-ink-muted text-xs">
        Each item is answered Pass, Fail or Not applicable at sign-off. Measurements record a value and are checked
        against the limits. Electrical safety items record the test standard and version used.
      </p>
      {items.map((it, i) => (
        <div key={it.key} className="border-line grid gap-2 rounded-md border p-3 md:grid-cols-[2fr_1fr_1fr]">
          <InputField
            label={`Item ${i + 1}`}
            name={`ci-label-${i}`}
            id={`ci-label-${it.key}`}
            value={it.label}
            maxLength={200}
            onChange={(e) => update(i, { label: e.target.value })}
          />
          <SelectField
            label="Section"
            name={`ci-section-${i}`}
            id={`ci-section-${it.key}`}
            value={it.section}
            onChange={(e) => update(i, { section: e.target.value as ChecklistItem["section"] })}
          >
            {CHECKLIST_SECTIONS.map((s) => (
              <option key={s} value={s}>
                {SECTION_LABELS[s]}
              </option>
            ))}
          </SelectField>
          <SelectField
            label="Answer"
            name={`ci-kind-${i}`}
            id={`ci-kind-${it.key}`}
            value={it.kind}
            onChange={(e) => update(i, { kind: e.target.value as ChecklistItem["kind"] })}
          >
            <option value="CHECK">Pass / Fail / N/A</option>
            <option value="MEASUREMENT">Measurement + Pass / Fail</option>
          </SelectField>
          {it.kind === "MEASUREMENT" ? (
            <div className="grid grid-cols-3 gap-2 md:col-span-3">
              <InputField
                label="Unit"
                name={`ci-unit-${i}`}
                id={`ci-unit-${it.key}`}
                value={it.unit ?? ""}
                maxLength={20}
                placeholder="Ω, µA, J…"
                onChange={(e) => update(i, { unit: e.target.value || null })}
              />
              <InputField
                label="Lower limit"
                name={`ci-min-${i}`}
                id={`ci-min-${it.key}`}
                type="number"
                step="any"
                value={it.min ?? ""}
                onChange={(e) => update(i, { min: num(e.target.value) })}
              />
              <InputField
                label="Upper limit"
                name={`ci-max-${i}`}
                id={`ci-max-${it.key}`}
                type="number"
                step="any"
                value={it.max ?? ""}
                onChange={(e) => update(i, { max: num(e.target.value) })}
              />
            </div>
          ) : null}
          <div className="md:col-span-3">
            <InputField
              label="Guidance (optional)"
              name={`ci-guidance-${i}`}
              id={`ci-guidance-${it.key}`}
              value={it.guidance ?? ""}
              maxLength={300}
              onChange={(e) => update(i, { guidance: e.target.value || null })}
            />
          </div>
          <div className="flex flex-wrap items-center gap-2 md:col-span-3">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={it.required}
                onChange={(e) => update(i, { required: e.target.checked })}
                className="size-4 accent-teal-700"
              />
              Required (N/A needs a reason)
            </label>
            <span className="flex-1" />
            <Button variant="ghost" onClick={() => move(i, -1)} disabled={i === 0} aria-label={`Move item ${i + 1} up`}>
              ↑
            </Button>
            <Button
              variant="ghost"
              onClick={() => move(i, 1)}
              disabled={i === items.length - 1}
              aria-label={`Move item ${i + 1} down`}
            >
              ↓
            </Button>
            <Button
              variant="danger"
              onClick={() => setItems(items.filter((_, k) => k !== i))}
              aria-label={`Remove item ${i + 1}`}
            >
              Remove
            </Button>
          </div>
        </div>
      ))}
      <div className="flex flex-wrap gap-2">
        {CHECKLIST_SECTIONS.map((s) => (
          <Button
            key={s}
            variant="secondary"
            onClick={() =>
              setItems([
                ...items,
                {
                  key: newKey(s),
                  label: "",
                  section: s,
                  kind: s === "ELECTRICAL_SAFETY" ? "MEASUREMENT" : "CHECK",
                  required: true,
                  unit: null,
                  min: null,
                  max: null,
                  guidance: null,
                },
              ])
            }
          >
            + {SECTION_LABELS[s]}
          </Button>
        ))}
      </div>
      {error ? <p className="text-danger text-xs font-medium">{error.join(" ")}</p> : null}
    </fieldset>
  );
}

export function PlanForm({ options, defaults }: { options: PlanFormOptions; defaults: PlanDefaults }) {
  const editing = Boolean(defaults.id);
  const [state, formAction, pending] = useActionState(editing ? updatePlanAction : createPlanAction, null);
  const { formRef, onSubmit } = useKeepValuesSubmit(formAction, state, { resetOnSuccess: false });
  const [hospitalId, setHospitalId] = useState(defaults.hospitalId);
  const [targetKind, setTargetKind] = useState(defaults.targetKind);
  const [targetId, setTargetId] = useState(defaults.targetId);
  const [source, setSource] = useState(defaults.intervalSource);
  const [count, setCount] = useState(String(defaults.intervalCount));
  const [unit, setUnit] = useState(defaults.intervalUnit);
  const [items, setItems] = useState<ChecklistItem[]>(defaults.checklist.length ? defaults.checklist : STARTER);

  const model = useMemo(() => {
    if (targetKind === "MODEL") return options.models.find((m) => m.id === targetId);
    if (targetKind === "ASSET") {
      // The asset list does not carry the model; the server checks the rules on save.
      return undefined;
    }
    return undefined;
  }, [targetKind, targetId, options.models]);
  const category = targetKind === "CATEGORY" ? options.categories.find((c) => c.id === targetId) : undefined;
  const preset = INTERVAL_PRESETS.find((p) => String(p.count) === count && p.unit === unit)?.key ?? "custom";

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
          label="Plan name"
          name="name"
          defaultValue={defaults.name}
          maxLength={120}
          required
          error={err(state, "name")}
        />
        <SelectField
          label="Maintenance type"
          name="workType"
          defaultValue={defaults.workType}
          disabled={defaults.locked}
          error={err(state, "workType")}
        >
          {PLAN_WORK_TYPES.map((t) => (
            <option key={t} value={t}>
              {WORK_TYPE_LABELS[t]}
            </option>
          ))}
        </SelectField>
        {defaults.locked ? <input type="hidden" name="workType" value={defaults.workType} /> : null}
      </div>
      <FieldShell label="Description (optional)" name="description" error={err(state, "description")}>
        <textarea
          id="description"
          name="description"
          defaultValue={defaults.description}
          maxLength={1000}
          className={textarea}
        />
      </FieldShell>

      <fieldset className="grid gap-3 md:grid-cols-3">
        <legend className="mb-2 text-sm font-semibold">What the plan applies to</legend>
        <SelectField
          label="Hospital"
          name="hospitalId"
          value={hospitalId}
          onChange={(e) => {
            setHospitalId(e.target.value);
            // A department belongs to one hospital: changing the hospital clears it.
            if (targetKind === "DEPARTMENT") setTargetId("");
          }}
          error={err(state, "hospitalId")}
        >
          {options.orgWide ? <option value="">Every hospital in the organisation</option> : null}
          {options.hospitals.map((h) => (
            <option key={h.id} value={h.id}>
              {h.code} · {h.name}
            </option>
          ))}
        </SelectField>
        <SelectField
          label="Applies to"
          name="targetKind"
          value={targetKind}
          disabled={defaults.locked}
          onChange={(e) => {
            setTargetKind(e.target.value);
            setTargetId("");
          }}
          error={err(state, "targetKind")}
        >
          {TARGET_KINDS.map((k) => (
            <option key={k} value={k}>
              {TARGET_LABELS[k]}
            </option>
          ))}
        </SelectField>
        {defaults.locked ? <input type="hidden" name="targetKind" value={targetKind} /> : null}
        {targetKind === "ASSET" ? (
          <SelectField
            label="Asset"
            name="target_ASSET"
            value={targetId}
            disabled={defaults.locked}
            onChange={(e) => setTargetId(e.target.value)}
            error={err(state, "targetId")}
          >
            <option value="">Choose an asset…</option>
            {options.assets.map((a) => (
              <option key={a.id} value={a.id}>
                {a.assetTag} · {a.name}
              </option>
            ))}
          </SelectField>
        ) : targetKind === "DEPARTMENT" ? (
          <SelectField
            label="Department"
            name="target_DEPARTMENT"
            value={targetId}
            disabled={defaults.locked}
            onChange={(e) => setTargetId(e.target.value)}
            error={err(state, "targetId")}
          >
            <option value="">{hospitalId ? "Choose a department…" : "Choose a hospital first"}</option>
            {options.departments
              .filter((d) => d.hospitalId === hospitalId)
              .map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
          </SelectField>
        ) : targetKind === "MODEL" ? (
          <SelectField
            label="Model"
            name="target_MODEL"
            value={targetId}
            disabled={defaults.locked}
            onChange={(e) => setTargetId(e.target.value)}
            error={err(state, "targetId")}
          >
            <option value="">Choose a model…</option>
            {options.models.map((m) => (
              <option key={m.id} value={m.id}>
                {m.manufacturer.name} {m.modelName} ({m.category.name})
              </option>
            ))}
          </SelectField>
        ) : (
          <SelectField
            label="Category"
            name="target_CATEGORY"
            value={targetId}
            disabled={defaults.locked}
            onChange={(e) => setTargetId(e.target.value)}
            error={err(state, "targetId")}
          >
            <option value="">Choose a category…</option>
            {options.categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </SelectField>
        )}
        {defaults.locked ? <input type="hidden" name={`target_${targetKind}`} value={targetId} /> : null}
      </fieldset>

      <fieldset className="flex flex-col gap-3">
        <legend className="mb-2 text-sm font-semibold">Interval and where it comes from</legend>
        <p className="text-ink-muted text-xs">
          Priority order: 1 a regulatory or organisational requirement · 2 the manufacturer&apos;s interval for this
          model · 3 an organisation-defined interval only where no manufacturer guidance exists, with a written
          justification.
        </p>
        {model?.manufacturerPmIntervalCount ? (
          <p className="bg-info-bg text-info rounded-sm px-3 py-2 text-sm">
            Manufacturer interval on record for {model.modelName}:{" "}
            <strong>
              {intervalLabel(model.manufacturerPmIntervalCount, model.manufacturerPmIntervalUnit as IntervalUnitValue)}
            </strong>{" "}
            — {model.manufacturerPmReference}.{" "}
            <button
              type="button"
              className="font-semibold underline"
              onClick={() => {
                setSource("MANUFACTURER");
                setCount(String(model.manufacturerPmIntervalCount));
                setUnit(model.manufacturerPmIntervalUnit ?? "MONTH");
              }}
            >
              Use it
            </button>
          </p>
        ) : model ? (
          <p className="bg-warn-bg rounded-sm px-3 py-2 text-sm text-[#6b3f00]">
            No manufacturer interval is recorded for {model.modelName}. Record it under Settings, or use a requirement.
          </p>
        ) : null}
        {targetKind === "DEPARTMENT" ? (
          <p className="bg-surface-sunken rounded-sm px-3 py-2 text-sm">
            A department has different makes, so the interval must come from a <strong>requirement</strong> (for example
            a regulation or hospital policy), not from one manufacturer. An organisation-defined interval is accepted
            only if none of the department&apos;s equipment has manufacturer guidance on record. Assets are added to the
            plan from the plan page after it is approved.
          </p>
        ) : null}
        {category?.defaultPmIntervalMonths ? (
          <p className="text-ink-muted text-xs">
            Category default from the asset register: every {category.defaultPmIntervalMonths} months. This is a hint
            only; it is not an approved interval.
          </p>
        ) : null}
        <div className="grid gap-3 md:grid-cols-[1.4fr_0.6fr_0.8fr_2fr]">
          <SelectField
            label="Frequency"
            name="preset"
            value={preset}
            onChange={(e) => {
              const p = INTERVAL_PRESETS.find((x) => x.key === e.target.value);
              if (p) {
                setCount(String(p.count));
                setUnit(p.unit);
              }
            }}
          >
            {INTERVAL_PRESETS.map((p) => (
              <option key={p.key} value={p.key}>
                {p.label}
              </option>
            ))}
            <option value="custom">Custom</option>
          </SelectField>
          <InputField
            label="Every"
            name="intervalCount"
            type="number"
            min={1}
            value={count}
            onChange={(e) => setCount(e.target.value)}
            error={err(state, "intervalCount")}
          />
          <SelectField
            label="Unit"
            name="intervalUnit"
            value={unit}
            onChange={(e) => setUnit(e.target.value)}
            error={err(state, "intervalUnit")}
          >
            {INTERVAL_UNITS.map((u) => (
              <option key={u} value={u}>
                {INTERVAL_UNIT_LABELS[u]}
              </option>
            ))}
          </SelectField>
          <SelectField
            label="Source of the interval"
            name="intervalSource"
            value={source}
            onChange={(e) => setSource(e.target.value)}
            error={err(state, "intervalSource")}
          >
            {INTERVAL_SOURCES.map((s) => (
              <option key={s} value={s}>
                {INTERVAL_SOURCE_LABELS[s]}
              </option>
            ))}
          </SelectField>
        </div>
        {source === "ORGANIZATION_DEFINED" ? (
          <FieldShell label="Justification (required)" name="justification" error={err(state, "justification")}>
            <textarea
              id="justification"
              name="justification"
              defaultValue={defaults.justification}
              maxLength={1000}
              className={textarea}
              placeholder="Why this interval was chosen, e.g. failure history, usage, risk assessment"
            />
          </FieldShell>
        ) : (
          <InputField
            label={source === "MANUFACTURER" ? "Manufacturer document (required)" : "Requirement and clause (required)"}
            name="sourceReference"
            defaultValue={defaults.sourceReference}
            maxLength={300}
            error={err(state, "sourceReference")}
          />
        )}
        {source === "ORGANIZATION_DEFINED" ? (
          <input type="hidden" name="sourceReference" value={defaults.sourceReference} />
        ) : (
          <input type="hidden" name="justification" value={defaults.justification} />
        )}
      </fieldset>

      <fieldset className="grid gap-3 md:grid-cols-4">
        <legend className="mb-2 text-sm font-semibold">Dates and timing</legend>
        <InputField
          label="Start date"
          name="startsOn"
          type="date"
          defaultValue={defaults.startsOn}
          error={err(state, "startsOn")}
        />
        <InputField
          label="End date (optional)"
          name="endsOn"
          type="date"
          defaultValue={defaults.endsOn}
          error={err(state, "endsOn")}
        />
        <InputField
          label="Create work order (days before due)"
          name="leadDays"
          type="number"
          min={0}
          max={90}
          defaultValue={defaults.leadDays}
          error={err(state, "leadDays")}
        />
        <InputField
          label="Grace days (still on time)"
          name="graceDays"
          type="number"
          min={0}
          max={60}
          defaultValue={defaults.graceDays}
          error={err(state, "graceDays")}
        />
      </fieldset>

      <fieldset className="grid gap-3 md:grid-cols-4">
        <legend className="mb-2 text-sm font-semibold">Work</legend>
        <SelectField
          label="Priority"
          name="priority"
          defaultValue={defaults.priority}
          hint="Safety-critical devices are always at least High"
          error={err(state, "priority")}
        >
          {PRIORITIES.map((p) => (
            <option key={p} value={p}>
              {PRIORITY_LABELS[p]}
            </option>
          ))}
        </SelectField>
        <InputField
          label="Estimated minutes"
          name="estimatedMinutes"
          type="number"
          min={1}
          defaultValue={defaults.estimatedMinutes}
          error={err(state, "estimatedMinutes")}
        />
        <SelectField
          label="Assign to (optional)"
          name="defaultAssigneeId"
          defaultValue={defaults.defaultAssigneeId}
          hint="Used when they cover the asset's department"
          error={err(state, "defaultAssigneeId")}
        >
          <option value="">Leave for the manager to assign</option>
          {options.assignees.map((a) => (
            <option key={a.userId} value={a.userId}>
              {a.name}
              {a.role === "ENGINEERING_MANAGER" ? " (manager)" : ""}
            </option>
          ))}
        </SelectField>
        <InputField
          label="Required competency (optional)"
          name="requiredCompetency"
          defaultValue={defaults.requiredCompetency}
          maxLength={200}
          error={err(state, "requiredCompetency")}
        />
      </fieldset>
      <InputField
        label="Service documentation reference (optional)"
        name="documentReference"
        defaultValue={defaults.documentReference}
        maxLength={300}
        placeholder="e.g. Service manual rev C, chapter 6"
        error={err(state, "documentReference")}
      />
      <FieldShell label="Instructions (optional)" name="instructions" error={err(state, "instructions")}>
        <textarea
          id="instructions"
          name="instructions"
          defaultValue={defaults.instructions}
          maxLength={4000}
          className={textarea}
        />
      </FieldShell>

      <ChecklistEditor
        items={items}
        setItems={setItems}
        templates={options.templates}
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
          {pending ? "Saving…" : editing ? "Save changes" : "Save as draft"}
        </Button>
        <span className="text-ink-muted text-sm">
          {editing
            ? "Changes take effect after an Engineering Manager approves them."
            : "A draft creates no work until an Engineering Manager approves it."}
        </span>
      </div>
      <Feedback state={state} />
    </form>
  );
}
