// Status tags for Stage 8: always an icon AND words, never colour alone.
import { ToneTag, type Tone } from "@/components/analytics/ui";
import {
  PURCHASE_STATUS_LABELS,
  CLAIM_STATUS_LABELS,
  SERVICE_STATUS_LABELS,
  type ClaimStatusValue,
} from "@/lib/validation/inventory";

export function StockTag({ state }: { state: "out" | "low" | "ok" }) {
  if (state === "out") return <ToneTag tone="danger">Out of stock</ToneTag>;
  if (state === "low") return <ToneTag tone="warn">Low stock</ToneTag>;
  return <ToneTag tone="ok">In stock</ToneTag>;
}

const WARRANTY: Record<string, [Tone, string]> = {
  active: ["ok", "Active"],
  expiring: ["warn", "Expiring soon"],
  expired: ["danger", "Expired"],
  not_started: ["warn", "Not started yet"],
};
export function WarrantyTag({ state }: { state: string }) {
  const [tone, word] = WARRANTY[state] ?? ["warn", state];
  return <ToneTag tone={tone}>{word}</ToneTag>;
}

export function PurchaseTag({ status }: { status: string }) {
  const tone: Tone = ["REJECTED", "CANCELLED"].includes(status) ? "danger" : status === "RECEIVED" ? "ok" : "warn";
  return <ToneTag tone={tone}>{PURCHASE_STATUS_LABELS[status] ?? status}</ToneTag>;
}

export function ClaimTag({ status }: { status: string }) {
  const tone: Tone = status === "ACCEPTED" ? "ok" : status === "REJECTED" || status === "WITHDRAWN" ? "danger" : "warn";
  return <ToneTag tone={tone}>{CLAIM_STATUS_LABELS[status as ClaimStatusValue] ?? status}</ToneTag>;
}

export function ServiceTag({ status }: { status: string }) {
  const tone: Tone = status === "COMPLETED" ? "ok" : status === "CANCELLED" ? "danger" : "warn";
  return <ToneTag tone={tone}>{SERVICE_STATUS_LABELS[status as keyof typeof SERVICE_STATUS_LABELS] ?? status}</ToneTag>;
}

/** "Yes" / "No" / "Not recorded" for coverage answers — never assumed. */
export const recorded = (v: boolean | null | undefined) =>
  v === true ? "Yes (as recorded)" : v === false ? "No (as recorded)" : "Not recorded";
