import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { requireAccess } from "@/server/auth/session";
import { NotFoundError } from "@/server/authz/errors";
import { getWorkOrder } from "@/server/services/work-orders";
import { Badge, Card, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/shell/page-header";
import { StatusBadge } from "@/components/assets/status-badge";
import { OverdueBadge, PriorityBadge, SafetyBadge, WoStatusBadge } from "@/components/work-orders/badges";
import { CHECK_LABELS, MAX_PHOTOS, OUTCOME_LABELS, WO_STATUS_LABELS } from "@/lib/validation/work-orders";
import {
  AssignForm,
  CancelForm,
  CompleteForm,
  HoldForm,
  LogWorkForm,
  NoteForm,
  PhotoUpload,
  PriorityForm,
  ReopenForm,
  ReviewForm,
  StartForm,
  TakeForm,
} from "./forms";

export const metadata: Metadata = { title: "Work order" };

const dateTime = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" });
const linkButton =
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-md border px-4 text-sm font-semibold transition-colors";

const EVENT_LABELS: Record<string, string> = {
  CREATED: "Fault reported",
  ASSIGNED: "Assigned",
  TAKEN: "Taken by technician",
  PRIORITY_CHANGED: "Priority changed",
  STARTED: "Work started",
  RESUMED: "Work resumed",
  ON_HOLD: "Put on hold",
  WORK_LOGGED: "Work logged",
  PHOTO_ADDED: "Photo added",
  NOTE: "Note",
  COMPLETED: "Signed off by technician",
  REVIEWED: "Reviewed by manager",
  REOPENED: "Reopened",
  CANCELLED: "Cancelled",
};

const SAVED: Record<string, string> = {
  reported: "Fault reported. The engineering team has been notified.",
  taken: "The job is now assigned to you.",
  started: "Work started.",
  "on-hold": "Job put on hold.",
  "signed-off": "Job signed off. The reporter has been notified.",
  reviewed: "Marked as reviewed.",
  reopened: "Job reopened. The technician has been notified.",
  cancelled: "Job cancelled. The device status was not changed: confirm separately that it is safe to use.",
};

export default async function WorkOrderPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const ctx = await requireAccess();
  const wo = await getWorkOrder(ctx, id).catch((error) => {
    if (error instanceof NotFoundError) notFound();
    throw error;
  });
  const person = (uid: string | null) => (uid ? (wo.people[uid] ?? "Unknown user") : "—");
  const a = wo.allowed;
  const saved = typeof sp.saved === "string" ? SAVED[sp.saved] : undefined;
  const photoErrors = typeof sp.photoErrors === "string" ? Number(sp.photoErrors) : 0;
  const hours = Math.floor(wo.totalMinutes / 60);
  const mins = wo.totalMinutes % 60;

  return (
    <>
      <PageHeader
        title={`${wo.number} · ${wo.asset.assetTag}`}
        description={`${wo.asset.name} · ${wo.hospital.name}, ${wo.department.name}`}
        actions={
          <div className="flex flex-wrap gap-2">
            <Link href="/work-orders" className={`${linkButton} border-line-strong hover:bg-surface-sunken bg-white`}>
              All work orders
            </Link>
            <Link
              href={`/work-orders/${wo.id}/print`}
              className={`${linkButton} border-line-strong hover:bg-surface-sunken bg-white`}
            >
              Print job sheet
            </Link>
          </div>
        }
      />

      {saved ? (
        <p role="status" className="bg-ok-bg text-ok rounded-md px-4 py-3 text-sm font-semibold">
          {saved}
        </p>
      ) : null}
      {photoErrors > 0 ? (
        <p role="alert" className="bg-warn-bg rounded-md px-4 py-3 text-sm text-[#6b3f00]">
          {photoErrors} photo(s) could not be uploaded. You can try again below.
        </p>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-[2fr_1fr]">
        <Card>
          <CardTitle
            action={
              <span className="flex flex-wrap gap-1">
                {wo.safetyCritical ? <SafetyBadge /> : null}
                {wo.overdue ? <OverdueBadge /> : null}
                <PriorityBadge priority={wo.priority} />
                <WoStatusBadge status={wo.status} />
              </span>
            }
          >
            Fault
          </CardTitle>
          <p className="text-sm whitespace-pre-line">{wo.faultDescription}</p>
          <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
            <Item label="Reported">
              {dateTime.format(wo.createdAt)} UTC · {person(wo.reportedById)}
            </Item>
            <Item label="Device taken out of use">{wo.outOfUse ? "Yes" : "No"}</Item>
            <Item label="Target">{wo.dueAt ? `${dateTime.format(wo.dueAt)} UTC` : "—"}</Item>
            <Item label="Assigned to">
              {wo.assignedToId ? `${person(wo.assignedToId)} (by ${person(wo.assignedById)})` : "Not yet assigned"}
            </Item>
            {wo.holdReason ? <Item label="On hold because">{wo.holdReason}</Item> : null}
            <Item label="Time logged">{wo.totalMinutes ? `${hours} h ${mins} min` : "—"}</Item>
          </dl>
        </Card>

        <Card>
          <CardTitle>Device</CardTitle>
          <div>
            <Link href={`/assets/${wo.asset.id}`} className="font-mono text-lg font-bold text-teal-700 hover:underline">
              {wo.asset.assetTag}
            </Link>
            <div className="font-semibold">{wo.asset.name}</div>
            <div className="text-ink-muted text-sm">
              {wo.asset.model.manufacturer.name} {wo.asset.model.modelName}
              {wo.asset.serialNumber ? ` · S/N ${wo.asset.serialNumber}` : ""}
            </div>
            <div className="text-ink-muted text-sm">
              {wo.hospital.code} · {wo.department.name}
              {wo.asset.location ? ` · ${wo.asset.location.name}` : ""}
            </div>
          </div>
          <div>
            <span className="text-ink-muted text-xs font-semibold tracking-wide uppercase">Current status</span>
            <div className="mt-1">
              <StatusBadge status={wo.asset.status} />
            </div>
          </div>
          {wo.downtime.length ? (
            <div className="text-sm">
              <span className="text-ink-muted text-xs font-semibold tracking-wide uppercase">Downtime</span>
              <ul className="mt-1">
                {wo.downtime.map((d) => (
                  <li key={d.id}>
                    {dateTime.format(d.startedAt)} → {d.endedAt ? dateTime.format(d.endedAt) : "ongoing"}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </Card>
      </div>

      {a.assign || a.priority || a.take || a.start || a.hold || a.logWork || a.complete ? (
        <Card>
          <CardTitle>Actions</CardTitle>
          <div className="grid gap-6 lg:grid-cols-2">
            {a.take ? (
              <Section title="Pick up this job">
                <TakeForm id={wo.id} />
              </Section>
            ) : null}
            {a.assign ? (
              <Section title="Assign">
                <AssignForm id={wo.id} current={wo.assignedToId} candidates={wo.candidates} />
              </Section>
            ) : null}
            {a.priority ? (
              <Section title="Priority">
                <PriorityForm id={wo.id} current={wo.priority} safetyCritical={wo.safetyCritical} />
              </Section>
            ) : null}
            {a.start ? (
              <Section title="Work">
                <StartForm id={wo.id} resume={wo.status === "ON_HOLD"} />
              </Section>
            ) : null}
            {a.hold ? (
              <Section title="Waiting for something?">
                <HoldForm id={wo.id} />
              </Section>
            ) : null}
            {a.logWork ? (
              <Section title="Log work" wide>
                <LogWorkForm id={wo.id} />
              </Section>
            ) : null}
          </div>
          {a.complete ? (
            <Section title="Sign off (technician who did the job)" wide>
              <CompleteForm id={wo.id} />
            </Section>
          ) : null}
        </Card>
      ) : null}

      {wo.status === "COMPLETED" ? (
        <Card>
          <CardTitle
            action={
              wo.reviewedAt ? (
                <Badge tone="ok">Reviewed</Badge>
              ) : wo.safetyCritical ? (
                <Badge tone="warn">Manager review pending</Badge>
              ) : null
            }
          >
            Sign-off
          </CardTitle>
          <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
            <Item label="Outcome">{wo.outcome ? OUTCOME_LABELS[wo.outcome] : "—"}</Item>
            <Item label="Signed off by">
              {person(wo.completedById)} · {wo.completedAt ? `${dateTime.format(wo.completedAt)} UTC` : ""}
            </Item>
            <Item label="Functional check">{wo.functionalCheck ? CHECK_LABELS[wo.functionalCheck] : "—"}</Item>
            <Item label="Electrical safety test">
              {wo.electricalSafetyCheck ? CHECK_LABELS[wo.electricalSafetyCheck] : "—"}
            </Item>
            {wo.checkNotes ? <Item label="Check notes">{wo.checkNotes}</Item> : null}
            <Item label="Declaration">{wo.signOffDeclaration ? "Confirmed by the technician" : "—"}</Item>
            {wo.reviewedAt ? (
              <Item label="Reviewed by">
                {person(wo.reviewedById)} · {dateTime.format(wo.reviewedAt)} UTC
              </Item>
            ) : null}
          </dl>
          <div>
            <h3 className="text-ink-muted text-xs font-semibold tracking-wide uppercase">Diagnosis</h3>
            <p className="mt-1 text-sm whitespace-pre-line">{wo.diagnosis}</p>
            <h3 className="text-ink-muted mt-3 text-xs font-semibold tracking-wide uppercase">Work done and result</h3>
            <p className="mt-1 text-sm whitespace-pre-line">{wo.resolution}</p>
          </div>
          <div className="grid gap-6 lg:grid-cols-2">
            {a.review ? <ReviewForm id={wo.id} /> : null}
            {a.reopen ? <ReopenForm id={wo.id} /> : null}
          </div>
        </Card>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-2">
        <Card>
          <CardTitle>Work log</CardTitle>
          {wo.tasks.length === 0 ? (
            <p className="text-ink-muted text-sm">No work logged yet.</p>
          ) : (
            <ul className="flex flex-col gap-2 text-sm">
              {wo.tasks.map((t) => (
                <li key={t.id} className="border-line border-b pb-2">
                  <span className="font-medium">{t.description}</span>{" "}
                  <span className="text-ink-muted">
                    · {t.minutes} min · {person(t.performedById)} · {dateTime.format(t.createdAt)} UTC
                  </span>
                </li>
              ))}
            </ul>
          )}
          <p className="text-ink-muted text-xs">
            Spare parts used will be recorded here once the inventory module (Stage 7) is built.
          </p>
        </Card>

        <Card>
          <CardTitle>Photos</CardTitle>
          {wo.attachments.length === 0 ? (
            <p className="text-ink-muted text-sm">No photos.</p>
          ) : (
            <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {wo.attachments.map((p) => (
                <li key={p.id}>
                  <a href={`/work-orders/${wo.id}/photos/${p.id}`} target="_blank" rel="noopener noreferrer">
                    {/* eslint-disable-next-line @next/next/no-img-element -- authenticated, re-encoded photo */}
                    <img
                      src={`/work-orders/${wo.id}/photos/${p.id}`}
                      alt={`Photo ${p.filename}`}
                      width={p.width}
                      height={p.height}
                      className="border-line aspect-square w-full rounded-sm border object-cover"
                      loading="lazy"
                    />
                  </a>
                </li>
              ))}
            </ul>
          )}
          {a.photos ? <PhotoUpload id={wo.id} remaining={MAX_PHOTOS - wo.attachments.length} /> : null}
        </Card>
      </div>

      <Card>
        <CardTitle>Timeline</CardTitle>
        <ol className="flex flex-col gap-2 text-sm">
          {wo.events.map((e) => (
            <li key={e.id} className="border-line border-b pb-2">
              <span className="font-semibold">{EVENT_LABELS[e.kind] ?? e.kind}</span>
              {e.toStatus && e.kind !== "CREATED" ? (
                <span className="text-ink-muted"> → {WO_STATUS_LABELS[e.toStatus]}</span>
              ) : null}
              <span className="text-ink-muted">
                {" "}
                · {person(e.actorId)} · {dateTime.format(e.createdAt)} UTC
              </span>
              {e.note && e.kind !== "COMPLETED" ? <div className="mt-0.5 whitespace-pre-line">{e.note}</div> : null}
            </li>
          ))}
        </ol>
        {a.comment ? <NoteForm id={wo.id} /> : null}
      </Card>

      {a.cancel ? (
        <Card>
          <CardTitle>Cancel</CardTitle>
          <CancelForm id={wo.id} />
        </Card>
      ) : null}
    </>
  );
}

function Item({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-ink-muted text-xs font-semibold tracking-wide uppercase">{label}</dt>
      <dd className="mt-0.5 text-sm">{children}</dd>
    </div>
  );
}

function Section({ title, children, wide }: { title: string; children: ReactNode; wide?: boolean }) {
  return (
    <section className={`flex flex-col gap-2 ${wide ? "lg:col-span-2" : ""}`}>
      <h3 className="text-sm font-semibold">{title}</h3>
      {children}
    </section>
  );
}
