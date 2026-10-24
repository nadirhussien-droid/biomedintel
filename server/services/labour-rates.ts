// Hourly labour rates for the cost reports.
//
// A rate belongs to one person from a start date, in one currency. Rates are
// never edited or deleted: a new rate with a later start date takes over from
// that date, so earlier reports keep the rate that applied at the time. People
// with no rate still have their hours reported, just without a money value.
import { withTenant } from "../db/tenant";
import { audit } from "../audit/audit";
import { requirePermission, type AccessContext } from "../authz/access";
import { ValidationError } from "../authz/errors";
import { parseInput } from "../validation";
import { labourRateSchema } from "@/lib/validation/labour";
import { peopleNames } from "./work-order-core";

const tenant = (ctx: AccessContext) => ({ userId: ctx.user.id, organizationId: ctx.organization.id });
const day = (d: Date) => d.toISOString().slice(0, 10);

export type PersonRates = {
  userId: string;
  name: string;
  role: string;
  rates: { id: string; hourlyRate: string; currency: string; effectiveFrom: string; note: string | null }[];
};

/** Everyone who can log work, with their rate history (newest first). */
export async function listLabourRates(ctx: AccessContext): Promise<PersonRates[]> {
  await requirePermission(ctx, "labour.rates", { entityType: "labour_rate" });
  return withTenant(tenant(ctx), async (tx) => {
    const members = await tx.membership.findMany({
      where: { status: "ACTIVE", role: { in: ["TECHNICIAN", "ENGINEERING_MANAGER", "ORG_ADMIN"] } },
      select: { userId: true, role: true },
    });
    const rates = await tx.labourRate.findMany({ orderBy: [{ effectiveFrom: "desc" }, { createdAt: "desc" }] });
    const names = await peopleNames(
      tx,
      members.map((m) => m.userId),
    );
    return members
      .map((m) => ({
        userId: m.userId,
        name: names[m.userId] ?? "Unknown",
        role: m.role,
        rates: rates
          .filter((r) => r.userId === m.userId)
          .map((r) => ({
            id: r.id,
            hourlyRate: r.hourlyRate.toFixed(2),
            currency: r.currency,
            effectiveFrom: day(r.effectiveFrom),
            note: r.note,
          })),
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  });
}

export async function addLabourRate(ctx: AccessContext, input: unknown) {
  await requirePermission(ctx, "labour.rates", { entityType: "labour_rate" });
  const data = parseInput(labourRateSchema, input);
  return withTenant(tenant(ctx), async (tx) => {
    const member = await tx.membership.findFirst({
      where: { userId: data.userId, status: "ACTIVE" },
      select: { userId: true },
    });
    if (!member) throw new ValidationError("Choose a person from your organisation.", { userId: ["Not a member"] });
    const row = await tx.labourRate.create({
      data: {
        organizationId: ctx.organization.id,
        userId: data.userId,
        hourlyRate: data.hourlyRate,
        currency: data.currency,
        effectiveFrom: new Date(`${data.effectiveFrom}T00:00:00Z`),
        note: data.note,
        createdById: ctx.user.id,
      },
      select: { id: true },
    });
    await audit(tx, {
      organizationId: ctx.organization.id,
      actorUserId: ctx.user.id,
      action: "labour_rate.added",
      entityType: "labour_rate",
      entityId: row.id,
      metadata: {
        forUserId: data.userId,
        hourlyRate: data.hourlyRate,
        currency: data.currency,
        effectiveFrom: data.effectiveFrom,
      },
      request: ctx.request,
    });
    return row;
  });
}
