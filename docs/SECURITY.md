# BiomedIntel.ai — security (Stages 3 to 8)

This describes what is in place, how it works, and what is **not** done yet. Technical safeguards are not the same as regulatory compliance or certification; BiomedIntel.ai makes no compliance claim.

## Defence in depth for tenant isolation

| Layer                     | Where                                                    | What it does                                                                                                                                                                                                      |
| ------------------------- | -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Authentication         | Better Auth (`server/auth/auth.ts`)                      | Database-backed sessions, HTTP-only SameSite cookies (Secure in production), 12 h expiry, hourly refresh, rate-limited sign-in, MFA for privileged roles                                                          |
| 2. Optimistic redirect    | `proxy.ts`                                               | Visitors without a session cookie go to /sign-in. Convenience only — never the security boundary                                                                                                                  |
| 3. Access resolution      | `server/authz/access.ts`, `server/auth/session.ts`       | On every page and action, the server loads the user's ACTIVE memberships and scopes from the database. Organisation/hospital/department ids from cookies or forms are only accepted if the database confirms them |
| 4. Permission checks      | `server/authz/permissions.ts`                            | One deny-by-default table of role → action. Every service function calls `requirePermission()` first; refusals are written to the audit log                                                                       |
| 5. Scope checks           | `requireHospitalAccess()`                                | Targets outside the user's hospitals/departments return "not found" (a guessed id reveals nothing) and are audited                                                                                                |
| 6. Row-Level Security     | `prisma/migrations/*_security`                           | Every tenant table has `organization_id`, RLS is ENABLED and FORCED, and policies only show rows of the transaction's organisation                                                                                |
| 7. Composite foreign keys | schema                                                   | A department, scope or membership can never reference another organisation's row                                                                                                                                  |
| 8. Tests                  | `tests/integration/rls.test.ts`, `authorization.test.ts` | Two fictional organisations; the suite fails if either can read or write the other's data                                                                                                                         |

**RLS supplements server-side authorization; it does not replace it.** RLS only knows the organisation. Roles, hospital/department scope, approval rules and MFA are enforced by the server. RLS is the safety net if server code ever forgets an organisation filter.

### Tenant context and connection pooling

`withTenant()` (`server/db/tenant.ts`) opens a transaction and calls `set_config('app.org_id', …, true)`. The `true` makes the value **transaction-local**: PostgreSQL discards it at COMMIT or ROLLBACK, so a pooled connection never carries one request's organisation into the next. A query outside `withTenant()` sees no tenant rows. The context comes only from the server-side session — the browser cannot set it. This is tested with a single-connection pool, including a failed transaction.

### Database roles

| Role                | Used by                                                           | Can bypass RLS | Notes                                                                                                                                                                          |
| ------------------- | ----------------------------------------------------------------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `biomedintel_app`   | The web app (`DATABASE_URL`)                                      | **No**         | SELECT/INSERT/UPDATE on tenant tables; no DELETE on organisations, hospitals, departments or memberships; SELECT/INSERT only on audit_logs; cannot write `users.platform_role` |
| `biomedintel_owner` | Migrations, seed, bootstrap, Prisma Studio (`DATABASE_URL_ADMIN`) | Yes            | Owns the tables. **Protect these credentials** — the owner can alter tables and disable triggers. Never give this URL to the web app                                           |

The app refuses to start (`instrumentation.ts`) if `DATABASE_URL` uses a role that can bypass RLS.

### Platform Super Administrator

Created only by `npm run admin:bootstrap` (owner credentials, refuses if one exists). The app role cannot set `platform_role` (column-level grants + check constraint). A platform administrator can create organisations but gets **no access to hospital data** unless also given a membership. Note: RLS cannot distinguish a platform administrator acting with a chosen organisation context from a member; this boundary is enforced in server code (`resolveAccess` requires a membership).

## Equipment records (Stage 4)

The same layers protect equipment. Specifically:

- **Scope on every asset action.** Every asset query is filtered by the user's hospitals and departments (`assetScopeWhere`). Viewing, editing, scanning, labels, export and approvals all use it. Searching, filtering, sorting and paging happen in the database after this filter, so no query-string value can widen it. Sort fields are an allow-list.
- **Row-Level Security** is enabled and forced on all eight equipment tables (`locations`, `manufacturers`, `equipment_categories`, `equipment_models`, `assets`, `asset_status_history`, `warranties`, `lifecycle_events`).
- **Composite foreign keys** stop an asset pointing at another organisation's hospital, department, model or room. They also stop a room belonging to a different department from the asset's own.
- **No deletion.** The app role has no DELETE on any equipment table, so assets are archived instead. It also cannot UPDATE `organization_id` or `created_by`, and `asset_status_history` is append-only (a trigger rejects changes, even from the owner).
- **"Not found" for everything unauthorised.** A guessed id, another organisation's asset, or an out-of-scope asset all return the same "not found". Each attempt is audited as `asset.access_denied`.
- **Duplicate checks never cross tenants.** Asset IDs are unique per organisation and checked under RLS, so another organisation's IDs can neither clash nor be discovered. The serial-number warning does not reveal which asset matched.
- **Field-level rules.**
  - Purchase cost is visible only to admins, managers and auditors, and editable only by admins and managers.
  - "Decommissioned" cannot be set directly; it requires an approved request.
  - The approver must be the department's NUM. Only when there is no NUM can the Engineering Manager or Facility Manager approve. Never the requester (also enforced by a database CHECK constraint).
- **Optimistic locking.** An edit form carries the record's `updated_at`; a save fails if someone else saved in between.

### Barcodes (Code 128)

Labels carried QR codes in the first Stage 4 build. On 15 October 2026 they were replaced with Code 128 barcodes at Nadir's request. Migration `20261015000000_barcode_labels` removed the random QR columns and the QR look-up function; no asset record, asset ID, permission or audit row was removed.

- **Content.** The barcode holds only the asset ID (e.g. `INF-0412`), which is also printed as text on the label. There are no credentials, sessions, keys, database ids, patient data or other equipment details.
- **The barcode is not a credential.**
  - Look-up happens only inside the signed-in app (Scan page or register search). There is no public link route.
  - It searches only the organisation the user is working in (RLS), first by asset ID and then by the hospital inventory number.
  - The result is checked against the user's hospital/department scope like any other access.
  - Unknown codes and out-of-scope assets give the same "No asset found that you can open"; out-of-scope attempts are audited as `asset.access_denied`.
- **Accepted trade-off.** An asset ID is human-readable and can be guessed, unlike the random QR code it replaces. That is acceptable because it grants nothing on its own; it is already printed on the label; and all access goes through sign-in, organisation and scope checks. Equipment details stay behind sign-in.
- **Scanner safety.**
  - Scanned or typed text is untrusted. It is accepted only as a short plain code (no links, no `javascript:` or `data:`, no control characters, at most 40 characters) and is checked again on the server.
  - The browser only navigates to an in-app `/assets/<id>` address that the server built from the asset's id, never to the scanned text.
  - The camera is optional and requested only when the user taps "Start camera". `Permissions-Policy` allows the camera for this site only (`camera=(self)`). Handheld scanners need no browser permission at all.
- **Signed-out visitors** to an asset page are sent to sign-in. Only the asset page address is remembered (`?next=`), and only addresses matching a strict allow-list are accepted, so there is no open redirect.
- **Barcode changes are audited.** `asset.barcode_issued` is recorded when an asset is registered. `asset.barcode_replaced` (old and new ID) is recorded when its asset ID changes, because old labels then no longer match.

### Audit events added in Stage 4

`asset.created`, `asset.barcode_issued`, `asset.updated` (changed field names only, never a copy of the record or the cost), `asset.reassigned`, `asset.status_changed`, `asset.risk_changed`, `asset.location_changed`, `asset.archived`, `asset.restored`, `asset.barcode_replaced`, `asset.scanned` (with `matchedBy`), `asset.access_denied`, `asset.label_printed`, `asset.exported`, `asset.warranty_added`, `asset.decommission_requested`, `asset.decommissioned` (with `approvedAs`), `asset.decommission_rejected`, `asset.decommission_cancelled`, `manufacturer.created`, `equipment_category.created`, `equipment_model.created`, `location.created`, and `authz.denied` for refused actions. (`asset.qr_issued`, `asset.qr_reissued` and `asset.scan_denied` appear only in history from the first, QR-based Stage 4 build.)

### CSV export

The export uses the same scope and filters as the register screen, is capped at 5,000 rows, and is audited. Cells beginning with `= + - @` are prefixed with `'` so spreadsheet programs do not run them as formulas (CSV injection).

## Work orders (Stage 5)

- **Scope.** Every job records the hospital and department of its asset when it is reported.
  - Every query is filtered by the user's hospitals/departments (`workOrderScopeWhere`). Fault Reporters are additionally limited to jobs they reported.
  - RLS on all seven new tables (`work_orders`, `work_order_counters`, `work_order_events`, `work_order_tasks`, `attachments`, `downtime_events`, `notifications`) is the safety net.
  - Unknown, other-tenant and out-of-scope jobs are "not found", audited as `workorder.access_denied`.
- **Barcode-based reporting grants nothing.** A scanned asset ID is resolved by the Stage 4 look-up (current organisation and scope). `reportFault` then loads the asset again under the scope filter before creating a job. There is no separate barcode registry.
- **Who may act** is decided on the server for each job: managers triage; only the **assigned technician** starts, holds, logs work and signs off. Assignees are checked against memberships and scope; the browser never chooses who is eligible.
- **Sign-off by the technician who did the job** (decision of 15 Oct 2026). The database refuses a completed job unless:
  - `completed_by` equals `assigned_to`;
  - an outcome, a resolution, both checks and the declaration are recorded;
  - for "repaired", the functional check passed and the electrical safety test passed or was not applicable.
- **Accepted risk, with safeguards.** There is no independent check before a device returns to service. Safeguards:
  - the declaration and recorded checks;
  - immediate notification of the reporter;
  - for safety-critical jobs, notification of managers and a **review list** (`workorder.reviewed` when reviewed);
  - managers can **reopen** a job, which puts the device back under repair.
  - Hospitals that need approval before return to service should ask for a blocking review step.
- **Append-only records.** The timeline, the work log and photos cannot be updated or deleted, even by the owner role (trigger). Corrections are new entries. The app role has no DELETE on any work order table. It cannot UPDATE a job's organisation, number, asset, location, reporter or creation time (column grants).
- **Photos.**
  - Uploaded one at a time through a dedicated route. The 1 MB limit for all other forms is unchanged.
  - The route accepts same-origin requests only, checks size before and after reading (5 MB), and requires the user to be the reporter, the assignee or a manager of a job in scope (at most 5 photos per job, row-locked).
  - Each file is **decoded and re-encoded** with sharp: only real JPEG/PNG/WebP is accepted, whatever its name; at most 50 megapixels; resized to 2048 px. **EXIF metadata such as GPS location and camera details is removed.**
  - Stored in PostgreSQL with a SHA-256 hash. Served only after the same scope check, with `nosniff` and `private, no-store`.
  - The database allows only JPEG/PNG/WebP MIME types and up to 5 MB.
- **Notifications.** Recipients are worked out on the server from memberships and scope. A database policy lets each person read and mark only their own; links must be in-app paths (CHECK constraint).
- **Decommissioning** is refused while the asset has open jobs (Stage 2 rule).
- **Audit events added:**
  - `workorder.requested`, `workorder.assigned`, `workorder.priority_changed`, `workorder.started`, `workorder.on_hold`, `workorder.work_logged`, `workorder.note_added` (the note text stays in the timeline, not the audit log), `workorder.photo_added`.
  - `workorder.completed` (outcome, checks, `signedOffBy: assigned_technician`), `workorder.reviewed`, `workorder.reopened`, `workorder.cancelled`, `workorder.access_denied`.
  - `asset.returned_to_service`, plus `asset.status_changed` with the work order id.

## Preventive maintenance (Stage 6)

- **Scope and RLS.**
  - Ten new tables, all with Row-Level Security enabled **and forced**: `maintenance_plans`, `maintenance_plan_revisions`, `pm_schedules`, `pm_occurrences`, `pm_generation_runs`, `checklist_results`, `test_standards`, `test_standard_rules`, `safety_holds`, `safety_hold_events`.
  - Composite foreign keys `(organization_id, x)` throughout. No DELETE grant for the app role. Column-level UPDATE grants.
  - Schedules, occurrences, holds and reports are filtered by the asset's hospital/department (`assetScopeWhere` / `scopeSql`). Plans are visible org-wide or for the user's hospitals; only org-wide staff edit org-wide plans.
  - A test checks that **every** table with `organization_id` has RLS enabled and forced.
- **Permissions** (`server/authz/permissions.ts`):
  - `pm.view`: everyone except Fault Reporters.
  - `pm.manage` / `pm.generate`: Org Admin, Engineering Manager.
  - `pm.approve`, `standards.verify` and `safety.release`: **Engineering Manager only** (qualified staff).
  - `pm.report`: + Department Head, Auditor. `pm.export`: Org Admin, Engineering Manager, Auditor.
  - `member.resetMfa`: Org Admin.
- **Server-side validation.** Every referenced asset, model, category, hospital, default assignee and test standard is checked against the organisation and the user's scope. Assignees on generated jobs are re-checked for each asset's department.
- **Interval rules** are enforced in the service **and** by database CHECKs:
  - a reference or a justification is always present;
  - manufacturer intervals only for models;
  - only an approved plan can be active.
- **Duplicate prevention.**
  - `UNIQUE (schedule_id, due_on)` on occurrences, and `UNIQUE (organization_id, pm_occurrence_id)` on work orders.
  - Each schedule is processed in its own transaction under `SELECT … FOR UPDATE`, and is advanced only after the occurrence and its job are recorded.
  - Reminders carry a `dedupe_key` with `UNIQUE (organization_id, user_id, dedupe_key)`.
  - Tests cover retries and three concurrent runs.
- **Failures** are recorded on the occurrence (`FAILED`, attempts, a short message) in a separate transaction, audited as `pm.generation_failed`, and reported to managers once. Internal error details go to the server log only, never to the database or screen.
- **Scheduler endpoint** `POST /api/cron/pm-generate`:
  - off unless `CRON_SECRET` (32+ characters) is set;
  - bearer token compared in constant time; refusals audited as `pm.scheduler_denied`;
  - responses contain counts only.
  - It runs with the **restricted app role**. The only cross-tenant step is the `SECURITY DEFINER` function `app_pm_organizations()`, which returns organisation ids that have active plans; all work then happens inside each organisation under RLS.
- **Failed Safety Test — Do Not Use** (decision of 15 Oct 2026):
  - A failed electrical safety item places a hold, sets the device Out of service and starts downtime.
  - It creates a linked repair job and then a retest.
  - Release requires `safety.release`, a passed retest and a **different person** from the retester. This is checked in the service and by a database CHECK (`released_by <> retested_by`).
  - A `SECURITY DEFINER` trigger on `assets` refuses `IN_SERVICE` while any hold is open, whoever asks.
  - Hold jobs cannot be cancelled. The hold history (`safety_hold_events`) is append-only.
  - **Exceptions are not available.** They need a written, authorised policy first.
- **Records preserved.** Each job stores a copy of the approved checklist, the plan version and the test standard code and version. Plan revisions, checklist results and hold events are append-only (trigger, even for the owner). Reopened jobs record a new attempt.
- **Prefetch safety.** The PM CSV export is a plain link, so viewing the report page never triggers an export. Every export is audited (`pm.report_exported`).
- **MFA (decision 4).**
  - Required for Engineering Managers, Org Admins and platform admins (unchanged), and **encouraged** for every other role with a banner.
  - Better Auth stores the TOTP secret and backup codes **encrypted** (symmetric encryption keyed by `BETTER_AUTH_SECRET`); a test checks the database never holds them in plain text.
  - "Trust this device" is refused, so a code is required at every sign-in.
  - New audit events: `auth.mfa_enrolled`, `auth.mfa_verified`, `auth.mfa_verify_failed`, `auth.mfa_backup_code_used`, `auth.mfa_backup_codes_regenerated`, `auth.password_changed`, `auth.password_reset`, `auth.mfa_reset_by_admin`. No code, secret or backup code is ever logged; a test checks this.
  - **Recovery:**
    - use a backup code, then set up again;
    - users can create new backup codes (password required);
    - if both are lost, an Org Admin resets the authenticator after confirming identity outside the app. The reason is recorded, the person is signed out everywhere, admins cannot reset themselves, and platform admins are excluded.
- **Audit events added:**
  - `pm.plan_created`, `pm.plan_updated`, `pm.plan_approved`, `pm.interval_reviewed`, `pm.plan_paused`, `pm.plan_resumed`, `pm.plan_archived`;
  - `pm.assets_enrolled`, `pm.schedule_ended`, `pm.schedules_ended`, `pm.workorder_generated`, `pm.generation_failed`, `pm.generation_run`, `pm.access_denied`, `pm.report_exported`, `pm.scheduler_denied`;
  - `standard.created`, `standard.verified`, `standard.archived`, `standard.rule_set`, `standard.rule_removed`, `catalog.manufacturer_interval_set`;
  - `safety.hold_placed`, `safety.hold_failure_added`, `safety.retest_created`, `safety.retest_passed`, `safety.retest_failed`, `safety.hold_released`, `safety.release_rejected`, `safety.access_denied`.

## Reports and analytics (Stage 7)

- **Read-only.** Analytics services only read. The only writes are audit events (exports, financial views, schedule changes) and scheduled-report snapshots and notifications. A walk-through check confirms viewing and exporting reports changes no asset status or safety hold; reports cannot release a hold or return a device to service.
- **Scope.** All aggregation runs in the database under RLS (`withTenant`) **and** the user's hospital/department scope (`woScopeSql` on the job's own hospital/department, `scopeSql` on the asset's). Filters are validated with Zod, then checked against scope: a hospital or department outside the user's access returns NotFound.
- **Permissions:** `analytics.view` (everyone except Fault Reporters), `analytics.workload` and `reports.schedule` (Org Admin, Engineering Manager), `analytics.export` and `analytics.financial` (Org Admin, Engineering Manager, Auditor).
- **Individuals.** Per-engineer figures, the engineer filter and the by-engineer breakdown need `analytics.workload`; otherwise NotFound. Workload is alphabetical with a caveat; there is no ranking.
- **Financial data.** Acquisition cost is computed only for `analytics.financial` and every view is audited (`analytics.financial_viewed`). Snapshots never contain cost.
- **CSV.** Formula-safe cells (`csvCell`), header with organisation, UTC generation time and period, `Cache-Control: no-store`, audited (`analytics.exported`). Export buttons are plain links (no prefetch).
- **Scheduled reports.**
  - Two new tables, RLS enabled and forced: `report_schedules`, `report_snapshots`. Snapshots: SELECT/INSERT only, append-only trigger. Checked manually: another organisation sees 0 rows; inserting for another organisation is refused by RLS; UPDATE/DELETE are refused.
  - `UNIQUE (schedule_id, period_key)` prevents duplicate snapshots and notifications on retry or concurrent runs; notifications also carry a `dedupe_key`.
  - Snapshots are computed with a synthetic read-only Auditor context limited to the schedule's hospital or organisation.
  - Recipients are re-checked at every run (active, `analytics.view`, covers the whole scope). Viewing a snapshot needs the same coverage.
  - The only cross-tenant step is `app_report_organizations()` (SECURITY DEFINER), which returns organisation ids with active schedules.
  - Failures are audited as `report.generation_failed` without internal details and retried next run.
- **Audit events added:** `analytics.exported`, `analytics.financial_viewed`, `report.schedule_created`, `report.schedule_paused`, `report.schedule_resumed`, `report.snapshot_generated`, `report.generation_failed`.

## Lifecycle, warranties, inventory and suppliers (Stage 8)

- **Tables and RLS.** 15 new tables, all with Row-Level Security enabled **and forced**, composite `(organization_id, x)` foreign keys and no DELETE grant. A manual check confirmed another organisation sees no rows and forged inserts are refused.
- **Stock integrity.** `stock_levels` is written only by the `stock_movements_apply` trigger; the app role has no UPDATE/DELETE on `stock_levels` or `stock_movements` (checked: "permission denied"), and movements and claim history are append-only (trigger). CHECKs refuse negative stock, adjustments without a reason, receipts not against an ordered request, and receipts above the requested quantity. Every stock form carries a one-time key with `UNIQUE (organization_id, idempotency_key)`; issues and transfers lock the part row, so concurrent requests cannot both take the last units (tested).
- **Permissions:** `inventory.view`, `inventory.manage`, `stock.receive`, `stock.adjust` (Inventory Managers up to a configurable limit), `stock.issue` (technicians only on their own jobs), `inventory.viewCost`, `inventory.settings`, `purchase.view/request/approve/order`, `supplier.view/manage`, `service.manage`, `warranty.view/manage/claim`, `lifecycle.manage`. Purchase approval needs a second person (service and CHECK `decided_by <> requested_by`).
- **Scope.** Stores belong to a hospital; stock and movements are limited to stores in the user's hospitals. Work orders, assets, warranties and claims use the existing hospital/department scope. Every referenced part, store, supplier, work order, warranty and purchase line is re-checked on the server; unknown or out-of-scope ids return NotFound, and out-of-scope attempts are audited.
- **Safety controls untouched.** Inventory, warranty, purchasing, supplier and lifecycle actions never change a device's operational status; issuing parts never completes a job; a decommissioned device cannot be moved to another status (database); safety holds still require the Stage 6 second-person release.
- **Financial data.** Unit costs, stock value, claim amounts and supplier costs are shown only to `inventory.viewCost` / `asset.viewCost` / `analytics.financial` roles and can only be changed by them; the cost report is audited (`analytics.financial_viewed`). Reminder texts contain no costs.
- **Barcode look-up.** Part codes are resolved on the server within the user's organisation (RLS); other organisations' part numbers never resolve.
- **Reminders** run with the restricted app role per organisation, carry de-duplication keys, go only to members whose role and scope allow them, and record failures (`reminders.failed`) without internal details.
- **Redirects** after actions are built only from validated UUIDs; the sign-in "return to" allow-list gained the inventory, supplier and cost report pages.
- **Documents are not uploaded** in this stage (only a text reference), so no new file-storage surface was added.

## Knowledge base and IntellAssist (Stage 9)

- **Tables and RLS.** 13 new tables, RLS enabled **and forced**, composite organisation foreign keys. A manual check as the app role confirmed: no rows without a tenant context, no Coastal rows while acting as Highland, and a forged cross-organisation insert into `ai_settings` refused by the policy. Updating stored files, deleting troubleshooting entries and editing an AI suggestion's text all fail with "permission denied" (column grants and append-only triggers).
- **Permissions:** `knowledge.view`, `knowledge.contribute` (technicians, managers), `knowledge.approve` (Engineering Managers only), `troubleshoot.view`, `troubleshoot.work`, `ai.settings` (Organisation Administrators), `ai.usage`. Technicians work only on their own sessions or their assigned jobs; only managers reopen.
- **Document visibility.** Organisation (RLS) → hospital (one or all) → access level (managers-only documents hidden from technicians) → status (withdrawn documents hidden from non-managers). The same rule is applied in SQL for search and AI retrieval, so a passage a person cannot open is never sent to the AI on their behalf.
- **Uploads.** Dedicated route handlers with a same-origin check (403 otherwise), a size check before the body is read, type decided from the bytes (PDF or valid UTF-8 text only), SHA-256 recorded, identical re-uploads refused. Files are served with `nosniff`, `no-store` and `Content-Security-Policy: default-src 'none'` (text also `sandbox` and always `text/plain`). The site-wide CSP is not applied to these responses so the stricter one wins. Opening and downloading are audited.
- **Untrusted content.** Extracted text has control, bidirectional and private-use characters removed; passages are neutralised before being placed in the prompt; the model's output is validated against a fixed schema, citations are checked against what was actually retrieved, and decision wording and confidence figures are removed. The AI has no tools and no write access; nothing it returns is executed or used to change a record's status.
- **Provider credentials.** `ANTHROPIC_API_KEY` is read only on the server, sent only in the `x-api-key` header, never logged, never stored in the database or audit log, and never returned to the browser (tested: the key does not appear in the audit entry or the settings page). Provider error bodies are not logged; only a code such as `provider_http_401` is stored.
- **Data minimisation.** Requests contain device, fault, observation and passage text only; emails and numbers of 8+ digits are removed. Users are reminded not to enter patient information.
- **Availability.** AI is off by default and optional; timeouts, per-user and per-organisation limits, and clear messages when unavailable. Manual troubleshooting never depends on it.

## Authentication

- No public sign-up (`disableSignUp`). People are added by administrators (temporary password shown once) or the bootstrap script.
- Passwords: 12–128 characters, hashed by Better Auth (scrypt). Never logged.
- Sessions: database-validated on every request (no cookie-only trust), 12-hour lifetime, refreshed at most hourly.
- MFA (TOTP authenticator app, with backup codes): **required** for Platform Super Administrators, Organization Administrators and Biomedical Engineering Managers. Until enrolled they can only reach the account-security page, and services refuse their actions.
- Password reset: 30-minute single-use links; using one signs out all other sessions. Responses are identical whether or not the email exists.
- Rate limits (per IP): sign-in 5/min, MFA verification 5/min, password reset 3/5 min, other auth endpoints 60/min. Stored **in memory** (see limitations).

## Audit logging

- Table `audit_logs`: actor, action, outcome (SUCCESS/DENIED/FAILURE), organisation, target type/id, request id (`x-request-id` from `proxy.ts`), IP, user agent, timestamp, small metadata.
- Events: sign-in, failed sign-in (email kept, never the password), sign-out, MFA setup, hospital/department create and archive, member added, role changed, organisation created, platform admin bootstrapped, every denied permission or scope check.
- Append-only: the app role has only SELECT/INSERT; a trigger rejects UPDATE, DELETE and TRUNCATE for everyone (including the owner, unless the owner deliberately disables the trigger — which the test suite does only on `biomedintel_test` to wipe data).
- Secrets are stripped from metadata (`sanitizeMetadata`).
- Audit rows are tenant-isolated; sign-in events have no organisation and are visible only to database administrators for now.

## Web application protections

- Every input validated with Zod on the server; ids must be UUIDs before they reach the database.
- Prisma parameterises every query; the few raw queries use tagged templates (parameterised).
- React escapes output; no `dangerouslySetInnerHTML`.
- Security headers on every response: Content-Security-Policy, X-Frame-Options DENY, frame-ancestors 'none', nosniff, Referrer-Policy, Permissions-Policy, HSTS in production. `X-Powered-By` removed.
- Server Actions are POST-only with Next.js origin checks; Better Auth checks `trustedOrigins`.
- Secrets live only in environment variables, validated at start-up; `.env*` is git-ignored except `.env.example`.

## Known limitations (must be addressed before any real hospital uses it)

1. **Not security-reviewed or penetration-tested.** Plan an independent review before the pilot.
2. **No email provider.** Password reset works only in development (link printed to the console); in production it fails safely. New members get a temporary password shown once to the administrator instead of an invitation email, and are not yet forced to change it.
3. **Rate limiting is in memory** — resets on restart and is per server instance. Use database or Redis storage before running more than one instance.
4. **CSP allows inline scripts** (`'unsafe-inline'`), needed by Next.js without nonces. Move to a nonce-based policy before the pilot.
5. **No account lockout UI.** Better Auth locks second-factor attempts after repeated failures. (Admin MFA reset was added in Stage 6.)
6. **Owner credentials are powerful.** They can disable the audit trigger. In production restrict them to the deployment pipeline and a break-glass procedure, and ship audit logs to separate write-once storage.
7. **Sign-in audit events have no organisation**, so organisation admins cannot see them in the app yet.
8. **No data retention or deletion jobs** yet; retention periods are still an open decision.
9. **No backups configured** — there is no deployed database yet (see below).
10. **Platform administration is minimal** (create and list organisations only).
11. **Printed labels are visible to anyone nearby.** They carry only the asset name and ID (and optionally hospital and department). The barcode opens nothing without a permitted account, but anyone can read the asset ID from it, just as from the printed text.
12. **"Label printed" means the label page was opened.** The browser cannot confirm that anything was physically printed.
13. **Duplicate asset IDs are revealed within an organisation.** To keep IDs unique, a user can learn that an ID already exists in their own organisation, even in a hospital they cannot see. No other details are revealed.
14. **The approval rule depends on correct memberships.** If a NUM account is missing or wrongly scoped, the fallback approvers (Engineering Manager, Facility Manager) can decide. Keep Department Head scopes accurate.
15. **No virus scanning of uploads.** Photos are decoded and re-encoded, which defeats files disguised as images, but there is no antivirus scan. Documents arrive in Stage 8.
16. **Self-sign-off.** Technicians sign off their own repairs, including on safety-critical devices (decision of 15 Oct 2026). Manager review afterwards is optional and does not block return to service.
17. **Corrective jobs have no scheduled escalation yet.** Overdue PM jobs get in-app reminders from the daily PM run (Stage 6); overdue repair jobs are only shown as Overdue on screens.
18. **Photos are stored in the database** (decision of 15 Oct 2026). Move them to encrypted object storage when hosting is chosen; database backups grow with photos.
19. **Notifications are in-app only.** Nobody is alerted outside the app until an email or SMS provider is added.
20. **The PM scheduler must be set up when deploying.** Until a daily cron job or the protected endpoint is configured, PM work orders are only created when someone runs `npm run pm:generate` or presses **Run generation now**.
21. **Safety-hold exceptions are not available.** A held device can only return to service through repair, a passed retest and second-person approval. If a hospital's policy allows authorised exceptions, that process must be designed and approved first.
22. **Test standard limits are configured by people.** The seeded IEC 62353 / AS/NZS 3551 entries and checklist limits are fictional demo values. Qualified staff must verify real procedures, editions and limits for each jurisdiction. BiomedIntel.ai does not certify compliance.
23. **The second-person rule needs two Engineering Managers in scope.** A hospital with only one Engineering Manager must have someone else do the retest, or add a second manager. Approvers can be in any hospital that can see the device.
24. **No operating hours are recorded,** so MTBF and MTTR are not calculated. Labelled proxies (calendar days between faults, repair duration) must not be read as MTBF/MTTR.
25. **All durations are calendar time.** No working hours, shifts or public holidays are configured.
26. **Costs are acquisition cost only.** Maintenance, parts and contract costs are not recorded, so no total cost of ownership is shown.
27. **Scheduled reports are delivered in the app only.** An email provider would need a cost decision and its own security review (no report content in email bodies).
28. **Fault categories exist only for jobs signed off from Stage 7,** so older faults appear as "Not classified".
29. **Reports support audits; they do not certify compliance** with IEC 62353, AS/NZS 3551 or any regulation.
30. **Warranty and contract documents are not stored.** Only a reference to where they are kept. Secure document storage is planned with the knowledge module.
31. **Costs are partial by design.** Parts and external service costs are recorded; in-house labour, taxes (unless entered) and total cost of ownership are not. Currencies are never converted.
32. **Purchasing is a request record only.** Ordering, quotes, invoices, budgets and any approval steps beyond one second person happen outside BiomedIntel.ai.
33. **No backorders or negative stock.** These need an explicitly approved policy before they are added.
34. **Reminder recipients follow roles,** not a configurable list of people; supplier response times are not measured (no first-response timestamp).
35. **The real AI provider is untested here.** The Claude adapter was tested against a local imitation of the documented API; no request has been sent to Anthropic from this environment. Test with a real key and a spend limit before any pilot.
36. **No virus scanning or OCR for knowledge documents.** Only PDF and plain text are accepted, typed from their bytes and parsed for text only; scanned PDFs are stored but not searchable.
37. **Redaction before AI requests is basic** (emails, long numbers). It cannot recognise every personal identifier typed into free text.
38. **Documents are stored in the database** and grow backups; move to encrypted object storage when hosting is chosen. Retention periods for documents and AI request records are not yet decided.
39. **AI output is checked by rules, not understood.** Decision wording and percentages are removed by pattern; an unusual phrasing could pass. Every suggestion is labelled advisory and no AI output can change a record's status.

## Backups and environments

Local development needs no backups: `npm run db:reset` rebuilds it from migrations and fictional seed data. **Real data must never be put in a development database.**

Before any shared or production environment:

- Managed PostgreSQL with automated daily backups and point-in-time recovery, encrypted at rest, in the agreed data region.
- A restore rehearsal, timed, documented, repeated quarterly.
- Separate databases, secrets and storage for development, staging and production. Production access limited to named people.
- Run only `npm run db:deploy` (`prisma migrate deploy`) against shared databases — never `migrate dev`, `migrate reset` or `db push`.
- Rotate `BETTER_AUTH_SECRET` and database passwords when staff with access leave.

## Regulatory and data-protection assessment (not yet done)

Even without patient data, BiomedIntel.ai stores staff personal data (names, emails, activity). Before deployment, assess with qualified advisers: the data protection law of each market (for example Kenya, Uganda, Rwanda, Tanzania, Somalia, later Australia), data residency, whether any AI feature could fall under medical device software rules, customer contracts and data processing agreements. See the Stage 2 blueprint, section 8.
