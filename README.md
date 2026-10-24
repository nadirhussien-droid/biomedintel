# BiomedIntel.ai

**Smarter Maintenance. Safer Healthcare.**

BiomedIntel.ai is an AI-powered CMMS (Computerized Maintenance Management System) for hospital biomedical engineering teams. It manages **medical equipment and engineering records, never patient records**.

This repository contains:

- **Stage 3 foundation:** project setup, database, secure sign-in, roles and permissions, multi-hospital tenant isolation, audit logging and the branded application shell.
- **Stage 4 equipment register:** asset register with search, filters and paging; asset details; create/edit/archive; decommissioning with NUM approval; equipment catalog; Code 128 barcode labels, barcode scanning (handheld scanner, phone camera or typing) and printable labels; export to Excel, PDF or CSV (`docs/EXPORTS.md`).

- **Stage 5 work orders:** fault reports from a scanned barcode (handheld scanner, camera or typing), with photos; assignment; the technician workflow; sign-off by the technician who did the job; downtime; a manager review list; in-app notifications; printable job sheets.

Preventive maintenance, testing, inventory, IntellKnowledge, IntellAssist and reports arrive in later stages.

> **Not production-ready.** It runs locally and its security foundations are tested, but it has not been security-reviewed, has no email provider, and has never been deployed. See [docs/SECURITY.md](docs/SECURITY.md).

---

## What you need

| Tool       | Version            | Check with       |
| ---------- | ------------------ | ---------------- |
| Node.js    | 22.13 or newer     | `node -v`        |
| npm        | comes with Node.js | `npm -v`         |
| PostgreSQL | 16 or newer        | `psql --version` |
| Git        | any recent version | `git --version`  |

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

| Task                         | Where                                                               | Who can do it                                                                                                                |
| ---------------------------- | ------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Search, filter, sort, page   | Register page                                                       | Everyone, but only for their own hospitals and departments                                                                   |
| Register an asset            | **Register asset**                                                  | Org Admin, Engineering Manager, Technician                                                                                   |
| Edit an asset                | Asset page → **Edit asset**                                         | Org Admin, Engineering Manager, Technician (purchase cost: admins and managers only)                                         |
| Change status or room        | Asset page → **Quick update**                                       | Org Admin, Engineering Manager, Technician                                                                                   |
| Request decommissioning      | Asset page → **Decommissioning**                                    | Org Admin, Engineering Manager, Technician                                                                                   |
| Approve decommissioning      | Asset page, or the approvals box on the register                    | The department's **NUM** (Department Head). If it has none: the Engineering Manager or Facility Manager. Never the requester |
| Archive / restore            | Asset page → **Archive**                                            | Org Admin, Engineering Manager                                                                                               |
| Find an asset by barcode     | Register → **Scan barcode** (or type it in the register search)     | Everyone, but only for their own hospitals and departments                                                                   |
| Print labels                 | Asset page → **Print label**, or tick assets in the register        | Org Admin, Engineering Manager, Technician                                                                                   |
| Export register              | Register → **Export register: Excel / PDF / CSV** (current filters) | Org Admin, Engineering Manager, Inventory Manager, Auditor                                                                   |
| Manufacturers, models, rooms | Register → **Equipment catalog**                                    | Add: Org Admin, Engineering Manager, Technician. Everyone can view                                                           |

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

**Job sheet:** **Print job sheet** gives an A4 sheet with the work order number and the asset ID as Code 128 barcodes, so the technician can scan the device on site. The header shows the organisation name and, if the Organisation Administrator uploaded one (Admin → Hospital logo, optional), its logo. See `docs/JOB-SHEET-BRANDING.md`.

**Edit after completion:** the technician, engineer or manager who worked on a completed job can edit its text, fault category and work log with one Edit button; safety results stay locked. See `docs/WORK-ORDER-EDIT.md`.

**AI model per hospital:** platform staff choose Haiku, Sonnet or Opus for each hospital on the Platform page; hospitals with no choice use the `AI_MODEL` default. See `docs/AI-MODEL.md`.

**Help:** every page has a **Help** button with short steps for that page and the person's role, and a **Report a problem** form that reaches the Organisation Administrator (Admin → Problem reports). See `docs/HELP.md`.

**Notifications** appear under the bell in the header: new faults, safety-critical faults, assignments, notes, completions, reopened and cancelled jobs, and decommissioning requests. They are in-app only for now; email needs an email provider.

The seed adds four fictional jobs:

- WO-…-00001: a completed repair on MON-0002.
- WO-…-00002: a job in progress on VEN-0001.
- WO-…-00003: a new safety-critical report on DEF-0101, taken out of use.
- One assigned job in Highland.

## Preventive maintenance (Stage 6)

Open **Preventive Maintenance** in the sidebar. Full details are in [docs/STAGE-6.md](docs/STAGE-6.md).

**In short:**

1. An Engineering Manager or Org Admin writes a **maintenance plan**. A plan holds what it applies to (one asset, one model or one category), the interval, where the interval comes from, the checklist, the lead time and who does the work. It starts as a **draft**.
2. An **Engineering Manager approves** it. Approval confirms the procedure, the measurement limits and the interval. Nothing is scheduled before this.
3. Matching assets are **enrolled** with a first due date.
4. Once a day the **scheduler** creates a normal work order for each due date that falls inside the plan's lead time. It also sends reminders: upcoming, due today and overdue.
5. The assigned technician answers every checklist item and signs off, exactly as in Stage 5.

**Where an interval may come from** (decision of 15 Oct 2026, in priority order):

1. a regulatory or organisational requirement, with its reference;
2. the manufacturer's interval for the model (record it under **Maintenance → Settings**);
3. an organisation-defined interval, only where no manufacturer guidance exists, with a written justification.

Equipment without an approved plan is listed under **Needs review**. BiomedIntel.ai never invents a schedule.

**Failed electrical safety test.** If any electrical safety item fails:

- the device is flagged **"Failed Safety Test — Do Not Use"** and taken out of service;
- a repair job is created; after the repair, a retest job;
- after a passed retest, an Engineering Manager who did **not** do the retest must approve return to service.

Nothing else can put the device back in service, and the database enforces this too.

**Test standards.** IEC 62353 is the default and AS/NZS 3551 is listed. You choose which applies per organisation, country, hospital or category. A qualified Engineering Manager must verify a standard before it is used. Each test result stores the standard and version used.

**Running the scheduler:**

```bash
npm run pm:generate     # creates due PM work orders and reminders for every organisation, once
```

- It is safe to run it any number of times: a due date can only ever get one work order.
- In production, run it daily with the server's cron, or call `POST /api/cron/pm-generate` with the header `Authorization: Bearer <CRON_SECRET>` (see `.env.example`).
- Managers can also press **Run generation now** on the Maintenance overview.

**Barcodes:** **Scan barcode** on the Maintenance pages (or `/assets/scan?then=pm`) opens the scanned device's maintenance section. Every asset page now has a **Preventive maintenance** section.

**Seed data:** fictional test standards, manufacturer intervals and four plans (three approved, one draft). Run `npm run pm:generate` after seeding: it creates 5 PM work orders (overdue, due today and upcoming) and records 1 missed ventilator inspection.

## Reports and analytics (Stage 7)

Open **Reports and Analytics** in the sidebar. Full details, definitions and formulas are in [docs/STAGE-7.md](docs/STAGE-7.md), [docs/STAGE-8.md](docs/STAGE-8.md).

- **Dashboard:** 14 headline figures (equipment, work orders, planned maintenance, electrical safety, reliability). Each shows its definition, whether it is "right now" or "in the period", and links to the records behind it.
- **Reports:** PM compliance (the single source of compliance figures — `/maintenance/reports` now redirects here), work order performance, equipment reliability, electrical safety and return to service, plan governance, lifecycle and cost.
- **Filters:** period (this month, last month, this year, last 12 months, custom), hospital, department, location, category, priority, status. Dates use each hospital's local calendar; durations are calendar time.
- **Honest figures:** compliance is N/A when nothing was due; MTBF/MTTR are not shown because operating hours are not recorded (labelled proxies are used instead); only acquisition cost is shown, and only to financial roles.
- **Export to Excel, PDF or CSV** (Org Admin, Engineering Manager, Auditor): same filters as the screen, formula-safe, with generation time and period. Every export is audited with its format. See `docs/EXPORTS.md`.
- **Scheduled reports** (Org Admin, Engineering Manager): weekly or monthly read-only snapshots, delivered as in-app notifications (no email is sent).
- **Fault category:** an optional field when signing off a corrective job, used by the reliability report.

**Daily job:**

```bash
npm run jobs:daily      # PM generation and reminders, scheduled report snapshots, then lifecycle/inventory reminders
```

Safe to run any number of times. The cron endpoint `/api/cron/pm-generate` runs the same job.

## Lifecycle, warranties, spare parts and suppliers (Stage 8)

Full details, definitions and a step-by-step tour are in [docs/STAGE-8.md](docs/STAGE-8.md).

- **Asset pages** now have a **Lifecycle** section (stage worked out from the existing status and safety hold, key dates, replacement review, disposal record, full history) and a richer **Warranties** section (supplier, reference, parts/labour coverage _as recorded_, exclusions, claims with status history).
- **Spare Parts Inventory:** parts with Code 128 part-number barcodes, stores per hospital, lots and expiry, low/out-of-stock/expiring views. Stock changes **only** through recorded movements (receipt, issue, return, transfer, adjustment, write-off); the database keeps the totals, refuses negative stock and never lets a movement be edited. **Available = on hand (unexpired) − reserved.**
- **Work orders:** reserve, issue and return parts; record a part as unavailable; record external supplier work. None of this marks a device repaired or safe.
- **Purchase requests:** draft → submitted → approved by a second person → marked ordered → received. Nothing is ordered or paid by BiomedIntel.ai; stock rises only when a receipt is recorded.
- **Suppliers and Contracts:** supplier register, warranty and contract lists (active, expiring, expired, missing), supplier work in progress.
- **Reports → Parts & service:** recorded parts and external service costs per currency (financial roles only, audited), consumption, write-offs, supplier history, claims.
- **Reminders** (in-app, part of `npm run jobs:daily`): warranty/contract expiry (90/60/30 days by default), low and out-of-stock, expiring stock, overdue supplier work, purchase requests waiting, lifecycle reviews.

The seed adds fictional suppliers, two stores and four parts with opening stock.

## Technical knowledge and IntellAssist (Stage 9)

Full details are in [docs/STAGE-9.md](docs/STAGE-9.md).

- **Technical Knowledge** (`/knowledge`): upload PDF, .txt or .md documents (up to 20 MB) or type notes; documents start as **drafts** and an Engineering Manager approves them. Versions, supersede and withdraw (nothing is deleted), documented error codes, full-text search with "Open page N" links.
- **IntellAssist** (`/assist`): troubleshooting sessions on a device or work order — facts from records, observations and tests, root cause, corrective action and verification — kept clearly apart from AI suggestions. Closing a session never changes the device or the job.
- **AI suggestions are optional and off by default.** With `AI_PROVIDER` empty everything else works. Suggestions use only approved documents, cite pages, and are marked "Unverified" when no source supports them. `AI_PROVIDER="mock"` is a labelled test stand-in; `"anthropic"` uses the paid Claude API (key and model in `.env`, never committed).

The seed adds one fictional approved document (DM-Infuse 100, error code P-110).

## Production readiness and staging (Stage 10)

Stage 10 checked and hardened everything above and prepared a **private staging** deployment. Nothing has been deployed. Start with these guides:

- [docs/STAGE-10.md](docs/STAGE-10.md) — what was checked, changed and measured.
- [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) — step-by-step staging deployment on Render, with costs.
- [docs/OPERATIONS.md](docs/OPERATIONS.md) — environments, health checks, logs, backups, restore and incident response.
- [docs/SECURITY.md](docs/SECURITY.md) — every security finding and its status, plus known limitations.
- [docs/PERMISSIONS.md](docs/PERMISSIONS.md) — what each role may do, generated from the code.

## Pilot preparation (Stage 11)

The pilot has **not started**; see [docs/PILOT.md](docs/PILOT.md). Stage 11 added:

- **Change password** on Account security, so people can replace a temporary password.
- **Simpler staging set-up.** Render generates the app database password, and the first deploy creates the restricted database user. You no longer type a database address or run anything on your own computer ([docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)).
- **`npm run pilot:data -- --fictional`**, which loads the fictional organisations below onto an **empty staging** database for the pilot scenarios. It only runs where `PILOT_DATA_ALLOWED=true`.

## Production (Stage 12)

**Not deployed. The go/no-go decision on 20 Oct 2026 was NO-GO:** the pilot has not run, and there is no staging, customer or launch approval yet. See [docs/PRODUCTION.md](docs/PRODUCTION.md) for the reasons, the release and rollback rules, and where the full readiness assessment lives.

## Create the first Platform Super Administrator

There is no public sign-up page, and no web form can create a platform administrator. Use the script, once:

```bash
npm run admin:bootstrap
```

It uses `BOOTSTRAP_ADMIN_EMAIL` and `BOOTSTRAP_ADMIN_NAME` from `.env`, asks for a password (hidden), and refuses to run if a platform administrator already exists. Sign in, set up MFA, and you land on **/platform**, where you can create organisations and their first Organization Administrator.

## Everyday commands

| Command                             | What it does                                                                   |
| ----------------------------------- | ------------------------------------------------------------------------------ |
| `npm run dev`                       | Start the app with live reload at http://localhost:3000                        |
| `npm run typecheck`                 | TypeScript type checking (strict mode)                                         |
| `npm run lint`                      | ESLint                                                                         |
| `npm run format`                    | Format code with Prettier                                                      |
| `npm test`                          | Run all automated tests against `biomedintel_test`                             |
| `npm run build`                     | Production build                                                               |
| `npm run check`                     | Type check + lint + tests + build, in that order                               |
| `npm run db:migrate`                | Create a NEW migration after editing `prisma/schema.prisma` (development only) |
| `npm run db:deploy`                 | Apply existing migrations (safe for any environment)                           |
| `npm run db:seed`                   | Load the fictional data into an empty development database                     |
| `npm run db:reset`                  | **Local only**: wipe `biomedintel_dev`, re-apply migrations, re-seed           |
| `npm run db:studio`                 | Open Prisma Studio to browse the database (uses the owner role — careful)      |
| `npm run db:test:prepare`           | Apply migrations to the test database                                          |
| `npm run pm:generate`               | Create due preventive maintenance work orders and reminders (safe to repeat)   |
| `npm run jobs:daily`                | The daily job: PM work orders, reminders and scheduled report snapshots        |
| `npm run db:check-migrations`       | Refuse migrations with unreviewed destructive statements                       |
| `npm run db:backup -- FOLDER`       | Make a checked backup of the database in `DATABASE_URL_ADMIN`                  |
| `npm run db:restore-drill -- FILE`  | Prove a backup restores (into a throwaway local database)                      |
| `npm run docs:permissions`          | Regenerate `docs/PERMISSIONS.md` after changing permissions                    |
| `npm run pilot:data -- --fictional` | Staging only: load the fictional pilot organisations into an empty database    |

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

Stage 6 adds tests for:

- date maths: month ends, leap years, time zones;
- plan rules, approval and permissions;
- generation: correct links, retries, concurrent runs, failure and recovery, catch-up, skipped assets;
- checklist sign-off;
- the full failed-safety-test hold with second-person approval;
- reports, exports, barcode entry, the scheduler endpoint, and MFA storage and recovery.

Stage 7 adds tests for:

- reporting periods, time zones and the N/A rule;
- exact values for every report from a fixture with known timestamps;
- read-only behaviour, financial and workload restrictions, scope and tenant isolation;
- CSV formula safety, scheduled-report idempotency and recipient re-checks;
- performance with 20,000 work orders and 10,000 PM due dates.

Stage 8 adds tests for:

- stock receipts, reservations, issues, returns, transfers, adjustments and write-offs;
- duplicate and concurrent submissions recorded once, and stock never below zero;
- purchase request approval by a second person and receipts only against ordered requests;
- suppliers, external service dates, warranties and claim statuses, lifecycle rules;
- reminders without duplicates, cost reporting restrictions and tenant isolation.

**If you add a new migration**, run `npm run db:test:prepare` before `npm test`.

HTTP checks against a running server (optional):

```bash
# terminal 1 — run the production build against the TEST database
npm run build
DATABASE_URL="postgresql://biomedintel_app:YOUR_APP_PASSWORD@localhost:5432/biomedintel_test" npm run start
# terminal 2 — one file at a time
E2E_BASE_URL=http://localhost:3000 E2E_PASSWORD=Test-only-password-123 npx vitest run tests/e2e/routes.test.ts
```

The HTTP files are `routes`, `assets`, `pm`, `analytics`, `inventory`, `knowledge` and `tenant-isolation` (Stage 10: probes every module as another organisation). Sign-in is limited to 5 attempts per minute per address, so **wait one minute between files**. Running them all at once trips the limit on purpose.

Stage 10 adds tests for: the per-account sign-in limit and MFA lock, cross-organisation MFA resets, production settings, log redaction, migration safety, the managed-host database policies, the permissions document, and cross-organisation changes to every module.

Run the server on the address in `BETTER_AUTH_URL` (port 3000 by default): sign-in from any other address is refused with **403** on purpose.

## How the security works (short version)

1. **Sign-in** — Better Auth: passwords hashed with scrypt, HTTP-only session cookies, 12-hour sessions, no public sign-up, rate limiting, MFA for privileged roles.
2. **Every page and action re-checks on the server** — `requireAccess()` validates the session in the database and works out the user's organisation, role, hospitals and departments. Nothing the browser sends (ids in URLs, forms or cookies) is trusted.
3. **Every action checks permission first** — `requirePermission()` against one permission table (`server/authz/permissions.ts`). Deny by default. Refusals are audited.
4. **The database checks again** — Row-Level Security on every tenant table; the app's database role cannot bypass it. The tenant is set per transaction, so pooled connections never leak it.
5. **Everything important is audited** — append-only `audit_logs` that even the app cannot change.

Details: [docs/SECURITY.md](docs/SECURITY.md) · Stage reports: [docs/STAGE-3.md](docs/STAGE-3.md), [docs/STAGE-4.md](docs/STAGE-4.md), [docs/STAGE-5.md](docs/STAGE-5.md), [docs/STAGE-6.md](docs/STAGE-6.md), [docs/STAGE-7.md](docs/STAGE-7.md), [docs/STAGE-8.md](docs/STAGE-8.md).

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
