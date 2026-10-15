import type { InputHTMLAttributes, ReactNode, Ref, SelectHTMLAttributes } from "react";
import { cn } from "@/lib/cn";

const control =
  "min-h-11 w-full rounded-sm border border-line-strong bg-white px-3 text-sm text-ink placeholder:text-ink-muted/70 disabled:bg-surface-sunken";

type FieldShellProps = { label: string; name: string; error?: string[]; hint?: string; children: ReactNode };

export function FieldShell({ label, name, error, hint, children }: FieldShellProps) {
  // `name` here is the control's id.
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={name} className="text-ink text-sm font-semibold">
        {label}
      </label>
      {children}
      {hint && !error?.length ? <p className="text-ink-muted text-xs">{hint}</p> : null}
      {error?.length ? (
        <p id={`${name}-error`} className="text-danger text-xs font-medium">
          {error.join(" ")}
        </p>
      ) : null}
    </div>
  );
}

type InputFieldProps = InputHTMLAttributes<HTMLInputElement> & {
  /** React 19 passes refs as an ordinary prop. */
  ref?: Ref<HTMLInputElement>;
  label: string;
  name: string;
  error?: string[];
  hint?: string;
};

export function InputField({ label, name, error, hint, className, id, ...props }: InputFieldProps) {
  const controlId = id ?? name;
  return (
    <FieldShell label={label} name={controlId} error={error} hint={hint}>
      <input
        {...props}
        id={controlId}
        name={name}
        aria-invalid={error?.length ? true : undefined}
        aria-describedby={error?.length ? `${controlId}-error` : undefined}
        className={cn(control, className)}
      />
    </FieldShell>
  );
}

type SelectFieldProps = SelectHTMLAttributes<HTMLSelectElement> & {
  label: string;
  name: string;
  error?: string[];
  hint?: string;
};

export function SelectField({ label, name, error, hint, className, children, id, ...props }: SelectFieldProps) {
  const controlId = id ?? name;
  return (
    <FieldShell label={label} name={controlId} error={error} hint={hint}>
      <select
        {...props}
        id={controlId}
        name={name}
        aria-invalid={error?.length ? true : undefined}
        aria-describedby={error?.length ? `${controlId}-error` : undefined}
        className={cn(control, className)}
      >
        {children}
      </select>
    </FieldShell>
  );
}
