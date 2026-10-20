// Daily lifecycle, warranty and inventory reminders (Stage 8), run by the
// daily job after PM generation and scheduled reports.
//
//   • In-app notifications only (no email provider is configured).
//   • Every reminder carries a dedupe key (UNIQUE per person), so a retried or
//     repeated run never sends the same reminder twice.
//   • Recipients are worked out from roles and scope in each organisation,
//     inside that organisation only (RLS). Reminder text never contains
//     costs or prices.
//   • A failure in one organisation is recorded (audit + server log) and does
//     not stop the others; the next run tries again.
import { withTenant, type Tx } from "../db/tenant";
import { audit } from "../audit/audit";
import { roleCan, type Action } from "../authz/permissions";
import type { MembershipRole } from "../authz/roles";
import { notify } from "./notifications";
import { SYSTEM_SCHEDULER, systemActor } from "./work-order-core";
import { readSettings } from "./inventory";
import { addDays, daysBetween, localToday, toDbDate } from "@/lib/pm/dates";
import { log } from "../log";

type Member = {
  userId: string;
  role: MembershipRole;
  orgWide: boolean;
  scopes: { hospitalId: string; departmentId: string | null }[];
};

const covers = (m: Member, hospitalId: string, departmentId?: string) =>
  m.orgWide ||
  m.scopes.some(
    (s) =>
      s.hospitalId === hospitalId &&
      (departmentId === undefined || s.departmentId === null || s.departmentId === departmentId),
  );

function recipients(members: Member[], action: Action, hospitalId: string, departmentId?: string) {
  return members.filter((m) => roleCan(m.role, action) && covers(m, hospitalId, departmentId)).map((m) => m.userId);
}

/** The reminder bucket for a date `daysLeft` away: the smallest threshold not below it. */
export function reminderBucket(daysLeft: number, thresholds: number[]): number | null {
  if (daysLeft < 0) return null;
  const fitting = thresholds.filter((t) => t >= daysLeft).sort((a, b) => a - b);
  return fitting[0] ?? null;
}

export type ReminderSummary = { organizationId: string; sent: number; failed: boolean };

async function remindOrganization(organizationId: string, now: Date): Promise<number> {
  const actor = systemActor(organizationId);
  return withTenant({ userId: SYSTEM_SCHEDULER, organizationId }, async (tx) => {
    const settings = await readSettings(tx, organizationId);
    const hospitals = await tx.hospital.findMany({
      where: { status: "ACTIVE" },
      select: { id: true, code: true, timezone: true },
    });
    const members = (await tx.membership.findMany({
      where: { status: "ACTIVE" },
      select: { userId: true, role: true, orgWide: true, scopes: { select: { hospitalId: true, departmentId: true } } },
    })) as Member[];
    let sent = 0;
    const send = async (to: string[], n: Parameters<typeof notify>[3]) => {
      sent += await notify(tx, actor, to, n);
    };

    for (const h of hospitals) {
      const today = localToday(h.timezone, now);
      const t = toDbDate(today);

      // 1. Warranty and service contract expiry (largest threshold window).
      const maxDays = Math.max(...settings.warrantyReminderDays, ...settings.contractReminderDays);
      const expiring = await tx.warranty.findMany({
        where: {
          archivedAt: null,
          endsOn: { gte: t, lte: toDbDate(addDays(today, maxDays)) },
          asset: { hospitalId: h.id, archivedAt: null, status: { not: "DECOMMISSIONED" } },
        },
        select: {
          id: true,
          kind: true,
          provider: true,
          endsOn: true,
          asset: { select: { id: true, assetTag: true, departmentId: true } },
        },
      });
      for (const w of expiring) {
        const ends = w.endsOn.toISOString().slice(0, 10);
        const left = daysBetween(today, ends);
        const bucket = reminderBucket(
          left,
          w.kind === "WARRANTY" ? settings.warrantyReminderDays : settings.contractReminderDays,
        );
        if (bucket === null) continue;
        const label = w.kind === "WARRANTY" ? "Warranty" : "Service contract";
        await send(recipients(members, "warranty.claim", h.id, w.asset.departmentId), {
          type: w.kind === "WARRANTY" ? "warranty.expiring" : "contract.expiring",
          title: `${label} for ${w.asset.assetTag} ends in ${left} day${left === 1 ? "" : "s"}`,
          body: `${w.provider} · ends ${ends}`,
          link: `/assets/${w.asset.id}#warranties`,
          entityType: "warranty",
          entityId: w.id,
          dedupeKey: `warranty:${w.id}:${bucket}:${ends}`,
        });
      }

      // 2. Low and out-of-stock parts, per hospital (all its active stores).
      const stock = await tx.$queryRaw<
        {
          part_id: string;
          part_number: string;
          name: string;
          min_level: number;
          usable: bigint;
          reserved: bigint;
          last_in: string | null;
        }[]
      >`
        SELECT p.id AS part_id, p.part_number, p.name, p.min_level,
          coalesce(sum(l.on_hand) FILTER (WHERE l.expires_on IS NULL OR l.expires_on >= ${today}::date), 0) AS usable,
          coalesce((SELECT sum(r.quantity) FROM part_reservations r JOIN stock_locations s2 ON s2.id = r.location_id
                     WHERE r.part_id = p.id AND r.status = 'ACTIVE' AND s2.hospital_id = ${h.id}::uuid), 0) AS reserved,
          (SELECT m.id::text FROM stock_movements m JOIN stock_locations s3 ON s3.id = m.location_id
             WHERE m.part_id = p.id AND s3.hospital_id = ${h.id}::uuid AND m.quantity > 0
             ORDER BY m.created_at DESC LIMIT 1) AS last_in
        FROM parts p
        JOIN stock_levels l ON l.part_id = p.id
        JOIN stock_locations s ON s.id = l.location_id AND s.hospital_id = ${h.id}::uuid AND s.status = 'ACTIVE'
        WHERE p.status = 'ACTIVE'
        GROUP BY p.id`;
      for (const p of stock) {
        const available = Number(p.usable) - Number(p.reserved);
        const state = available <= 0 ? "out" : available <= p.min_level ? "low" : null;
        if (!state) continue;
        await send(recipients(members, "inventory.manage", h.id), {
          type: state === "out" ? "stock.out" : "stock.low",
          title:
            state === "out"
              ? `Out of stock at ${h.code}: ${p.part_number}`
              : `Low stock at ${h.code}: ${p.part_number}`,
          body: `${p.name} · ${Math.max(0, available)} available (minimum ${p.min_level})`,
          link: `/inventory/parts/${p.part_id}`,
          entityType: "part",
          entityId: p.part_id,
          // Re-alerts only after new stock has arrived and it drops again.
          dedupeKey: `stock:${state}:${p.part_id}:${h.id}:${p.last_in ?? "none"}`,
        });
      }

      // 3. Expiring and expired stock lots.
      const lots = await tx.stockLevel.findMany({
        where: {
          onHand: { gt: 0 },
          expiresOn: { not: null, lte: toDbDate(addDays(today, settings.stockExpiryWarningDays)) },
          location: { hospitalId: h.id },
        },
        select: {
          id: true,
          lotNumber: true,
          expiresOn: true,
          onHand: true,
          part: { select: { id: true, partNumber: true } },
          location: { select: { code: true } },
        },
      });
      for (const l of lots) {
        const exp = l.expiresOn!.toISOString().slice(0, 10);
        const expired = exp < today;
        await send(recipients(members, "inventory.manage", h.id), {
          type: expired ? "stock.expired" : "stock.expiring",
          title: expired
            ? `Expired stock at ${l.location.code}: ${l.part.partNumber}`
            : `Stock expiring at ${l.location.code}: ${l.part.partNumber}`,
          body: `Lot ${l.lotNumber} · ${l.onHand} on hand · expires ${exp}`,
          link: `/inventory/parts/${l.part.id}`,
          entityType: "stock_level",
          entityId: l.id,
          dedupeKey: `expiry:${l.id}:${exp}:${expired ? "expired" : "soon"}`,
        });
      }

      // 4. Supplier work past its expected date.
      const late = await tx.externalService.findMany({
        where: { status: { in: ["REQUESTED", "IN_PROGRESS"] }, expectedBy: { lt: t }, workOrder: { hospitalId: h.id } },
        select: {
          id: true,
          expectedBy: true,
          createdById: true,
          supplier: { select: { name: true } },
          workOrder: { select: { id: true, number: true, departmentId: true } },
        },
      });
      for (const s of late) {
        const exp = s.expectedBy!.toISOString().slice(0, 10);
        // The person who recorded it, if still an active member who can see the job.
        const creator = members.some(
          (m) =>
            m.userId === s.createdById &&
            roleCan(m.role, "service.manage") &&
            covers(m, h.id, s.workOrder.departmentId),
        )
          ? [s.createdById]
          : [];
        await send([...creator, ...recipients(members, "workorder.manage", h.id, s.workOrder.departmentId)], {
          type: "service.overdue",
          title: `Supplier work overdue on ${s.workOrder.number}`,
          body: `${s.supplier.name} · expected by ${exp}`,
          link: `/work-orders/${s.workOrder.id}#external-service`,
          entityType: "external_service",
          entityId: s.id,
          dedupeKey: `service-overdue:${s.id}:${exp}`,
        });
      }

      // 5. Purchase requests waiting for approval for 3 days or more.
      const waiting = await tx.purchaseRequest.findMany({
        where: {
          hospitalId: h.id,
          status: "SUBMITTED",
          submittedAt: { lte: new Date(now.getTime() - 3 * 86_400_000) },
        },
        select: { id: true, number: true },
      });
      for (const r of waiting) {
        await send(recipients(members, "purchase.approve", h.id), {
          type: "purchase.waiting",
          title: `Purchase request ${r.number} is still awaiting approval`,
          link: `/inventory/purchasing/${r.id}`,
          entityType: "purchase_request",
          entityId: r.id,
          dedupeKey: `purchase-waiting:${r.id}`,
        });
      }

      // 6. Lifecycle reviews due.
      const reviews = await tx.asset.findMany({
        where: {
          hospitalId: h.id,
          archivedAt: null,
          status: { not: "DECOMMISSIONED" },
          lifecycleReviewOn: { lte: toDbDate(addDays(today, settings.lifecycleReviewLeadDays)) },
        },
        select: { id: true, assetTag: true, departmentId: true, lifecycleReviewOn: true },
      });
      for (const a of reviews) {
        const on = a.lifecycleReviewOn!.toISOString().slice(0, 10);
        await send(recipients(members, "lifecycle.manage", h.id, a.departmentId), {
          type: "lifecycle.review_due",
          title: `Lifecycle review ${on < today ? "overdue" : "due"} for ${a.assetTag}`,
          body: `Review date ${on}`,
          link: `/assets/${a.id}#lifecycle`,
          entityType: "asset",
          entityId: a.id,
          dedupeKey: `lifecycle-review:${a.id}:${on}`,
        });
      }
    }
    return sent;
  });
}

export async function runInventoryReminders(
  opts: { now?: Date; organizationIds?: string[] } = {},
): Promise<ReminderSummary[]> {
  const now = opts.now ?? new Date();
  const orgs = await withTenant(
    { userId: SYSTEM_SCHEDULER, organizationId: null },
    (tx) => tx.$queryRaw<{ id: string }[]>`SELECT app_active_organizations() AS id`,
  );
  const out: ReminderSummary[] = [];
  for (const { id } of orgs) {
    if (opts.organizationIds && !opts.organizationIds.includes(id)) continue;
    try {
      out.push({ organizationId: id, sent: await remindOrganization(id, now), failed: false });
    } catch (error) {
      log.error("reminders.organisation_failed", { organizationId: id }, error);
      await withTenant({ userId: SYSTEM_SCHEDULER, organizationId: id }, (tx: Tx) =>
        audit(tx, {
          organizationId: id,
          actorUserId: null,
          action: "reminders.failed",
          outcome: "FAILURE",
          entityType: "organization",
          entityId: id,
          metadata: {
            reason: "Reminders could not be prepared; see the server log. They are retried on the next run.",
          },
        }),
      );
      out.push({ organizationId: id, sent: 0, failed: true });
    }
  }
  return out;
}
