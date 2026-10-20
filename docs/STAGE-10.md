# Stage 10 — Production readiness, security hardening and deployment preparation

BiomedIntel.ai — _Smarter Maintenance. Safer Healthcare._

Stage 10 changes no workflow and adds no feature. It checks the application built in Stages 3–9, fixes verified problems, measures it, and prepares a **private staging** deployment. The approved architecture is unchanged: Next.js, PostgreSQL with row-level security, Prisma, Better Auth with TOTP MFA, and the Stage 2 roles.

Related documents:

- `docs/SECURITY.md`, "Production readiness review": every finding and its status.
- `docs/PERMISSIONS.md`: the permissions matrix, generated from the code.
- `docs/DEPLOYMENT.md`: step-by-step staging deployment on Render.
- `docs/OPERATIONS.md`: environments, health checks, logs, backups, restore and incidents.

---

## 1. What was inspected

- The whole repository: Stages 3–9, 20 migrations, 68 tables, 7 member roles plus the Platform Super Administrator, and 68 permission actions.
- Authentication: Better Auth configuration, cookies, sessions, rate limits, MFA enrolment, verification and recovery, password reset, and the bootstrap of the first administrator.
- Authorization: the permission table, the scope rules, and the server checks behind every page, action and route.
- Tenant isolation: row-level security on every tenant table, composite keys, `SECURITY DEFINER` functions, and every entry point (pages, actions, upload and download routes, exports, barcode look-ups).
- Safety workflows: the Failed Safety Test hold, repair, retest and second-person release; PM generation; work-order status changes; inventory concurrency.
- AI and the knowledge base: retrieval scope, citations, prompt injection, provider errors and secrets.
- Uploads and file serving, logging, error handling, security headers, dependencies, and the migration history.

## 2. What changed

**Security** (details and tests in `docs/SECURITY.md`):

- A per-account sign-in limit that can't be dodged by faking the IP address. The IP header is now configurable (`TRUSTED_IP_HEADER`).
- Cross-organisation MFA resets are refused.
- The app refuses to start in production with MFA off or the placeholder secret.
- Honest password-reset wording.
- Next.js 16.3.8.
- IP addresses are shown in the organisation's audit log (account-level sign-in events still have no screen: `docs/SECURITY.md`, limitation 45).

**Hosting fixes** (found by simulating a managed database whose owner cannot bypass row-level security):

- Owner-only read policies.
- A fixed `search_path` on every database function.
- Uploads between 10 and 20 MB no longer cut off by the request proxy.

**Reliability:**

- `/api/health` (is the server running) and `/api/health/ready` (can it reach the database; returns 503 if not).
- Structured JSON logs with secrets redacted.
- Refused page loads logged as warnings, not errors.
- A stricter guard that stops the tests touching any non-local database.
- A note when a very long document exceeds the 4,000-passage search limit.

**Deployment tooling** (new `npm run` commands):

| Command               | What it does                                                                                                               |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `db:check-migrations` | Fails if a migration contains an unreviewed destructive statement (reviews: `prisma/migrations/reviewed-destructive.json`) |
| `db:create-app-role`  | One-time creation of the restricted app database user on a hosted database                                                 |
| `db:predeploy`        | What the host runs before each release: checks the app user and migrations, applies them, then verifies them               |
| `db:backup`           | Logical backup that refuses to produce an incomplete file                                                                  |
| `db:restore-drill`    | Restores a backup into a throwaway local database and checks every table                                                   |
| `docs:permissions`    | Regenerates `docs/PERMISSIONS.md` from the code (a test fails if it is out of date)                                        |
| `perf:load`           | Fills a separate local `_perf_dev` database with synthetic data for timing                                                 |

`render.yaml` describes a private staging setup. It is **not deployed**.

## 3. Database changes

Four additive migrations. No data is deleted and no table or column is removed.

| Migration                             | Purpose                                                                                                                                                               |
| ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `20261016000000_auth_throttle`        | Failed-sign-in counters keyed by a SHA-256 hash (no email addresses stored)                                                                                           |
| `20261016000100_cross_org_mfa_guard`  | A yes/no function: "does this member also belong to another organisation?"                                                                                            |
| `20261016000200_owner_read_policies`  | Read access for the table owner under forced row-level security, so the daily job, guards and backups work on a managed host. Never granted to the app user (tested). |
| `20261016000300_function_search_path` | A fixed `search_path` on every function                                                                                                                               |

All 20 migrations applied to an empty database. The migration-safety check passes: 8 risky statements found, all 8 reviewed.

## 4. Test results (run on 20 Oct 2026)

| Check                                                              | Result                                                                                                                                                                     |
| ------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Prettier, ESLint, TypeScript strict                                | pass                                                                                                                                                                       |
| Unit and integration tests (`npm test`)                            | **365 passed**                                                                                                                                                             |
| HTTP tests against a production build (7 files)                    | **84 passed** (routes 13, assets 16, PM 10, analytics 12, inventory 12, knowledge 15, cross-organisation 6); the server logged no errors                                   |
| Browser walk-through of the 12 journeys in the brief               | **48 of 48 checks passed** (Chromium, mock AI labelled as such)                                                                                                            |
| Accessibility scan (axe-core, WCAG 2.1 A/AA rules)                 | **no violations** on 38 signed-in page views (19 pages at desktop and phone width)                                                                                         |
| Migration-safety check                                             | pass                                                                                                                                                                       |
| Production dependency audit (`npm audit --omit=dev`)               | 0 vulnerabilities                                                                                                                                                          |
| Backup + restore drill, large synthetic database                   | 68 tables, 261,285 rows, identical counts, row-level security intact, 6.3 s                                                                                                |
| Hosted-database rehearsal (no `.env`, owner without bypass rights) | app user created, first administrator created, production server started, both health checks, MFA enforced, daily job ran; `/ready` returned 503 with the database stopped |

The 12 journeys in the browser walk-through:

1. Sign-in with MFA.
2. Equipment registration with a barcode.
3. A work order.
4. Preventive maintenance.
5. A failed electrical safety test.
6. No early return to service.
7. Repair and retest.
8. Second-person release.
9. Parts usage.
10. The knowledge base and AI.
11. Report accuracy.
12. Cross-organisation access.

## 5. Performance (measured, not estimated)

Measured on 16 Oct 2026 against a separate local database with 5,000 synthetic assets, 52,000 work orders and 200,000 audit records, on a 2-CPU workspace. Medians of repeated requests:

| Page                                   | Median       | Slowest      |
| -------------------------------------- | ------------ | ------------ |
| Dashboard                              | 230–237 ms   | 268 ms       |
| Asset list / page 100 / search         | 63–106 ms    | 131 ms       |
| Asset page (90+ jobs)                  | 128 ms       | 162 ms       |
| Barcode look-up                        | 34 ms        | 45 ms        |
| Work orders / my jobs                  | 87–91 ms     | 101 ms       |
| Inventory, knowledge search, audit log | 43–47 ms     | 75 ms        |
| Reports overview                       | 301 ms       | 347 ms       |
| **Work-order report, 12 months**       | **1,728 ms** | **2,302 ms** |
| **Reliability report**                 | **1,552 ms** | **1,798 ms** |

- **20 simultaneous requests:** all succeeded. The slowest took 1.3 s on assets and 3.6 s on the dashboard.
- **Memory:** the server used about 456–464 MB, so the staging plan uses 2 GB.
- **Upload:** a 12.9 MB, 1,200-page PDF was uploaded, read and indexed.
- **The two slow reports:** their time is in grouped queries over all 52,000 jobs. Switching off the new read policies did not change it (1,668 vs 1,692 ms).
- **Scale:** 52,000 jobs is roughly 20 times a year's work for a 2,350-device hospital. So the slow reports were recorded as a limitation, not optimised in this stage.
- **What this does not show:** these figures do not prove how many users the hosted service supports. That must be measured on staging.

## 6. Permissions vs. requirements

The roles and permissions in the code match the approved decisions. `docs/PERMISSIONS.md` lists all 68 actions by role. Deliberate differences from the Stage 2 blueprint, each approved by you:

- Technicians sign off their own repairs (15 Oct 2026), with manager review afterwards.
- Decommissioning needs the department's NUM, with fallbacks (decision 8).
- MFA is required for Organization Administrators as well as Engineering Managers.

No role was added. No gap was found between the approved requirements and the enforced permissions.

## 7. Readiness

See the final report and `docs/SECURITY.md`. In short:

- **Ready** for internal testing on a private staging copy with fictional data.
- **Not yet ready** for a hospital pilot. Hosting, alerting, backup retention, data residency and incident contacts must first be set up, tested on staging and agreed. No code-level release blocker is known.
