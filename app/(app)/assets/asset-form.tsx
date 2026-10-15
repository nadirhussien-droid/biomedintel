"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { FieldShell, InputField, SelectField } from "@/components/ui/field";
import { EDITABLE_STATUSES, RISK_CLASSES, RISK_LABELS, STATUS_LABELS } from "@/lib/validation/assets";
import { createAssetAction, updateAssetAction, type FormState } from "./actions";

export type AssetFormOptions = {
  hospitals: { id: string; name: string }[];
  departments: { id: string; name: string; hospitalId: string }[];
  locations: { id: string; name: string; departmentId: string; building: string | null; floor: string | null }[];
  models: {
    id: string;
    modelName: string;
    manufacturer: { name: string };
    category: { name: string; defaultRiskClass: string | null };
  }[];
};

type Values = Record<string, string>;

const EMPTY: Values = {
  name: "",
  assetTag: "",
  modelId: "",
  hospitalId: "",
  departmentId: "",
  locationId: "",
  serialNumber: "",
  inventoryNumber: "",
  supplier: "",
  description: "",
  status: "IN_SERVICE",
  riskClass: "",
  purchaseDate: "",
  commissionedAt: "",
  eolDate: "",
  purchaseCost: "",
  purchaseCurrency: "",
};

const textareaClass =
  "min-h-24 w-full rounded-sm border border-line-strong bg-white px-3 py-2 text-sm text-ink placeholder:text-ink-muted/70";

export function AssetForm({
  mode,
  options,
  initial,
  canEditCost,
  assetId,
  version,
}: {
  mode: "create" | "edit";
  options: AssetFormOptions;
  initial?: Values;
  canEditCost: boolean;
  assetId?: string;
  version?: string;
}) {
  const [state, action, pending] = useActionState<FormState | null, FormData>(
    mode === "create" ? createAssetAction : updateAssetAction,
    null,
  );
  // After a failed save, show what the person typed (a fresh form would lose it).
  const values: Values = { ...EMPTY, ...initial, ...(state?.values ?? {}) };
  return (
    <AssetFormFields
      key={state?.attempt ?? 0}
      state={state}
      action={action}
      pending={pending}
      values={values}
      options={options}
      canEditCost={canEditCost}
      mode={mode}
      assetId={assetId}
      version={version}
    />
  );
}

function AssetFormFields({
  state,
  action,
  pending,
  values,
  options,
  canEditCost,
  mode,
  assetId,
  version,
}: {
  state: FormState | null;
  action: (form: FormData) => void;
  pending: boolean;
  values: Values;
  options: AssetFormOptions;
  canEditCost: boolean;
  mode: "create" | "edit";
  assetId?: string;
  version?: string;
}) {
  const [hospitalId, setHospitalId] = useState(values.hospitalId || options.hospitals[0]?.id || "");
  const departments = options.departments.filter((d) => d.hospitalId === hospitalId);
  const [departmentId, setDepartmentId] = useState(
    departments.some((d) => d.id === values.departmentId) ? values.departmentId : (departments[0]?.id ?? ""),
  );
  const locations = options.locations.filter((l) => l.departmentId === departmentId);
  const [modelId, setModelId] = useState(values.modelId);
  const [riskClass, setRiskClass] = useState(values.riskClass);
  const err = (key: string) => (state && !state.ok ? state.fieldErrors?.[key] : undefined);
  const needsSerialConfirmation = Boolean(err("confirmDuplicateSerial"));

  function onModelChange(id: string) {
    setModelId(id);
    // Suggest the category default risk only when none was chosen yet; the user decides.
    const model = options.models.find((m) => m.id === id);
    if (!riskClass && model?.category.defaultRiskClass) setRiskClass(model.category.defaultRiskClass);
  }

  return (
    <form action={action} className="flex flex-col gap-6" noValidate>
      {assetId ? <input type="hidden" name="id" value={assetId} /> : null}
      {version ? <input type="hidden" name="version" value={version} /> : null}

      {state && !state.ok ? (
        <p role="alert" className="bg-danger-bg text-danger rounded-sm px-3 py-2 text-sm font-medium">
          {state.message}
        </p>
      ) : null}

      <fieldset className="grid gap-4 md:grid-cols-2">
        <legend className="text-ink mb-3 text-base font-semibold">Identification</legend>
        <InputField
          label="Asset ID"
          name="assetTag"
          required
          defaultValue={values.assetTag}
          placeholder="INF-0412"
          hint="Your organisation's unique ID for this device. Shown on the label."
          error={err("assetTag")}
          autoCapitalize="characters"
        />
        <InputField
          label="Asset name"
          name="name"
          required
          defaultValue={values.name}
          placeholder="Infusion pump"
          error={err("name")}
        />
        <SelectField
          label="Model (manufacturer · category)"
          name="modelId"
          value={modelId}
          onChange={(e) => onModelChange(e.target.value)}
          required
          error={err("modelId")}
        >
          <option value="">Choose a model…</option>
          {options.models.map((m) => (
            <option key={m.id} value={m.id}>
              {m.manufacturer.name} {m.modelName} · {m.category.name}
            </option>
          ))}
        </SelectField>
        <div className="text-ink-muted self-end pb-3 text-xs">
          Model missing?{" "}
          <Link href="/assets/catalog" className="font-semibold text-teal-700 hover:underline">
            Add it to the equipment catalog
          </Link>
          .
        </div>
        <InputField
          label="Serial number"
          name="serialNumber"
          defaultValue={values.serialNumber}
          hint="As printed on the device's rating plate."
          error={err("serialNumber")}
        />
        <InputField
          label="Hospital inventory number"
          name="inventoryNumber"
          defaultValue={values.inventoryNumber}
          hint="The hospital's own asset number, if it has one."
          error={err("inventoryNumber")}
        />
        {needsSerialConfirmation ? (
          <label className="bg-warn-bg flex items-start gap-2 rounded-sm p-3 text-sm text-[#6b3f00] md:col-span-2">
            <input type="checkbox" name="confirmDuplicateSerial" className="mt-0.5 size-4 accent-teal-700" />I have
            checked: this is a different physical device with the same model and serial number.
          </label>
        ) : null}
      </fieldset>

      <fieldset className="grid gap-4 md:grid-cols-3">
        <legend className="text-ink mb-3 text-base font-semibold">Location and ownership</legend>
        <SelectField
          label="Hospital"
          name="hospitalId"
          value={hospitalId}
          onChange={(e) => {
            setHospitalId(e.target.value);
            const first = options.departments.find((d) => d.hospitalId === e.target.value);
            setDepartmentId(first?.id ?? "");
          }}
          error={err("hospitalId")}
        >
          {options.hospitals.map((h) => (
            <option key={h.id} value={h.id}>
              {h.name}
            </option>
          ))}
        </SelectField>
        <SelectField
          label="Department (responsible)"
          name="departmentId"
          value={departmentId}
          onChange={(e) => setDepartmentId(e.target.value)}
          error={err("departmentId")}
        >
          {departments.length === 0 ? <option value="">No departments you can access</option> : null}
          {departments.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </SelectField>
        <SelectField
          label="Room or location"
          name="locationId"
          key={departmentId}
          defaultValue={locations.some((l) => l.id === values.locationId) ? values.locationId : ""}
          error={err("locationId")}
        >
          <option value="">Not specified</option>
          {locations.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
              {l.building ? ` · ${l.building}` : ""}
              {l.floor ? ` · floor ${l.floor}` : ""}
            </option>
          ))}
        </SelectField>
      </fieldset>

      <fieldset className="grid gap-4 md:grid-cols-3">
        <legend className="text-ink mb-3 text-base font-semibold">Status and risk</legend>
        <SelectField
          label="Operational status"
          name="status"
          defaultValue={values.status}
          error={err("status")}
          hint="Decommissioning needs a request approved by the Department Head / NUM."
        >
          {EDITABLE_STATUSES.map((s) => (
            <option key={s} value={s}>
              {STATUS_LABELS[s]}
            </option>
          ))}
        </SelectField>
        <SelectField
          label="Risk category"
          name="riskClass"
          value={riskClass}
          onChange={(e) => setRiskClass(e.target.value)}
          error={err("riskClass")}
          hint="Your organisation's maintenance risk rating, not a regulatory class."
        >
          <option value="">Not assessed</option>
          {RISK_CLASSES.map((r) => (
            <option key={r} value={r}>
              {RISK_LABELS[r]}
            </option>
          ))}
        </SelectField>
        <InputField label="Supplier" name="supplier" defaultValue={values.supplier} error={err("supplier")} />
        <div className="md:col-span-3">
          <FieldShell label="Description" name="description" error={err("description")}>
            <textarea
              id="description"
              name="description"
              defaultValue={values.description}
              className={textareaClass}
              maxLength={2000}
              aria-describedby="description-hint"
            />
          </FieldShell>
          <p id="description-hint" className="text-ink-muted mt-1 text-xs">
            Equipment details only. Do not enter patient names or any patient information.
          </p>
        </div>
      </fieldset>

      <fieldset className="grid gap-4 md:grid-cols-3">
        <legend className="text-ink mb-3 text-base font-semibold">Dates{canEditCost ? " and cost" : ""}</legend>
        <InputField
          label="Purchase date"
          name="purchaseDate"
          type="date"
          defaultValue={values.purchaseDate}
          error={err("purchaseDate")}
        />
        <InputField
          label="Commissioning date"
          name="commissionedAt"
          type="date"
          defaultValue={values.commissionedAt}
          error={err("commissionedAt")}
        />
        <InputField
          label="Planned end of life"
          name="eolDate"
          type="date"
          defaultValue={values.eolDate}
          error={err("eolDate")}
        />
        {canEditCost ? (
          <>
            <InputField
              label="Purchase cost"
              name="purchaseCost"
              inputMode="decimal"
              defaultValue={values.purchaseCost}
              placeholder="185000.00"
              error={err("purchaseCost")}
            />
            <InputField
              label="Currency"
              name="purchaseCurrency"
              defaultValue={values.purchaseCurrency}
              placeholder="KES"
              maxLength={3}
              error={err("purchaseCurrency")}
            />
          </>
        ) : null}
      </fieldset>

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : mode === "create" ? "Register asset" : "Save changes"}
        </Button>
        <Link
          href={assetId ? `/assets/${assetId}` : "/assets"}
          className="text-sm font-semibold text-teal-700 hover:underline"
        >
          Cancel
        </Link>
      </div>
    </form>
  );
}
