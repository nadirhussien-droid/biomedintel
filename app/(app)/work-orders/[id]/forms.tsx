"use client";

import { useRouter } from "next/navigation";
import { useActionState, useState, useTransition, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { useKeepValuesSubmit } from "@/components/forms/use-keep-values";
import { FieldShell, InputField, SelectField } from "@/components/ui/field";
import {
  CHECK_LABELS,
  CHECKS,
  MAX_PHOTO_BYTES,
  OUTCOME_LABELS,
  OUTCOMES,
  PHOTO_MIME,
  PRIORITIES,
  PRIORITY_LABELS,
} from "@/lib/validation/work-orders";
import {
  assignAction,
  cancelAction,
  completeAction,
  holdAction,
  logWorkAction,
  noteAction,
  pmCompleteAction,
  priorityAction,
  reopenAction,
  reviewAction,
  startAction,
  takeAction,
  type WoFormState,
} from "../actions";

type Action = (prev: WoFormState | null, form: FormData) => Promise<WoFormState>;

const textarea =
  "min-h-24 w-full rounded-sm border border-line-strong bg-white px-3 py-2 text-sm text-ink placeholder:text-ink-muted/70";

function Feedback({ state }: { state: WoFormState | null }) {
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

const err = (state: WoFormState | null, key: string) => (state && !state.ok ? state.fieldErrors?.[key] : undefined);

/** A small form bound to one action, with the job id and inline feedback. */
function ActionForm({
  action,
  id,
  children,
  label,
  variant = "primary",
  confirm,
  className = "flex flex-col gap-3",
}: {
  action: Action;
  id: string;
  children?: (state: WoFormState | null) => ReactNode;
  label: string;
  variant?: "primary" | "secondary" | "danger";
  confirm?: string;
  className?: string;
}) {
  const [state, formAction, pending] = useActionState(action, null);
  const { formRef, onSubmit } = useKeepValuesSubmit(formAction, state, { confirm });
  return (
    <form ref={formRef} onSubmit={onSubmit} className={className} noValidate>
      <input type="hidden" name="id" value={id} />
      {children?.(state)}
      <div>
        <Button type="submit" variant={variant} disabled={pending}>
          {pending ? "Saving…" : label}
        </Button>
      </div>
      <Feedback state={state} />
    </form>
  );
}

export function AssignForm({
  id,
  current,
  candidates,
}: {
  id: string;
  current: string | null;
  candidates: { userId: string; name: string; role: string }[];
}) {
  return (
    <ActionForm action={assignAction} id={id} label={current ? "Reassign" : "Assign"} variant="secondary">
      {(state) => (
        <SelectField
          label="Technician"
          name="assigneeId"
          id="assigneeId"
          defaultValue={current ?? candidates[0]?.userId ?? ""}
          error={err(state, "assigneeId")}
        >
          {candidates.length === 0 ? <option value="">No technician has access to this department</option> : null}
          {candidates.map((c) => (
            <option key={c.userId} value={c.userId}>
              {c.name}
              {c.role === "ENGINEERING_MANAGER" ? " (manager)" : ""}
            </option>
          ))}
        </SelectField>
      )}
    </ActionForm>
  );
}

export function PriorityForm({
  id,
  current,
  safetyCritical,
}: {
  id: string;
  current: string;
  safetyCritical: boolean;
}) {
  return (
    <ActionForm action={priorityAction} id={id} label="Change priority" variant="secondary">
      {(state) => (
        <SelectField
          label="Priority"
          name="priority"
          id="priority"
          defaultValue={current}
          error={err(state, "priority")}
        >
          {PRIORITIES.filter((p) => !safetyCritical || p === "URGENT" || p === "HIGH").map((p) => (
            <option key={p} value={p}>
              {PRIORITY_LABELS[p]}
            </option>
          ))}
        </SelectField>
      )}
    </ActionForm>
  );
}

export function TakeForm({ id }: { id: string }) {
  return <ActionForm action={takeAction} id={id} label="Take this job" />;
}

export function StartForm({ id, resume }: { id: string; resume: boolean }) {
  return <ActionForm action={startAction} id={id} label={resume ? "Resume work" : "Start work"} />;
}

export function HoldForm({ id }: { id: string }) {
  return (
    <ActionForm action={holdAction} id={id} label="Put on hold" variant="secondary">
      {(state) => (
        <InputField
          label="Reason"
          name="reason"
          id="hold-reason"
          required
          maxLength={500}
          placeholder="e.g. Waiting for a replacement battery"
          error={err(state, "reason")}
        />
      )}
    </ActionForm>
  );
}

export function LogWorkForm({ id }: { id: string }) {
  return (
    <ActionForm
      action={logWorkAction}
      id={id}
      label="Log work"
      variant="secondary"
      className="grid gap-3 md:grid-cols-[3fr_1fr] md:items-end"
    >
      {(state) => (
        <>
          <InputField
            label="Work done"
            name="description"
            id="log-description"
            required
            maxLength={1000}
            placeholder="e.g. Replaced door sensor, cleaned contacts"
            error={err(state, "description")}
          />
          <InputField
            label="Minutes"
            name="minutes"
            id="log-minutes"
            type="number"
            min={1}
            max={1440}
            required
            error={err(state, "minutes")}
          />
        </>
      )}
    </ActionForm>
  );
}

export function CompleteForm({ id }: { id: string }) {
  const [outcome, setOutcome] = useState<string>("REPAIRED");
  return (
    <ActionForm action={completeAction} id={id} label="Sign off and complete">
      {(state) => (
        <>
          <FieldShell label="Diagnosis — what was wrong" name="diagnosis" error={err(state, "diagnosis")}>
            <textarea id="diagnosis" name="diagnosis" required maxLength={2000} className={textarea} />
          </FieldShell>
          <FieldShell label="Work done and result" name="resolution" error={err(state, "resolution")}>
            <textarea id="resolution" name="resolution" required maxLength={2000} className={textarea} />
          </FieldShell>
          <div className="grid gap-3 md:grid-cols-3">
            <SelectField
              label="Outcome"
              name="outcome"
              id="outcome"
              value={outcome}
              onChange={(e) => setOutcome(e.target.value)}
              error={err(state, "outcome")}
            >
              {OUTCOMES.map((o) => (
                <option key={o} value={o}>
                  {OUTCOME_LABELS[o]}
                </option>
              ))}
            </SelectField>
            <SelectField
              label="Functional check"
              name="functionalCheck"
              id="functionalCheck"
              defaultValue="PASS"
              error={err(state, "functionalCheck")}
            >
              {CHECKS.map((c) => (
                <option key={c} value={c}>
                  {CHECK_LABELS[c]}
                </option>
              ))}
            </SelectField>
            <SelectField
              label="Electrical safety test"
              name="electricalSafetyCheck"
              id="electricalSafetyCheck"
              defaultValue="PASS"
              error={err(state, "electricalSafetyCheck")}
            >
              {CHECKS.map((c) => (
                <option key={c} value={c}>
                  {CHECK_LABELS[c]}
                </option>
              ))}
            </SelectField>
          </div>
          <InputField
            label="Check notes (required if the electrical safety test is not applicable)"
            name="checkNotes"
            id="checkNotes"
            maxLength={1000}
            placeholder="e.g. Battery-only device; test analyser model and result reference"
            error={err(state, "checkNotes")}
          />
          {outcome === "NOT_REPAIRABLE" ? (
            <p className="bg-warn-bg rounded-sm px-3 py-2 text-sm text-[#6b3f00]">
              The device will stay Out of service. Request decommissioning from the asset page if it should be retired.
            </p>
          ) : null}
          <label className="bg-surface flex items-start gap-2 rounded-sm p-3 text-sm">
            <input type="checkbox" name="declaration" className="mt-0.5 size-4 accent-teal-700" />
            <span>
              <strong>I declare</strong> that I carried out this work and these checks myself, that the results are my
              own measurements, and that the device is safe to return to clinical use{" "}
              {outcome === "NOT_REPAIRABLE" ? "(not applicable: it stays out of service)" : ""}.
            </span>
          </label>
          {err(state, "declaration") ? (
            <p className="text-danger text-xs font-medium">{err(state, "declaration")!.join(" ")}</p>
          ) : null}
        </>
      )}
    </ActionForm>
  );
}

type PmItem = {
  key: string;
  label: string;
  section: string;
  kind: string;
  required: boolean;
  unit: string | null;
  min: number | null;
  max: number | null;
  guidance: string | null;
};

const SECTION_NAMES: Record<string, string> = {
  INSPECTION: "Inspection",
  FUNCTIONAL: "Functional test",
  SERVICING: "Cleaning / servicing",
  ELECTRICAL_SAFETY: "Electrical safety",
};

/**
 * Stage 6: sign-off of planned maintenance or a safety (re)test. Every item is
 * answered; the overall result is worked out on the server from the answers,
 * and a failed electrical safety item places a "Do Not Use" hold.
 */
export function PmCompleteForm({ id, items, standard }: { id: string; items: PmItem[]; standard: string | null }) {
  const [results, setResults] = useState<Record<string, string>>({});
  const anyFail = Object.values(results).includes("FAIL");
  const esFail = items.some((i) => i.section === "ELECTRICAL_SAFETY" && results[i.key] === "FAIL");
  return (
    <ActionForm action={pmCompleteAction} id={id} label="Sign off and complete">
      {(state) => (
        <>
          <fieldset className="flex flex-col gap-3">
            <legend className="text-sm font-semibold">Checklist</legend>
            {standard ? (
              <p className="text-ink-muted text-xs">Electrical safety items are recorded against {standard}.</p>
            ) : null}
            {items.map((item, i) => {
              const e = err(state, `item_${item.key}`);
              const limits =
                item.min !== null || item.max !== null
                  ? ` · limits ${item.min ?? "—"} to ${item.max ?? "—"} ${item.unit ?? ""}`
                  : "";
              return (
                <div key={item.key} className={`rounded-md border p-3 ${e ? "border-danger" : "border-line"}`}>
                  <input type="hidden" name="itemKey" value={item.key} />
                  <div className="text-sm font-semibold">
                    {i + 1}. {item.label}
                    {item.required ? "" : " (optional)"}
                  </div>
                  <div className="text-ink-muted text-xs">
                    {SECTION_NAMES[item.section] ?? item.section}
                    {limits}
                    {item.guidance ? ` · ${item.guidance}` : ""}
                  </div>
                  <div className="mt-2 grid gap-2 md:grid-cols-[auto_8rem_1fr] md:items-end">
                    <div
                      role="radiogroup"
                      aria-label={`Result for ${item.label}`}
                      className="flex flex-wrap gap-3 text-sm"
                    >
                      {CHECKS.map((c) => (
                        <label key={c} className="flex min-h-11 items-center gap-1.5">
                          <input
                            type="radio"
                            name={`result_${item.key}`}
                            value={c}
                            className="size-4 accent-teal-700"
                            onChange={() => setResults((r) => ({ ...r, [item.key]: c }))}
                          />
                          {CHECK_LABELS[c]}
                        </label>
                      ))}
                    </div>
                    {item.kind === "MEASUREMENT" ? (
                      <InputField
                        label={`Value (${item.unit ?? ""})`}
                        name={`value_${item.key}`}
                        id={`value_${item.key}`}
                        type="number"
                        step="any"
                        inputMode="decimal"
                      />
                    ) : (
                      <span />
                    )}
                    <InputField
                      label="Notes"
                      name={`notes_${item.key}`}
                      id={`notes_${item.key}`}
                      maxLength={500}
                      placeholder={results[item.key] === "FAIL" ? "What failed (required)" : "Optional"}
                    />
                  </div>
                  {e ? <p className="text-danger mt-1 text-xs font-medium">{e.join(" ")}</p> : null}
                </div>
              );
            })}
          </fieldset>
          <FieldShell label="Work done and findings" name="resolution" error={err(state, "resolution")}>
            <textarea id="resolution" name="resolution" required maxLength={2000} className={textarea} />
          </FieldShell>
          <FieldShell label="Other notes (optional)" name="diagnosis" error={err(state, "diagnosis")}>
            <textarea id="diagnosis" name="diagnosis" maxLength={2000} className={textarea} />
          </FieldShell>
          {esFail ? (
            <p role="alert" className="bg-danger-bg text-danger rounded-sm px-3 py-2 text-sm font-semibold">
              An electrical safety check failed. On sign-off the device is flagged “Failed Safety Test — Do Not Use”,
              taken out of service, and a repair job is created. It returns to service only after a passed retest
              approved by a second person.
            </p>
          ) : anyFail ? (
            <p className="bg-warn-bg rounded-sm px-3 py-2 text-sm text-[#6b3f00]">
              A check failed. On sign-off the device is taken out of use and a repair job is created.
            </p>
          ) : null}
          <label className="bg-surface flex items-start gap-2 rounded-sm p-3 text-sm">
            <input type="checkbox" name="declaration" className="mt-0.5 size-4 accent-teal-700" />
            <span>
              <strong>I declare</strong> that I carried out this work and these checks myself and that the results and
              measurements are my own. (Signing off does not by itself certify the device as safe for clinical use.)
            </span>
          </label>
          {err(state, "declaration") ? (
            <p className="text-danger text-xs font-medium">{err(state, "declaration")!.join(" ")}</p>
          ) : null}
          {state && !state.ok && state.fieldErrors?.answers ? (
            <p className="text-danger text-xs font-medium">{state.fieldErrors.answers.join(" ")}</p>
          ) : null}
        </>
      )}
    </ActionForm>
  );
}

export function ReviewForm({ id }: { id: string }) {
  return <ActionForm action={reviewAction} id={id} label="Mark as reviewed" variant="secondary" />;
}

export function ReopenForm({ id }: { id: string }) {
  return (
    <ActionForm
      action={reopenAction}
      id={id}
      label="Reopen job"
      variant="danger"
      confirm="Reopen this job? The device will be marked Under repair again."
    >
      {(state) => (
        <InputField
          label="Reason for reopening"
          name="reason"
          id="reopen-reason"
          required
          maxLength={500}
          error={err(state, "reason")}
        />
      )}
    </ActionForm>
  );
}

export function CancelForm({ id }: { id: string }) {
  return (
    <ActionForm action={cancelAction} id={id} label="Cancel job" variant="danger" confirm="Cancel this job?">
      {(state) => (
        <InputField
          label="Reason for cancelling"
          name="reason"
          id="cancel-reason"
          required
          maxLength={500}
          hint="Cancelling does not change the device's status; confirm separately that it is safe to use."
          error={err(state, "reason")}
        />
      )}
    </ActionForm>
  );
}

export function NoteForm({ id }: { id: string }) {
  return (
    <ActionForm action={noteAction} id={id} label="Add note" variant="secondary">
      {(state) => (
        <FieldShell label="Add a note" name="note" error={err(state, "note")}>
          <textarea
            id="note"
            name="note"
            required
            maxLength={2000}
            className={textarea}
            placeholder="No patient information."
          />
        </FieldShell>
      )}
    </ActionForm>
  );
}

export function PhotoUpload({ id, remaining }: { id: string; remaining: number }) {
  const router = useRouter();
  const [message, setMessage] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        const input = e.currentTarget.elements.namedItem("photo") as HTMLInputElement;
        const files = [...(input.files ?? [])];
        if (!files.length) return setMessage("Choose a photo first.");
        if (files.length > remaining) return setMessage(`You can add ${remaining} more photo(s).`);
        const bad = files.find((f) => f.size > MAX_PHOTO_BYTES || !(PHOTO_MIME as readonly string[]).includes(f.type));
        if (bad) return setMessage(`${bad.name} must be a JPEG, PNG or WebP photo of 5 MB or less.`);
        start(async () => {
          let failed = "";
          for (const file of files) {
            const body = new FormData();
            body.append("photo", file);
            const res = await fetch(`/work-orders/${id}/photos`, { method: "POST", body }).catch(() => null);
            if (!res || !res.ok) {
              const data = res ? ((await res.json().catch(() => null)) as { message?: string } | null) : null;
              failed = data?.message ?? "Upload failed.";
            }
          }
          setMessage(failed || "Photo added.");
          input.value = "";
          router.refresh();
        });
      }}
    >
      <label htmlFor="photo" className="text-sm font-semibold">
        Add photos ({remaining} more allowed)
      </label>
      <input
        id="photo"
        name="photo"
        type="file"
        multiple
        accept="image/jpeg,image/png,image/webp"
        className="text-sm"
      />
      <div>
        <Button type="submit" variant="secondary" disabled={pending}>
          {pending ? "Uploading…" : "Upload"}
        </Button>
      </div>
      {message ? (
        <p role="status" className="text-sm font-medium">
          {message}
        </p>
      ) : null}
    </form>
  );
}
