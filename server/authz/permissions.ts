// Which role may do which action — the ONE place these rules live.
//
// Deny by default: an action not listed here, or a role not listed for an
// action, is refused. Hiding a button in the interface is only a convenience;
// every server action calls `requirePermission` before doing anything.
//
// Stage 3 added the organisation foundation; Stage 4 adds equipment assets,
// following the Stage 2 roles matrix and decision 8 (approved 14 Oct 2026:
// technicians may register assets; decommissioning needs approval by the
// Department Head / Nurse Unit Manager of the asset's department).
// Work orders, maintenance, inventory, documents and AI come in later stages.
//
// Permission = WHAT a role may do. Scope = WHERE: every asset action also
// checks the asset's hospital and department against the user's scope.
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

  // Equipment assets (Stage 4)
  "asset.view": [
    "ORG_ADMIN",
    "ENGINEERING_MANAGER",
    "TECHNICIAN",
    "INVENTORY_MANAGER",
    "DEPARTMENT_HEAD",
    "AUDITOR",
    "FAULT_REPORTER", // to identify equipment when reporting a fault (Stage 5)
  ],
  "asset.create": ["ORG_ADMIN", "ENGINEERING_MANAGER", "TECHNICIAN"],
  "asset.edit": ["ORG_ADMIN", "ENGINEERING_MANAGER", "TECHNICIAN"],
  // Field-level: purchase cost is financial information.
  "asset.viewCost": ["ORG_ADMIN", "ENGINEERING_MANAGER", "AUDITOR"],
  "asset.editCost": ["ORG_ADMIN", "ENGINEERING_MANAGER"],
  "asset.archive": ["ORG_ADMIN", "ENGINEERING_MANAGER"],
  "asset.labelPrint": ["ORG_ADMIN", "ENGINEERING_MANAGER", "TECHNICIAN"],
  "asset.export": ["ORG_ADMIN", "ENGINEERING_MANAGER", "INVENTORY_MANAGER", "AUDITOR"],
  "asset.auditView": ["ORG_ADMIN", "ENGINEERING_MANAGER", "AUDITOR"],
  "asset.decommissionRequest": ["ORG_ADMIN", "ENGINEERING_MANAGER", "TECHNICIAN"],
  // NUM first; managers and facility managers only when the department has no
  // NUM (rule enforced in services/assets.ts → decommissionApproverKind).
  "asset.decommissionApprove": ["DEPARTMENT_HEAD", "ENGINEERING_MANAGER"],
  // Manufacturers, categories, models and locations (adding entries).
  "catalog.create": ["ORG_ADMIN", "ENGINEERING_MANAGER", "TECHNICIAN"],
} as const satisfies Record<string, readonly MembershipRole[]>;

export type Action = keyof typeof PERMISSIONS;

export function roleCan(role: MembershipRole, action: Action): boolean {
  const allowed: readonly MembershipRole[] = PERMISSIONS[action] ?? [];
  return allowed.includes(role);
}
