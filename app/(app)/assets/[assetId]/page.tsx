import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { requireAccess } from "@/server/auth/session";
import { can } from "@/server/authz/access";
import { NotFoundError } from "@/server/authz/errors";
import { withTenant } from "@/server/db/tenant";
import { APPROVER_LABELS, getAsset } from "@/server/services/assets";
import { listWorkOrdersForAsset } from "@/server/services/work-orders";
import { getAssetLifecycle } from "@/server/services/lifecycle";
import { getAssetWarranties } from "@/server/services/warranties";
import { supplierOptions } from "@/server/services/suppliers";
import { AssetLifecycle } from "@/components/stage8/asset-lifecycle";
import { AssetWarranties } from "@/components/stage8/asset-warranties";
import { getAssetPm } from "@/server/services/pm-schedule";
import { DoNotUseBanner, DueStateBadge, OccurrenceBadge } from "@/components/pm/badges";
import { formatDateOnly } from "@/lib/pm/dates";
import { PriorityBadge, WoStatusBadge } from "@/components/work-orders/badges";
import { ANY_OUTCOME_LABELS } from "@/lib/validation/work-orders";
import { code128 } from "@/server/barcode";
import { Badge, Card, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/shell/page-header";
import { BarcodeSvg } from "@/components/assets/barcode-svg";
import { RiskBadge, StatusBadge } from "@/components/assets/status-badge";
import { STATUS_LABELS } from "@/lib/validation/assets";
import {
  ArchiveForm,
  CancelRequestForm,
  DecisionForm,
  DecommissionRequestForm,
  QuickStatusForm,
  RestoreForm,
} from "./detail-forms";

export const metadata: Metadata = { title: "Equipment asset" };

const dateTime = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" });
const dateOnly = (iso: string | null) =>
  iso
    ? new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeZone: "UTC" }).format(new Date(`${iso}T00:00:00Z`))
    : "—";

const SAVED: Record<string, string> = {
  "claim-updated": "Claim updated. Its status history is kept below.",
  disposal: "Disposal recorded. The device stays decommissioned.",
  created: "Asset registered. Its barcode label is ready to print.",
  retagged:
    "Changes saved. The asset ID changed, so its barcode changed too: print a new label and replace the old one.",
  updated: "Changes saved.",
  unchanged: "No changes to save.",
  decommissioned: "Approved. The asset is now decommissioned and read-only.",
  rejected: "Request rejected. The requester can see your note on this page.",
  withdrawn: "Decommissioning request withdrawn.",
  requested:
    "Request sent for approval: the department's NUM, or the Biomedical Engineering Manager or Facility Manager if the department has no NUM.",
  archived: "Asset archived. It is hidden from the register; its history is kept.",
  restored: "Asset restored to the register.",
};

const linkButton =
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-md border px-4 text-sm font-semibold transition-colors";

export default async function AssetDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ assetId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { assetId } = await params;
  const saved = (await searchParams).saved;
  const ctx = await requireAccess();
  const asset = await getAsset(ctx, assetId).catch((error) => {
    if (error instanceof NotFoundError) notFound();
    throw error;
  });

  const archived = asset.archivedAt !== null;
  const decommissioned = asset.status === "DECOMMISSIONED";
  const editable = !archived && !decommissioned;
  const pendingRequest = asset.lifecycleEvents.find((e) => e.status === "PENDING");
  const barcode = code128(asset.assetTag);

  const [workOrders, pm, lifecycle, warranties, suppliers] = await Promise.all([
    listWorkOrdersForAsset(ctx, asset.id),
    getAssetPm(ctx, asset.id),
    getAssetLifecycle(ctx, asset.id),
    getAssetWarranties(ctx, asset.id),
    supplierOptions(ctx),
  ]);
  const openJobs = workOrders.filter((w) => w.status !== "COMPLETED" && w.status !== "CANCELLED");
  const serviceHistory = workOrders.filter((w) => w.status === "COMPLETED");
  const locations =
    can(ctx, "asset.edit") && editable
      ? await withTenant({ userId: ctx.user.id, organizationId: ctx.organization.id }, (tx) =>
          tx.location.findMany({
            where: { departmentId: asset.departmentId, status: "ACTIVE" },
            orderBy: { name: "asc" },
            select: { id: true, name: true },
          }),
        )
      : [];
  const person = (id: string | null) => (id ? (asset.people[id] ?? "Unknown user") : "System (seed data)");
  const savedMessage = typeof saved === "string" ? SAVED[saved] : undefined;

  return (
    <>
      <PageHeader
        title={`${asset.assetTag} · ${asset.name}`}
        description={`${asset.model.manufacturer.name} ${asset.model.modelName} · ${asset.hospital.name}, ${asset.department.name}`}
        actions={
          <div className="flex flex-wrap gap-2">
            <Link href="/assets" className={`${linkButton} border-line-strong hover:bg-surface-sunken bg-white`}>
              Back to register
            </Link>
            {can(ctx, "workorder.report") && editable ? (
              <Link
                href={`/work-orders/new?asset=${asset.id}`}
                className={`${linkButton} border-danger/40 text-danger hover:bg-danger-bg bg-white`}
              >
                Report a fault
              </Link>
            ) : null}
            {can(ctx, "asset.labelPrint") && !archived ? (
              <Link
                href={`/assets/labels?id=${asset.id}`}
                className={`${linkButton} border-line-strong hover:bg-surface-sunken bg-white`}
              >
                Print label
              </Link>
            ) : null}
            {can(ctx, "asset.edit") && editable ? (
              <Link
                href={`/assets/${asset.id}/edit`}
                className={`${linkButton} text-navy-900 border-teal-400 bg-teal-400 hover:bg-teal-500`}
              >
                Edit asset
              </Link>
            ) : null}
          </div>
        }
      />

      {savedMessage ? (
        <p role="status" className="bg-ok-bg text-ok rounded-md px-4 py-3 text-sm font-semibold">
          {savedMessage}
        </p>
      ) : null}
      {pm?.hold ? <DoNotUseBanner holdId={pm.hold.id} status={pm.hold.status} /> : null}
      {archived ? (
        <p className="bg-warn-bg rounded-md px-4 py-3 text-sm text-[#6b3f00]">
          This asset was archived on {dateTime.format(asset.archivedAt!)} UTC. It is hidden from the register; scanning
          its barcode still opens this read-only record. Its history is kept.
        </p>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-[2fr_1fr]">
        <Card>
          <CardTitle action={<StatusBadge status={asset.status} archived={archived} />}>Equipment details</CardTitle>
          <dl className="grid gap-x-6 gap-y-4 sm:grid-cols-2">
            <Item label="Asset ID">
              <span className="font-mono font-semibold">{asset.assetTag}</span>
            </Item>
            <Item label="Asset name">{asset.name}</Item>
            <Item label="Category">{asset.model.category.name}</Item>
            <Item label="Manufacturer">{asset.model.manufacturer.name}</Item>
            <Item label="Model">{asset.model.modelName}</Item>
            <Item label="Serial number">
              <span className="font-mono">{asset.serialNumber ?? "—"}</span>
            </Item>
            <Item label="Hospital inventory number">{asset.inventoryNumber ?? "—"}</Item>
            <Item label="Risk category">
              <RiskBadge risk={asset.riskClass} />
            </Item>
            <Item label="Hospital">{asset.hospital.name}</Item>
            <Item label="Responsible department">{asset.department.name}</Item>
            <Item label="Room or location">
              {asset.location
                ? [
                    asset.location.name,
                    asset.location.building,
                    asset.location.floor && `floor ${asset.location.floor}`,
                  ]
                    .filter(Boolean)
                    .join(" · ")
                : "Not specified"}
            </Item>
            <Item label="Supplier">{asset.supplier ?? "—"}</Item>
            <Item label="Purchase date">{dateOnly(asset.purchaseDate)}</Item>
            <Item label="Commissioning date">{dateOnly(asset.commissionedAt)}</Item>
            <Item label="Planned end of life">{dateOnly(asset.eolDate)}</Item>
            <Item label="Expected life (model)">
              {asset.model.expectedLifeYears ? `${asset.model.expectedLifeYears} years` : "—"}
            </Item>
            {asset.cost ? (
              <Item label="Purchase cost">
                {asset.cost.currency} {Number(asset.cost.amount).toLocaleString("en-GB", { minimumFractionDigits: 2 })}
              </Item>
            ) : null}
            <Item label="Registered">
              {dateTime.format(asset.createdAt)} UTC · {person(asset.createdById)}
            </Item>
            <Item label="Last updated">
              {dateTime.format(asset.updatedAt)} UTC · {person(asset.updatedById)}
            </Item>
          </dl>
          {asset.description ? (
            <div>
              <h3 className="text-ink-muted text-xs font-semibold tracking-wide uppercase">Description</h3>
              <p className="mt-1 text-sm whitespace-pre-line">{asset.description}</p>
            </div>
          ) : null}
        </Card>

        <Card>
          <CardTitle>Barcode</CardTitle>
          <div className="mx-auto flex w-full max-w-64 flex-col items-center gap-1 bg-white p-2">
            <BarcodeSvg
              barcode={barcode}
              label={`Code 128 barcode for asset ${asset.assetTag}`}
              className="h-20 w-full"
            />
            <span className="font-mono text-lg font-bold tracking-wider">{asset.assetTag}</span>
          </div>
          <p className="text-ink-muted text-xs">
            Code 128 barcode of the asset ID. Scan it with a handheld barcode scanner or the Scan page. Scanning only
            finds the asset for signed-in people with access to {asset.department.name}; the barcode itself grants
            nothing. Changing the asset ID changes the barcode, so the label must then be reprinted.
          </p>
        </Card>
      </div>

      {can(ctx, "asset.edit") && editable ? (
        <Card>
          <CardTitle>Quick update</CardTitle>
          <QuickStatusForm
            assetId={asset.id}
            status={asset.status}
            locationId={asset.location?.id ?? null}
            locations={locations}
          />
        </Card>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-2">
        <Card>
          <CardTitle>Status history</CardTitle>
          {asset.statusHistory.length === 0 ? (
            <p className="text-ink-muted text-sm">No status changes recorded.</p>
          ) : (
            <ol className="flex flex-col gap-2 text-sm">
              {asset.statusHistory.map((h) => (
                <li key={h.id} className="border-line border-b pb-2">
                  <span className="font-semibold">
                    {h.fromStatus ? `${STATUS_LABELS[h.fromStatus]} → ` : ""}
                    {STATUS_LABELS[h.toStatus]}
                  </span>
                  <span className="text-ink-muted">
                    {" "}
                    · {dateTime.format(h.createdAt)} UTC · {person(h.changedById)}
                  </span>
                  {h.reason ? <div className="text-ink-muted text-xs">{h.reason}</div> : null}
                </li>
              ))}
            </ol>
          )}
        </Card>
      </div>

      <AssetLifecycle data={lifecycle} suppliers={suppliers} />
      {warranties ? (
        <AssetWarranties
          data={warranties}
          assetId={asset.id}
          canManage={can(ctx, "warranty.manage") && can(ctx, "asset.edit") && editable}
          canClaim={can(ctx, "warranty.claim") && !archived}
          suppliers={suppliers}
          jobs={workOrders.map((w) => ({ id: w.id, number: w.number }))}
        />
      ) : null}

      <Card>
        <CardTitle>Decommissioning</CardTitle>
        <p className="text-ink-muted text-sm">
          Decommissioning needs approval by the NUM (Department Head) of {asset.department.name}. If the department has
          no NUM, the Biomedical Engineering Manager or Facility Manager approves. The person who requests it cannot
          approve it.
        </p>
        {asset.lifecycleEvents.length ? (
          <ul className="flex flex-col gap-3 text-sm">
            {asset.lifecycleEvents.map((e) => (
              <li key={e.id} className="border-line rounded-md border p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span>
                    Requested by <strong>{person(e.requestedById)}</strong> on {dateTime.format(e.createdAt)} UTC
                  </span>
                  <Badge tone={e.status === "PENDING" ? "warn" : e.status === "APPROVED" ? "danger" : "neutral"}>
                    {e.status === "PENDING" ? "Waiting for approval" : e.status.toLowerCase()}
                  </Badge>
                </div>
                <p className="mt-1">{e.reason}</p>
                {e.decidedById ? (
                  <p className="text-ink-muted mt-1 text-xs">
                    Decided by {person(e.decidedById)}
                    {e.decidedAt ? ` on ${dateTime.format(e.decidedAt)} UTC` : ""}
                    {e.decisionNote ? ` · “${e.decisionNote}”` : ""}
                  </p>
                ) : null}
                {e.status === "PENDING" && e.canDecide ? (
                  <>
                    <p className="text-ink-muted mt-2 text-xs">You can decide as: {APPROVER_LABELS[e.canDecide]}</p>
                    <DecisionForm requestId={e.id} />
                  </>
                ) : null}
                {e.status === "PENDING" &&
                can(ctx, "asset.decommissionRequest") &&
                (e.requestedById === ctx.user.id || can(ctx, "asset.archive")) ? (
                  <div className="mt-2">
                    <CancelRequestForm requestId={e.id} />
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        ) : null}
        {editable && !pendingRequest && can(ctx, "asset.decommissionRequest") ? (
          <DecommissionRequestForm assetId={asset.id} />
        ) : null}
      </Card>

      <div className="grid gap-6 xl:grid-cols-2">
        <Card>
          <CardTitle>Work orders</CardTitle>
          {openJobs.length === 0 ? (
            <p className="text-ink-muted text-sm">No open jobs for this device.</p>
          ) : (
            <ul className="flex flex-col gap-2 text-sm">
              {openJobs.map((w) => (
                <li key={w.id} className="border-line flex flex-wrap items-center justify-between gap-2 border-b pb-2">
                  <span>
                    <Link
                      href={`/work-orders/${w.id}`}
                      className="font-mono font-semibold text-teal-700 hover:underline"
                    >
                      {w.number}
                    </Link>{" "}
                    <span className="text-ink-muted line-clamp-1">{w.faultDescription}</span>
                  </span>
                  <span className="flex gap-1">
                    <PriorityBadge priority={w.priority} />
                    <WoStatusBadge status={w.status} />
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card>
          <CardTitle>Equipment service history</CardTitle>
          {serviceHistory.length === 0 ? (
            <p className="text-ink-muted text-sm">No completed jobs recorded in BiomedIntel.ai yet.</p>
          ) : (
            <ol className="flex flex-col gap-2 text-sm">
              {serviceHistory.map((w) => (
                <li key={w.id} className="border-line border-b pb-2">
                  <Link href={`/work-orders/${w.id}`} className="font-mono font-semibold text-teal-700 hover:underline">
                    {w.number}
                  </Link>
                  <span className="text-ink-muted">
                    {" "}
                    · {w.completedAt ? dateTime.format(w.completedAt) : ""} UTC ·{" "}
                    {w.outcome ? ANY_OUTCOME_LABELS[w.outcome] : ""}
                  </span>
                  {w.resolution ? <div className="line-clamp-2">{w.resolution}</div> : null}
                </li>
              ))}
            </ol>
          )}
        </Card>
      </div>

      {pm ? (
        <Card id="pm">
          <CardTitle
            action={
              can(ctx, "pm.view") ? (
                <Link
                  href={`/maintenance/schedule?view=all&asset=${asset.id}`}
                  className="text-sm font-semibold text-teal-700 hover:underline"
                >
                  Full maintenance history
                </Link>
              ) : null
            }
          >
            Preventive maintenance
          </CardTitle>
          {pm.noApprovedPlan && editable ? (
            <p className="bg-warn-bg rounded-sm px-3 py-2 text-sm text-[#6b3f00]">
              Needs review: this device has no approved maintenance plan. No schedule is assigned automatically —{" "}
              <Link href="/maintenance/review" className="font-semibold underline">
                see Needs review
              </Link>
              .
            </p>
          ) : null}
          {pm.schedules.length ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <caption className="sr-only">Maintenance schedules for this device</caption>
                <thead className="text-ink-muted text-left text-xs uppercase">
                  <tr>
                    <th className="py-2 pr-3">Plan</th>
                    <th className="py-2 pr-3">Interval</th>
                    <th className="py-2 pr-3">Next due</th>
                    <th className="py-2 pr-3">Last done</th>
                  </tr>
                </thead>
                <tbody>
                  {pm.schedules.map((s) => (
                    <tr key={s.id} className="border-line border-t">
                      <td className="py-2 pr-3">
                        <Link href={`/maintenance/plans/${s.plan.id}`} className="text-teal-700 hover:underline">
                          {s.plan.name}
                        </Link>
                        {s.status !== "ACTIVE" ? (
                          <div className="text-ink-muted text-xs">Ended: {s.endReason}</div>
                        ) : null}
                        {s.status === "ACTIVE" && s.plan.status !== "ACTIVE" ? (
                          <div className="text-ink-muted text-xs">Plan {s.plan.status.toLowerCase()}</div>
                        ) : null}
                      </td>
                      <td className="py-2 pr-3">{s.interval}</td>
                      <td className="py-2 pr-3">
                        {s.status === "ACTIVE" ? (
                          <>
                            {formatDateOnly(s.nextDue)} <DueStateBadge state={s.state} />
                          </>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="py-2 pr-3">{s.lastDone ? formatDateOnly(s.lastDone) : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-ink-muted text-sm">Not enrolled in any maintenance plan.</p>
          )}
          {pm.occurrences.length ? (
            <div>
              <h3 className="text-ink-muted text-xs font-semibold tracking-wide uppercase">Recent due dates</h3>
              <ul className="mt-1 flex flex-col gap-1.5 text-sm">
                {pm.occurrences.slice(0, 8).map((o) => (
                  <li key={o.id} className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold">{formatDateOnly(o.due)}</span>
                    <span>{o.plan.name}</span>
                    <OccurrenceBadge status={o.status} />
                    {o.workOrder ? (
                      <Link href={`/work-orders/${o.workOrder.id}`} className="font-mono text-teal-700 hover:underline">
                        {o.workOrder.number}
                      </Link>
                    ) : null}
                    {o.completed ? (
                      <span className="text-ink-muted">
                        done {formatDateOnly(o.completed)} · {o.onTime ? "on time" : "late"}
                      </span>
                    ) : null}
                    {o.status === "FAILED" && o.lastError ? (
                      <span className="text-danger text-xs">{o.lastError}</span>
                    ) : null}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </Card>
      ) : null}

      <Card>
        <CardTitle action={<Badge tone="info">Coming in later stages</Badge>}>More maintenance records</CardTitle>
        <p className="text-ink-muted text-sm">Placeholders: these will show real records once each module is built.</p>
        <p className="text-ink-muted text-sm">Spare parts used are recorded on each work order.</p>
        <ul className="grid gap-3 sm:grid-cols-3">
          {[
            ["Calibration certificates", "later"],
            ["Technical documents", 9],
            ["IntellAssist troubleshooting", 9],
          ].map(([label, stage]) => (
            <li key={label} className="border-line rounded-md border border-dashed p-3 text-sm">
              <div className="font-semibold">{label}</div>
              <div className="text-ink-muted text-xs">Not built yet{stage === "later" ? "" : ` · Stage ${stage}`}</div>
            </li>
          ))}
        </ul>
      </Card>

      {asset.auditEvents ? (
        <Card>
          <CardTitle>Audit trail</CardTitle>
          {asset.auditEvents.length === 0 ? (
            <p className="text-ink-muted text-sm">No audit events recorded for this asset yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="bg-surface-sunken text-ink-muted text-left text-xs tracking-wide uppercase">
                    <th scope="col" className="px-3 py-2">
                      When (UTC)
                    </th>
                    <th scope="col" className="px-3 py-2">
                      Who
                    </th>
                    <th scope="col" className="px-3 py-2">
                      Event
                    </th>
                    <th scope="col" className="px-3 py-2">
                      Outcome
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {asset.auditEvents.map((e) => (
                    <tr key={e.id} className="border-line border-b">
                      <td className="px-3 py-2 whitespace-nowrap">{dateTime.format(e.createdAt)}</td>
                      <td className="px-3 py-2">{person(e.actorUserId)}</td>
                      <td className="px-3 py-2 font-mono text-xs">{e.action}</td>
                      <td className="px-3 py-2">
                        <Badge tone={e.outcome === "SUCCESS" ? "ok" : "danger"}>{e.outcome.toLowerCase()}</Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      ) : null}

      {archived && can(ctx, "asset.archive") ? (
        <Card>
          <CardTitle>Archive</CardTitle>
          <RestoreForm assetId={asset.id} />
        </Card>
      ) : null}
      {!archived && can(ctx, "asset.archive") ? (
        <Card>
          <CardTitle>Archive</CardTitle>
          <p className="text-ink-muted text-sm">
            Archiving hides the asset from the register. Nothing is deleted: its history, status changes and audit trail
            are kept, and it can be restored.
          </p>
          <ArchiveForm assetId={asset.id} tag={asset.assetTag} />
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
