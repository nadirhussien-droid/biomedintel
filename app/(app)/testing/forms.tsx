"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { InputField, SelectField, FieldShell } from "@/components/ui/field";
import {
  CAL_RESULTS,
  KIND_LABELS,
  RESULT_LABELS,
  TEST_KINDS,
  TEST_STATUSES,
  TEST_STATUS_LABELS,
} from "@/lib/validation/testing";
import {
  addCalibrationAction,
  addCertificateAction,
  createEquipmentAction,
  updateEquipmentAction,
  type TestFormState,
} from "./actions";

const err = (s: TestFormState | null, k: string) => (s && !s.ok ? s.fieldErrors?.[k] : undefined);
const val = (s: TestFormState | null, init: Record<string, string>, k: string) => s?.values?.[k] ?? init[k] ?? "";
const area = "border-line-strong text-ink min-h-24 w-full rounded-sm border bg-white px-3 py-2 text-sm";

function Feedback({ state }: { state: TestFormState | null }) {
  if (!state) return null;
  return (
    <p
      role={state.ok ? "status" : "alert"}
      className={state.ok ? "text-ok text-sm font-medium" : "text-danger text-sm font-medium"}
    >
      {state.message}
    </p>
  );
}

export type EquipmentValues = Record<string, string>;
export const EMPTY_EQUIPMENT: EquipmentValues = {
  name: "",
  kind: "",
  manufacturer: "",
  model: "",
  serialNumber: "",
  equipmentTag: "",
  measures: "",
  calibrationIntervalMonths: "12",
  heldBy: "",
  location: "",
  status: "IN_USE",
  notes: "",
};

export function EquipmentForm({
  mode,
  id,
  initial,
}: {
  mode: "create" | "edit";
  id?: string;
  initial: EquipmentValues;
}) {
  const [state, action, pending] = useActionState(
    mode === "create" ? createEquipmentAction : updateEquipmentAction,
    null,
  );
  const v = (k: string) => val(state, initial, k);
  return (
    <form action={action} className="grid gap-4 md:grid-cols-2" key={state?.attempt ?? 0}>
      {id ? <input type="hidden" name="id" value={id} /> : null}
      <InputField
        label="Name"
        name="name"
        id="te-name"
        required
        defaultValue={v("name")}
        error={err(state, "name")}
        hint="For example: Fluke ESA615 safety analyser"
      />
      <SelectField label="Type" name="kind" id="te-kind" required defaultValue={v("kind")} error={err(state, "kind")}>
        <option value="">Choose…</option>
        {TEST_KINDS.map((k) => (
          <option key={k} value={k}>
            {KIND_LABELS[k]}
          </option>
        ))}
      </SelectField>
      <InputField
        label="Manufacturer"
        name="manufacturer"
        id="te-mfr"
        required
        defaultValue={v("manufacturer")}
        error={err(state, "manufacturer")}
      />
      <InputField
        label="Model"
        name="model"
        id="te-model"
        required
        defaultValue={v("model")}
        error={err(state, "model")}
      />
      <InputField
        label="Serial number"
        name="serialNumber"
        id="te-serial"
        required
        defaultValue={v("serialNumber")}
        error={err(state, "serialNumber")}
      />
      <InputField
        label="Your own ID (optional)"
        name="equipmentTag"
        id="te-tag"
        defaultValue={v("equipmentTag")}
        error={err(state, "equipmentTag")}
        hint="For example TE-001. Must be different for every tool."
      />
      <InputField
        label="What it measures (optional)"
        name="measures"
        id="te-measures"
        defaultValue={v("measures")}
        error={err(state, "measures")}
        hint="For example: leakage current, earth resistance, insulation"
      />
      <InputField
        label="Calibrate every (months)"
        name="calibrationIntervalMonths"
        id="te-interval"
        type="number"
        min={1}
        max={60}
        required
        defaultValue={v("calibrationIntervalMonths")}
        error={err(state, "calibrationIntervalMonths")}
        hint="Used to suggest the next due date. Usually 12."
      />
      <InputField
        label="Held by (optional)"
        name="heldBy"
        id="te-held"
        defaultValue={v("heldBy")}
        error={err(state, "heldBy")}
        hint="Person or team who keeps it"
      />
      <InputField
        label="Where it is kept (optional)"
        name="location"
        id="te-loc"
        defaultValue={v("location")}
        error={err(state, "location")}
      />
      <SelectField
        label="Status"
        name="status"
        id="te-status"
        required
        defaultValue={v("status")}
        error={err(state, "status")}
      >
        {TEST_STATUSES.map((s) => (
          <option key={s} value={s}>
            {TEST_STATUS_LABELS[s]}
          </option>
        ))}
      </SelectField>
      <div className="md:col-span-2">
        <FieldShell label="Notes (optional)" name="te-notes" error={err(state, "notes")}>
          <textarea id="te-notes" name="notes" defaultValue={v("notes")} className={area} maxLength={2000} />
        </FieldShell>
      </div>
      <div className="flex items-center gap-3 md:col-span-2">
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : mode === "create" ? "Register test equipment" : "Save changes"}
        </Button>
        <Feedback state={state} />
      </div>
    </form>
  );
}

export function CalibrationForm({ equipmentId, intervalMonths }: { equipmentId: string; intervalMonths: number }) {
  const [state, action, pending] = useActionState(addCalibrationAction, null);
  const v = (k: string) => state?.values?.[k] ?? "";
  return (
    <form action={action} className="grid gap-4 md:grid-cols-2" key={state?.ok ? `done-${state.attempt}` : "form"}>
      <input type="hidden" name="testEquipmentId" value={equipmentId} />
      <InputField
        label="Calibration date"
        name="calibratedOn"
        id="cal-on"
        type="date"
        required
        defaultValue={v("calibratedOn")}
        error={err(state, "calibratedOn")}
      />
      <InputField
        label="Next due date (optional)"
        name="dueOn"
        id="cal-due"
        type="date"
        defaultValue={v("dueOn")}
        error={err(state, "dueOn")}
        hint={`Leave blank to use ${intervalMonths} months after the calibration date.`}
      />
      <InputField
        label="Laboratory"
        name="laboratory"
        id="cal-lab"
        required
        defaultValue={v("laboratory")}
        error={err(state, "laboratory")}
        hint="Who calibrated it"
      />
      <InputField
        label="Certificate number (optional)"
        name="certificateNumber"
        id="cal-cert"
        defaultValue={v("certificateNumber")}
        error={err(state, "certificateNumber")}
      />
      <SelectField
        label="Result"
        name="result"
        id="cal-result"
        required
        defaultValue={v("result") || "PASS"}
        error={err(state, "result")}
      >
        {CAL_RESULTS.map((r) => (
          <option key={r} value={r}>
            {RESULT_LABELS[r]}
          </option>
        ))}
      </SelectField>
      <InputField
        label="Accreditation (optional)"
        name="accreditation"
        id="cal-acc"
        defaultValue={v("accreditation")}
        error={err(state, "accreditation")}
        hint="For example ISO/IEC 17025"
      />
      <InputField
        label="Traceable to (optional)"
        name="traceableTo"
        id="cal-trace"
        defaultValue={v("traceableTo")}
        error={err(state, "traceableTo")}
        hint="For example the national standards body"
      />
      <FieldShell label="Certificate PDF (optional, up to 5 MB)" name="cal-file" error={err(state, "certificate")}>
        <input
          id="cal-file"
          name="certificate"
          type="file"
          accept="application/pdf,.pdf"
          className="border-line-strong min-h-11 w-full rounded-sm border bg-white px-3 py-2 text-sm"
        />
      </FieldShell>
      <div className="md:col-span-2">
        <FieldShell label="Notes (optional)" name="cal-notes" error={err(state, "notes")}>
          <textarea id="cal-notes" name="notes" defaultValue={v("notes")} className={area} maxLength={2000} />
        </FieldShell>
      </div>
      <p className="text-ink-muted text-xs md:col-span-2">
        A calibration record cannot be changed after it is saved. If you make a mistake, add a new record.
      </p>
      <div className="flex items-center gap-3 md:col-span-2">
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : "Save calibration"}
        </Button>
        <Feedback state={state} />
      </div>
    </form>
  );
}

export function CertificateForm({ recordId }: { recordId: string }) {
  const [state, action, pending] = useActionState(addCertificateAction, null);
  return (
    <form action={action} className="flex flex-wrap items-end gap-2">
      <input type="hidden" name="recordId" value={recordId} />
      <div className="flex flex-col gap-1">
        <label htmlFor={`cert-${recordId}`} className="text-ink text-xs font-semibold">
          Add the certificate (PDF)
        </label>
        <input
          id={`cert-${recordId}`}
          name="certificate"
          type="file"
          accept="application/pdf,.pdf"
          required
          className="border-line-strong rounded-sm border bg-white px-2 py-1.5 text-xs"
        />
      </div>
      <Button type="submit" variant="secondary" disabled={pending} className="min-h-9 px-3 text-xs">
        {pending ? "Saving…" : "Attach"}
      </Button>
      {state && !state.ok ? (
        <span role="alert" className="text-danger w-full text-xs font-medium">
          {state.message} {err(state, "certificate")?.join(" ")}
        </span>
      ) : null}
      {state?.ok ? (
        <span role="status" className="text-ok text-xs font-medium">
          {state.message}
        </span>
      ) : null}
    </form>
  );
}
