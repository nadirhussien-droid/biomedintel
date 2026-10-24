import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { requireAccess } from "@/server/auth/session";
import { NotFoundError } from "@/server/authz/errors";
import { getWorkOrder } from "@/server/services/work-orders";
import { can } from "@/server/authz/access";
import { getWorkOrderParts } from "@/server/services/work-order-parts";
import { listUsableTestEquipment } from "@/server/services/testing";
import { sessionsFor } from "@/server/services/troubleshooting";
import { TroubleshootingCard } from "@/components/stage9/troubleshooting-card";
import { partOptions } from "@/server/services/inventory";
import { warrantyForAsset } from "@/server/services/warranties";
import { listServicesForWorkOrder } from "@/server/services/external-services";
import { supplierOptions } from "@/server/services/suppliers";
import { WorkOrderParts } from "@/components/stage8/work-order-parts";
import { ExternalServicePanel, WarrantyPanel } from "@/components/stage8/work-order-extras";
import { localToday } from "@/lib/pm/dates";
import { Badge, Card, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/shell/page-header";
import { StatusBadge } from "@/components/assets/status-badge";
import { OverdueBadge, PriorityBadge, SafetyBadge, WoStatusBadge } from "@/components/work-orders/badges";
import {
  CHECK_LABELS,
  MAX_PHOTOS,
  ANY_OUTCOME_LABELS,
  FAILURE_CATEGORY_LABELS,
  WO_STATUS_LABELS,
} from "@/lib/validation/work-orders";
import { DoNotUseBanner, OccurrenceBadge } from "@/components/pm/badges";
import { formatDateOnly, fromDbDate } from "@/lib/pm/dates";
import { SECTION_LABELS, WORK_TYPE_LABELS, type ChecklistSection } from "@/lib/validation/pm";
import {
  AssignForm,
  CancelForm,
  CompleteForm,
  EditCompletedJob,
  HoldForm,
  LogWorkForm,
  NoteForm,
  PhotoUpload,
  PmCompleteForm,
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
  PARTS_RESERVED: "Parts reserved",
  PARTS_RELEASED: "Reservation released",
  PARTS_ISSUED: "Parts issued",
  PARTS_RETURNED: "Parts returned to stock",
  PARTS_UNAVAILABLE: "Parts not available",
  EXTERNAL_SERVICE: "External service",
  TROUBLESHOOTING: "Troubleshooting",
};

const SAVED: Record<string, string> = {
  "parts-reserved": "Parts reserved for this job.",
  "parts-released": "Reservation released.",
  "parts-issued": "Parts issued to this job. Stock updated. This does not mark the device repaired or safe to use.",
  "parts-returned": "Return recorded. Stock updated.",
  "service-updated": "External service updated.",
  reported: "Fault reported. The engineering team has been notified.",
  taken: "The job is now assigned to you.",
  started: "Work started.",
  "on-hold": "Job put on hold.",
  "signed-off": "Job signed off. The reporter has been notified.",
  reviewed: "Marked as reviewed.",
  reopened: "Job reopened. The technician has been notified.",
  edited: "Changes saved.",
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
  // Stage 8 panels (each service checks permission and scope; null = not for this role).
  const [parts, partChoices, warranty, services, suppliers, troubleshooting] = await Promise.all([
    getWorkOrderParts(ctx, wo.id),
    can(ctx, "stock.issue") ? partOptions(ctx) : Promise.resolve([]),
    wo.type === "CORRECTIVE" ? warrantyForAsset(ctx, wo.asset.id) : Promise.resolve(null),
    listServicesForWorkOrder(ctx, wo.id),
    can(ctx, "service.manage") ? supplierOptions(ctx) : Promise.resolve([]),
    sessionsFor(ctx, { workOrderId: wo.id }),
  ]);
  // Technicians troubleshoot their own jobs; managers any job in scope (the service enforces this too).
  const mayTroubleshoot =
    can(ctx, "troubleshoot.work") &&
    ["REQUESTED", "ASSIGNED", "IN_PROGRESS", "ON_HOLD"].includes(wo.status) &&
    (ctx.role === "ENGINEERING_MANAGER" || wo.assignedToId === ctx.user.id);
  const hospitalToday = localToday(wo.hospital.timezone);
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
            {wo.status === "COMPLETED" &&
            wo.planned &&
            wo.electricalSafetyCheck &&
            wo.electricalSafetyCheck !== "NOT_APPLICABLE" ? (
              <Link
                href={`/work-orders/${wo.id}/safety-report`}
                className={`${linkButton} border-line-strong hover:bg-surface-sunken bg-white`}
              >
                Safety test report
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
      {wo.assetHold ? <DoNotUseBanner holdId={wo.assetHold.id} status={wo.assetHold.status} /> : null}
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
            {wo.planned ? `${WORK_TYPE_LABELS[wo.type]} job` : "Fault"}
          </CardTitle>
          <p className="text-sm whitespace-pre-line">{wo.faultDescription}</p>
          <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
            <Item label={wo.planned ? "Created" : "Reported"}>
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

      {wo.planned ? (
        <Card>
          <CardTitle
            action={
              wo.pmOccurrence ? (
                <OccurrenceBadge status={wo.pmOccurrence.status} />
              ) : wo.safetyHoldId ? (
                <Badge tone="danger">Safety hold retest</Badge>
              ) : null
            }
          >
            {wo.pmOccurrence ? "Preventive maintenance" : "Electrical safety retest"}
          </CardTitle>
          <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-3">
            {wo.pmOccurrence ? (
              <>
                <Item label="Plan">
                  <Link
                    href={`/maintenance/plans/${wo.pmOccurrence.plan.id}`}
                    className="text-teal-700 hover:underline"
                  >
                    {wo.pmOccurrence.plan.name}
                  </Link>
                  {wo.planRevision ? (
                    <span className="text-ink-muted"> · version {wo.planRevision.revisionNo}</span>
                  ) : null}
                </Item>
                <Item label="Due (hospital date)">{formatDateOnly(fromDbDate(wo.pmOccurrence.dueOn))}</Item>
                <Item label="Completed">
                  {wo.pmOccurrence.completedOn
                    ? `${formatDateOnly(fromDbDate(wo.pmOccurrence.completedOn))} · ${wo.pmOccurrence.onTime ? "on time" : "late"}`
                    : "—"}
                </Item>
                {wo.pmOccurrence.plan.requiredCompetency ? (
                  <Item label="Required competency">{wo.pmOccurrence.plan.requiredCompetency}</Item>
                ) : null}
                {wo.pmOccurrence.plan.documentReference ? (
                  <Item label="Service documentation">{wo.pmOccurrence.plan.documentReference}</Item>
                ) : null}
              </>
            ) : wo.safetyHoldId ? (
              <Item label="Safety hold">
                <Link href={`/maintenance/holds/${wo.safetyHoldId}`} className="text-teal-700 hover:underline">
                  View hold and approval history
                </Link>
              </Item>
            ) : null}
            <Item label="Test standard">
              {wo.testStandardCode ? `${wo.testStandardCode} ${wo.testStandardVersion}` : "Not applicable"}
            </Item>
          </dl>
          {wo.instructions ? <p className="text-sm whitespace-pre-line">{wo.instructions}</p> : null}
          {wo.status !== "COMPLETED" && wo.checklistItems ? (
            <div>
              <h3 className="text-ink-muted text-xs font-semibold tracking-wide uppercase">
                Checklist ({wo.checklistItems.length} items)
              </h3>
              <ol className="mt-1 list-decimal pl-5 text-sm">
                {wo.checklistItems.map((i) => (
                  <li key={i.key}>
                    {i.label} <span className="text-ink-muted">· {SECTION_LABELS[i.section as ChecklistSection]}</span>
                  </li>
                ))}
              </ol>
            </div>
          ) : null}
        </Card>
      ) : null}

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
              {wo.planned && wo.checklistItems ? (
                <PmCompleteForm
                  id={wo.id}
                  items={wo.checklistItems}
                  standard={wo.testStandardCode ? `${wo.testStandardCode} ${wo.testStandardVersion}` : null}
                  testEquipment={can(ctx, "testing.view") ? await listUsableTestEquipment(ctx) : []}
                />
              ) : (
                <CompleteForm id={wo.id} />
              )}
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
            <Item label="Outcome">{wo.outcome ? ANY_OUTCOME_LABELS[wo.outcome] : "—"}</Item>
            {wo.type === "CORRECTIVE" && wo.outcome !== "NO_FAULT_FOUND" ? (
              <Item label="Fault category">
                {wo.failureCategory ? FAILURE_CATEGORY_LABELS[wo.failureCategory] : "Not classified"}
              </Item>
            ) : null}
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
          {wo.checklistResults.length ? (
            <div
              className="overflow-x-auto"
              tabIndex={0}
              role="region"
              aria-label="Table (scroll sideways on small screens)"
            >
              <h3 className="text-ink-muted text-xs font-semibold tracking-wide uppercase">Checklist results</h3>
              <table className="mt-1 w-full text-sm">
                <caption className="sr-only">Checklist results</caption>
                <thead className="text-ink-muted text-left text-xs uppercase">
                  <tr>
                    <th className="py-1.5 pr-3">Item</th>
                    <th className="py-1.5 pr-3">Result</th>
                    <th className="py-1.5 pr-3">Value</th>
                    <th className="py-1.5 pr-3">Standard</th>
                    <th className="py-1.5 pr-3">Notes</th>
                  </tr>
                </thead>
                <tbody>
                  {[...wo.checklistResults]
                    .sort(
                      (x, y) =>
                        y.attempt - x.attempt ||
                        (wo.checklistItems?.findIndex((i) => i.key === x.itemKey) ?? 0) -
                          (wo.checklistItems?.findIndex((i) => i.key === y.itemKey) ?? 0),
                    )
                    .map((r) => (
                      <tr
                        key={r.id}
                        className={`border-line border-t ${r.attempt !== wo.reopenCount ? "text-ink-muted" : ""}`}
                      >
                        <td className="py-1.5 pr-3">
                          {r.label}
                          {r.attempt !== wo.reopenCount ? (
                            <span className="text-xs"> (earlier sign-off {r.attempt + 1})</span>
                          ) : null}
                        </td>
                        <td className={`py-1.5 pr-3 font-semibold ${r.result === "FAIL" ? "text-danger" : ""}`}>
                          {CHECK_LABELS[r.result]}
                        </td>
                        <td className="py-1.5 pr-3">
                          {r.value !== null ? `${Number(r.value)} ${r.unit ?? ""}` : "—"}
                          {r.lowerLimit !== null || r.upperLimit !== null ? (
                            <div className="text-ink-muted text-xs">
                              limits {r.lowerLimit !== null ? Number(r.lowerLimit) : "—"} to{" "}
                              {r.upperLimit !== null ? Number(r.upperLimit) : "—"}
                            </div>
                          ) : null}
                        </td>
                        <td className="py-1.5 pr-3">
                          {r.testStandardCode ? `${r.testStandardCode} ${r.testStandardVersion}` : "—"}
                        </td>
                        <td className="py-1.5 pr-3">{r.notes ?? ""}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          ) : null}
          <div>
            <h3 className="text-ink-muted text-xs font-semibold tracking-wide uppercase">
              {wo.planned ? "Notes" : "Diagnosis"}
            </h3>
            <p className="mt-1 text-sm whitespace-pre-line">{wo.diagnosis}</p>
            <h3 className="text-ink-muted mt-3 text-xs font-semibold tracking-wide uppercase">
              {wo.planned ? "Work done and findings" : "Work done and result"}
            </h3>
            <p className="mt-1 text-sm whitespace-pre-line">{wo.resolution}</p>
          </div>
          {a.editCompleted ? (
            <EditCompletedJob
              id={wo.id}
              planned={wo.planned}
              isRepair={wo.type === "CORRECTIVE"}
              diagnosis={wo.diagnosis ?? ""}
              resolution={wo.resolution ?? ""}
              failureCategory={wo.failureCategory}
              lines={wo.tasks.map((t) => ({ id: t.id, description: t.description, minutes: t.minutes }))}
            />
          ) : null}
          <div className="grid gap-6 lg:grid-cols-2">
            {a.review ? <ReviewForm id={wo.id} /> : null}
            {a.reopen ? <ReopenForm id={wo.id} /> : null}
          </div>
        </Card>
      ) : null}

      {troubleshooting ? (
        <TroubleshootingCard
          sessions={troubleshooting}
          startHref={mayTroubleshoot ? `/assist/new?asset=${wo.asset.id}&workOrder=${wo.id}` : null}
          docsHref={can(ctx, "knowledge.view") ? `/knowledge?model=${wo.asset.model.id}` : null}
        />
      ) : null}
      {warranty ? <WarrantyPanel data={warranty} assetId={wo.asset.id} /> : null}
      {parts ? <WorkOrderParts data={parts} partOptions={partChoices} /> : null}
      {services ? (
        <ExternalServicePanel
          data={services}
          workOrderId={wo.id}
          open={["REQUESTED", "ASSIGNED", "IN_PROGRESS", "ON_HOLD"].includes(wo.status)}
          suppliers={suppliers}
          today={hospitalToday}
          showCost={can(ctx, "inventory.viewCost")}
        />
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
              <span className="font-semibold">
                {e.kind === "CREATED" && wo.planned ? "Work order created" : (EVENT_LABELS[e.kind] ?? e.kind)}
              </span>
              {e.toStatus && e.kind !== "CREATED" ? (
                <span className="text-ink-muted"> → {WO_STATUS_LABELS[e.toStatus]}</span>
              ) : null}
              <span className="text-ink-muted">
                {" "}
                · {person(e.actorId)} · {dateTime.format(e.createdAt)} UTC
              </span>
              {e.note && e.kind !== "COMPLETED" && e.kind !== "CREATED" ? (
                <div className="mt-0.5 whitespace-pre-line">{e.note}</div>
              ) : null}
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
