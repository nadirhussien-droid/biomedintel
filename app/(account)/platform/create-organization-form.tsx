"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { InputField } from "@/components/ui/field";
import { createOrganizationAction } from "./actions";

export function CreateOrganizationForm() {
  const [state, action, pending] = useActionState(createOrganizationAction, null);
  const err = (k: string) => (state && !state.ok ? state.fieldErrors?.[k] : undefined);
  return (
    <form action={action} className="flex flex-col gap-3">
      <div className="grid gap-3 md:grid-cols-3">
        <InputField label="Organisation name" name="name" required error={err("name")} />
        <InputField label="Short name (slug)" name="slug" required placeholder="coastal-health" error={err("slug")} />
        <InputField
          label="Country code"
          name="country"
          required
          placeholder="KE"
          maxLength={2}
          error={err("country")}
        />
        <InputField label="First administrator's name" name="adminName" required error={err("adminName")} />
        <InputField
          label="First administrator's email"
          name="adminEmail"
          type="email"
          required
          error={err("adminEmail")}
        />
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? "Creating…" : "Create organisation"}
        </Button>
        {state ? (
          <p className={state.ok ? "text-ok text-sm font-medium" : "text-danger text-sm font-medium"}>
            {state.message}
          </p>
        ) : null}
      </div>
      {state?.ok && state.data?.temporaryPassword ? (
        <div role="status" className="bg-warn-bg rounded-sm border border-[#e8c98c] p-3 text-sm text-[#6b3f00]">
          <p className="font-semibold">Temporary password for the new administrator (shown once):</p>
          <code className="text-ink mt-1 block font-mono text-base select-all">{state.data.temporaryPassword}</code>
        </div>
      ) : null}
    </form>
  );
}
