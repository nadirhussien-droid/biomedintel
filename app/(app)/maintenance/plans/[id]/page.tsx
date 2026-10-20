import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAccess } from "@/server/auth/session";
import { NotFoundError } from "@/server/authz/errors";
import { getPlan } from "@/server/services/pm-plans";
import { PageHeader } from "@/components/shell/page-header";
import { Badge, Card, CardTitle } from "@/components/ui/card";
import { PlanStatusBadge } from "@/components/pm/badges";
import { addDays, formatDateOnly, fromDbDate, intervalLabel } from "@/lib/pm/dates";
import { todayFor } from "@/server/services/pm-schedule";
import { INTERVAL_SOURCE_LABELS, SECTION_LABELS, WORK_TYPE_LABELS } from "@/lib/validation/pm";
import { PRIORITY_LABELS } from "@/lib/validation/work-orders";
import {
  ApprovePlanForm,
  ArchivePlanForm,
  EndScheduleForm,
  EnrolForm,
  PausePlanForm,
  ResumePlanForm,
  ReviewPlanForm,
} from "../../forms";

export const metadata: Metadata = { title: "Maintenance plan" };

const dateTime = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" });
const SAVED: Record<string, string> = {
  created: "Plan saved as a draft. An Engineering Manager must approve it before any work is created.",
  updated: "Changes saved. They take effect when an Engineering Manager approves them.",
  approved: "Plan approved. New work orders use this version.",
  reviewed: "Interval review recorded.",
  paused: "Plan paused. No new work orders will be created.",
  resumed: "Plan resumed.",
  archived: "Plan archived. Its schedules have ended; history is kept.",
};

function Item({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-ink-muted text-xs font-semibold uppercase">{label}</dt>
      <dd className="mt-0.5 text-sm">{children}</dd>
    </div>
  );
}

export default async function PlanPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ saved?: string }>;
}) {
  const ctx = await requireAccess();
  const { id } = await params;
  const { saved } = await searchParams;
  const plan = await getPlan(ctx, id).catch((e) => {
    if (e instanceof NotFoundError) notFound();
    throw e;
  });
  const today = await todayFor(ctx, plan.hospitalId);
  const approved = plan.revisions.find((r) => r.id === plan.approvedRevisionId);
  const n = (id: string | null) => (id ? (plan.names[id] ?? "Unknown") : "—");
  const linkButton = "inline-flex min-h-11 items-center justify-center rounded-md border px-4 text-sm font-semibold";

  return (
    <>
      <PageHeader
        title={plan.name}
        description={`${WORK_TYPE_LABELS[plan.workType]} · ${plan.target}`}
        actions={
          <span className="flex flex-wrap items-center gap-2">
            {plan.hasUnapprovedChanges && plan.approvedRevisionId && plan.status !== "ARCHIVED" ? (
              <Badge tone="warn">Changes awaiting approval</Badge>
            ) : null}
            <PlanStatusBadge status={plan.status} />
            {plan.allowed.edit ? (
              <Link
                href={`/maintenance/plans/${plan.id}/edit`}
                className={`${linkButton} border-line-strong text-navy-900 bg-white`}
              >
                Edit
              </Link>
            ) : null}
          </span>
        }
      />
      {saved && SAVED[saved] ? (
        <p role="status" className="bg-ok-bg text-ok rounded-md px-4 py-3 text-sm font-medium">
          {SAVED[saved]}
        </p>
      ) : null}
      {plan.status === "DRAFT" ? (
        <p className="bg-warn-bg rounded-md border border-[#e8c98c] px-4 py-3 text-sm text-[#6b3f00]">
          Draft: this plan creates no work orders until an Engineering Manager approves it.
        </p>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
        <div className="flex flex-col gap-4">
          <Card>
            <CardTitle>Plan</CardTitle>
            <dl className="grid gap-3 sm:grid-cols-3">
              <Item label="Interval">{intervalLabel(plan.intervalCount, plan.intervalUnit)}</Item>
              <Item label="Interval source">{INTERVAL_SOURCE_LABELS[plan.intervalSource]}</Item>
              <Item label={plan.intervalSource === "ORGANIZATION_DEFINED" ? "Justification" : "Reference"}>
                {plan.intervalSource === "ORGANIZATION_DEFINED" ? plan.justification : plan.sourceReference}
              </Item>
              <Item label="Hospital">
                {plan.hospital ? `${plan.hospital.code} · ${plan.hospital.name}` : "Every hospital"}
              </Item>
              <Item label="Dates">
                From {formatDateOnly(fromDbDate(plan.startsOn))}
                {plan.endsOn ? ` to ${formatDateOnly(fromDbDate(plan.endsOn))}` : " (no end date)"}
              </Item>
              <Item label="Work order created">
                {plan.leadDays} days before due · {plan.graceDays} grace days
              </Item>
              <Item label="Priority">{PRIORITY_LABELS[plan.priority]}</Item>
              <Item label="Estimated time">{plan.estimatedMinutes ? `${plan.estimatedMinutes} min` : "—"}</Item>
              <Item label="Assigned to">{plan.defaultAssigneeId ? n(plan.defaultAssigneeId) : "Manager assigns"}</Item>
              <Item label="Required competency">{plan.requiredCompetency ?? "—"}</Item>
              <Item label="Service documentation">{plan.documentReference ?? "—"}</Item>
              <Item label="Next interval review">
                {plan.nextReviewOn ? formatDateOnly(fromDbDate(plan.nextReviewOn)) : "—"}
              </Item>
            </dl>
            {plan.model?.manufacturerPmIntervalCount ? (
              <p className="text-ink-muted text-xs">
                Manufacturer interval on record for this model:{" "}
                {intervalLabel(plan.model.manufacturerPmIntervalCount, plan.model.manufacturerPmIntervalUnit!)} (
                {plan.model.manufacturerPmReference}).
              </p>
            ) : null}
            {plan.description ? <p className="text-sm">{plan.description}</p> : null}
            {plan.instructions ? (
              <div>
                <h3 className="text-sm font-semibold">Instructions</h3>
                <p className="text-sm whitespace-pre-line">{plan.instructions}</p>
              </div>
            ) : null}
            {plan.status === "PAUSED" ? (
              <p className="bg-surface rounded-sm px-3 py-2 text-sm">
                Paused by {n(plan.pausedById)} on {plan.pausedAt ? dateTime.format(plan.pausedAt) : ""} UTC:{" "}
                {plan.pauseReason}
              </p>
            ) : null}
          </Card>

          <Card>
            <CardTitle
              action={
                <span className="text-ink-muted text-xs">
                  {approved ? `Approved version ${approved.revisionNo} is in use` : "Working copy"}
                </span>
              }
            >
              Checklist ({plan.checklistItems.length} items)
            </CardTitle>
            <ol className="flex list-decimal flex-col gap-1.5 pl-5 text-sm">
              {plan.checklistItems.map((i) => (
                <li key={i.key}>
                  <span className="font-medium">{i.label}</span>{" "}
                  <span className="text-ink-muted">
                    · {SECTION_LABELS[i.section]}
                    {i.kind === "MEASUREMENT"
                      ? ` · measure in ${i.unit}${i.min !== null || i.max !== null ? ` (limits ${i.min ?? "—"} to ${i.max ?? "—"})` : ""}`
                      : ""}
                    {i.required ? "" : " · optional"}
                  </span>
                  {i.guidance ? <div className="text-ink-muted text-xs">{i.guidance}</div> : null}
                </li>
              ))}
            </ol>
          </Card>

          <Card>
            <CardTitle
              action={<span className="text-ink-muted text-sm">{plan.eligible} matching asset(s) in your scope</span>}
            >
              Assets in this plan
            </CardTitle>
            {plan.schedules.length === 0 ? (
              <p className="text-ink-muted text-sm">No assets enrolled yet.</p>
            ) : (
              <div
                className="overflow-x-auto"
                tabIndex={0}
                role="region"
                aria-label="Table (scroll sideways on small screens)"
              >
                <table className="w-full text-sm">
                  <caption className="sr-only">Enrolled assets</caption>
                  <thead className="text-ink-muted text-left text-xs uppercase">
                    <tr>
                      <th className="py-2 pr-3">Asset</th>
                      <th className="py-2 pr-3">Where</th>
                      <th className="py-2 pr-3">Next due</th>
                      <th className="py-2 pr-3">Last done</th>
                      <th className="py-2 pr-3">Schedule</th>
                    </tr>
                  </thead>
                  <tbody>
                    {plan.schedules.map((s) => (
                      <tr key={s.id} className="border-line border-t align-top">
                        <td className="py-2 pr-3">
                          <Link
                            href={`/assets/${s.asset.id}#pm`}
                            className="font-mono font-semibold text-teal-700 hover:underline"
                          >
                            {s.asset.assetTag}
                          </Link>{" "}
                          {s.asset.name}
                        </td>
                        <td className="py-2 pr-3">
                          {s.asset.hospital.code} · {s.asset.department.name}
                        </td>
                        <td className="py-2 pr-3">
                          {s.status === "ACTIVE" ? formatDateOnly(fromDbDate(s.nextDueOn)) : "—"}
                        </td>
                        <td className="py-2 pr-3">{s.lastDoneOn ? formatDateOnly(fromDbDate(s.lastDoneOn)) : "—"}</td>
                        <td className="py-2 pr-3">
                          {s.status === "ACTIVE" ? (
                            plan.allowed.enrol ? (
                              <EndScheduleForm id={s.id} />
                            ) : (
                              <Badge tone="ok">Active</Badge>
                            )
                          ) : (
                            <span className="text-ink-muted text-xs">Ended: {s.endReason}</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {plan.allowed.enrol && plan.unenrolled.length ? (
              <EnrolForm
                id={plan.id}
                defaultDate={fromDbDate(plan.startsOn) > today ? fromDbDate(plan.startsOn) : today}
                assets={plan.unenrolled}
              />
            ) : plan.allowed.enrol ? (
              <p className="text-ink-muted text-sm">Every matching asset in your scope is enrolled.</p>
            ) : null}
          </Card>
        </div>

        <div className="flex flex-col gap-4">
          {plan.allowed.approve ? (
            <Card>
              <CardTitle>Approve</CardTitle>
              <ApprovePlanForm id={plan.id} today={today} nextYear={addDays(today, 365)} />
            </Card>
          ) : plan.hasUnapprovedChanges && plan.status !== "ARCHIVED" ? (
            <Card>
              <p className="text-sm">An Engineering Manager responsible for this plan must approve it.</p>
            </Card>
          ) : null}
          {plan.allowed.review ? (
            <Card>
              <CardTitle>Interval review</CardTitle>
              <ReviewPlanForm id={plan.id} nextYear={addDays(today, 365)} />
            </Card>
          ) : null}
          {plan.allowed.pause || plan.allowed.resume || plan.allowed.archive ? (
            <Card>
              <CardTitle>Status</CardTitle>
              {plan.allowed.pause ? <PausePlanForm id={plan.id} /> : null}
              {plan.allowed.resume ? <ResumePlanForm id={plan.id} /> : null}
              {plan.allowed.archive ? <ArchivePlanForm id={plan.id} /> : null}
            </Card>
          ) : null}
          <Card>
            <CardTitle>Approval and review history</CardTitle>
            {plan.revisions.length === 0 ? (
              <p className="text-ink-muted text-sm">Not approved yet.</p>
            ) : (
              <ol className="flex flex-col gap-3 text-sm">
                {plan.revisions.map((r) => (
                  <li key={r.id} className="border-line border-l-2 pl-3">
                    <div className="font-semibold">
                      {r.kind === "APPROVAL" ? `Version ${r.revisionNo} approved` : "Interval reviewed"}
                      {r.id === plan.approvedRevisionId ? " · in use" : ""}
                    </div>
                    <div className="text-ink-muted text-xs">
                      {n(r.approvedById)} · {dateTime.format(r.approvedAt)} UTC · effective{" "}
                      {formatDateOnly(fromDbDate(r.effectiveFrom))}
                    </div>
                    <div className="text-xs">
                      {intervalLabel(r.intervalCount, r.intervalUnit)} ·{" "}
                      {INTERVAL_SOURCE_LABELS[r.intervalSource].replace(/^\d · /, "")}:{" "}
                      {r.intervalSource === "ORGANIZATION_DEFINED" ? r.justification : r.sourceReference}
                    </div>
                    {r.note ? <div className="text-xs">“{r.note}”</div> : null}
                  </li>
                ))}
              </ol>
            )}
            <p className="text-ink-muted text-xs">
              Created by {n(plan.createdById)}. History cannot be edited or deleted.
            </p>
          </Card>
        </div>
      </div>
    </>
  );
}
