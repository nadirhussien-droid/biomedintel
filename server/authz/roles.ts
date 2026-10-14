// The BiomedIntel.ai roles (Stage 2 blueprint, section 3, plus the approved
// eighth role, Fault Reporter).
import type { MembershipRole } from "../db/generated/enums";

export type { MembershipRole };

export const MEMBERSHIP_ROLES = [
  "ORG_ADMIN",
  "ENGINEERING_MANAGER",
  "TECHNICIAN",
  "INVENTORY_MANAGER",
  "DEPARTMENT_HEAD",
  "AUDITOR",
  "FAULT_REPORTER",
] as const satisfies readonly MembershipRole[];

export const ROLE_LABELS: Record<MembershipRole, string> = {
  ORG_ADMIN: "Hospital Organization Administrator",
  ENGINEERING_MANAGER: "Biomedical Engineering Manager",
  TECHNICIAN: "Biomedical Engineer or Technician",
  INVENTORY_MANAGER: "Inventory Manager",
  DEPARTMENT_HEAD: "Department Head or Facility Manager",
  AUDITOR: "Read-only Auditor or Executive",
  FAULT_REPORTER: "Fault Reporter",
};

export const PLATFORM_SUPER_ADMIN_LABEL = "Platform Super Administrator";

/**
 * Roles that must use authenticator-app MFA (approved decision 13):
 * Platform Super Administrator, Hospital Organization Administrator and
 * Biomedical Engineering Manager.
 */
export const MFA_REQUIRED_ROLES: ReadonlySet<MembershipRole> = new Set(["ORG_ADMIN", "ENGINEERING_MANAGER"]);

export function roleRequiresMfa(role: MembershipRole | null, isPlatformAdmin: boolean): boolean {
  return isPlatformAdmin || (role !== null && MFA_REQUIRED_ROLES.has(role));
}
