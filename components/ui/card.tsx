import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/cn";

export function Card({ className, ...props }: HTMLAttributes<HTMLElement>) {
  return (
    <section
      className={cn(
        "border-line flex min-w-0 flex-col gap-4 rounded-md border bg-white p-5 shadow-[0_1px_2px_rgba(16,45,70,0.06),0_1px_3px_rgba(16,45,70,0.08)]",
        className,
      )}
      {...props}
    />
  );
}

export function CardTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h2 className="text-ink text-base font-semibold">{children}</h2>
      {action}
    </div>
  );
}

type Tone = "ok" | "warn" | "danger" | "info" | "neutral" | "demo";

const tones: Record<Tone, string> = {
  ok: "bg-ok-bg text-ok",
  warn: "bg-warn-bg text-warn",
  danger: "bg-danger-bg text-danger",
  info: "bg-info-bg text-info",
  neutral: "bg-surface-sunken text-ink-muted",
  demo: "bg-warn text-white",
};

export function Badge({ tone = "neutral", children }: { tone?: Tone; children: ReactNode }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-sm px-2 py-0.5 text-[11.5px] font-semibold tracking-wide whitespace-nowrap uppercase",
        tones[tone],
      )}
    >
      {children}
    </span>
  );
}
