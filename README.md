# BiomedIntel.ai

**Smarter Maintenance. Safer Healthcare.**

BiomedIntel.ai is an AI-powered CMMS (Computerized Maintenance Management System) for hospital biomedical engineering teams. It manages **medical equipment and engineering records, never patient records**.

This repository is the **Stage 3 foundation**: project setup, database, secure sign-in, roles and permissions, multi-hospital tenant isolation, audit logging and the branded application shell. The equipment modules (assets, work orders, maintenance, inventory, IntellKnowledge, IntellAssist, reports) arrive in later stages.

> **Not production-ready.** It runs locally and its security foundations are tested, but it has not been security-reviewed, has no email provider, and has never been deployed. See [docs/SECURITY.md](docs/SECURITY.md).

---

## What you need

| Tool       | Version                             | Check with       |
| ---------- | ----------------------------------- | ---------------- |
| Node.js    | 20.19 or newer (22 LTS recommended) | `node -v`        |
| npm        | comes with Node.js                  | `npm -v`         |
| PostgreSQL | 16 or newer                         | `psql --version` |
| Git        | any recent version                  | `git --version`  |

PostgreSQL can be installed normally ([postgresql.org/download](https://www.postgresql.org/download/)) **or** run with Docker using the included `docker-compose.yml`.

## Set up on your computer (first time)

Run each command in a terminal from the project folder.

**1. Install the packages**

```bash
npm install
```

This also generates the Prisma database client. (`.npmrc` sets `legacy-peer-deps=true` because one test tool's optional peer dependency confuses npm 10.)

**2. Create the database roles and databases**

With Docker:

```bash
docker compose up -d
```

Or with your own PostgreSQL installation (asks for the `postgres` password):

```bash
psql -h localhost -U postgres -f scripts/db/setup-local.sql
```

Either way you get two databases (`biomedintel_dev`, `biomedintel_test`) and two roles:

- `biomedintel_owner` — owns the tables; used only by migrations, seed and admin scripts.
- `biomedintel_app` — used by the running website; it **cannot bypass Row-Level Security**.

**3. Create your `.env` file**

```bash
cp .env.example .env
```

Open `.env` and fill in:

- the two passwords from `scripts/db/setup-local.sql` (`local_app_password`, `local_owner_password`) in the four database URLs;
- `BETTER_AUTH_SECRET` — generate one with `openssl rand -base64 32`;
- `SEED_USER_PASSWORD` — any password of 12+ characters for the fictional test users.

`.env` is ignored by Git. Never commit it.

**4. Create the tables**

```bash
npm run db:deploy        # applies prisma/migrations to biomedintel_dev
npm run db:test:prepare  # applies them to biomedintel_test
```

**5. Load the fictional development data**

```bash
npm run db:seed
```

**6. Start the app**

```bash
npm run dev
```

Open <http://localhost:3000>. Sign in with any seed user below and the `SEED_USER_PASSWORD` from your `.env`.

## Fictional seed users

All names, hospitals and emails are invented (`.example` addresses can never receive mail).

| Person        | Email                         | Organisation             | Role                           | Access                                       |
| ------------- | ----------------------------- | ------------------------ | ------------------------------ | -------------------------------------------- |
| Hodan Ali     | hodan.ali@coastal.example     | Coastal Health Group     | Organization Administrator     | Whole organisation                           |
| James Otieno  | james.otieno@coastal.example  | Coastal Health Group     | Biomedical Engineering Manager | Riverside General                            |
| ″             | ″                             | Highland Medical Network | Read-only Auditor              | Whole organisation                           |
| Amina Warsame | amina.warsame@coastal.example | Coastal Health Group     | Technician                     | Riverside (all) + Northlake ICU and Theatres |
| Grace Mwangi  | grace.mwangi@coastal.example  | Coastal Health Group     | Inventory Manager              | Riverside General                            |
| Peter Kamau   | peter.kamau@coastal.example   | Coastal Health Group     | Department Head                | Riverside ICU                                |
| Fatuma Hassan | fatuma.hassan@coastal.example | Coastal Health Group     | Read-only Auditor              | Whole organisation                           |
| Lucy Achieng  | lucy.achieng@coastal.example  | Coastal Health Group     | Fault Reporter                 | Northlake Emergency                          |
| David Mutua   | david.mutua@highland.example  | Highland Medical Network | Organization Administrator     | Whole organisation                           |
| Sara Nakato   | sara.nakato@highland.example  | Highland Medical Network | Technician                     | Summit Regional                              |

Administrators and Engineering Managers must set up an **authenticator app** (Microsoft or Google Authenticator) at first sign-in.

## Create the first Platform Super Administrator

There is no public sign-up page, and no web form can create a platform administrator. Use the script, once:

```bash
npm run admin:bootstrap
```

It uses `BOOTSTRAP_ADMIN_EMAIL` and `BOOTSTRAP_ADMIN_NAME` from `.env`, asks for a password (hidden), and refuses to run if a platform administrator already exists. Sign in, set up MFA, and you land on **/platform**, where you can create organisations and their first Organization Administrator.

## Everyday commands

| Command                   | What it does                                                                   |
| ------------------------- | ------------------------------------------------------------------------------ |
| `npm run dev`             | Start the app with live reload at http://localhost:3000                        |
| `npm run typecheck`       | TypeScript type checking (strict mode)                                         |
| `npm run lint`            | ESLint                                                                         |
| `npm run format`          | Format code with Prettier                                                      |
| `npm test`                | Run all automated tests against `biomedintel_test`                             |
| `npm run build`           | Production build                                                               |
| `npm run check`           | Type check + lint + tests + build, in that order                               |
| `npm run db:migrate`      | Create a NEW migration after editing `prisma/schema.prisma` (development only) |
| `npm run db:deploy`       | Apply existing migrations (safe for any environment)                           |
| `npm run db:seed`         | Load the fictional data into an empty development database                     |
| `npm run db:reset`        | **Local only**: wipe `biomedintel_dev`, re-apply migrations, re-seed           |
| `npm run db:studio`       | Open Prisma Studio to browse the database (uses the owner role — careful)      |
| `npm run db:test:prepare` | Apply migrations to the test database                                          |

### Resetting your local database safely

`npm run db:reset` refuses to run unless the database name ends in `_dev` or `_test`, the host is local, and `NODE_ENV` is not `production`. **Never** run `prisma migrate reset`, `db push` or `DROP` commands against a shared, staging or production database.

### Looking inside the database

- `npm run db:studio` opens a browser view of the tables.
- Or connect with psql: `psql "postgresql://biomedintel_owner:…@localhost:5432/biomedintel_dev"` and try `\dt` (list tables) or `SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT 20;`.
- To see RLS in action, connect as `biomedintel_app` and run `SELECT count(*) FROM hospitals;` — it returns **0**, because no organisation is set for that session.

## Running the tests

```bash
npm test
```

The suite wipes and re-seeds `biomedintel_test` (it refuses any database not ending in `_test`). It covers schema constraints, Row-Level Security, cross-tenant access, pooled-connection leakage, role permissions, self-escalation, input validation, sign-in, sessions, MFA, password reset and audit records.

HTTP checks against a running server (optional):

```bash
# terminal 1 — run the production build against the TEST database
npm run build
DATABASE_URL="postgresql://biomedintel_app:YOUR_APP_PASSWORD@localhost:5432/biomedintel_test" npm run start
# terminal 2
E2E_BASE_URL=http://localhost:3000 E2E_PASSWORD=Test-only-password-123 npm test -- tests/e2e
```

(Sign-in is rate-limited to 5 attempts per minute per address, so wait a minute between repeated runs.)

## How the security works (short version)

1. **Sign-in** — Better Auth: passwords hashed with scrypt, HTTP-only session cookies, 12-hour sessions, no public sign-up, rate limiting, MFA for privileged roles.
2. **Every page and action re-checks on the server** — `requireAccess()` validates the session in the database and works out the user's organisation, role, hospitals and departments. Nothing the browser sends (ids in URLs, forms or cookies) is trusted.
3. **Every action checks permission first** — `requirePermission()` against one permission table (`server/authz/permissions.ts`). Deny by default. Refusals are audited.
4. **The database checks again** — Row-Level Security on every tenant table; the app's database role cannot bypass it. The tenant is set per transaction, so pooled connections never leak it.
5. **Everything important is audited** — append-only `audit_logs` that even the app cannot change.

Details: [docs/SECURITY.md](docs/SECURITY.md) · Architecture and stage report: [docs/STAGE-3.md](docs/STAGE-3.md).

## Project structure

```text
app/                    Pages (Next.js App Router)
  (auth)/               Sign-in, MFA code, forgot/reset password (public)
  (account)/            Account security (MFA setup), no-access, platform admin
  (app)/                The signed-in app: dashboard, admin, settings, module placeholders
  api/auth/[...all]/    Better Auth endpoints
components/             UI building blocks (ui/) and the app shell (shell/)
lib/                    Shared client-safe code: validation schemas, navigation, auth client
server/                 Server-only code — never sent to the browser
  auth/                 Better Auth setup, session helpers, user creation
  authz/                Roles, permission table, access resolution, errors
  audit/                Audit logging
  db/                   Prisma client, withTenant() transactions, generated client
  services/             Business rules (organisation admin, platform, dashboard)
  actions/              Shared result handling for server actions
prisma/                 schema.prisma, migrations, seed
scripts/                Bootstrap admin, database setup/reset helpers
tests/                  unit/, integration/ (database), e2e/ (HTTP)
proxy.ts                Request id + redirect signed-out visitors (Next.js 16 "proxy")
instrumentation.ts      Start-up checks (config, database role)
```

## Troubleshooting

| Problem                                                          | Fix                                                                                                     |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `BiomedIntel.ai configuration error` at start                    | A variable in `.env` is missing or invalid; the message names it.                                       |
| `DATABASE_URL connects as … which can bypass Row-Level Security` | `DATABASE_URL` must use `biomedintel_app`, not the owner or `postgres`.                                 |
| `password authentication failed for user …`                      | The password in your `.env` URL does not match `setup-local.sql` (or Docker).                           |
| `database "biomedintel_dev" does not exist`                      | Run step 2 again.                                                                                       |
| `The test database is missing migrations`                        | `npm run db:test:prepare`                                                                               |
| `relation "…" does not exist`                                    | Migrations not applied: `npm run db:deploy`.                                                            |
| Sign-in says "Too many attempts"                                 | Rate limiting: wait one minute.                                                                         |
| Seed says organisations already exist                            | `npm run db:reset` (local only) for a clean database.                                                   |
| An admin is sent to "Account security"                           | Expected: privileged roles must set up an authenticator app first.                                      |
| `npm install` fails with `edgesOut`                              | Make sure `.npmrc` (with `legacy-peer-deps=true`) is in the project folder.                             |
| Forgot-password emails do not arrive                             | There is no email provider yet. In development the reset link is printed in the `npm run dev` terminal. |
| Prisma cannot download its engine                                | Check your internet connection or proxy; Prisma downloads its schema engine on first use.               |
