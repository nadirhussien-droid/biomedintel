"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { InputField, SelectField } from "@/components/ui/field";
import { RISK_CLASSES, RISK_LABELS } from "@/lib/validation/assets";
import {
  createCategoryAction,
  createLocationAction,
  createManufacturerAction,
  createModelAction,
  type FormState,
} from "../actions";
import { Feedback } from "../[assetId]/detail-forms";

const err = (state: FormState | null, key: string) => (state && !state.ok ? state.fieldErrors?.[key] : undefined);
const formClass = "bg-surface grid gap-3 rounded-md p-4 md:grid-cols-4 md:items-end";

export function ManufacturerForm() {
  const [state, action, pending] = useActionState(createManufacturerAction, null);
  return (
    <form action={action} className={formClass}>
      <InputField label="Manufacturer name" name="name" id="m-name" required error={err(state, "name")} />
      <InputField
        label="Country (2 letters)"
        name="country"
        id="m-country"
        maxLength={2}
        error={err(state, "country")}
      />
      <InputField label="Support contact" name="supportContact" id="m-contact" error={err(state, "supportContact")} />
      <Button type="submit" variant="secondary" disabled={pending}>
        Add manufacturer
      </Button>
      <div className="md:col-span-4">
        <Feedback state={state} />
      </div>
    </form>
  );
}

export function CategoryForm() {
  const [state, action, pending] = useActionState(createCategoryAction, null);
  return (
    <form action={action} className={formClass}>
      <InputField
        label="Category name"
        name="name"
        id="c-name"
        required
        placeholder="Infusion pump"
        error={err(state, "name")}
      />
      <SelectField label="Default risk" name="defaultRiskClass" id="c-risk" defaultValue="">
        <option value="">Not set</option>
        {RISK_CLASSES.map((r) => (
          <option key={r} value={r}>
            {RISK_LABELS[r]}
          </option>
        ))}
      </SelectField>
      <InputField
        label="Default PM interval (months)"
        name="defaultPmIntervalMonths"
        id="c-pm"
        inputMode="numeric"
        error={err(state, "defaultPmIntervalMonths")}
      />
      <Button type="submit" variant="secondary" disabled={pending}>
        Add category
      </Button>
      <div className="md:col-span-4">
        <Feedback state={state} />
      </div>
    </form>
  );
}

export function ModelForm({
  manufacturers,
  categories,
}: {
  manufacturers: { id: string; name: string }[];
  categories: { id: string; name: string }[];
}) {
  const [state, action, pending] = useActionState(createModelAction, null);
  return (
    <form action={action} className="bg-surface grid gap-3 rounded-md p-4 md:grid-cols-5 md:items-end">
      <SelectField label="Manufacturer" name="manufacturerId" id="mo-man" error={err(state, "manufacturerId")}>
        {manufacturers.map((m) => (
          <option key={m.id} value={m.id}>
            {m.name}
          </option>
        ))}
      </SelectField>
      <SelectField label="Category" name="categoryId" id="mo-cat" error={err(state, "categoryId")}>
        {categories.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </SelectField>
      <InputField label="Model name" name="modelName" id="mo-name" required error={err(state, "modelName")} />
      <InputField
        label="Expected life (years)"
        name="expectedLifeYears"
        id="mo-life"
        inputMode="numeric"
        hint="From the manufacturer, if known."
        error={err(state, "expectedLifeYears")}
      />
      <Button type="submit" variant="secondary" disabled={pending || !manufacturers.length || !categories.length}>
        Add model
      </Button>
      <div className="md:col-span-5">
        <Feedback state={state} />
      </div>
    </form>
  );
}

export function LocationForm({
  hospitals,
  departments,
}: {
  hospitals: { id: string; name: string }[];
  departments: { id: string; name: string; hospitalId: string }[];
}) {
  const [state, action, pending] = useActionState(createLocationAction, null);
  const [hospitalId, setHospitalId] = useState(hospitals[0]?.id ?? "");
  return (
    <form action={action} className="bg-surface grid gap-3 rounded-md p-4 md:grid-cols-6 md:items-end">
      <SelectField
        label="Hospital"
        name="hospitalId"
        id="l-h"
        value={hospitalId}
        onChange={(e) => setHospitalId(e.target.value)}
      >
        {hospitals.map((h) => (
          <option key={h.id} value={h.id}>
            {h.name}
          </option>
        ))}
      </SelectField>
      <SelectField label="Department" name="departmentId" id="l-d" key={hospitalId} error={err(state, "departmentId")}>
        {departments
          .filter((d) => d.hospitalId === hospitalId)
          .map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
      </SelectField>
      <InputField
        label="Room or location"
        name="name"
        id="l-name"
        required
        placeholder="ICU Bay 3"
        error={err(state, "name")}
      />
      <InputField label="Building" name="building" id="l-b" error={err(state, "building")} />
      <InputField label="Floor" name="floor" id="l-f" error={err(state, "floor")} />
      <Button type="submit" variant="secondary" disabled={pending}>
        Add location
      </Button>
      <div className="md:col-span-6">
        <Feedback state={state} />
      </div>
    </form>
  );
}
