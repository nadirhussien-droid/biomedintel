// Contact details printed on exported reports (address, email, telephone, website,
// registration or licence number, and one free note).
//
//   • Only an Organisation Administrator may change them (logo.manage, the same
//     "branding" permission as the logo).
//   • Any member may READ them: they are printed on reports the member exports.
//   • Append-only history: saving adds a row, the newest row is current. Saving
//     with every box empty clears them.
import { withTenant } from "../db/tenant";
import { audit } from "../audit/audit";
import { requirePermission, type AccessContext } from "../authz/access";
import { parseInput } from "../validation";
import { letterheadSchema, type Letterhead } from "@/lib/validation/letterhead";

const tenant = (ctx: AccessContext) => ({ userId: ctx.user.id, organizationId: ctx.organization.id });

export async function getLetterhead(ctx: AccessContext): Promise<Letterhead | null> {
  return withTenant(tenant(ctx), async (tx) => {
    const row = await tx.organizationLetterhead.findFirst({
      where: { organizationId: ctx.organization.id },
      orderBy: { createdAt: "desc" },
    });
    if (!row) return null;
    const out = {
      address: row.address,
      email: row.email,
      phone: row.phone,
      website: row.website,
      registration: row.registration,
      note: row.note,
    };
    return Object.values(out).some(Boolean) ? out : null;
  });
}

export async function setLetterhead(ctx: AccessContext, input: unknown) {
  await requirePermission(ctx, "logo.manage", { entityType: "organization" });
  const data = parseInput(letterheadSchema, input);
  return withTenant(tenant(ctx), async (tx) => {
    await tx.organizationLetterhead.create({
      data: { organizationId: ctx.organization.id, ...data, changedById: ctx.user.id },
    });
    await audit(tx, {
      organizationId: ctx.organization.id,
      actorUserId: ctx.user.id,
      action: "organization.letterhead_set",
      entityType: "organization",
      entityId: ctx.organization.id,
      metadata: {
        filled: Object.entries(data)
          .filter(([, v]) => v)
          .map(([k]) => k),
      },
      request: ctx.request,
    });
    return { saved: true };
  });
}

/** The printed lines for the header: address lines, then telephone, email and website. */
export function headerLines(l: Letterhead | null): string[] {
  if (!l) return [];
  const lines = (l.address ?? "")
    .split(/\r?\n/)
    .map((x) => x.trim())
    .filter(Boolean);
  if (l.phone) lines.push(`Tel: ${l.phone}`);
  if (l.email) lines.push(l.email);
  if (l.website) lines.push(l.website);
  return lines;
}

/** The printed lines for the footer: registration or licence number, then the free note. */
export function footerLines(l: Letterhead | null): string[] {
  if (!l) return [];
  return [l.registration, l.note].filter((x): x is string => Boolean(x)).map((x) => x.replace(/\s*\r?\n\s*/g, " · "));
}
