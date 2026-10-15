// Parts, external service and maintenance cost reporting (Stage 8, extends Stage 7).
//
// Only RECORDED figures, never estimates:
//   • Parts cost = quantity issued minus quantity returned, at the unit cost
//     recorded on the part when it was issued. Parts with no unit cost
//     recorded are counted (quantities) but add nothing to the cost, and the
//     report says how many there were.
//   • External service cost = the cost recorded on the supplier record.
//   • Maintenance cost by asset = parts cost + external service cost.
//     It does NOT include in-house labour (no rates are recorded), taxes or
//     other components unless the person included them in the recorded figure.
//   • Each currency is reported separately; currencies are never converted or added.
//   • Cost figures need analytics.financial and every view is audited.
import { Prisma } from "../db/generated/client";
import { withTenant } from "../db/tenant";
import { audit } from "../audit/audit";
import { can, requirePermission, type AccessContext } from "../authz/access";
import { NotFoundError } from "../authz/errors";
import { analyticsQuerySchema } from "@/lib/validation/analytics";
import { resolvePeriod } from "@/lib/analytics/period";
import { todayFor } from "./pm-schedule";
import { tenant } from "./inventory";

const n = (v: bigint | number | null | undefined) => (v === null || v === undefined ? 0 : Number(v));
const NONE = "00000000-0000-0000-0000-000000000000";

export async function getCostReport(ctx: AccessContext, raw: unknown) {
  await requirePermission(ctx, "analytics.view", { entityType: "analytics" });
  const q = analyticsQuerySchema.parse(raw ?? {});
  if (q.hospital && !ctx.hospitals.some((h) => h.id === q.hospital)) throw new NotFoundError("Hospital");
  const today = await todayFor(ctx, q.hospital);
  const p = resolvePeriod(q.period, today, { from: q.from, to: q.to });
  const financial = can(ctx, "analytics.financial");
  const hospitals = q.hospital ? [q.hospital] : ctx.hospitals.map((h) => h.id);
  const hs = Prisma.join(hospitals.length ? hospitals : [NONE]);
  // Job scope: the job's own hospital and department (as in Stage 7).
  const woScope = ctx.hospitals.length
    ? Prisma.join(
        ctx.hospitals
          .filter((h) => !q.hospital || h.id === q.hospital)
          .map((h) =>
            h.departments === "ALL"
              ? Prisma.sql`w.hospital_id = ${h.id}::uuid`
              : h.departments.length
                ? Prisma.sql`(w.hospital_id = ${h.id}::uuid AND w.department_id IN (${Prisma.join(h.departments.map((d) => Prisma.sql`${d}::uuid`))}))`
                : Prisma.sql`FALSE`,
          ),
        " OR ",
      )
    : Prisma.sql`FALSE`;
  // The same scope on the asset (alias a), for warranty claims.
  const claimScope = ctx.hospitals.length
    ? Prisma.join(
        ctx.hospitals
          .filter((h) => !q.hospital || h.id === q.hospital)
          .map((h) =>
            h.departments === "ALL"
              ? Prisma.sql`a.hospital_id = ${h.id}::uuid`
              : h.departments.length
                ? Prisma.sql`(a.hospital_id = ${h.id}::uuid AND a.department_id IN (${Prisma.join(h.departments.map((d) => Prisma.sql`${d}::uuid`))}))`
                : Prisma.sql`FALSE`,
          ),
        " OR ",
      )
    : Prisma.sql`FALSE`;
  const inPeriod = (col: Prisma.Sql) =>
    Prisma.sql`(${col} >= (${p.from}::date)::timestamp AT TIME ZONE h.timezone AND ${col} < ((${p.to}::date + 1))::timestamp AT TIME ZONE h.timezone)`;

  return withTenant(tenant(ctx), async (tx) => {
    // Movements in the period, in stores of the user's hospitals.
    const MOV = Prisma.sql`FROM stock_movements m JOIN parts p ON p.id = m.part_id JOIN stock_locations s ON s.id = m.location_id JOIN hospitals h ON h.id = s.hospital_id
      WHERE s.hospital_id IN (${hs}) AND ${inPeriod(Prisma.sql`m.created_at`)}`;
    const movementSummary = await tx.$queryRaw<{ type: string; movements: bigint; units: bigint }[]>`
      SELECT m.type::text AS type, count(*) AS movements, sum(abs(m.quantity)) AS units ${MOV} GROUP BY 1 ORDER BY 1`;
    const consumption = await tx.$queryRaw<
      { part_id: string; part_number: string; name: string; unit: string; used: bigint; jobs: bigint }[]
    >`
      SELECT p.id AS part_id, p.part_number, p.name, p.unit::text AS unit, -sum(m.quantity) AS used, count(DISTINCT m.work_order_id) AS jobs
      ${MOV} AND m.type IN ('ISSUE', 'RETURN')
      GROUP BY 1, 2, 3, 4 HAVING -sum(m.quantity) <> 0 ORDER BY 5 DESC, 2 LIMIT 100`.then((rows) =>
      rows.map((r) => ({ ...r, used: n(r.used), jobs: n(r.jobs) })),
    );
    const writeOffs = await tx.$queryRaw<
      { part_id: string; part_number: string; name: string; units: bigint; reasons: string }[]
    >`
      SELECT p.id AS part_id, p.part_number, p.name, -sum(m.quantity) AS units, string_agg(DISTINCT left(m.reason, 80), '; ') AS reasons
      ${MOV} AND m.type = 'WRITE_OFF'
      GROUP BY 1, 2, 3 ORDER BY 4 DESC LIMIT 100`.then((rows) => rows.map((r) => ({ ...r, units: n(r.units) })));

    const supplierHistory = await tx.$queryRaw<
      {
        supplier_id: string;
        name: string;
        requests: bigint;
        completed: bigint;
        open: bigint;
        with_dates: bigint;
        on_time: bigint;
      }[]
    >`
      SELECT sp.id AS supplier_id, sp.name,
        count(*) AS requests,
        count(*) FILTER (WHERE e.status = 'COMPLETED') AS completed,
        count(*) FILTER (WHERE e.status IN ('REQUESTED', 'IN_PROGRESS')) AS open,
        count(*) FILTER (WHERE e.expected_by IS NOT NULL AND e.completed_on IS NOT NULL) AS with_dates,
        count(*) FILTER (WHERE e.expected_by IS NOT NULL AND e.completed_on IS NOT NULL AND e.completed_on <= e.expected_by) AS on_time
      FROM external_services e
      JOIN suppliers sp ON sp.id = e.supplier_id
      JOIN work_orders w ON w.id = e.work_order_id
      WHERE (${woScope}) AND e.requested_on BETWEEN ${p.from}::date AND ${p.to}::date
      GROUP BY 1, 2 ORDER BY 3 DESC, 2`;

    const claims = await tx.$queryRaw<{ status: string; claims: bigint }[]>`
      SELECT c.status::text AS status, count(*) AS claims
      FROM warranty_claims c JOIN assets a ON a.id = c.asset_id
      WHERE (${claimScope})
        AND coalesce(c.decided_on, c.submitted_on, c.created_at::date) BETWEEN ${p.from}::date AND ${p.to}::date
      GROUP BY 1 ORDER BY 1`;

    let costs: null | {
      partsByCurrency: { currency: string; total: string }[];
      unpricedIssues: number;
      serviceByCurrency: { currency: string; total: string; records: number }[];
      servicesWithoutCost: number;
      byAsset: {
        asset_id: string;
        asset_tag: string;
        name: string;
        currency: string;
        parts: string;
        service: string;
        total: string;
      }[];
      byWorkOrder: { work_order_id: string; number: string; currency: string; parts: string }[];
      writeOffValue: { currency: string; total: string }[];
      recovered: { currency: string; total: string }[];
    } = null;
    if (financial) {
      const partsByCurrency = await tx.$queryRaw<{ currency: string; total: string }[]>`
        SELECT m.currency, (-sum(m.quantity * m.unit_cost))::numeric(14,2)::text AS total
        ${MOV} AND m.type IN ('ISSUE', 'RETURN') AND m.unit_cost IS NOT NULL GROUP BY 1 ORDER BY 1`;
      const [unpriced] = await tx.$queryRaw<{ n: bigint }[]>`
        SELECT count(*) AS n ${MOV} AND m.type = 'ISSUE' AND m.unit_cost IS NULL`;
      const svc = Prisma.sql`FROM external_services e JOIN work_orders w ON w.id = e.work_order_id
        WHERE (${woScope}) AND e.status = 'COMPLETED' AND e.completed_on BETWEEN ${p.from}::date AND ${p.to}::date`;
      const serviceByCurrency = await tx.$queryRaw<{ currency: string; total: string; records: bigint }[]>`
        SELECT e.currency, sum(e.cost)::numeric(14,2)::text AS total, count(*) AS records ${svc} AND e.cost IS NOT NULL GROUP BY 1 ORDER BY 1`;
      const [noCost] = await tx.$queryRaw<{ n: bigint }[]>`SELECT count(*) AS n ${svc} AND e.cost IS NULL`;
      const byAsset = await tx.$queryRaw<
        {
          asset_id: string;
          asset_tag: string;
          name: string;
          currency: string;
          parts: string;
          service: string;
          total: string;
        }[]
      >`
        WITH parts AS (
          SELECT w.asset_id, m.currency, -sum(m.quantity * m.unit_cost) AS amount
          FROM stock_movements m JOIN work_orders w ON w.id = m.work_order_id JOIN hospitals h ON h.id = w.hospital_id
          WHERE (${woScope}) AND m.type IN ('ISSUE', 'RETURN') AND m.unit_cost IS NOT NULL AND ${inPeriod(Prisma.sql`m.created_at`)}
          GROUP BY 1, 2),
        service AS (
          SELECT e.asset_id, e.currency, sum(e.cost) AS amount ${svc} AND e.cost IS NOT NULL GROUP BY 1, 2),
        both_ AS (
          SELECT coalesce(pa.asset_id, se.asset_id) AS asset_id, coalesce(pa.currency, se.currency) AS currency,
                 coalesce(pa.amount, 0) AS parts, coalesce(se.amount, 0) AS service
          FROM parts pa FULL JOIN service se ON se.asset_id = pa.asset_id AND se.currency = pa.currency)
        SELECT b.asset_id, a.asset_tag, a.name, b.currency, b.parts::numeric(14,2)::text AS parts,
               b.service::numeric(14,2)::text AS service, (b.parts + b.service)::numeric(14,2)::text AS total
        FROM both_ b JOIN assets a ON a.id = b.asset_id
        ORDER BY b.currency, b.parts + b.service DESC LIMIT 100`;
      const byWorkOrder = await tx.$queryRaw<
        { work_order_id: string; number: string; currency: string; parts: string }[]
      >`
        SELECT w.id AS work_order_id, w.number, m.currency, (-sum(m.quantity * m.unit_cost))::numeric(14,2)::text AS parts
        FROM stock_movements m JOIN work_orders w ON w.id = m.work_order_id JOIN hospitals h ON h.id = w.hospital_id
        WHERE (${woScope}) AND m.type IN ('ISSUE', 'RETURN') AND m.unit_cost IS NOT NULL AND ${inPeriod(Prisma.sql`m.created_at`)}
        GROUP BY 1, 2, 3 HAVING sum(m.quantity) <> 0 ORDER BY 3, sum(m.quantity * m.unit_cost) ASC LIMIT 100`;
      const writeOffValue = await tx.$queryRaw<{ currency: string; total: string }[]>`
        SELECT m.currency, (-sum(m.quantity * m.unit_cost))::numeric(14,2)::text AS total
        ${MOV} AND m.type = 'WRITE_OFF' AND m.unit_cost IS NOT NULL GROUP BY 1 ORDER BY 1`;
      const recovered = await tx.$queryRaw<{ currency: string; total: string }[]>`
        SELECT c.currency, sum(c.amount_recovered)::numeric(14,2)::text AS total
        FROM warranty_claims c JOIN assets a ON a.id = c.asset_id
        WHERE (${claimScope}) AND c.amount_recovered IS NOT NULL AND c.decided_on BETWEEN ${p.from}::date AND ${p.to}::date
        GROUP BY 1 ORDER BY 1`;
      costs = {
        partsByCurrency,
        unpricedIssues: n(unpriced?.n),
        serviceByCurrency: serviceByCurrency.map((s) => ({ ...s, records: n(s.records) })),
        servicesWithoutCost: n(noCost?.n),
        byAsset,
        byWorkOrder,
        writeOffValue,
        recovered,
      };
      await audit(tx, {
        organizationId: ctx.organization.id,
        actorUserId: ctx.user.id,
        action: "analytics.financial_viewed",
        entityType: "analytics",
        metadata: { report: "costs", hospital: q.hospital ?? null, from: p.from, to: p.to },
        request: ctx.request,
      });
    }
    return {
      q,
      period: p,
      today,
      financial,
      movementSummary: movementSummary.map((m) => ({ ...m, movements: n(m.movements), units: n(m.units) })),
      consumption,
      writeOffs,
      supplierHistory: supplierHistory.map((s) => ({
        ...s,
        requests: n(s.requests),
        completed: n(s.completed),
        open: n(s.open),
        withDates: n(s.with_dates),
        onTime: n(s.on_time),
      })),
      claims: claims.map((c) => ({ status: c.status, claims: n(c.claims) })),
      costs,
    };
  });
}
