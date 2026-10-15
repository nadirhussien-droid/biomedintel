import Link from "next/link";
import { Badge } from "@/components/ui/card";
import {
  DO_NOT_USE_LABEL,
  HOLD_STATUS_LABELS,
  OCCURRENCE_STATUS_LABELS,
  PLAN_STATUS_LABELS,
} from "@/lib/validation/pm";

const OCC_TONE: Record<string, "ok" | "warn" | "danger" | "info" | "neutral"> = {
  SCHEDULED: "info",
  WORK_ORDER_CREATED: "info",
  COMPLETED: "ok",
  CANCELLED: "neutral",
  MISSED: "danger",
  FAILED: "danger",
  SKIPPED: "neutral",
  PROJECTED: "neutral",
};

export function OccurrenceBadge({ status }: { status: string }) {
  return <Badge tone={OCC_TONE[status] ?? "neutral"}>{OCCURRENCE_STATUS_LABELS[status] ?? status}</Badge>;
}

/** Overdue / due today / upcoming — always written in words, not colour alone. */
export function DueStateBadge({ state }: { state: string | null }) {
  if (state === "overdue") return <Badge tone="danger">Overdue</Badge>;
  if (state === "due_today") return <Badge tone="warn">Due today</Badge>;
  if (state === "upcoming") return <Badge tone="info">Upcoming</Badge>;
  return null;
}

const PLAN_TONE = { DRAFT: "warn", ACTIVE: "ok", PAUSED: "neutral", ARCHIVED: "neutral" } as const;

export function PlanStatusBadge({ status }: { status: keyof typeof PLAN_TONE }) {
  return <Badge tone={PLAN_TONE[status]}>{PLAN_STATUS_LABELS[status].split(" —")[0]}</Badge>;
}

export function HoldStatusBadge({ status }: { status: string }) {
  return <Badge tone={status === "RELEASED" ? "ok" : "danger"}>{HOLD_STATUS_LABELS[status] ?? status}</Badge>;
}

/** The red "Failed Safety Test — Do Not Use" banner shown wherever the device appears. */
export function DoNotUseBanner({ holdId, status }: { holdId: string; status: string }) {
  return (
    <div
      role="alert"
      className="border-danger bg-danger-bg text-danger flex flex-wrap items-center justify-between gap-3 rounded-md border-2 px-4 py-3"
    >
      <div>
        <p className="text-base font-bold tracking-wide uppercase">{DO_NOT_USE_LABEL}</p>
        <p className="text-sm">
          {HOLD_STATUS_LABELS[status] ?? status}. This device can only return to service after repair, a passed retest
          and approval by a second, authorised person.
        </p>
      </div>
      <Link href={`/maintenance/holds/${holdId}`} className="text-sm font-semibold underline">
        View safety hold
      </Link>
    </div>
  );
}
