// Which role may do which action — the ONE place these rules live.
//
// Deny by default: an action not listed here, or a role not listed for an
// action, is refused. Hiding a button in the interface is only a convenience;
// every server action calls `requirePermission` before doing anything.
//
// Stage 3 covers the organisation foundation. Equipment, work orders,
// maintenance, inventory, documents and AI permissions are added in the stage
// that builds each module, following the Stage 2 roles matrix.
import type { MembershipRole } from "./roles";

export const PERMISSIONS = {
  // Everyone with an active membership
  "dashboard.view": [
    "ORG_ADMIN",
    "ENGINEERING_MANAGER",
    "TECHNICIAN",
    "INVENTORY_MANAGER",
    "DEPARTMENT_HEAD",
    "AUDITOR",
    "FAULT_REPORTER",
  ],
  "hospital.view": [
    "ORG_ADMIN",
    "ENGINEERING_MANAGER",
    "TECHNICIAN",
    "INVENTORY_MANAGER",
    "DEPARTMENT_HEAD",
    "AUDITOR",
    "FAULT_REPORTER",
  ],

  // Organisation administration
  "admin.view": ["ORG_ADMIN", "AUDITOR"],
  "hospital.create": ["ORG_ADMIN"],
  "hospital.archive": ["ORG_ADMIN"],
  "department.create": ["ORG_ADMIN"],
  "department.archive": ["ORG_ADMIN"],
  "member.view": ["ORG_ADMIN", "AUDITOR"],
  "member.add": ["ORG_ADMIN"],
  "member.changeRole": ["ORG_ADMIN"],
  "audit.view": ["ORG_ADMIN", "AUDITOR"],
} as const satisfies Record<string, readonly MembershipRole[]>;

export type Action = keyof typeof PERMISSIONS;

export function roleCan(role: MembershipRole, action: Action): boolean {
  const allowed: readonly MembershipRole[] = PERMISSIONS[action] ?? [];
  return allowed.includes(role);
}
