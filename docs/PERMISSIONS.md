# BiomedIntel.ai — permissions matrix

<!-- Generated from server/authz/permissions.ts by `npm run docs:permissions`. Do not edit by hand. -->

**What a role may do.** Every server action and page checks this table on the server before doing anything (deny by default). Hiding a button is only a convenience.

**Where it may do it.** Separately, every record is checked against the person's organisation (database row-level security) and their hospitals and departments (scope). A permission never reaches another organisation's records.

## Roles

| Role | Name in the app | MFA |
| --- | --- | --- |
| Org admin | Hospital Organization Administrator | Required (authenticator app) |
| Eng. manager | Biomedical Engineering Manager | Required (authenticator app) |
| Technician | Biomedical Engineer or Technician | Optional |
| Inventory mgr | Inventory Manager | Optional |
| Dept head | Department Head or Facility Manager | Optional |
| Auditor | Read-only Auditor or Executive | Optional |
| Fault reporter | Fault Reporter | Optional |
| Platform Super Administrator | Runs the platform; not a member role | Required |

## Actions (68)

✔ = allowed. Blank = refused.

### dashboard

| Action | Org admin | Eng. manager | Technician | Inventory mgr | Dept head | Auditor | Fault reporter |
| --- | :-: | :-: | :-: | :-: | :-: | :-: | :-: |
| `dashboard.view` | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |

### hospital

| Action | Org admin | Eng. manager | Technician | Inventory mgr | Dept head | Auditor | Fault reporter |
| --- | :-: | :-: | :-: | :-: | :-: | :-: | :-: |
| `hospital.view` | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |
| `hospital.create` | ✔ |  |  |  |  |  |  |
| `hospital.archive` | ✔ |  |  |  |  |  |  |

### admin

| Action | Org admin | Eng. manager | Technician | Inventory mgr | Dept head | Auditor | Fault reporter |
| --- | :-: | :-: | :-: | :-: | :-: | :-: | :-: |
| `admin.view` | ✔ |  |  |  |  | ✔ |  |

### department

| Action | Org admin | Eng. manager | Technician | Inventory mgr | Dept head | Auditor | Fault reporter |
| --- | :-: | :-: | :-: | :-: | :-: | :-: | :-: |
| `department.create` | ✔ |  |  |  |  |  |  |
| `department.archive` | ✔ |  |  |  |  |  |  |

### member

| Action | Org admin | Eng. manager | Technician | Inventory mgr | Dept head | Auditor | Fault reporter |
| --- | :-: | :-: | :-: | :-: | :-: | :-: | :-: |
| `member.view` | ✔ |  |  |  |  | ✔ |  |
| `member.add` | ✔ |  |  |  |  |  |  |
| `member.changeRole` | ✔ |  |  |  |  |  |  |
| `member.resetMfa` | ✔ |  |  |  |  |  |  |

### audit

| Action | Org admin | Eng. manager | Technician | Inventory mgr | Dept head | Auditor | Fault reporter |
| --- | :-: | :-: | :-: | :-: | :-: | :-: | :-: |
| `audit.view` | ✔ |  |  |  |  | ✔ |  |

### asset

| Action | Org admin | Eng. manager | Technician | Inventory mgr | Dept head | Auditor | Fault reporter |
| --- | :-: | :-: | :-: | :-: | :-: | :-: | :-: |
| `asset.view` | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |
| `asset.create` | ✔ | ✔ | ✔ |  |  |  |  |
| `asset.edit` | ✔ | ✔ | ✔ |  |  |  |  |
| `asset.viewCost` | ✔ | ✔ |  |  |  | ✔ |  |
| `asset.editCost` | ✔ | ✔ |  |  |  |  |  |
| `asset.archive` | ✔ | ✔ |  |  |  |  |  |
| `asset.labelPrint` | ✔ | ✔ | ✔ |  |  |  |  |
| `asset.export` | ✔ | ✔ |  | ✔ |  | ✔ |  |
| `asset.auditView` | ✔ | ✔ |  |  |  | ✔ |  |
| `asset.decommissionRequest` | ✔ | ✔ | ✔ |  |  |  |  |
| `asset.decommissionApprove` |  | ✔ |  |  | ✔ |  |  |

### catalog

| Action | Org admin | Eng. manager | Technician | Inventory mgr | Dept head | Auditor | Fault reporter |
| --- | :-: | :-: | :-: | :-: | :-: | :-: | :-: |
| `catalog.create` | ✔ | ✔ | ✔ |  |  |  |  |

### workorder

| Action | Org admin | Eng. manager | Technician | Inventory mgr | Dept head | Auditor | Fault reporter |
| --- | :-: | :-: | :-: | :-: | :-: | :-: | :-: |
| `workorder.view` | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |
| `workorder.report` | ✔ | ✔ | ✔ |  | ✔ |  | ✔ |
| `workorder.comment` | ✔ | ✔ | ✔ |  | ✔ |  | ✔ |
| `workorder.manage` | ✔ | ✔ |  |  |  |  |  |
| `workorder.work` |  | ✔ | ✔ |  |  |  |  |

### pm

| Action | Org admin | Eng. manager | Technician | Inventory mgr | Dept head | Auditor | Fault reporter |
| --- | :-: | :-: | :-: | :-: | :-: | :-: | :-: |
| `pm.view` | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |  |
| `pm.manage` | ✔ | ✔ |  |  |  |  |  |
| `pm.generate` | ✔ | ✔ |  |  |  |  |  |
| `pm.approve` |  | ✔ |  |  |  |  |  |
| `pm.report` | ✔ | ✔ |  |  | ✔ | ✔ |  |
| `pm.export` | ✔ | ✔ |  |  |  | ✔ |  |

### standards

| Action | Org admin | Eng. manager | Technician | Inventory mgr | Dept head | Auditor | Fault reporter |
| --- | :-: | :-: | :-: | :-: | :-: | :-: | :-: |
| `standards.manage` | ✔ | ✔ |  |  |  |  |  |
| `standards.verify` |  | ✔ |  |  |  |  |  |

### safety

| Action | Org admin | Eng. manager | Technician | Inventory mgr | Dept head | Auditor | Fault reporter |
| --- | :-: | :-: | :-: | :-: | :-: | :-: | :-: |
| `safety.release` |  | ✔ |  |  |  |  |  |

### analytics

| Action | Org admin | Eng. manager | Technician | Inventory mgr | Dept head | Auditor | Fault reporter |
| --- | :-: | :-: | :-: | :-: | :-: | :-: | :-: |
| `analytics.view` | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |  |
| `analytics.workload` | ✔ | ✔ |  |  |  |  |  |
| `analytics.export` | ✔ | ✔ |  |  |  | ✔ |  |
| `analytics.financial` | ✔ | ✔ |  |  |  | ✔ |  |

### reports

| Action | Org admin | Eng. manager | Technician | Inventory mgr | Dept head | Auditor | Fault reporter |
| --- | :-: | :-: | :-: | :-: | :-: | :-: | :-: |
| `reports.schedule` | ✔ | ✔ |  |  |  |  |  |

### lifecycle

| Action | Org admin | Eng. manager | Technician | Inventory mgr | Dept head | Auditor | Fault reporter |
| --- | :-: | :-: | :-: | :-: | :-: | :-: | :-: |
| `lifecycle.manage` | ✔ | ✔ |  |  |  |  |  |

### warranty

| Action | Org admin | Eng. manager | Technician | Inventory mgr | Dept head | Auditor | Fault reporter |
| --- | :-: | :-: | :-: | :-: | :-: | :-: | :-: |
| `warranty.view` | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |  |
| `warranty.manage` | ✔ | ✔ | ✔ |  |  |  |  |
| `warranty.claim` | ✔ | ✔ |  |  |  |  |  |

### supplier

| Action | Org admin | Eng. manager | Technician | Inventory mgr | Dept head | Auditor | Fault reporter |
| --- | :-: | :-: | :-: | :-: | :-: | :-: | :-: |
| `supplier.view` | ✔ | ✔ | ✔ | ✔ |  | ✔ |  |
| `supplier.manage` | ✔ | ✔ |  | ✔ |  |  |  |

### service

| Action | Org admin | Eng. manager | Technician | Inventory mgr | Dept head | Auditor | Fault reporter |
| --- | :-: | :-: | :-: | :-: | :-: | :-: | :-: |
| `service.manage` | ✔ | ✔ | ✔ |  |  |  |  |

### inventory

| Action | Org admin | Eng. manager | Technician | Inventory mgr | Dept head | Auditor | Fault reporter |
| --- | :-: | :-: | :-: | :-: | :-: | :-: | :-: |
| `inventory.view` | ✔ | ✔ | ✔ | ✔ |  | ✔ |  |
| `inventory.manage` |  | ✔ |  | ✔ |  |  |  |
| `inventory.viewCost` | ✔ | ✔ |  | ✔ |  | ✔ |  |
| `inventory.settings` | ✔ | ✔ |  |  |  |  |  |

### stock

| Action | Org admin | Eng. manager | Technician | Inventory mgr | Dept head | Auditor | Fault reporter |
| --- | :-: | :-: | :-: | :-: | :-: | :-: | :-: |
| `stock.receive` |  | ✔ |  | ✔ |  |  |  |
| `stock.adjust` |  | ✔ |  | ✔ |  |  |  |
| `stock.issue` |  | ✔ | ✔ | ✔ |  |  |  |

### purchase

| Action | Org admin | Eng. manager | Technician | Inventory mgr | Dept head | Auditor | Fault reporter |
| --- | :-: | :-: | :-: | :-: | :-: | :-: | :-: |
| `purchase.view` | ✔ | ✔ | ✔ | ✔ |  | ✔ |  |
| `purchase.request` |  | ✔ | ✔ | ✔ |  |  |  |
| `purchase.approve` | ✔ | ✔ |  |  |  |  |  |
| `purchase.order` |  | ✔ |  | ✔ |  |  |  |

### knowledge

| Action | Org admin | Eng. manager | Technician | Inventory mgr | Dept head | Auditor | Fault reporter |
| --- | :-: | :-: | :-: | :-: | :-: | :-: | :-: |
| `knowledge.view` | ✔ | ✔ | ✔ | ✔ |  | ✔ |  |
| `knowledge.contribute` |  | ✔ | ✔ |  |  |  |  |
| `knowledge.approve` |  | ✔ |  |  |  |  |  |

### troubleshoot

| Action | Org admin | Eng. manager | Technician | Inventory mgr | Dept head | Auditor | Fault reporter |
| --- | :-: | :-: | :-: | :-: | :-: | :-: | :-: |
| `troubleshoot.view` | ✔ | ✔ | ✔ |  |  | ✔ |  |
| `troubleshoot.work` |  | ✔ | ✔ |  |  |  |  |

### ai

| Action | Org admin | Eng. manager | Technician | Inventory mgr | Dept head | Auditor | Fault reporter |
| --- | :-: | :-: | :-: | :-: | :-: | :-: | :-: |
| `ai.settings` | ✔ |  |  |  |  |  |  |
| `ai.usage` | ✔ | ✔ |  |  |  | ✔ |  |

## Rules enforced in the services as well (not visible in this table)

- Nobody can change their own role or reset their own MFA; an MFA reset is refused when the person also belongs to another organisation (Stage 10).
- Technicians sign off, issue parts for and troubleshoot only jobs assigned to them (or sessions they started).
- A Failed Safety Test hold is released only by an Engineering Manager who is NOT the person who did the retest, after a passed retest; the database enforces the same rule.
- Decommissioning is approved by the department's Department Head (fallback: Engineering Manager or facility-wide Department Head), never by the requester.
- Purchase requests are approved by a second person (never the requester; database check).
- Knowledge documents are approved by an Engineering Manager; managers-only documents and withdrawn documents are hidden from technicians.
- Costs are shown only to roles with the cost permissions; the cost report and financial views are audited.
- AI suggestions can never change a record's status, approve repairs or release a safety hold (no code path exists).
