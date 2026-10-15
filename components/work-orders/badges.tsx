import { Badge } from "@/components/ui/card";
import {
  PRIORITY_LABELS,
  WO_STATUS_LABELS,
  type PriorityValue,
  type WorkOrderStatusValue,
} from "@/lib/validation/work-orders";

const STATUS_TONE = {
  REQUESTED: "info",
  ASSIGNED: "info",
  IN_PROGRESS: "warn",
  ON_HOLD: "warn",
  COMPLETED: "ok",
  CANCELLED: "neutral",
} as const;

const PRIORITY_TONE = { URGENT: "danger", HIGH: "danger", MEDIUM: "warn", LOW: "neutral" } as const;

export function WoStatusBadge({ status }: { status: WorkOrderStatusValue }) {
  return <Badge tone={STATUS_TONE[status]}>{WO_STATUS_LABELS[status]}</Badge>;
}

export function PriorityBadge({ priority }: { priority: PriorityValue }) {
  return <Badge tone={PRIORITY_TONE[priority]}>{PRIORITY_LABELS[priority]}</Badge>;
}

export function SafetyBadge() {
  return <Badge tone="danger">Safety-critical</Badge>;
}

export function OverdueBadge() {
  return <Badge tone="danger">Overdue</Badge>;
}
