# BiomedIntel.ai — Stage 3 report

Stage 3: Project Setup, Database Implementation and Secure Authentication.
Built 14 October 2026 against the Stage 2 Technical Blueprint.

## Decisions applied

| Stage 2 decision  | Applied in Stage 3                                                                                                                                                                                                                               |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1. Core stack     | Next.js 16.3 (App Router) + TypeScript (strict) + Tailwind CSS 4 + PostgreSQL 16                                                                                                                                                                 |
| 2. ORM            | **Prisma 7.10** (your choice; replaces the Drizzle recommendation). RLS works through transaction-scoped settings in `withTenant()`                                                                                                              |
| 3. Authentication | **Better Auth 1.7** (approved)                                                                                                                                                                                                                   |
| 6. Roles          | Seven blueprint roles **plus the Fault Reporter role** (approved)                                                                                                                                                                                |
| 13. MFA           | Required for Platform Super Administrators, Organization Administrators **and Biomedical Engineering Managers** — the recommended option. Tell me if you meant administrators only                                                               |
| UI components     | Hand-written accessible components in the shadcn/ui style plus Radix for the account menu. The shadcn CLI could not reach its registry from the build environment; the components can be swapped for shadcn/ui ones later without changing pages |
| Fonts             | Inter bundled locally (no request to Google Fonts)                                                                                                                                                                                               |

Pinned versions (each at least two weeks old when chosen): next 16.3.6, react 19.2.8, prisma / @prisma/client / @prisma/adapter-pg 7.10.0, better-auth 1.7.6, zod 4.6.5, vitest 4.1.11, tailwindcss 4.3.3.

## Implemented

- Next.js project, strict TypeScript, Tailwind with BiomedIntel.ai brand tokens, ESLint, Prettier, Git.
- PostgreSQL schema (Stage 2 section 4, foundation subset): `organizations`, `hospitals`, `departments`, `users`, `memberships`, `membership_scopes`, `audit_logs`, and Better Auth's `auth_sessions`, `auth_accounts`, `auth_verifications`, `auth_two_factors`.
- Two migrations: generated tables + a hand-written security migration (RLS policies, helper functions, append-only audit trigger, check constraints, grants).
- Two database roles (owner vs restricted app role) and a start-up check that refuses an RLS-bypassing role.
- Fictional seed data: 2 organisations, 4 hospitals, 15 departments, 9 people covering all 7 membership roles, one person in two organisations.
- Sign-in, sign-out, server-validated sessions, password reset (development email), authenticator-app MFA with backup codes, enforced for privileged roles.
- First-administrator bootstrap script; no public sign-up.
- Server-side authorization: permission table, access resolution, hospital/department scope, self-escalation and last-admin protection.
- Tenant isolation: RLS + composite foreign keys + transaction-scoped context + cross-tenant tests.
- Audit logging for authentication, administration, membership changes and denied attempts.
- Branded shell: responsive sidebar with every module, organisation/hospital/department selectors, account menu with sign-out, dashboard (live organisation figures + clearly labelled fictional equipment figures), placeholders for future modules.
- Organisation administration: hospitals and departments (create, archive), members (add with temporary password, change role), audit log viewer.
- Platform administration: list and create organisations with their first administrator.

## Not yet built (by design or deferred)

- Equipment assets, QR codes, work orders, PM, safety tests, calibration, inventory, lifecycle, IntellKnowledge, IntellAssist, reports (Stages 4–9).
- Email delivery and invitations; forced password change for temporary passwords.
- Editing a member's hospital/department scopes after creation, suspending members, archiving organisations, un-archiving.
- Admin MFA reset, account lockout screens, session list ("sign out other devices").
- Organisation-level view of sign-in events.
- Database-backed rate limiting, nonce-based CSP, data retention jobs, backups, deployment.

Known security limitations are listed in [SECURITY.md](SECURITY.md).

## Test and build results (run on 14 October 2026)

| Check                | Command                                                                    | Result                                                                                                                                                                                                                                                                         |
| -------------------- | -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Type check           | `npm run typecheck`                                                        | Passed, 0 errors                                                                                                                                                                                                                                                               |
| Lint                 | `npm run lint`                                                             | Passed, 0 errors, 0 warnings                                                                                                                                                                                                                                                   |
| Formatting           | `npx prettier --check .`                                                   | Passed                                                                                                                                                                                                                                                                         |
| Automated tests      | `npm test`                                                                 | **65 passed**, 0 failed (5 files); the HTTP test file is skipped unless a server is running                                                                                                                                                                                    |
| HTTP route tests     | `E2E_BASE_URL=… E2E_PASSWORD=… npm test -- tests/e2e` against `next start` | **13 passed**, 0 failed                                                                                                                                                                                                                                                        |
| Production build     | `npm run build`                                                            | Passed (21 routes)                                                                                                                                                                                                                                                             |
| Browser walk-through | Headless Chromium script                                                   | Sign-in, technician dashboard and scope, hospital selector, placeholder page, account menu sign-out, forced MFA enrolment with QR code, admin page, create hospital, validation errors, sign-in with TOTP code, 390 px mobile layout (no horizontal scroll), no console errors |

What the tests cover: schema constraints (9), RLS and tenant isolation including pooled-connection leakage and a failed transaction (15), authorization, scope, self-escalation, validation and audit events (23), authentication, sessions, sign-up closed, platform-role protection, MFA and password reset (9), permission matrix and validation units (9), protected routes and security headers over HTTP (13).

A deliberate check that the tests catch real failures: with RLS switched off on `hospitals` in the test database, 7 isolation tests failed; RLS was then restored.

### Not run, and why

- **`prisma migrate dev`, `prisma migrate deploy` and `prisma migrate reset` were not run through the Prisma CLI.** The build environment blocks downloads from `binaries.prisma.sh`, where the CLI fetches its schema engine. The initial migration SQL was generated, and both migrations applied to `biomedintel_dev` and `biomedintel_test`, using Prisma's official WebAssembly build of the **same** engine version (`@prisma/schema-engine-wasm` 7.10.0, commit 0edf323), so the `_prisma_migrations` history is standard. On your computer, `npm run db:deploy` and `npm run db:test:prepare` use the normal CLI. Please run them once and tell me if anything differs.
- Consequently `npm run db:reset` (which calls `prisma migrate reset`) was not run end to end; its safety guards were tested and refuse non-local, non-`_dev`/`_test` and production targets.
- Docker Compose was not tested (no Docker in the build environment). The same `setup-local.sql` was run directly with psql.
- `npm run admin:bootstrap` was run with a password from the environment (not the interactive prompt): it created the administrator and refused a second run.

## Git commit checklist

Before every commit:

- [ ] `git status` shows no `.env` file (only `.env.example`).
- [ ] No passwords, secrets, tokens or real names/emails in the diff (`git diff --staged`).
- [ ] `npm run typecheck`, `npm run lint`, `npm test` and `npm run build` pass (`npm run check` runs all four).
- [ ] Schema changes come with a migration in `prisma/migrations/` (`npm run db:migrate -- --name what_changed`), never by editing an applied migration.
- [ ] New tenant tables have `organization_id`, an RLS policy, grants for `biomedintel_app`, composite foreign keys, and an isolation test.
- [ ] New server actions call `requireAccess()` and a service that calls `requirePermission()` first.
- [ ] Important changes write an audit event.
- [ ] Only fictional data in seeds, tests and screenshots; no patient data anywhere.
- [ ] Commit message says what changed and why.
- [ ] Push to a branch and open a pull request; do not push straight to `main`.

## Proposed Stage 4: Equipment Asset Register and QR Code Management

1. **Schema:** `manufacturers`, `equipment_categories`, `equipment_models`, `assets`, `asset_status_history`, `warranties` (blueprint section 4), each with RLS, composite FKs, grants and isolation tests.
2. **Permissions:** add `asset.view/create/edit/archive`, `asset.label.print`, following the Stage 2 roles matrix (technicians create drafts; managers approve — decision 8 still open).
3. **Asset register:** list with search and filters by hospital, department, category, status; asset detail page; create/edit forms; archive.
4. **QR codes:** random `qr_token` per asset, printable label sheet (BiomedIntel.ai mark, asset tag, model), scan route `/a/[token]` that reveals nothing to signed-out visitors and respects scope when signed in; token reissue.
5. **Import:** CSV import of an existing equipment list with validation preview and an audit record.
6. **Dashboard:** replace the fictional asset figures with live counts.
7. **Tests:** asset isolation across organisations and hospitals, scan route access, import validation, audit events.

Open decisions that affect Stage 4: decision 8 (who approves technician-created assets), and confirmation of the MFA scope above.
