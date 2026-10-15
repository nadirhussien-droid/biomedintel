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
  // Stage 6: MFA recovery for a member who lost authenticator AND backup codes.
  "member.resetMfa": ["ORG_ADMIN"],
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

  // Work orders (Stage 5). Scope: the job's hospital and department.
  // Fault Reporters see only the jobs they reported.
  "workorder.view": [
    "ORG_ADMIN",
    "ENGINEERING_MANAGER",
    "TECHNICIAN",
    "INVENTORY_MANAGER",
    "DEPARTMENT_HEAD",
    "AUDITOR",
    "FAULT_REPORTER",
  ],
  "workorder.report": ["ORG_ADMIN", "ENGINEERING_MANAGER", "TECHNICIAN", "DEPARTMENT_HEAD", "FAULT_REPORTER"],
  "workorder.comment": ["ORG_ADMIN", "ENGINEERING_MANAGER", "TECHNICIAN", "DEPARTMENT_HEAD", "FAULT_REPORTER"],
  // Triage: assign anyone in scope, change priority, cancel, reopen, review.
  "workorder.manage": ["ORG_ADMIN", "ENGINEERING_MANAGER"],
  // Take an unassigned job, and do the work on jobs assigned to oneself
  // (start, hold, log work, sign off).
  "workorder.work": ["ENGINEERING_MANAGER", "TECHNICIAN"],

  // Preventive maintenance (Stage 6). Scope: the asset's hospital and
  // department; a plan limited to one hospital needs access to that hospital.
  // Fault Reporters do not see maintenance schedules.
  "pm.view": ["ORG_ADMIN", "ENGINEERING_MANAGER", "TECHNICIAN", "INVENTORY_MANAGER", "DEPARTMENT_HEAD", "AUDITOR"],
  // Write, edit, pause, resume and archive plans; enrol assets; set
  // manufacturer intervals; run generation now.
  "pm.manage": ["ORG_ADMIN", "ENGINEERING_MANAGER"],
  "pm.generate": ["ORG_ADMIN", "ENGINEERING_MANAGER"],
  // Approving a plan (its procedure, limits and interval) and reviewing an
  // interval need qualified biomedical engineering staff (decision of
  // 15 Oct 2026), so only the Engineering Manager.
  "pm.approve": ["ENGINEERING_MANAGER"],
  "pm.report": ["ORG_ADMIN", "ENGINEERING_MANAGER", "DEPARTMENT_HEAD", "AUDITOR"],
  "pm.export": ["ORG_ADMIN", "ENGINEERING_MANAGER", "AUDITOR"],
  // Test standards and which standard applies where.
  "standards.manage": ["ORG_ADMIN", "ENGINEERING_MANAGER"],
  "standards.verify": ["ENGINEERING_MANAGER"],
  // Safety holds after a failed safety test (decision of 15 Oct 2026): every
  // PM viewer can see them; only an Engineering Manager who did NOT do the
  // retest may approve return to service (second-person rule in the service
  // and the database).
  "safety.release": ["ENGINEERING_MANAGER"],

  // Analytics and reports (Stage 7). Read-only; scope as everywhere else.
  "analytics.view": [
    "ORG_ADMIN",
    "ENGINEERING_MANAGER",
    "TECHNICIAN",
    "INVENTORY_MANAGER",
    "DEPARTMENT_HEAD",
    "AUDITOR",
  ],
  // Workload per engineer: management context only, never a public ranking.
  "analytics.workload": ["ORG_ADMIN", "ENGINEERING_MANAGER"],
  "analytics.export": ["ORG_ADMIN", "ENGINEERING_MANAGER", "AUDITOR"],
  // Financial figures (acquisition cost). Same roles that may see asset cost.
  "analytics.financial": ["ORG_ADMIN", "ENGINEERING_MANAGER", "AUDITOR"],
  // Create and change scheduled reports.
  "reports.schedule": ["ORG_ADMIN", "ENGINEERING_MANAGER"],

  // Lifecycle (Stage 8): replacement reviews, lifecycle review dates, disposal
  // records and the asset's supplier link. Decommissioning keeps its Stage 4 rule.
  "lifecycle.manage": ["ORG_ADMIN", "ENGINEERING_MANAGER"],

  // Warranties and service contracts (Stage 8). Viewing follows asset access
  // (Fault Reporters excluded); recording claims is for managers.
  "warranty.view": [
    "ORG_ADMIN",
    "ENGINEERING_MANAGER",
    "TECHNICIAN",
    "INVENTORY_MANAGER",
    "DEPARTMENT_HEAD",
    "AUDITOR",
  ],
  "warranty.manage": ["ORG_ADMIN", "ENGINEERING_MANAGER", "TECHNICIAN"],
  "warranty.claim": ["ORG_ADMIN", "ENGINEERING_MANAGER"],

  // Suppliers and external service providers (Stage 8).
  "supplier.view": ["ORG_ADMIN", "ENGINEERING_MANAGER", "TECHNICIAN", "INVENTORY_MANAGER", "AUDITOR"],
  "supplier.manage": ["ORG_ADMIN", "ENGINEERING_MANAGER", "INVENTORY_MANAGER"],
  // External service on a work order: managers create and update; the
  // assigned technician may update dates and references on their own job.
  "service.manage": ["ORG_ADMIN", "ENGINEERING_MANAGER", "TECHNICIAN"],

  // Spare parts inventory (Stage 8, Stage 2 workflow H). Stores belong to a
  // hospital: stock is visible and movable only for stores in the user's hospitals.
  "inventory.view": ["ORG_ADMIN", "ENGINEERING_MANAGER", "TECHNICIAN", "INVENTORY_MANAGER", "AUDITOR"],
  // Part catalogue, stores, reorder levels.
  "inventory.manage": ["ENGINEERING_MANAGER", "INVENTORY_MANAGER"],
  // Initial stock, receipts and transfers.
  "stock.receive": ["ENGINEERING_MANAGER", "INVENTORY_MANAGER"],
  // Adjustments and write-offs. Inventory Managers up to the organisation's
  // adjustment limit; above it an Engineering Manager (rule in the service).
  "stock.adjust": ["ENGINEERING_MANAGER", "INVENTORY_MANAGER"],
  // Reserve, issue and return parts on work orders. Technicians: only on jobs
  // assigned to them (rule in the service).
  "stock.issue": ["ENGINEERING_MANAGER", "TECHNICIAN", "INVENTORY_MANAGER"],
  // Unit costs and stock value are financial information.
  "inventory.viewCost": ["ORG_ADMIN", "ENGINEERING_MANAGER", "INVENTORY_MANAGER", "AUDITOR"],
  // Reminder thresholds and the adjustment limit.
  "inventory.settings": ["ORG_ADMIN", "ENGINEERING_MANAGER"],

  // Purchase requests (records only; nothing is sent or paid).
  "purchase.view": ["ORG_ADMIN", "ENGINEERING_MANAGER", "TECHNICIAN", "INVENTORY_MANAGER", "AUDITOR"],
  "purchase.request": ["ENGINEERING_MANAGER", "TECHNICIAN", "INVENTORY_MANAGER"],
  // Approval needs a second person (database CHECK: approver <> requester).
  "purchase.approve": ["ORG_ADMIN", "ENGINEERING_MANAGER"],
  // Mark an approved request as ordered (done outside BiomedIntel.ai).
  "purchase.order": ["ENGINEERING_MANAGER", "INVENTORY_MANAGER"],

  // Technical knowledge base (Stage 9, IntellKnowledge). A document's access
  // level and hospital narrow this further (rule in the service).
  "knowledge.view": ["ORG_ADMIN", "ENGINEERING_MANAGER", "TECHNICIAN", "INVENTORY_MANAGER", "AUDITOR"],
  // Register documents, upload versions (always as drafts), add error codes.
  "knowledge.contribute": ["ENGINEERING_MANAGER", "TECHNICIAN"],
  // Approve, supersede, withdraw and re-index documents: qualified biomedical
  // engineering staff (default for Stage 2 decision 12).
  "knowledge.approve": ["ENGINEERING_MANAGER"],

  // Troubleshooting sessions (Stage 9, IntellAssist). Scope: the asset's
  // hospital and department. Technicians edit sessions they started or on
  // jobs assigned to them; managers any session in scope (rule in the service).
  "troubleshoot.view": ["ORG_ADMIN", "ENGINEERING_MANAGER", "TECHNICIAN", "AUDITOR"],
  "troubleshoot.work": ["ENGINEERING_MANAGER", "TECHNICIAN"],
  // Switch the AI provider on or off for the organisation (data leaves the
  // application when it is on).
  "ai.settings": ["ORG_ADMIN"],
  // AI usage figures for the organisation.
  "ai.usage": ["ORG_ADMIN", "ENGINEERING_MANAGER", "AUDITOR"],
} as const satisfies Record<string, readonly MembershipRole[]>;

export type Action = keyof typeof PERMISSIONS;

export function roleCan(role: MembershipRole, action: Action): boolean {
  const allowed: readonly MembershipRole[] = PERMISSIONS[action] ?? [];
  return allowed.includes(role);
}
