// Display names for user ids, read inside the current organisation (RLS).
import { withTenant } from "../db/tenant";
import type { AccessContext } from "../authz/access";
import { peopleNames } from "./work-order-core";

export function peopleNamesFor(ctx: AccessContext, ids: (string | null | undefined)[]) {
  return withTenant({ userId: ctx.user.id, organizationId: ctx.organization.id }, (tx) => peopleNames(tx, ids));
}
