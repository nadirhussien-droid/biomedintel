// In-app notifications (Stage 5). Email comes later with an email provider.
//
// Recipients are always worked out on the server from memberships and scope
// in the CURRENT organisation (RLS). A person only ever reads their own
// notifications (database policy), and links are in-app paths only.
import type { MembershipRole } from "../authz/roles";
import { withTenant, type Tx } from "../db/tenant";
import { requirePermission, type AccessContext } from "../authz/access";
import { parseInput } from "../validation";
import { z } from "zod";

export type StaffMember = { userId: string; role: MembershipRole; coverage: "org" | "hospital" | "department" };

/**
 * Active members of the current organisation with one of `roles` whose access
 * covers the given hospital and department.
 */
export async function findStaff(
  tx: Tx,
  where: { hospitalId: string; departmentId: string; roles: MembershipRole[] },
): Promise<StaffMember[]> {
  const memberships = await tx.membership.findMany({
    where: { status: "ACTIVE", role: { in: where.roles } },
    select: { userId: true, role: true, orgWide: true, scopes: { select: { hospitalId: true, departmentId: true } } },
  });
  const out: StaffMember[] = [];
  for (const m of memberships) {
    if (m.orgWide) {
      out.push({ userId: m.userId, role: m.role, coverage: "org" });
      continue;
    }
    const inHospital = m.scopes.filter((s) => s.hospitalId === where.hospitalId);
    if (inHospital.some((s) => s.departmentId === null)) {
      out.push({ userId: m.userId, role: m.role, coverage: "hospital" });
    } else if (inHospital.some((s) => s.departmentId === where.departmentId)) {
      out.push({ userId: m.userId, role: m.role, coverage: "department" });
    }
  }
  return out;
}

export type NewNotification = {
  type: string;
  title: string;
  body?: string;
  link?: string;
  entityType?: string;
  entityId?: string;
};

/** Creates one notification per recipient (never the person who acted). */
export async function notify(
  tx: Tx,
  ctx: AccessContext,
  recipientIds: Iterable<string | null | undefined>,
  n: NewNotification,
): Promise<number> {
  const ids = [...new Set([...recipientIds].filter((id): id is string => Boolean(id) && id !== ctx.user.id))];
  if (ids.length === 0) return 0;
  if (n.link && !/^\/[a-z]/.test(n.link)) throw new Error("Notification links must be in-app paths");
  await tx.notification.createMany({
    data: ids.map((userId) => ({
      organizationId: ctx.organization.id,
      userId,
      type: n.type,
      title: n.title.slice(0, 200),
      body: n.body?.slice(0, 500) ?? null,
      link: n.link ?? null,
      entityType: n.entityType ?? null,
      entityId: n.entityId ?? null,
    })),
  });
  return ids.length;
}

const tenant = (ctx: AccessContext) => ({ userId: ctx.user.id, organizationId: ctx.organization.id });

export async function listMyNotifications(ctx: AccessContext, limit = 50) {
  await requirePermission(ctx, "dashboard.view");
  return withTenant(tenant(ctx), (tx) =>
    tx.notification.findMany({
      where: { userId: ctx.user.id },
      orderBy: { createdAt: "desc" },
      take: Math.min(Math.max(limit, 1), 200),
      select: { id: true, type: true, title: true, body: true, link: true, readAt: true, createdAt: true },
    }),
  );
}

export async function countMyUnread(ctx: AccessContext): Promise<number> {
  return withTenant(tenant(ctx), (tx) => tx.notification.count({ where: { userId: ctx.user.id, readAt: null } }));
}

const markSchema = z.object({ id: z.union([z.literal("all"), z.string().uuid()]) });

/** Marks one (or all) of the CURRENT user's notifications as read. */
export async function markRead(ctx: AccessContext, input: unknown): Promise<number> {
  await requirePermission(ctx, "dashboard.view");
  const { id } = parseInput(markSchema, input);
  return withTenant(tenant(ctx), async (tx) => {
    const r = await tx.notification.updateMany({
      where: { userId: ctx.user.id, readAt: null, ...(id === "all" ? {} : { id }) },
      data: { readAt: new Date() },
    });
    return r.count;
  });
}
