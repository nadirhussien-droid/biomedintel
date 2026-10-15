"use client";

// A small form bound to one server action, usable from server components:
// the fields are passed in as ordinary children (rendered on the server), and
// problems are listed under the form with the field they belong to. Values are
// kept when the server reports a problem and cleared after a successful save.
import { useActionState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { useKeepValuesSubmit } from "./use-keep-values";

export type FormResult = {
  ok: boolean;
  message?: string;
  fieldErrors?: Record<string, string[]>;
  attempt?: number;
};
type Action = (prev: FormResult | null, form: FormData) => Promise<FormResult>;

export function ActionForm({
  action,
  hidden = {},
  label,
  variant = "primary",
  confirm,
  className = "flex flex-col gap-3",
  fieldLabels = {},
  resetOnSuccess = true,
  children,
}: {
  action: Action;
  hidden?: Record<string, string>;
  label: string;
  variant?: "primary" | "secondary" | "danger";
  confirm?: string;
  className?: string;
  fieldLabels?: Record<string, string>;
  resetOnSuccess?: boolean;
  children?: ReactNode;
}) {
  const [state, formAction, pending] = useActionState(action, null);
  const { formRef, onSubmit } = useKeepValuesSubmit(formAction, state, { confirm, resetOnSuccess });
  const problems = state && !state.ok ? Object.entries(state.fieldErrors ?? {}) : [];
  return (
    <form ref={formRef} onSubmit={onSubmit} className={className} noValidate>
      {Object.entries(hidden).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
      {children}
      <div>
        <Button type="submit" variant={variant} disabled={pending}>
          {pending ? "Working…" : label}
        </Button>
      </div>
      {state ? (
        <div
          role={state.ok ? "status" : "alert"}
          className={state.ok ? "text-ok text-sm font-medium" : "text-danger text-sm font-medium"}
        >
          <p>{state.message}</p>
          {problems.length ? (
            <ul className="mt-1 list-disc pl-5 text-xs">
              {problems.map(([k, v]) => (
                <li key={k}>
                  {fieldLabels[k] ?? k.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase())}: {v.join(" ")}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </form>
  );
}
