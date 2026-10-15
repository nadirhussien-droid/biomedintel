"use client";

import { useActionState, useState } from "react";
import type { ActionResult } from "@/server/actions/result";
import { Button } from "@/components/ui/button";
import { InputField, SelectField } from "@/components/ui/field";
import {
  addMemberAction,
  changeMemberRoleAction,
  createDepartmentAction,
  createHospitalAction,
  resetMemberMfaAction,
} from "./actions";

function Message({ state }: { state: ActionResult<unknown> | null }) {
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

const errors = (state: ActionResult<unknown> | null, key: string) =>
  state && !state.ok ? state.fieldErrors?.[key] : undefined;

export function CreateHospitalForm() {
  const [state, action, pending] = useActionState(createHospitalAction, null);
  return (
    <form
      action={action}
      className="bg-surface grid gap-3 rounded-md p-4 md:grid-cols-[2fr_1fr_1.5fr_auto] md:items-end"
    >
      <InputField label="New hospital name" name="name" required error={errors(state, "name")} />
      <InputField label="Code" name="code" required placeholder="RGH" error={errors(state, "code")} />
      <InputField
        label="Time zone"
        name="timezone"
        required
        defaultValue="Africa/Nairobi"
        error={errors(state, "timezone")}
      />
      <Button type="submit" disabled={pending}>
        {pending ? "Adding…" : "Add hospital"}
      </Button>
      <div className="md:col-span-4">
        <Message state={state} />
      </div>
    </form>
  );
}

export function CreateDepartmentForm({ hospitalId }: { hospitalId: string }) {
  const [state, action, pending] = useActionState(createDepartmentAction, null);
  return (
    <form action={action} className="mt-3 grid gap-3 md:grid-cols-[2fr_1fr_auto] md:items-end">
      <input type="hidden" name="hospitalId" value={hospitalId} />
      <InputField
        label="New department"
        name="name"
        id={`dept-name-${hospitalId}`}
        required
        error={errors(state, "name")}
      />
      <InputField
        label="Code"
        name="code"
        id={`dept-code-${hospitalId}`}
        required
        placeholder="ICU"
        error={errors(state, "code")}
      />
      <Button type="submit" variant="secondary" disabled={pending}>
        {pending ? "Adding…" : "Add department"}
      </Button>
      <div className="md:col-span-3">
        <Message state={state} />
      </div>
    </form>
  );
}

type RoleOption = { value: string; label: string };

export function ChangeRoleForm({
  membershipId,
  current,
  roles,
}: {
  membershipId: string;
  current: string;
  roles: RoleOption[];
}) {
  const [state, action, pending] = useActionState(changeMemberRoleAction, null);
  return (
    <form action={action} className="flex flex-col gap-1">
      <input type="hidden" name="membershipId" value={membershipId} />
      <div className="flex gap-2">
        <label className="sr-only" htmlFor={`role-${membershipId}`}>
          Role
        </label>
        <select
          id={`role-${membershipId}`}
          name="role"
          defaultValue={current}
          className="border-line-strong min-h-10 rounded-sm border bg-white px-2 text-sm"
        >
          {roles.map((r) => (
            <option key={r.value} value={r.value}>
              {r.label}
            </option>
          ))}
        </select>
        <Button type="submit" variant="secondary" className="min-h-10 px-3" disabled={pending}>
          Save
        </Button>
      </div>
      {state && !state.ok ? <Message state={state} /> : null}
    </form>
  );
}

type HospitalOption = { id: string; name: string; departments: { id: string; name: string }[] };

export function AddMemberForm({ roles, hospitals }: { roles: RoleOption[]; hospitals: HospitalOption[] }) {
  const [state, action, pending] = useActionState(addMemberAction, null);
  const [orgWide, setOrgWide] = useState(false);
  const [hospitalId, setHospitalId] = useState(hospitals[0]?.id ?? "");
  const departments = hospitals.find((h) => h.id === hospitalId)?.departments ?? [];

  return (
    <form action={action} className="bg-surface flex flex-col gap-3 rounded-md p-4">
      <div className="grid gap-3 md:grid-cols-3">
        <InputField label="Full name" name="name" required error={errors(state, "name")} />
        <InputField label="Email" name="email" type="email" required error={errors(state, "email")} />
        <SelectField label="Role" name="role" defaultValue="TECHNICIAN" error={errors(state, "role")}>
          {roles.map((r) => (
            <option key={r.value} value={r.value}>
              {r.label}
            </option>
          ))}
        </SelectField>
      </div>
      <label className="flex items-center gap-2 text-sm font-medium">
        <input
          type="checkbox"
          name="orgWide"
          checked={orgWide}
          onChange={(e) => setOrgWide(e.target.checked)}
          className="size-4 accent-teal-700"
        />
        Access to the whole organisation
      </label>
      {!orgWide ? (
        <div className="grid gap-3 md:grid-cols-2">
          <SelectField
            label="Hospital"
            name="hospitalId"
            value={hospitalId}
            onChange={(e) => setHospitalId(e.target.value)}
            error={errors(state, "hospitalId")}
          >
            {hospitals.map((h) => (
              <option key={h.id} value={h.id}>
                {h.name}
              </option>
            ))}
          </SelectField>
          <SelectField label="Department" name="departmentId" defaultValue="" error={errors(state, "departmentId")}>
            <option value="">All departments in this hospital</option>
            {departments.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </SelectField>
        </div>
      ) : null}
      {errors(state, "orgWide") ? (
        <p className="text-danger text-xs font-medium">{errors(state, "orgWide")!.join(" ")}</p>
      ) : null}
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? "Adding…" : "Add member"}
        </Button>
        <Message state={state} />
      </div>
      {state?.ok && state.data?.temporaryPassword ? (
        <div role="status" className="bg-warn-bg rounded-sm border border-[#e8c98c] p-3 text-sm text-[#6b3f00]">
          <p className="font-semibold">Temporary password (shown once):</p>
          <code className="text-ink mt-1 block font-mono text-base select-all">{state.data.temporaryPassword}</code>
          <p className="mt-1">
            Give it to the person through a secure channel. Email invitations replace this step in a later stage.
          </p>
        </div>
      ) : null}
    </form>
  );
}

/** Stage 6: MFA recovery for a member who lost both their authenticator and backup codes. */
export function ResetMfaForm({ membershipId, name }: { membershipId: string; name: string }) {
  const [state, action, pending] = useActionState(resetMemberMfaAction, null);
  const [open, setOpen] = useState(false);
  if (!open) {
    return (
      <button
        type="button"
        className="text-xs font-semibold text-teal-700 hover:underline"
        onClick={() => setOpen(true)}
      >
        Reset
      </button>
    );
  }
  return (
    <form
      action={action}
      className="flex min-w-56 flex-col gap-1"
      onSubmit={(e) => {
        if (
          !window.confirm(
            `Remove ${name}'s authenticator? They will be signed out everywhere and must set up a new one.`,
          )
        )
          e.preventDefault();
      }}
    >
      <input type="hidden" name="membershipId" value={membershipId} />
      <label className="text-xs font-semibold" htmlFor={`mfa-reason-${membershipId}`}>
        How did you confirm who they are?
      </label>
      <input
        id={`mfa-reason-${membershipId}`}
        name="reason"
        maxLength={300}
        className="border-line-strong min-h-10 rounded-sm border bg-white px-2 text-sm"
        placeholder="e.g. Checked staff ID in person"
      />
      <Button type="submit" variant="danger" className="min-h-10 px-3" disabled={pending}>
        Reset two-step verification
      </Button>
      <Message state={state} />
    </form>
  );
}
