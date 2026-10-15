import { Badge } from "@/components/ui/card";
import { RISK_LABELS, STATUS_LABELS, type AssetStatusValue, type RiskClassValue } from "@/lib/validation/assets";

const STATUS_TONE = {
  IN_SERVICE: "ok",
  UNDER_REPAIR: "warn",
  OUT_OF_SERVICE: "danger",
  DECOMMISSIONED: "neutral",
} as const;

export function StatusBadge({ status, archived = false }: { status: AssetStatusValue; archived?: boolean }) {
  return (
    <span className="inline-flex flex-wrap gap-1">
      <Badge tone={STATUS_TONE[status]}>{STATUS_LABELS[status]}</Badge>
      {archived ? <Badge tone="neutral">Archived</Badge> : null}
    </span>
  );
}

export function RiskBadge({ risk }: { risk: RiskClassValue | null }) {
  if (!risk) return <span className="text-ink-muted text-xs">Not assessed</span>;
  return <Badge tone={risk === "HIGH" ? "danger" : risk === "MEDIUM" ? "warn" : "info"}>{RISK_LABELS[risk]}</Badge>;
}
