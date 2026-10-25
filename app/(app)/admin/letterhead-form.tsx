"use client";

// Contact details printed on exported reports (Organisation Administrator).
import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { FieldShell, InputField } from "@/components/ui/field";
import type { Letterhead } from "@/lib/validation/letterhead";
import type { ActionResult } from "@/server/actions/result";
import { setLetterheadAction } from "./actions";

const err = (s: ActionResult | null, k: string) => (s && !s.ok ? s.fieldErrors?.[k] : undefined);
const area = "border-line-strong text-ink min-h-20 w-full rounded-sm border bg-white px-3 py-2 text-sm";

export function LetterheadForm({ current }: { current: Letterhead | null }) {
  const [state, action, pending] = useActionState(setLetterheadAction, null);
  return (
    <form action={action} className="grid max-w-3xl gap-4 md:grid-cols-2">
      <div className="md:col-span-2">
        <FieldShell
          label="Address"
          name="address"
          error={err(state, "address")}
          hint="One line per row. Printed at the top right of every report."
        >
          <textarea
            id="address"
            name="address"
            defaultValue={current?.address ?? ""}
            maxLength={400}
            className={area}
          />
        </FieldShell>
      </div>
      <InputField label="Telephone" name="phone" defaultValue={current?.phone ?? ""} error={err(state, "phone")} />
      <InputField
        label="Email address"
        name="email"
        type="email"
        defaultValue={current?.email ?? ""}
        error={err(state, "email")}
      />
      <InputField label="Website" name="website" defaultValue={current?.website ?? ""} error={err(state, "website")} />
      <InputField
        label="Registration or licence number"
        name="registration"
        defaultValue={current?.registration ?? ""}
        error={err(state, "registration")}
        hint="Printed at the bottom of every page."
      />
      <div className="md:col-span-2">
        <FieldShell
          label="Other information"
          name="note"
          error={err(state, "note")}
          hint="For example a tax number or a line required by your customer. Printed at the bottom of every page."
        >
          <textarea id="note" name="note" defaultValue={current?.note ?? ""} maxLength={400} className={area} />
        </FieldShell>
      </div>
      <div className="flex items-center gap-3 md:col-span-2">
        <Button type="submit" variant="secondary" disabled={pending}>
          {pending ? "Saving…" : "Save contact details"}
        </Button>
        {state ? (
          <p
            role={state.ok ? "status" : "alert"}
            className={state.ok ? "text-sm font-medium" : "text-danger text-sm font-medium"}
          >
            {state.message}
          </p>
        ) : null}
      </div>
    </form>
  );
}
