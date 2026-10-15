import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { requireAccess } from "@/server/auth/session";
import { NotFoundError } from "@/server/authz/errors";
import { getSession } from "@/server/services/troubleshooting";
import { HAZARD_NOTICE } from "@/server/ai/safety";
import { PageHeader } from "@/components/shell/page-header";
import { Card, CardTitle } from "@/components/ui/card";
import { FieldShell, InputField, SelectField } from "@/components/ui/field";
import { ActionForm } from "@/components/forms/action-form";
import { Empty, fmtDateTime, recordLink, ToneTag } from "@/components/analytics/ui";
import { DocTag, EvidenceTag, FeedbackTag, KindChip, SessionTag } from "@/components/stage9/tags";
import {
  ENTRY_KIND_LABELS,
  ENTRY_KINDS,
  FEEDBACK,
  FEEDBACK_LABELS,
  TS_RESULT_LABELS,
  TS_RESULTS,
  VERIFICATION,
  VERIFICATION_LABELS,
} from "@/lib/validation/knowledge";
import {
  askAction,
  closeAction,
  detailsAction,
  entryAction,
  feedbackAction,
  reopenAction,
  rootCauseAction,
} from "../actions";

export const metadata: Metadata = { title: "Troubleshooting session" };

const SAVED: Record<string, string> = {
  started: "Session started. Record what you observe and test; AI suggestions are optional.",
  feedback: "Your assessment of the suggestion was recorded.",
  closed:
    "Session closed. The device and the work order were not changed — sign-off and return to service follow the work order and safety workflows.",
  reopened: "Session reopened.",
};
const REQUEST_STATUS: Record<string, string> = {
  SUCCEEDED: "Answered",
  NO_SOURCES: "Not sent — no approved source",
  DISABLED: "Not sent — AI switched off",
  RATE_LIMITED: "Not sent — usage limit",
  TIMEOUT: "Timed out",
  FAILED: "Provider unavailable",
  INVALID_RESPONSE: "Discarded — invalid reply",
};
const textarea = "min-h-20 w-full rounded-sm border border-line-strong bg-white px-3 py-2 text-sm text-ink";

function List({ title, items }: { title: string; items: string[] }) {
  if (!items.length) return null;
  return (
    <div>
      <p className="text-ink-muted text-xs font-semibold uppercase">{title}</p>
      <ul className="list-disc pl-5 text-sm">
        {items.map((x, i) => (
          <li key={i} className="whitespace-pre-line">
            {x}
          </li>
        ))}
      </ul>
    </div>
  );
}

function Detail({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-ink-muted text-xs font-semibold uppercase">{label}</dt>
      <dd className="text-sm whitespace-pre-line">{children}</dd>
    </div>
  );
}

type Answer = {
  missingInformation?: string[];
  clarifyingQuestions?: string[];
  isMock?: boolean;
  passages?: { label: string; title: string; page: number | null }[];
};

export default async function SessionPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await requireAccess();
  const { id } = await params;
  const sp = await searchParams;
  let d;
  try {
    d = await getSession(ctx, id);
  } catch (e) {
    if (e instanceof NotFoundError) notFound();
    throw e;
  }
  const {
    session: s,
    asset,
    entries,
    requests,
    suggestions,
    facts,
    undocumented,
    safetyCritical,
    hazards,
    names,
    ai,
    allowed,
  } = d;
  const saved = typeof sp.saved === "string" ? SAVED[sp.saved] : undefined;
  const latest = requests.find((r) => r.status === "SUCCEEDED");
  const latestAnswer = (latest?.answer ?? {}) as Answer;
  // Each answer's suggestions in the order the AI gave them; answers newest first.
  const requestOrder = new Map(requests.map((r, i) => [r.id, i]));
  const ordered = [...suggestions].sort(
    (a, b) => (requestOrder.get(a.requestId) ?? 0) - (requestOrder.get(b.requestId) ?? 0) || a.ordinal - b.ordinal,
  );
  const latestSuggestions = latest ? ordered.filter((x) => x.requestId === latest.id) : [];
  const earlierSuggestions = latest ? ordered.filter((x) => x.requestId !== latest.id) : ordered;
  const observations = entries.filter((e) => e.kind === "OBSERVATION" || e.kind === "TEST" || e.kind === "NOTE");
  const work = allowed.work;

  const suggestionCard = (x: (typeof suggestions)[number], showForm: boolean) => (
    <article
      key={x.id}
      className="border-line flex flex-col gap-3 rounded-md border p-4"
      aria-label={`Suggestion ${x.ordinal}`}
    >
      <div className="flex flex-wrap items-center gap-2">
        <KindChip kind="ai" />
        <EvidenceTag evidence={x.evidence} />
        <FeedbackTag feedback={x.feedback} />
      </div>
      <h3 className="text-base font-semibold">
        Possible cause {x.ordinal}: {x.cause}
      </h3>
      <List title="Observations that point to it" items={x.supportingObservations} />
      <List title="Recommended next checks" items={x.nextSteps} />
      <List title="What would confirm or rule it out" items={x.confirmRuleOut} />
      <List title="Tools and qualifications (from the cited source)" items={x.toolsQualifications} />
      {x.safetyNotes.length ? (
        <div className="bg-warn-bg rounded-md px-3 py-2 text-sm text-[#6b3f00]">
          <p className="text-xs font-semibold uppercase">Safety notes</p>
          <ul className="list-disc pl-5">
            {x.safetyNotes.map((n, i) => (
              <li key={i}>{n}</li>
            ))}
          </ul>
        </div>
      ) : null}
      <div>
        <p className="text-ink-muted text-xs font-semibold uppercase">References</p>
        {x.citations.length ? (
          <ul className="flex flex-col gap-2 text-sm">
            {x.citations.map((c) => (
              <li key={c.id} className="bg-surface-sunken rounded-sm px-3 py-2">
                <div className="flex flex-wrap items-center gap-2">
                  <Link href={`/knowledge/${c.document.id}`} className={recordLink}>
                    {c.document.title}
                  </Link>
                  {c.document.revision ? (
                    <span className="text-ink-muted text-xs">
                      {/^rev/i.test(c.document.revision) ? "" : "rev. "}
                      {c.document.revision}
                    </span>
                  ) : null}
                  <span className="text-ink-muted text-xs">version {c.version.versionNo}</span>
                  <DocTag review={c.document.reviewStatus} status={c.document.status} />
                  {c.document.currentVersionId !== c.version.id ? (
                    <ToneTag tone="warn">A newer version exists</ToneTag>
                  ) : null}
                </div>
                <p className="text-ink-muted mt-1 line-clamp-3 text-xs">
                  {c.chunk.heading ? `${c.chunk.heading} — ` : ""}
                  {c.chunk.content.slice(0, 320)}
                  {c.chunk.content.length > 320 ? "…" : ""}
                </p>
                <a
                  href={`/knowledge/files/${c.version.id}${c.pageFrom ? `#page=${c.pageFrom}` : ""}`}
                  className={`${recordLink} text-xs`}
                  target="_blank"
                  rel="noopener"
                >
                  {c.pageFrom ? `Open page ${c.pageFrom}` : "Open the document"}
                </a>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-warn text-sm">
            No approved source supports this suggestion. Treat it as an unverified idea.
          </p>
        )}
      </div>
      {x.feedbackAt ? (
        <p className="text-ink-muted text-xs">
          Assessed by {names[x.feedbackById ?? ""] ?? "Unknown"} on {fmtDateTime(x.feedbackAt)}
          {x.feedbackNote ? ` — ${x.feedbackNote}` : ""}
        </p>
      ) : null}
      {showForm ? (
        <ActionForm
          action={feedbackAction}
          hidden={{ suggestionId: x.id, sessionId: s.id }}
          label="Record assessment"
          variant="secondary"
          className="flex flex-wrap items-end gap-3"
        >
          <SelectField label="Your assessment" name="feedback" id={`fb-${x.id}`} defaultValue="">
            <option value="">Choose…</option>
            {FEEDBACK.map((f) => (
              <option key={f} value={f}>
                {FEEDBACK_LABELS[f]}
              </option>
            ))}
          </SelectField>
          <InputField label="Reason (optional)" name="note" id={`fbn-${x.id}`} maxLength={1000} />
        </ActionForm>
      ) : null}
    </article>
  );

  return (
    <>
      <PageHeader
        title={`Troubleshooting ${s.number}`}
        description={`${asset.assetTag} · ${asset.name} · ${asset.hospital.code}`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <SessionTag status={s.status} />
            <Link href={`/assets/${asset.id}`} className={recordLink}>
              Open asset
            </Link>
            {s.workOrder ? (
              <Link href={`/work-orders/${s.workOrder.id}`} className={recordLink}>
                Open {s.workOrder.number}
              </Link>
            ) : null}
          </div>
        }
      />
      {saved ? (
        <p role="status" className="bg-ok-bg text-ok rounded-md px-4 py-3 text-sm font-semibold">
          {saved}
        </p>
      ) : null}
      {hazards.length || safetyCritical ? (
        <div role="alert" className="bg-danger-bg text-danger rounded-md px-4 py-3 text-sm">
          <p className="font-semibold">
            {hazards.length ? `Possible hazard: ${hazards.join(", ")}.` : "Safety-critical device."} {HAZARD_NOTICE}
          </p>
        </div>
      ) : null}
      <p className="bg-surface-sunken rounded-md px-4 py-3 text-sm">
        AI suggestions are advisory only. They never change the device status, the work order, a safety hold or a
        maintenance schedule. Return to service follows the work order sign-off and, after a failed safety test, the
        independent safety-hold review.
      </p>

      <div className="grid gap-6 xl:grid-cols-[3fr_2fr]">
        <div className="flex min-w-0 flex-col gap-6">
          <Card>
            <CardTitle>Fault details</CardTitle>
            <div className="flex flex-wrap gap-2">
              <KindChip kind="observation" />
            </div>
            <dl className="grid gap-3 sm:grid-cols-2">
              <Detail label="Reported fault">{s.faultDescription}</Detail>
              <Detail label="Symptoms">{s.symptoms ?? "—"}</Detail>
              <Detail label="Error codes">
                {s.errorCodes.length ? <span className="font-mono">{s.errorCodes.join(", ")}</span> : "—"}
              </Detail>
              <Detail label="Alarms">{s.alarms ?? "—"}</Detail>
              <Detail label="Operating conditions">{s.operatingConditions ?? "—"}</Detail>
              <Detail label="Started">
                {fmtDateTime(s.createdAt)} · {names[s.startedById] ?? "Unknown"}
              </Detail>
            </dl>
            {work ? (
              <details>
                <summary className="cursor-pointer text-sm font-semibold text-teal-700">Edit details</summary>
                <ActionForm
                  action={detailsAction}
                  hidden={{ id: s.id }}
                  label="Save details"
                  variant="secondary"
                  resetOnSuccess={false}
                  className="mt-3 flex flex-col gap-3"
                >
                  <FieldShell label="Reported fault" name="sd-fault">
                    <textarea
                      id="sd-fault"
                      name="faultDescription"
                      className={textarea}
                      defaultValue={s.faultDescription}
                    />
                  </FieldShell>
                  <FieldShell label="Symptoms" name="sd-symptoms">
                    <textarea id="sd-symptoms" name="symptoms" className={textarea} defaultValue={s.symptoms ?? ""} />
                  </FieldShell>
                  <div className="grid gap-3 md:grid-cols-2">
                    <InputField
                      label="Error codes"
                      name="errorCodes"
                      id="sd-codes"
                      defaultValue={s.errorCodes.join(", ")}
                      className="font-mono"
                    />
                    <InputField label="Alarms" name="alarms" id="sd-alarms" defaultValue={s.alarms ?? ""} />
                  </div>
                  <FieldShell label="Operating conditions" name="sd-cond">
                    <textarea
                      id="sd-cond"
                      name="operatingConditions"
                      className={textarea}
                      defaultValue={s.operatingConditions ?? ""}
                    />
                  </FieldShell>
                  <p className="text-ink-muted text-xs">The previous wording is kept in the session history.</p>
                </ActionForm>
              </details>
            ) : null}
          </Card>

          <Card>
            <CardTitle>Facts from BiomedIntel.ai records</CardTitle>
            <p className="text-ink-muted text-xs">
              Taken from the asset register, work orders, safety tests and approved documents — not from the AI.
            </p>
            <ul className="flex flex-col gap-2 text-sm">
              {facts.map((f, i) => (
                <li key={i} className="flex flex-wrap items-baseline gap-2">
                  <KindChip kind="fact" />
                  <span className="font-semibold">{f.label}:</span>
                  {f.href ? (
                    <Link href={f.href} className={recordLink}>
                      {f.text}
                    </Link>
                  ) : (
                    <span>{f.text}</span>
                  )}
                </li>
              ))}
            </ul>
            {undocumented.length ? (
              <p className="bg-warn-bg rounded-md px-3 py-2 text-sm text-[#6b3f00]">
                <KindChip kind="question" /> No approved document explains error code
                {undocumented.length > 1 ? "s" : ""} <span className="font-mono">{undocumented.join(", ")}</span>. Its
                meaning is unverified — check the manufacturer&apos;s service documentation.
              </p>
            ) : null}
          </Card>

          <Card>
            <CardTitle>Observations and tests</CardTitle>
            {observations.length ? (
              <ul className="flex flex-col gap-2 text-sm">
                {observations.map((e) => (
                  <li key={e.id} className="border-line border-t pt-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <KindChip kind="observation" />
                      <span className="font-semibold">{ENTRY_KIND_LABELS[e.kind]}</span>
                      {e.testName ? <span>· {e.testName}</span> : null}
                      {e.result ? (
                        <ToneTag tone={e.result === "NORMAL" ? "ok" : e.result === "ABNORMAL" ? "danger" : "warn"}>
                          {TS_RESULT_LABELS[e.result]}
                        </ToneTag>
                      ) : null}
                      <span className="text-ink-muted text-xs">
                        {fmtDateTime(e.createdAt)} · {names[e.authorId] ?? "Unknown"}
                      </span>
                    </div>
                    <p className="whitespace-pre-line">{e.text}</p>
                  </li>
                ))}
              </ul>
            ) : (
              <Empty>Nothing recorded yet.</Empty>
            )}
            {work ? (
              <ActionForm
                action={entryAction}
                hidden={{ sessionId: s.id }}
                label="Record"
                className="flex flex-col gap-3"
              >
                <div className="grid gap-3 md:grid-cols-3">
                  <SelectField label="What are you recording" name="kind" id="te-kind" defaultValue="OBSERVATION">
                    {ENTRY_KINDS.map((k) => (
                      <option key={k} value={k}>
                        {ENTRY_KIND_LABELS[k]}
                      </option>
                    ))}
                  </SelectField>
                  <InputField label="Test name (tests only)" name="testName" id="te-test" maxLength={200} />
                  <SelectField label="Result (tests only)" name="result" id="te-result" defaultValue="">
                    <option value="">—</option>
                    {TS_RESULTS.map((r) => (
                      <option key={r} value={r}>
                        {TS_RESULT_LABELS[r]}
                      </option>
                    ))}
                  </SelectField>
                </div>
                <FieldShell label="What you found" name="te-text">
                  <textarea id="te-text" name="text" className={textarea} />
                </FieldShell>
              </ActionForm>
            ) : null}
          </Card>

          <Card>
            <CardTitle>Root cause, corrective action and verification</CardTitle>
            <dl className="grid gap-3 sm:grid-cols-2">
              <Detail label="Confirmed root cause">
                {s.rootCause ? (
                  <>
                    {s.rootCause}
                    <span className="text-ink-muted block text-xs">
                      {names[s.rootCauseById ?? ""] ?? "Unknown"} · {fmtDateTime(s.rootCauseAt)}
                    </span>
                  </>
                ) : (
                  "Not confirmed yet"
                )}
              </Detail>
              <Detail label="Corrective action">{s.correctiveAction ?? "—"}</Detail>
              <Detail label="Verification">
                {s.verificationOutcome ? VERIFICATION_LABELS[s.verificationOutcome] : "—"}
                {s.verificationNote ? `: ${s.verificationNote}` : ""}
              </Detail>
              <Detail label="Closed">
                {s.closedAt ? `${fmtDateTime(s.closedAt)} · ${names[s.closedById ?? ""] ?? "Unknown"}` : "—"}
              </Detail>
            </dl>
            {work ? (
              <>
                <ActionForm
                  action={rootCauseAction}
                  hidden={{ id: s.id }}
                  label={s.rootCause ? "Change root cause" : "Record root cause"}
                  variant="secondary"
                >
                  <FieldShell label="Confirmed root cause (what you found, not what the AI suggested)" name="rc-text">
                    <textarea id="rc-text" name="rootCause" className={textarea} />
                  </FieldShell>
                </ActionForm>
                <details>
                  <summary className="cursor-pointer text-sm font-semibold text-teal-700">Close the session</summary>
                  <ActionForm
                    action={closeAction}
                    hidden={{ id: s.id }}
                    label="Close session"
                    className="mt-3 flex flex-col gap-3"
                  >
                    <SelectField label="Outcome" name="outcome" id="cl-outcome" defaultValue="">
                      <option value="">Choose…</option>
                      <option value="RESOLVED">Resolved — root cause confirmed</option>
                      <option value="UNRESOLVED">Closed without a confirmed cause</option>
                    </SelectField>
                    <FieldShell label="Corrective action (required when resolved)" name="cl-action">
                      <textarea id="cl-action" name="correctiveAction" className={textarea} />
                    </FieldShell>
                    <SelectField
                      label="Verification (required when resolved)"
                      name="verificationOutcome"
                      id="cl-ver"
                      defaultValue=""
                    >
                      <option value="">—</option>
                      {VERIFICATION.map((v) => (
                        <option key={v} value={v}>
                          {VERIFICATION_LABELS[v]}
                        </option>
                      ))}
                    </SelectField>
                    <FieldShell label="Verification details (tests repeated, readings)" name="cl-vnote">
                      <textarea id="cl-vnote" name="verificationNote" className={textarea} />
                    </FieldShell>
                    <p className="text-ink-muted text-xs">
                      Closing the session does not complete the work order or return the device to service. Use the work
                      order sign-off and, where a safety test failed, the safety-hold review.
                    </p>
                  </ActionForm>
                </details>
              </>
            ) : null}
            {allowed.reopen ? (
              <ActionForm action={reopenAction} hidden={{ id: s.id }} label="Reopen session" variant="secondary">
                <InputField label="Reason for reopening" name="reason" id="ro-reason" maxLength={500} />
              </ActionForm>
            ) : null}
          </Card>
        </div>

        <div className="flex min-w-0 flex-col gap-6">
          <Card>
            <CardTitle>IntellAssist suggestions</CardTitle>
            <p className="text-sm">
              {!ai.enabled
                ? "AI suggestions are switched off for your organisation. Manual troubleshooting and the knowledge base still work."
                : !ai.configured
                  ? "No AI provider is configured on the server. Manual troubleshooting and the knowledge base still work."
                  : ai.isMock
                    ? "Provider: Mock AI (test only) — answers are generated by a deterministic test stand-in, not a real model."
                    : `Provider: ${ai.provider} · model ${ai.model}`}
            </p>
            {work && ai.enabled && ai.configured ? (
              <ActionForm
                action={askAction}
                hidden={{ sessionId: s.id }}
                label="Ask IntellAssist"
                className="flex flex-col gap-3"
              >
                <FieldShell label="Your question (optional)" name="ask-q">
                  <textarea
                    id="ask-q"
                    name="question"
                    className={textarea}
                    maxLength={1000}
                    placeholder="e.g. What could cause E-207 after a battery change?"
                  />
                </FieldShell>
                <label className="flex items-start gap-2 text-sm">
                  <input type="checkbox" name="allowUnverified" className="mt-1 accent-teal-700" />
                  <span>Ask even if no approved document matches (suggestions will be marked unverified)</span>
                </label>
                <p className="text-ink-muted text-xs">
                  Sent: the device model, the fault details, your observations and matching approved passages. Not sent:
                  names, patient information or attachments.
                </p>
              </ActionForm>
            ) : null}
            {latest ? (
              <div className="flex flex-col gap-3">
                <p className="text-ink-muted text-xs">
                  Latest answer {fmtDateTime(latest.createdAt)} ·{" "}
                  {latestAnswer.isMock ? "Mock AI (test only)" : `${latest.provider} ${latest.model}`}
                  {latest.safetyFlags.length ? ` · checks applied: ${latest.safetyFlags.join(", ")}` : ""}
                </p>
                {latestAnswer.missingInformation?.length ? (
                  <div className="bg-surface-sunken rounded-md px-3 py-2">
                    <KindChip kind="question" />
                    <List title="Missing or unverified information" items={latestAnswer.missingInformation} />
                  </div>
                ) : null}
                {latestAnswer.clarifyingQuestions?.length ? (
                  <div className="bg-surface-sunken rounded-md px-3 py-2">
                    <KindChip kind="question" />
                    <List title="Questions that would narrow it down" items={latestAnswer.clarifyingQuestions} />
                  </div>
                ) : null}
                {latestSuggestions.length ? (
                  latestSuggestions.map((x) => suggestionCard(x, work))
                ) : (
                  <Empty>The AI did not propose a cause.</Empty>
                )}
              </div>
            ) : (
              <Empty>No AI suggestions yet.</Empty>
            )}
            {earlierSuggestions.length ? (
              <details>
                <summary className="cursor-pointer text-sm font-semibold text-teal-700">
                  Earlier suggestions ({earlierSuggestions.length})
                </summary>
                <div className="mt-3 flex flex-col gap-3">{earlierSuggestions.map((x) => suggestionCard(x, work))}</div>
              </details>
            ) : null}
          </Card>

          <Card>
            <CardTitle>AI request log</CardTitle>
            {requests.length ? (
              <ul className="flex flex-col gap-2 text-xs">
                {requests.map((r) => (
                  <li key={r.id} className="border-line border-t pt-2">
                    <span className="font-semibold">{REQUEST_STATUS[r.status] ?? r.status}</span> ·{" "}
                    {fmtDateTime(r.createdAt)} · {names[r.requestedById] ?? "Unknown"}
                    {r.provider
                      ? ` · ${(r.answer as Answer | null)?.isMock ? "Mock AI (test only)" : `${r.provider} ${r.model ?? ""}`}`
                      : ""}
                    {r.inputTokens !== null ? ` · ${r.inputTokens} in / ${r.outputTokens ?? 0} out tokens` : ""}
                    {r.errorCode ? ` · ${r.errorCode}` : ""}
                    {r.unverifiedAllowed ? " · unverified allowed" : ""}
                  </li>
                ))}
              </ul>
            ) : (
              <Empty>No requests.</Empty>
            )}
          </Card>

          <Card>
            <CardTitle>History</CardTitle>
            <ol className="flex flex-col gap-2 text-xs">
              {entries.map((e) => (
                <li key={e.id} className="border-line border-t pt-2">
                  <span className="font-semibold">{ENTRY_KIND_LABELS[e.kind] ?? e.kind}</span> ·{" "}
                  {fmtDateTime(e.createdAt)} · {names[e.authorId] ?? "Unknown"}
                  <p className="text-sm whitespace-pre-line">{e.text}</p>
                </li>
              ))}
            </ol>
            {!entries.length ? <Empty>No history yet.</Empty> : null}
          </Card>
        </div>
      </div>
    </>
  );
}
