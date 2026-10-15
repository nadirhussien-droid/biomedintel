"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { useKeepValuesSubmit } from "@/components/forms/use-keep-values";
import { FieldShell, InputField, SelectField } from "@/components/ui/field";
import { REPORT_KIND_LABELS } from "@/lib/validation/analytics";
import {
  createScheduleAction,
  generateNowAction,
  pauseScheduleAction,
  resumeScheduleAction,
  type ReportFormState,
} from "./actions";

type Action = (prev: ReportFormState | null, form: FormData) => Promise<ReportFormState>;

function Feedback({ state }: { state: ReportFormState | null }) {
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

const err = (state: ReportFormState | null, key: string) => (state && !state.ok ? state.fieldErrors?.[key] : undefined);

export function ScheduleButton({
  action,
  id,
  label,
  variant = "secondary",
  confirm,
}: {
  action: "pause" | "resume" | "generate";
  id: string;
  label: string;
  variant?: "primary" | "secondary";
  confirm?: string;
}) {
  const fn: Action =
    action === "pause" ? pauseScheduleAction : action === "resume" ? resumeScheduleAction : generateNowAction;
  const [state, formAction, pending] = useActionState(fn, null);
  const { formRef, onSubmit } = useKeepValuesSubmit(formAction, state, { confirm });
  return (
    <form ref={formRef} onSubmit={onSubmit} className="flex flex-col gap-1">
      <input type="hidden" name="id" value={id} />
      <div>
        <Button type="submit" variant={variant} disabled={pending}>
          {pending ? "Working…" : label}
        </Button>
      </div>
      <Feedback state={state} />
    </form>
  );
}

export function CreateScheduleForm({
  hospitals,
  people,
  orgWide,
}: {
  hospitals: { id: string; code: string; name: string }[];
  people: { userId: string; name: string; role: string }[];
  orgWide: boolean;
}) {
  const [state, formAction, pending] = useActionState(createScheduleAction, null);
  const { formRef, onSubmit } = useKeepValuesSubmit(formAction, state);
  return (
    <form ref={formRef} onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
      <div className="grid gap-4 md:grid-cols-2">
        <InputField
          label="Name"
          name="name"
          required
          maxLength={120}
          placeholder="Monthly PM compliance — all hospitals"
          error={err(state, "name")}
        />
        <SelectField label="Report" name="kind" defaultValue="OVERVIEW" error={err(state, "kind")}>
          {Object.entries(REPORT_KIND_LABELS).map(([k, l]) => (
            <option key={k} value={k}>
              {l}
            </option>
          ))}
        </SelectField>
        <SelectField
          label="How often"
          name="frequency"
          defaultValue="MONTHLY"
          error={err(state, "frequency")}
          hint="Each report covers the last complete week (Monday–Sunday) or calendar month."
        >
          <option value="MONTHLY">Monthly</option>
          <option value="WEEKLY">Weekly</option>
        </SelectField>
        <SelectField
          label="Covers"
          name="hospitalId"
          defaultValue={orgWide ? "" : hospitals[0]?.id}
          error={err(state, "hospitalId")}
          hint="Recipients must have access to the whole of what the report covers."
        >
          {orgWide ? <option value="">Whole organisation</option> : null}
          {hospitals.map((h) => (
            <option key={h.id} value={h.id}>
              {h.code} · {h.name}
            </option>
          ))}
        </SelectField>
      </div>
      <FieldShell
        label="Recipients"
        name="recipients"
        error={err(state, "recipientIds")}
        hint="Told in BiomedIntel.ai when each report is ready. No email is sent."
      >
        <fieldset
          id="recipients"
          className="border-line-strong grid max-h-56 gap-1 overflow-y-auto rounded-sm border bg-white p-3 sm:grid-cols-2"
        >
          <legend className="sr-only">Recipients</legend>
          {people.map((p) => (
            <label key={p.userId} className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="recipientIds" value={p.userId} className="size-4 accent-teal-700" />
              {p.name} <span className="text-ink-muted text-xs">· {p.role.replaceAll("_", " ").toLowerCase()}</span>
            </label>
          ))}
        </fieldset>
      </FieldShell>
      <p className="text-ink-muted text-xs">
        Scheduled reports are generated with read-only access limited to what the report covers. They never include
        per-engineer workload or financial figures.
      </p>
      <div>
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : "Save scheduled report"}
        </Button>
      </div>
      <Feedback state={state} />
    </form>
  );
}
