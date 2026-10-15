"use client";

import { useActionState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { useKeepValuesSubmit } from "@/components/forms/use-keep-values";
import { FieldShell, InputField, SelectField } from "@/components/ui/field";
import { INTERVAL_UNITS, INTERVAL_UNIT_LABELS } from "@/lib/validation/pm";
import {
  addRuleAction,
  addStandardAction,
  approvePlanAction,
  approveReleaseAction,
  archivePlanAction,
  archiveStandardAction,
  createRepairAction,
  endScheduleAction,
  enrolAction,
  pausePlanAction,
  rejectReleaseAction,
  removeRuleAction,
  resumePlanAction,
  reviewPlanAction,
  runGenerationAction,
  setModelIntervalAction,
  verifyStandardAction,
  type PmFormState,
} from "./actions";

type Action = (prev: PmFormState | null, form: FormData) => Promise<PmFormState>;

export const textarea =
  "min-h-24 w-full rounded-sm border border-line-strong bg-white px-3 py-2 text-sm text-ink placeholder:text-ink-muted/70";

export function Feedback({ state }: { state: PmFormState | null }) {
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

export const err = (state: PmFormState | null, key: string) =>
  state && !state.ok ? state.fieldErrors?.[key] : undefined;

/** A small form bound to one action, with hidden fields and inline feedback. */
export function ActionForm({
  action,
  hidden = {},
  children,
  label,
  variant = "primary",
  confirm,
  className = "flex flex-col gap-3",
  resetOnSuccess,
}: {
  action: Action;
  hidden?: Record<string, string>;
  children?: (state: PmFormState | null) => ReactNode;
  label: string;
  variant?: "primary" | "secondary" | "danger";
  confirm?: string;
  className?: string;
  resetOnSuccess?: boolean;
}) {
  const [state, formAction, pending] = useActionState(action, null);
  const { formRef, onSubmit } = useKeepValuesSubmit(formAction, state, { confirm, resetOnSuccess });
  return (
    <form ref={formRef} onSubmit={onSubmit} className={className} noValidate>
      {Object.entries(hidden).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
      {children?.(state)}
      <div>
        <Button type="submit" variant={variant} disabled={pending}>
          {pending ? "Working…" : label}
        </Button>
      </div>
      <Feedback state={state} />
    </form>
  );
}

const Declaration = ({ name, children, error }: { name: string; children: ReactNode; error?: string[] }) => (
  <>
    <label className="bg-surface flex items-start gap-2 rounded-sm p-3 text-sm">
      <input type="checkbox" name={name} className="mt-0.5 size-4 accent-teal-700" />
      <span>{children}</span>
    </label>
    {error ? <p className="text-danger text-xs font-medium">{error.join(" ")}</p> : null}
  </>
);

// ─── Generation ──────────────────────────────────────────────────────────────

export function RunGenerationForm() {
  return (
    <ActionForm
      action={runGenerationAction}
      label="Run generation now"
      variant="secondary"
      confirm="Create work orders for every due PM in your hospitals now? Running it twice never creates duplicates."
    />
  );
}

// ─── Plan decisions ──────────────────────────────────────────────────────────

export function ApprovePlanForm({ id, today, nextYear }: { id: string; today: string; nextYear: string }) {
  return (
    <ActionForm action={approvePlanAction} hidden={{ id }} label="Approve plan">
      {(state) => (
        <>
          <div className="grid gap-3 md:grid-cols-2">
            <InputField
              label="Effective from"
              name="effectiveFrom"
              type="date"
              defaultValue={today}
              error={err(state, "effectiveFrom")}
            />
            <InputField
              label="Next interval review"
              name="nextReviewOn"
              type="date"
              defaultValue={nextYear}
              error={err(state, "nextReviewOn")}
            />
          </div>
          <InputField label="Approval note (optional)" name="note" maxLength={500} error={err(state, "note")} />
          <Declaration name="confirm" error={err(state, "confirm")}>
            <strong>I confirm</strong> that I am qualified to approve this procedure, that I have checked its checklist,
            measurement limits and interval source against the applicable standard, the manufacturer documentation and
            local requirements.
          </Declaration>
        </>
      )}
    </ActionForm>
  );
}

export function ReviewPlanForm({ id, nextYear }: { id: string; nextYear: string }) {
  return (
    <ActionForm
      action={reviewPlanAction}
      hidden={{ id }}
      label="Record interval review"
      variant="secondary"
      resetOnSuccess
    >
      {(state) => (
        <>
          <InputField
            label="Next review"
            name="nextReviewOn"
            type="date"
            defaultValue={nextYear}
            error={err(state, "nextReviewOn")}
          />
          <InputField
            label="Review note"
            name="note"
            maxLength={500}
            placeholder="e.g. Checked against the current service manual; no change"
            error={err(state, "note")}
          />
        </>
      )}
    </ActionForm>
  );
}

export function PausePlanForm({ id }: { id: string }) {
  return (
    <ActionForm action={pausePlanAction} hidden={{ id }} label="Pause plan" variant="secondary">
      {(state) => <InputField label="Reason" name="reason" maxLength={500} error={err(state, "reason")} />}
    </ActionForm>
  );
}

export function ResumePlanForm({ id }: { id: string }) {
  return (
    <ActionForm
      action={resumePlanAction}
      hidden={{ id }}
      label="Resume plan"
      confirm="Resume? Due dates that fell during the pause are not created; each asset continues from its next due date on or after today."
    />
  );
}

export function ArchivePlanForm({ id }: { id: string }) {
  return (
    <ActionForm
      action={archivePlanAction}
      hidden={{ id }}
      label="Archive plan"
      variant="danger"
      confirm="Archive this plan? No new work orders will be created and its schedules end. History and open jobs are kept."
    >
      {(state) => <InputField label="Reason" name="reason" maxLength={500} error={err(state, "reason")} />}
    </ActionForm>
  );
}

export function EnrolForm({
  id,
  defaultDate,
  assets,
}: {
  id: string;
  defaultDate: string;
  assets: { id: string; assetTag: string; name: string; hospital: { code: string } }[];
}) {
  return (
    <ActionForm action={enrolAction} hidden={{ id }} label="Enrol selected assets" variant="secondary">
      {(state) => (
        <>
          <InputField
            label="First due date"
            name="firstDueOn"
            type="date"
            defaultValue={defaultDate}
            hint="Later due dates are counted from this date. Use the next date the work is actually due."
            error={err(state, "firstDueOn")}
          />
          <fieldset className="flex flex-col gap-1">
            <legend className="mb-1 text-sm font-semibold">Matching assets not yet in this plan</legend>
            <div className="border-line max-h-56 overflow-y-auto rounded-sm border p-2">
              {assets.map((a) => (
                <label key={a.id} className="flex items-center gap-2 py-1 text-sm">
                  <input
                    type="checkbox"
                    name="assetIds"
                    value={a.id}
                    defaultChecked
                    className="size-4 accent-teal-700"
                  />
                  <span className="font-mono font-semibold">{a.assetTag}</span> {a.name}
                  <span className="text-ink-muted">· {a.hospital.code}</span>
                </label>
              ))}
            </div>
          </fieldset>
        </>
      )}
    </ActionForm>
  );
}

export function EndScheduleForm({ id }: { id: string }) {
  return (
    <ActionForm
      action={endScheduleAction}
      hidden={{ id }}
      label="Remove from plan"
      variant="danger"
      className="flex flex-wrap items-end gap-2"
      confirm="Remove this asset from the plan? Its history is kept."
    >
      {(state) => (
        <div className="min-w-48 flex-1">
          <InputField label="Reason" name="reason" id={`end-${id}`} maxLength={300} error={err(state, "reason")} />
        </div>
      )}
    </ActionForm>
  );
}

// ─── Safety holds ────────────────────────────────────────────────────────────

export function ApproveReleaseForm({ id }: { id: string }) {
  return (
    <ActionForm action={approveReleaseAction} hidden={{ id }} label="Approve return to service">
      {(state) => (
        <>
          <FieldShell label="Review note" name="release-note" error={err(state, "note")}>
            <textarea
              id="release-note"
              name="note"
              maxLength={1000}
              className={textarea}
              placeholder="What you reviewed: retest results, repair record, analyser used"
            />
          </FieldShell>
          <Declaration name="confirm" error={err(state, "confirm")}>
            <strong>I am the second person.</strong> I did not carry out the retest. I have reviewed the repair and the
            retest results and approve this device&apos;s return to clinical use.
          </Declaration>
        </>
      )}
    </ActionForm>
  );
}

export function RejectReleaseForm({ id }: { id: string }) {
  return (
    <ActionForm
      action={rejectReleaseAction}
      hidden={{ id }}
      label="Do not approve — repair again"
      variant="danger"
      confirm="Refuse return to service? A new repair job is created and the device stays out of service."
    >
      {(state) => (
        <FieldShell label="Reason" name="reject-note" error={err(state, "note")}>
          <textarea id="reject-note" name="note" maxLength={1000} className={textarea} />
        </FieldShell>
      )}
    </ActionForm>
  );
}

export function CreateRepairForm({ id }: { id: string }) {
  return <ActionForm action={createRepairAction} hidden={{ id }} label="Create repair job" variant="secondary" />;
}

// ─── Settings ────────────────────────────────────────────────────────────────

export function AddStandardForm() {
  return (
    <ActionForm
      action={addStandardAction}
      label="Add standard"
      variant="secondary"
      className="grid gap-3 md:grid-cols-2"
      resetOnSuccess
    >
      {(state) => (
        <>
          <InputField
            label="Standard"
            name="code"
            placeholder="e.g. IEC 62353"
            maxLength={40}
            error={err(state, "code")}
          />
          <InputField
            label="Version or edition"
            name="version"
            placeholder="e.g. Ed. 2.0 (2014)"
            maxLength={40}
            error={err(state, "version")}
          />
          <InputField label="Title" name="title" maxLength={200} error={err(state, "title")} />
          <InputField
            label="Where it applies (optional)"
            name="jurisdictionNote"
            maxLength={300}
            error={err(state, "jurisdictionNote")}
          />
        </>
      )}
    </ActionForm>
  );
}

export function VerifyStandardForm({ id }: { id: string }) {
  return (
    <ActionForm
      action={verifyStandardAction}
      hidden={{ id }}
      label="Verify"
      variant="secondary"
      className="flex flex-wrap items-end gap-2"
    >
      {(state) => (
        <div className="min-w-64 flex-1">
          <InputField
            label="Verification note"
            name="note"
            id={`verify-${id}`}
            maxLength={500}
            placeholder="What you checked (procedure, limits, analyser)"
            error={err(state, "note")}
          />
        </div>
      )}
    </ActionForm>
  );
}

export function ArchiveStandardForm({ id }: { id: string }) {
  return (
    <ActionForm
      action={archiveStandardAction}
      hidden={{ id }}
      label="Archive"
      variant="danger"
      confirm="Archive this standard?"
    />
  );
}

export function AddRuleForm({
  standards,
  hospitals,
  categories,
  orgWide,
}: {
  standards: { id: string; label: string }[];
  hospitals: { id: string; code: string; name: string }[];
  categories: { id: string; name: string }[];
  orgWide: boolean;
}) {
  return (
    <ActionForm
      action={addRuleAction}
      label="Save rule"
      variant="secondary"
      className="grid gap-3 md:grid-cols-4 md:items-end"
    >
      {(state) => (
        <>
          <SelectField label="Standard" name="standardId" error={err(state, "standardId")}>
            {standards.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </SelectField>
          <SelectField label="Hospital (facility)" name="hospitalId" error={err(state, "hospitalId")}>
            {orgWide ? <option value="">Every hospital</option> : null}
            {hospitals.map((h) => (
              <option key={h.id} value={h.id}>
                {h.code} · {h.name}
              </option>
            ))}
          </SelectField>
          <InputField
            label="Or country (jurisdiction)"
            name="country"
            maxLength={2}
            placeholder="e.g. KE"
            hint="Only with “Every hospital”"
            error={err(state, "country")}
          />
          <SelectField label="Equipment category" name="categoryId" error={err(state, "categoryId")}>
            <option value="">Every category</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </SelectField>
        </>
      )}
    </ActionForm>
  );
}

export function RemoveRuleForm({ id }: { id: string }) {
  return (
    <ActionForm action={removeRuleAction} hidden={{ id }} label="Remove" variant="danger" confirm="Remove this rule?" />
  );
}

export function ModelIntervalForm({
  modelId,
  count,
  unit,
  reference,
}: {
  modelId: string;
  count: number | null;
  unit: string | null;
  reference: string | null;
}) {
  return (
    <ActionForm
      action={setModelIntervalAction}
      hidden={{ modelId }}
      label="Save"
      variant="secondary"
      className="grid gap-2 md:grid-cols-[6rem_8rem_1fr_auto] md:items-end"
    >
      {(state) => (
        <>
          <InputField
            label="Every"
            name="count"
            id={`count-${modelId}`}
            type="number"
            min={1}
            defaultValue={count ?? ""}
            error={err(state, "count")}
          />
          <SelectField
            label="Unit"
            name="unit"
            id={`unit-${modelId}`}
            defaultValue={unit ?? ""}
            error={err(state, "unit")}
          >
            <option value="">—</option>
            {INTERVAL_UNITS.map((u) => (
              <option key={u} value={u}>
                {INTERVAL_UNIT_LABELS[u]}
              </option>
            ))}
          </SelectField>
          <InputField
            label="Manufacturer document"
            name="reference"
            id={`ref-${modelId}`}
            defaultValue={reference ?? ""}
            maxLength={300}
            placeholder="e.g. Service manual rev C, section 6"
            error={err(state, "reference")}
          />
        </>
      )}
    </ActionForm>
  );
}
