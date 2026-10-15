"use client";

import { useActionState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { InputField, SelectField } from "@/components/ui/field";
import { EDITABLE_STATUSES, STATUS_LABELS } from "@/lib/validation/assets";
import {
  addWarrantyAction,
  archiveAssetAction,
  cancelDecommissionAction,
  changeStatusAction,
  decideDecommissionAction,
  requestDecommissionAction,
  restoreAssetAction,
  type FormState,
} from "../actions";

type Action = (prev: FormState | null, form: FormData) => Promise<FormState>;

export function Feedback({ state }: { state: FormState | null }) {
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

const err = (state: FormState | null, key: string) => (state && !state.ok ? state.fieldErrors?.[key] : undefined);

/** A form with hidden fields, a confirmation prompt and inline feedback. */
function ConfirmForm({
  action,
  hidden,
  label,
  confirm,
  variant = "secondary",
  children,
}: {
  action: Action;
  hidden: Record<string, string>;
  label: string;
  confirm?: string;
  variant?: "primary" | "secondary" | "danger";
  children?: ReactNode;
}) {
  const [state, formAction, pending] = useActionState(action, null);
  return (
    <form
      action={formAction}
      onSubmit={(e) => {
        if (confirm && !window.confirm(confirm)) e.preventDefault();
      }}
      className="flex flex-col gap-2"
    >
      {Object.entries(hidden).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
      {children}
      <div>
        <Button type="submit" variant={variant} disabled={pending}>
          {pending ? "Working…" : label}
        </Button>
      </div>
      <Feedback state={state} />
    </form>
  );
}

export function QuickStatusForm({
  assetId,
  status,
  locationId,
  locations,
}: {
  assetId: string;
  status: string;
  locationId: string | null;
  locations: { id: string; name: string }[];
}) {
  const [state, action, pending] = useActionState(changeStatusAction, null);
  return (
    <form action={action} className="grid gap-3 md:grid-cols-[1fr_1fr_2fr_auto] md:items-end">
      <input type="hidden" name="id" value={assetId} />
      {/* Keyed by the saved value so each list shows it again after a save. */}
      <SelectField
        key={`s-${status}`}
        label="Status"
        name="status"
        id="quick-status"
        defaultValue={status}
        error={err(state, "status")}
      >
        {EDITABLE_STATUSES.map((s) => (
          <option key={s} value={s}>
            {STATUS_LABELS[s]}
          </option>
        ))}
      </SelectField>
      <SelectField
        key={`l-${locationId}`}
        label="Room or location"
        name="locationId"
        id="quick-location"
        defaultValue={locationId ?? ""}
      >
        <option value="">Not specified</option>
        {locations.map((l) => (
          <option key={l.id} value={l.id}>
            {l.name}
          </option>
        ))}
      </SelectField>
      <InputField
        label="Reason (optional)"
        name="reason"
        id="quick-reason"
        maxLength={500}
        placeholder="e.g. Alarm fault, removed from ward"
        error={err(state, "reason")}
      />
      <Button type="submit" disabled={pending}>
        {pending ? "Saving…" : "Update"}
      </Button>
      <div className="md:col-span-4">
        <Feedback state={state} />
      </div>
    </form>
  );
}

export function ArchiveForm({ assetId, tag }: { assetId: string; tag: string }) {
  return (
    <ConfirmForm
      action={archiveAssetAction}
      hidden={{ id: assetId }}
      label="Archive asset"
      variant="danger"
      confirm={`Archive ${tag}? It will be hidden from the register but its history is kept. You can restore it later.`}
    />
  );
}

export function RestoreForm({ assetId }: { assetId: string }) {
  return <ConfirmForm action={restoreAssetAction} hidden={{ id: assetId }} label="Restore asset" />;
}

export function DecommissionRequestForm({ assetId }: { assetId: string }) {
  const [state, action, pending] = useActionState(requestDecommissionAction, null);
  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="id" value={assetId} />
      <InputField
        label="Reason for decommissioning"
        name="reason"
        id="decom-reason"
        required
        minLength={5}
        maxLength={1000}
        placeholder="e.g. Beyond economical repair; replaced by a new unit"
        error={err(state, "reason")}
      />
      <InputField
        label="Proposed date (optional)"
        name="effectiveOn"
        id="decom-date"
        type="date"
        error={err(state, "effectiveOn")}
      />
      <div>
        <Button type="submit" variant="danger" disabled={pending}>
          {pending ? "Sending…" : "Request decommissioning"}
        </Button>
      </div>
      <Feedback state={state} />
    </form>
  );
}

export function DecisionForm({ requestId }: { requestId: string }) {
  const [state, action, pending] = useActionState(decideDecommissionAction, null);
  return (
    <form action={action} className="mt-3 grid gap-3 md:grid-cols-[2fr_auto_auto] md:items-end">
      <input type="hidden" name="requestId" value={requestId} />
      <InputField
        label="Note (required to reject)"
        name="note"
        id={`note-${requestId}`}
        maxLength={500}
        error={err(state, "note")}
      />
      <Button type="submit" name="decision" value="APPROVE" disabled={pending}>
        Approve
      </Button>
      <Button type="submit" name="decision" value="REJECT" variant="danger" disabled={pending}>
        Reject
      </Button>
      <div className="md:col-span-3">
        <Feedback state={state} />
      </div>
    </form>
  );
}

export function CancelRequestForm({ requestId }: { requestId: string }) {
  return (
    <ConfirmForm
      action={cancelDecommissionAction}
      hidden={{ id: requestId }}
      label="Withdraw request"
      confirm="Withdraw this decommissioning request?"
    />
  );
}

export function WarrantyForm({ assetId }: { assetId: string }) {
  const [state, action, pending] = useActionState(addWarrantyAction, null);
  return (
    <form action={action} className="bg-surface grid gap-3 rounded-md p-4 md:grid-cols-3">
      <input type="hidden" name="assetId" value={assetId} />
      <SelectField label="Type" name="kind" id="w-kind" defaultValue="WARRANTY">
        <option value="WARRANTY">Manufacturer warranty</option>
        <option value="SERVICE_CONTRACT">Service contract</option>
      </SelectField>
      <InputField label="Provider" name="provider" id="w-provider" required error={err(state, "provider")} />
      <InputField label="Coverage (optional)" name="coverage" id="w-coverage" error={err(state, "coverage")} />
      <InputField label="Start date" name="startsOn" id="w-start" type="date" error={err(state, "startsOn")} />
      <InputField label="End date" name="endsOn" id="w-end" type="date" required error={err(state, "endsOn")} />
      <div className="flex items-end">
        <Button type="submit" variant="secondary" disabled={pending}>
          {pending ? "Adding…" : "Add warranty or contract"}
        </Button>
      </div>
      <div className="md:col-span-3">
        <Feedback state={state} />
      </div>
    </form>
  );
}
