// Status labels for Stage 9: always an icon AND words, never colour alone.
import { ToneTag } from "@/components/analytics/ui";
import { FEEDBACK_LABELS, SESSION_STATUS_LABELS } from "@/lib/validation/knowledge";

/** Review and lifecycle state of a knowledge document. */
export function DocTag({ review, status }: { review: string; status: string }) {
  if (status === "WITHDRAWN") return <ToneTag tone="danger">Withdrawn — do not use</ToneTag>;
  if (status === "SUPERSEDED") return <ToneTag tone="warn">Superseded</ToneTag>;
  if (review === "APPROVED") return <ToneTag tone="ok">Approved</ToneTag>;
  return <ToneTag tone="warn">Draft — not reviewed</ToneTag>;
}

export function IndexTag({ status }: { status: string }) {
  if (status === "INDEXED") return <ToneTag tone="ok">Searchable</ToneTag>;
  if (status === "NO_TEXT") return <ToneTag tone="warn">No readable text</ToneTag>;
  if (status === "FAILED") return <ToneTag tone="danger">Could not be read</ToneTag>;
  return <ToneTag tone="warn">Waiting to be read</ToneTag>;
}

export function EvidenceTag({ evidence }: { evidence: string }) {
  return evidence === "SUPPORTED" ? (
    <ToneTag tone="ok">Supported by an approved source</ToneTag>
  ) : (
    <ToneTag tone="warn">Unverified — no approved source</ToneTag>
  );
}

export function FeedbackTag({ feedback }: { feedback: string }) {
  const tone = feedback === "ACCEPTED" ? "ok" : feedback === "REJECTED" ? "danger" : "warn";
  return <ToneTag tone={tone}>{FEEDBACK_LABELS[feedback] ?? feedback}</ToneTag>;
}

export function SessionTag({ status }: { status: string }) {
  const tone = status === "RESOLVED" ? "ok" : status === "UNRESOLVED" ? "danger" : "warn";
  return <ToneTag tone={tone}>{SESSION_STATUS_LABELS[status] ?? status}</ToneTag>;
}

/** Marks what a statement is: from records, entered by an engineer, or produced by the AI. */
export function KindChip({ kind }: { kind: "fact" | "observation" | "ai" | "question" }) {
  const label = {
    fact: "Fact from records",
    observation: "Engineer observation",
    ai: "AI suggestion",
    question: "Open question",
  }[kind];
  const cls = {
    fact: "bg-navy-900 text-white",
    observation: "bg-surface-sunken text-ink",
    ai: "bg-teal-400 text-navy-900",
    question: "bg-warn-bg text-warn",
  }[kind];
  return (
    <span className={`inline-flex rounded-sm px-1.5 py-0.5 text-[11px] font-semibold tracking-wide uppercase ${cls}`}>
      {label}
    </span>
  );
}
