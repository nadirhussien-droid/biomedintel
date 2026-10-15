# BiomedIntel.ai

**Smarter Maintenance. Safer Healthcare.**

BiomedIntel.ai is an AI-powered CMMS (Computerized Maintenance Management System) for hospital biomedical engineering teams. It manages **medical equipment and engineering records, never patient records**.

This repository contains:

- **Stage 3 foundation:** project setup, database, secure sign-in, roles and permissions, multi-hospital tenant isolation, audit logging and the branded application shell.
- **Stage 4 equipment register:** asset register with search, filters and paging; asset details; create/edit/archive; decommissioning with NUM approval; equipment catalog; Code 128 barcode labels, barcode scanning (handheld scanner, phone camera or typing) and printable labels; CSV export.

- **Stage 5 work orders:** fault reports from a scanned barcode (handheld scanner, camera or typing), with photos; assignment; the technician workflow; sign-off by the technician who did the job; downtime; a manager review list; in-app notifications; printable job sheets.

Preventive maintenance, testing, inventory, IntellKnowledge, IntellAssist and reports arrive in later stages.

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

This also generates the Prisma database client. (Run it again after pulling a new stage.) (`.npmrc` sets `legacy-peer-deps=true` because one test tool's optional peer dependency confuses npm 10.)

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

## Updating an existing copy

If you already ran Stage 3 on your computer:

```bash
npm install              # adds the barcode libraries (bwip-js, @zxing/browser) and sharp (photo processing)
npm run db:deploy        # applies new migrations (Stage 4: 4, Stage 5: 2); existing data is kept
npm run db:test:prepare  # same for the test database
```

If an earlier copy of this guide told you to add `APP_URL` to `.env`, you can delete that line: it is no longer used. The fictional equipment is only loaded into an **empty** development database; to get it, run `npm run db:reset` (local only — this wipes `biomedintel_dev`).

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
| Mary Njeri    | mary.njeri@coastal.example    | Coastal Health Group     | Department Head (Facility Mgr) | Northlake (whole hospital)                   |
| Fatuma Hassan | fatuma.hassan@coastal.example | Coastal Health Group     | Read-only Auditor              | Whole organisation                           |
| Lucy Achieng  | lucy.achieng@coastal.example  | Coastal Health Group     | Fault Reporter                 | Northlake Emergency                          |
| David Mutua   | david.mutua@highland.example  | Highland Medical Network | Organization Administrator     | Whole organisation                           |
| Sara Nakato   | sara.nakato@highland.example  | Highland Medical Network | Technician                     | Summit Regional                              |

Administrators and Engineering Managers must set up an **authenticator app** (Microsoft or Google Authenticator) at first sign-in.

The seed also loads **fictional demonstration equipment**: 14 assets in Coastal and 4 in Highland, with invented manufacturers and models marked "(demo)", serial numbers starting `DEMO-`, and the description "Fictional demonstration record — not a real device." Highland deliberately reuses Coastal's asset IDs and one serial number, to show that IDs are unique per organisation and serial numbers are not unique at all. One decommissioning request (INF-0002, Riverside ICU) is waiting for Peter Kamau, the NUM, to approve. Northlake has no NUMs in the demo data, so Mary Njeri (Facility Manager) or an Engineering Manager covering Northlake approves there.

## The equipment register (Stage 4)

Open **Equipment Assets** in the sidebar.

| Task                         | Where                                                           | Who can do it                                                                                                                |
| ---------------------------- | --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Search, filter, sort, page   | Register page                                                   | Everyone, but only for their own hospitals and departments                                                                   |
| Register an asset            | **Register asset**                                              | Org Admin, Engineering Manager, Technician                                                                                   |
| Edit an asset                | Asset page → **Edit asset**                                     | Org Admin, Engineering Manager, Technician (purchase cost: admins and managers only)                                         |
| Change status or room        | Asset page → **Quick update**                                   | Org Admin, Engineering Manager, Technician                                                                                   |
| Request decommissioning      | Asset page → **Decommissioning**                                | Org Admin, Engineering Manager, Technician                                                                                   |
| Approve decommissioning      | Asset page, or the approvals box on the register                | The department's **NUM** (Department Head). If it has none: the Engineering Manager or Facility Manager. Never the requester |
| Archive / restore            | Asset page → **Archive**                                        | Org Admin, Engineering Manager                                                                                               |
| Find an asset by barcode     | Register → **Scan barcode** (or type it in the register search) | Everyone, but only for their own hospitals and departments                                                                   |
| Print labels                 | Asset page → **Print label**, or tick assets in the register    | Org Admin, Engineering Manager, Technician                                                                                   |
| Export CSV                   | Register → **Export CSV** (uses the current filters)            | Org Admin, Engineering Manager, Inventory Manager, Auditor                                                                   |
| Manufacturers, models, rooms | Register → **Equipment catalog**                                | Add: Org Admin, Engineering Manager, Technician. Everyone can view                                                           |

Nothing is ever deleted. Archived assets keep their full history and can be restored. Decommissioned assets become read-only.

### Barcodes

- Every asset's label carries a **Code 128 barcode of its asset ID** (e.g. `INF-0412`), with the same ID printed underneath. Nothing else is in the barcode: no database id, password, session or patient data.
- A barcode is an identifier, not a key. Scanning finds the asset only for a signed-in person, only in the organisation they are working in, and only if the asset's hospital and department are in their access. Otherwise the answer is "No asset found that you can open", whatever the reason.
- **Changing an asset ID changes its barcode.** The old label stops matching, the change is recorded in the audit log (`asset.barcode_replaced`), and the asset page reminds you to print a new label.
- Scanning also accepts a hospital's own **inventory number**, so older barcode labels a hospital already has keep working.
- Asset IDs are unique per organisation. If you work in two organisations, switch organisation at the top of the page before scanning the other organisation's equipment.

### Scanning

Open **Equipment Assets → Scan barcode**. There are three ways:

1. **Handheld USB or Bluetooth barcode scanner** (recommended for busy workshops): most act like a keyboard. The box on the Scan page is ready as soon as it opens, so just scan; the scanner "types" the code and presses Enter. Set the scanner to send **Enter** after each scan (the factory default on most models) and to read **Code 128**.
2. **Phone or tablet camera:** tap **Start camera**. The browser asks for camera permission only then; video stays on the device and is never uploaded. Browsers only allow the camera on **https://** sites, or on `http://localhost` on the same computer.
3. **Typing** the asset ID or inventory number.

The register's search box also finds an asset by its barcode value, so a handheld scanner works there too.

### Printing labels

Two formats are built in:

| Format                    | Use with                                                           | Barcode size |
| ------------------------- | ------------------------------------------------------------------ | ------------ |
| A4 sheet, 24 labels       | 63.5 × 33.9 mm label sheets (3 × 8), on an ordinary laser printer  | 59.5 × 12 mm |
| Label printer, 62 × 29 mm | Continuous or die-cut 62 mm label rolls (e.g. Brother QL printers) | 58 × 11 mm   |

The barcode fills the label width, including the white quiet zones scanners need at each end. For a typical asset ID like `INF-0412` the narrowest bar is about 0.45 mm, comfortably above the ~0.25 mm most scanners need. Long asset IDs make thinner bars; the label page warns about any asset ID that would be too dense, so keep asset IDs short (about 12 characters or fewer).

Recommendations:

1. Print at **100% / Actual size**, not "Fit to page", and turn off the browser's headers and footers.
2. Print one test sheet first and scan it with **your own handheld scanner** (and a phone, if you use the camera) before printing a batch. The labels have been checked by software, but not yet with your scanners and printers.
3. Use a laser or thermal printer and durable (polyester or laminated) labels for equipment that is cleaned with disinfectant. Inkjet on paper smudges.
4. Keep the white margins at both ends of the barcode clear, and stick labels on a flat, visible surface, not over a seam or curved edge. Place the barcode horizontally where a scanner can reach it.
5. Labels show only the asset name, asset ID and, optionally, hospital and department. Serial numbers, costs and other internal details are never printed. Use **Hide hospital and department** for equipment in public areas if you prefer.

## Work orders (Stage 5)

Open **Work Orders** in the sidebar, or use **Report a fault** on an asset page.

**How a job flows:** Reported → Assigned → In progress (⇄ On hold) → Completed by the technician, or Cancelled.

| Task                                       | Who                                                                                      |
| ------------------------------------------ | ---------------------------------------------------------------------------------------- |
| Report a fault (scan, type or search)      | Fault Reporter, Department Head, Technician, Engineering Manager, Org Admin              |
| See jobs                                   | Everyone in their hospitals/departments; **Fault Reporters see only their own reports**  |
| Assign or reassign, change priority        | Engineering Manager, Org Admin                                                           |
| Take an unassigned job                     | Technician, Engineering Manager                                                          |
| Start, put on hold, log work, **sign off** | **Only the technician assigned to the job**                                              |
| Review a self-signed safety-critical job   | Engineering Manager, Org Admin (never blocks the job)                                    |
| Reopen a completed job                     | Engineering Manager, Org Admin                                                           |
| Cancel                                     | Engineering Manager, Org Admin; a reporter can cancel their own report before assignment |
| Add notes                                  | Anyone who can report                                                                    |

**Reporting a fault:**

- Scan the device's barcode with a handheld scanner straight into the box on **Report a fault**. Alternatively use **Scan barcode to report** (camera), or type the asset ID.
- Describe the problem, without patient information, and tick **I have taken this device out of use** if it is no longer in use. The device then becomes Out of service and downtime starts.
- Add up to 5 photos (JPEG/PNG/WebP, 5 MB each). Location and camera details are removed automatically.
- If the device already has an open job, you are asked to confirm before a second job is created.

**Safety-critical devices** are defibrillators, ventilators, anaesthesia machines, infusion pumps, electrosurgical units, and any asset rated High risk.

- Their jobs are at least **High** priority (**Urgent** if the device was taken out of use).
- Managers and org admins are notified immediately.
- After sign-off they appear in **Safety-critical to review** for a manager.
- The list of device types is a flag on each equipment category.

**Response targets** (from the time of reporting): Urgent 4 h, High 24 h, Medium 3 days, Low 7 days. Jobs past their target show **Overdue**.

**Sign-off.** The technician who did the job signs it off: decision of 15 Oct 2026.

- They record the diagnosis, the work done, the outcome, the functional check and the electrical safety test (or why it is not applicable), and confirm a declaration.
- A device cannot be signed off as repaired with a failed check (the database enforces this too).
- "Repaired" and "No fault found" return the device to service and end downtime, unless another open job still has it out of use.
- "Not repairable" keeps it out of service; request decommissioning from the asset page. **Open jobs block decommissioning.**

**Job sheet:** **Print job sheet** gives an A4 sheet with the work order number and the asset ID as Code 128 barcodes, so the technician can scan the device on site.

**Notifications** appear under the bell in the header: new faults, safety-critical faults, assignments, notes, completions, reopened and cancelled jobs, and decommissioning requests. They are in-app only for now; email needs an email provider.

The seed adds four fictional jobs:

- WO-…-00001: a completed repair on MON-0002.
- WO-…-00002: a job in progress on VEN-0001.
- WO-…-00003: a new safety-critical report on DEF-0101, taken out of use.
- One assigned job in Highland.

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

The suite wipes and re-seeds `biomedintel_test` (it refuses any database not ending in `_test`). It covers schema constraints, Row-Level Security, cross-tenant access, pooled-connection leakage, role permissions, self-escalation, input validation, sign-in, sessions, MFA, password reset and audit records — and, for equipment, asset isolation between organisations, hospitals and departments, search/paging/export isolation, barcode generation, decoding and look-up, label output, field-level rules and the decommissioning approval rule.

**If you add a new migration**, run `npm run db:test:prepare` before `npm test`.

HTTP checks against a running server (optional):

```bash
# terminal 1 — run the production build against the TEST database
npm run build
DATABASE_URL="postgresql://biomedintel_app:YOUR_APP_PASSWORD@localhost:5432/biomedintel_test" npm run start
# terminal 2
E2E_BASE_URL=http://localhost:3000 E2E_PASSWORD=Test-only-password-123 npm test -- tests/e2e
```

(Sign-in is rate-limited to 5 attempts per minute per address, so wait a minute between repeated runs.)

Run the server on the address in `BETTER_AUTH_URL` (port 3000 by default): sign-in from any other address is refused with **403** on purpose.

## How the security works (short version)

1. **Sign-in** — Better Auth: passwords hashed with scrypt, HTTP-only session cookies, 12-hour sessions, no public sign-up, rate limiting, MFA for privileged roles.
2. **Every page and action re-checks on the server** — `requireAccess()` validates the session in the database and works out the user's organisation, role, hospitals and departments. Nothing the browser sends (ids in URLs, forms or cookies) is trusted.
3. **Every action checks permission first** — `requirePermission()` against one permission table (`server/authz/permissions.ts`). Deny by default. Refusals are audited.
4. **The database checks again** — Row-Level Security on every tenant table; the app's database role cannot bypass it. The tenant is set per transaction, so pooled connections never leak it.
5. **Everything important is audited** — append-only `audit_logs` that even the app cannot change.

Details: [docs/SECURITY.md](docs/SECURITY.md) · Stage reports: [docs/STAGE-3.md](docs/STAGE-3.md), [docs/STAGE-4.md](docs/STAGE-4.md).

## Project structure

```text
app/                    Pages (Next.js App Router)
  (auth)/               Sign-in, MFA code, forgot/reset password (public)
  (account)/            Account security (MFA setup), no-access, platform admin
  (app)/                The signed-in app: dashboard, admin, settings, module placeholders
    assets/             Equipment register, asset pages, catalog, labels, scanner, CSV export
    work-orders/        Work order list, fault report, job page, job sheet, photo upload/view routes
    notifications/      In-app notifications
  api/auth/[...all]/    Better Auth endpoints
components/             UI building blocks (ui/) and the app shell (shell/)
lib/                    Shared client-safe code: validation schemas, navigation, auth client
server/                 Server-only code — never sent to the browser
  auth/                 Better Auth setup, session helpers, user creation
  authz/                Roles, permission table, access resolution, errors
  audit/                Audit logging
  db/                   Prisma client, withTenant() transactions, generated client
  services/             Business rules (organisation admin, platform, dashboard, assets, catalog, work orders, notifications)
  barcode.ts            Code 128 barcode generation for labels
  actions/              Shared result handling for server actions
prisma/                 schema.prisma, migrations, seed
scripts/                Bootstrap admin, database setup/reset helpers
tests/                  unit/, integration/ (database), e2e/ (HTTP)
proxy.ts                Request id + redirect signed-out visitors (Next.js 16 "proxy")
instrumentation.ts      Start-up checks (config, database role)
```

## Troubleshooting

| Problem                                                          | Fix                                                                                                                   |
| ---------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `BiomedIntel.ai configuration error` at start                    | A variable in `.env` is missing or invalid; the message names it.                                                     |
| `DATABASE_URL connects as … which can bypass Row-Level Security` | `DATABASE_URL` must use `biomedintel_app`, not the owner or `postgres`.                                               |
| `password authentication failed for user …`                      | The password in your `.env` URL does not match `setup-local.sql` (or Docker).                                         |
| `database "biomedintel_dev" does not exist`                      | Run step 2 again.                                                                                                     |
| `The test database is missing migrations`                        | `npm run db:test:prepare`                                                                                             |
| `relation "…" does not exist`                                    | Migrations not applied: `npm run db:deploy`.                                                                          |
| Sign-in says "Too many attempts"                                 | Rate limiting: wait one minute.                                                                                       |
| Seed says organisations already exist                            | `npm run db:reset` (local only) for a clean database.                                                                 |
| An admin is sent to "Account security"                           | Expected: privileged roles must set up an authenticator app first.                                                    |
| `npm install` fails with `edgesOut`                              | Make sure `.npmrc` (with `legacy-peer-deps=true`) is in the project folder.                                           |
| Forgot-password emails do not arrive                             | There is no email provider yet. In development the reset link is printed in the `npm run dev` terminal.               |
| Prisma cannot download its engine                                | Check your internet connection or proxy; Prisma downloads its schema engine on first use.                             |
| "Start camera" says camera scanning needs a secure connection    | Browsers allow cameras only on https:// or on localhost. Type the asset ID, or use an https address.                  |
| The camera starts but nothing happens                            | Hold the barcode flat and horizontal, 10–20 cm away in good light, filling most of the frame. Reprint damaged labels. |
| A scan says "No asset found that you can open"                   | Not your hospital/department, a label from before an asset ID change, or another organisation's equipment.            |
| "There is already an open job for this device"                   | Add a note to the existing job, or tick the box to report a separate fault.                                           |
| A photo upload says it is not a readable photo                   | Use JPEG, PNG or WebP up to 5 MB. HEIC photos from iPhones: set Camera → Formats → Most Compatible.                   |
| A device stays Out of service after sign-off                     | Another open job took it out of use; complete or cancel that job too.                                                 |
| A handheld scanner types but nothing happens                     | Set the scanner to send Enter after each scan, and to read Code 128.                                                  |
| Printed barcodes are too small or cut off                        | Print at 100% / Actual size, not "Fit to page"; check the label format matches your label stock.                      |
