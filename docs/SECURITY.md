# BiomedIntel.ai — security (Stages 3 and 4)

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
5. **No account lockout UI or admin MFA reset.** Better Auth locks second-factor attempts after repeated failures; there is no screen yet for an admin to reset a lost authenticator (backup codes are the fallback).
6. **Owner credentials are powerful.** They can disable the audit trigger. In production restrict them to the deployment pipeline and a break-glass procedure, and ship audit logs to separate write-once storage.
7. **Sign-in audit events have no organisation**, so organisation admins cannot see them in the app yet.
8. **No data retention or deletion jobs** yet; retention periods are still an open decision.
9. **No backups configured** — there is no deployed database yet (see below).
10. **Platform administration is minimal** (create and list organisations only).
11. **Printed labels are visible to anyone nearby.** They carry only the asset name and ID (and optionally hospital and department). The barcode opens nothing without a permitted account, but anyone can read the asset ID from it, just as from the printed text.
12. **"Label printed" means the label page was opened.** The browser cannot confirm that anything was physically printed.
13. **Duplicate asset IDs are revealed within an organisation.** To keep IDs unique, a user can learn that an ID already exists in their own organisation, even in a hospital they cannot see. No other details are revealed.
14. **The approval rule depends on correct memberships.** If a NUM account is missing or wrongly scoped, the fallback approvers (Engineering Manager, Facility Manager) can decide. Keep Department Head scopes accurate.
15. **No virus scanning, attachments or documents yet** (Stage 8).

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
