"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { InputField } from "@/components/ui/field";
import { addRateAction, type RateFormState } from "./actions";

const err = (s: RateFormState | null, k: string) => (s && !s.ok ? s.fieldErrors?.[k] : undefined);

export function RateForm({ userId, name, today }: { userId: string; name: string; today: string }) {
  const [state, action, pending] = useActionState(addRateAction, null);
  return (
    <form action={action} key={state?.attempt ?? 0} className="flex flex-wrap items-end gap-3">
      <input type="hidden" name="userId" value={userId} />
      <InputField
        label="Hourly rate"
        name="hourlyRate"
        id={`rate-${userId}`}
        inputMode="decimal"
        required
        error={err(state, "hourlyRate")}
        className="w-32"
      />
      <InputField
        label="Currency"
        name="currency"
        id={`cur-${userId}`}
        required
        maxLength={3}
        placeholder="USD"
        error={err(state, "currency")}
        className="w-24"
      />
      <InputField
        label="From"
        name="effectiveFrom"
        id={`from-${userId}`}
        type="date"
        required
        defaultValue={today}
        error={err(state, "effectiveFrom")}
      />
      <Button type="submit" disabled={pending} aria-label={`Save rate for ${name}`}>
        {pending ? "Saving…" : "Save rate"}
      </Button>
      {state ? (
        <p role={state.ok ? "status" : "alert"} className={state.ok ? "text-ok text-sm" : "text-danger text-sm"}>
          {state.message}
        </p>
      ) : null}
    </form>
  );
}
