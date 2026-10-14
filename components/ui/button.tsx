import { forwardRef, type ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/cn";

type Variant = "primary" | "secondary" | "ghost" | "danger";

const variants: Record<Variant, string> = {
  // Teal fill with navy text: 7.9:1 contrast.
  primary: "bg-teal-400 text-navy-900 border-teal-400 hover:bg-teal-500",
  secondary: "bg-white text-navy-900 border-line-strong hover:bg-surface-sunken",
  ghost: "bg-transparent text-teal-700 border-transparent hover:bg-surface-sunken",
  danger: "bg-white text-danger border-danger/40 hover:bg-danger-bg",
};

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant };

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant = "primary", type = "button", ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={cn(
        "inline-flex min-h-11 items-center justify-center gap-2 rounded-md border px-4 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-60",
        variants[variant],
        className,
      )}
      {...props}
    />
  );
});
