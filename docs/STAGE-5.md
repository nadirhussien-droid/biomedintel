# BiomedIntel.ai — Stage 5 report

Stage 5: Work Order Management.
Built 15 October 2026 on Stage 4 (barcode build `d65eb1f`), following the Stage 2 blueprint (workflows C, D and E; tables `work_orders`, `work_order_tasks`, `attachments`, `downtime_events`, `notifications`) and the Barcode Standard amendment (Stage 5 integration).

## Decisions applied (15 October 2026)

| Topic                           | Applied                                                                                                                                                                                                                                                                                                                                                   |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Who signs off a repair          | **The technician who did the job** (Nadir's decision). This replaces Stage 2's "a different person reviews and closes". Enforced in code and by a database CHECK (`completed_by = assigned_to`). Safeguards: declaration + recorded checks, failed checks block "repaired", manager review list for safety-critical jobs, reopen. See SECURITY.md item 16 |
| Photos                          | Stored in PostgreSQL for now; JPEG/PNG/WebP only, max 5 per job and 5 MB each; decoded and re-encoded so EXIF/GPS metadata is removed                                                                                                                                                                                                                     |
| Safety-critical list            | Stage 2 starting list: defibrillators, ventilators, anaesthesia machines, infusion pumps, electrosurgical units — plus any High-risk asset. Stored as a flag on equipment categories (existing categories matched by name in the migration)                                                                                                               |
| Barcodes                        | Fault reports start from the Stage 4 barcode look-up (handheld scanner, camera or typed asset ID). No second barcode registry. Job sheets carry the asset ID and the work order number as Code 128                                                                                                                                                        |
| Choices made by me (changeable) | Response targets Urgent 4 h / High 24 h / Medium 3 d / Low 7 d; technicians may take unassigned jobs; Fault Reporters see only their own reports; in-app notifications only; a cancelled job never changes the device status automatically                                                                                                                |

## Database (2 new migrations)

1. `20261015010000_work_orders` (generated): `work_orders`, `work_order_counters`, `work_order_events`, `work_order_tasks`, `attachments`, `downtime_events`, `notifications`; `equipment_categories.safety_critical`; `asset_status_history.work_order_id`. Composite foreign keys `(organization_id, …)` everywhere.
2. `20261015010100_work_orders_security` (hand-written): rules enforced by the database (number format, assignee present, completion complete and by the assignee, repaired only with passed checks, photo type/size, one open downtime per asset, in-app notification links), RLS enabled and forced on all 7 tables (notifications: recipient only), append-only timeline/work log/photos, grants without DELETE, and the safety-critical category flags.

Additive only; no existing row changed except marking matching categories as safety-critical.

## Implemented

- **Report a fault** (`/work-orders/new`):
  - Find the device with a handheld scanner (focused box), the camera (**Scan barcode to report**), a typed asset ID, or **Report a fault** on the asset page.
  - Description (with a no-patient-data warning), an "out of use" flag and up to 5 photos.
  - Duplicate open jobs need confirmation.
  - Priority is set from safety-critical status and risk; the response target from priority.
- **Out of use:** the device becomes Out of service (status history linked to the job) and downtime starts.
- **Work order list** (`/work-orders`):
  - Views: My jobs, Open, Waiting for a technician, Safety-critical to review, Completed, All.
  - Search by WO number, asset ID (handheld scanner works here), device or fault; priority and safety-critical filters; paging.
  - Overdue badges.
- **Job page** (`/work-orders/<id>`):
  - Fault, device and current status, downtime, assignment, target time.
  - Manager actions: assign/reassign (only eligible technicians listed and accepted), priority (safety-critical: High/Urgent only), review, reopen, cancel.
  - Technician actions: take, start/resume (device → Under repair), hold with reason, log work (minutes), sign off.
  - Work log with total time, photos, timeline with notes.
  - Confirmation banners after each action.
- **Sign-off:**
  - Records diagnosis, work done and result, outcome, functional check, electrical safety test (or the reason it does not apply), and the declaration.
  - Repaired / no fault found → In service and downtime ends, unless another open job keeps the device out of use.
  - Not repairable → stays Out of service.
- **Job sheet** (`/work-orders/<id>/print`): A4, with Code 128 barcodes of the WO number and the asset ID, and space for handwritten notes and a signature.
- **Notifications:** bell with unread count in the header, `/notifications` page, and mark as read.
  - Sent for new faults (managers; technicians if a hospital has no manager), safety-critical faults (plus org admins), assignment, notes, completion (reporter; managers for safety-critical), reopen and cancel.
  - Decommissioning requests now notify the approvers (NUM, or manager/facility manager).
- **Asset page:** **Report a fault** button; real **Work orders** and **Equipment service history** sections.
- **Stage 2 rule from Stage 4:** open work orders now block decommissioning requests and approvals.
- **Dashboard:** live work order figures (open, overdue, waiting, safety-critical open, to review, completed this month). The fictional "open work orders" figure is removed.
- **Forms keep what you typed** after an error (React clears forms by default). Applied to all work order forms and the Stage 4 asset forms.
- **Seed:** four fictional jobs (completed, in progress, safety-critical reported, Highland assigned).

## Not built in Stage 5 (by design or deferred)

- **Spare parts** used on a job (Stage 7, inventory). The work log has a placeholder note.
- **Automatic escalation** when a job passes its target: needs a background job runner. It is shown as Overdue on screen.
- **Email/SMS notifications** (need a provider). **Preventive maintenance, safety-test and calibration jobs** (Stage 6). The work order types already exist in the schema.
- **Structured test records** (measured values against limits) arrive with testing in Stage 6. Stage 5 records the check results and notes.
- **Spreadsheet import** of an existing equipment list: still open (Stage 2 milestone). It was offered as an optional quick win and not built yet.
- **Removing a photo** (records are append-only); **editing a note** (add a new note instead).
- **Downtime reports** (data is recorded; reports arrive with the reports module).

## Test and build results (run on 15 October 2026)

| Check                | Command / method                                                                 | Result                                                                                                      |
| -------------------- | -------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Type check           | `npm run typecheck`                                                              | Passed, 0 errors                                                                                            |
| Lint                 | `npm run lint`                                                                   | Passed, 0 errors, 0 warnings                                                                                |
| Formatting           | `npx prettier --check .`                                                         | Passed                                                                                                      |
| Automated tests      | `npm test`                                                                       | **189 passed**, 0 failed (10 files: 148 from Stages 3–4 + 41 new); HTTP files skipped without a server      |
| HTTP tests           | `E2E_BASE_URL=… npm test -- tests/e2e` against `next start` on the test database | **29 passed**, 0 failed (24 earlier + 5 new)                                                                |
| Production build     | `npm run build`                                                                  | Passed (34 routes)                                                                                          |
| Browser walk-through | Headless Chromium, full Stage 5 flow                                             | **8 checks passed**, no console errors                                                                      |
| Stage 4 regression   | The Stage 4 walk-through, re-run                                                 | **14 checks passed**, no console errors                                                                     |
| Mutation check       | RLS switched off on `work_orders` in the test database                           | 4 tests failed as expected (RLS checks); the service-level scope filters still blocked access. RLS restored |

Stage 5 browser walk-through:

1. The NUM's handheld scan (keystrokes + Enter) selected INF-0001 on **Report a fault**.
2. The fault was reported with a photo: safety-critical, Urgent, device Out of service, photo displayed.
3. The technician took, started (device → Under repair) and logged work.
4. Sign-off without the declaration was refused, and the typed diagnosis was kept.
5. Sign-off completed: device back In service, downtime closed, "Manager review pending".
6. The job sheet printed with both barcodes.
7. At 390 px phone width there is no horizontal scrolling on the list, job and report pages.
8. The reporter saw the unread bell, opened the "completed" notification and marked all as read.

New tests:

- `tests/integration/work-orders.test.ts` (30):
  - Barcode-based reporting by a Fault Reporter.
  - Out-of-scope, cross-tenant, unknown and malformed assets.
  - Auditors and inventory managers refused; archived assets refused.
  - Out of use → status, history, downtime and notifications; duplicate confirmation; numbering per organisation.
  - Assignment eligibility (other organisation, wrong role, invalid id); technicians cannot assign or re-prioritise; take once; the safety-critical priority floor.
  - Only the assignee works and signs off (another technician and the manager are refused and audited); the full timeline.
  - Return to service and downtime end; failed checks and missing declaration refused; "not repairable".
  - The **database** refusing sign-off by a non-assignee or "repaired" with a failed check.
  - Review, reopen and cancel rules.
  - Reporter, department-head and cross-tenant visibility; search by barcode value.
  - Photos: EXIF removed, filename sanitised, fake/GIF/oversized refused, limit of 5, who may add, cross-tenant access.
  - Notifications private to their recipient.
  - Open jobs block decommissioning; approvers notified.
- `tests/integration/work-orders-db.test.ts` (10): RLS forced on 7 tables; no DELETE and protected columns; append-only records; number, photo and link rules; one open downtime; composite keys; no-context denial; cross-tenant read/update; notifications private; pooled connections.
- `tests/unit/permissions.test.ts` (+1): who works and who triages.
- `tests/e2e/assets.test.ts` (+5, HTTP): work order link returns after sign-in; list/job/job sheet with barcodes; other-tenant and out-of-scope jobs 404; photo upload refused cross-site, without Origin, oversized and non-image; notifications page and bell.

### Problems found during verification and fixed

- Seven job actions (take, start, hold, sign off, review, reopen, cancel) lost their confirmation message because their form disappears afterwards. They now reopen the job page with a banner.
- **Typed text was lost after a validation error** (React resets forms). For example, a technician who forgot the declaration lost their diagnosis. All work order forms and the Stage 4 asset detail forms now keep values on error and clear them only after success.
- The due time was computed from the server clock while the report time came from the database clock (5 ms apart). Both now use the same moment.

### Not run, and why

- **Prisma CLI migrations:** blocked in the build environment, as before. Applied with the same engine's WebAssembly build. Run `npm run db:deploy` and `npm run db:test:prepare` on your computer.
- **Real phones, scanners and printers:** not available. Photo capture on phones (`capture="environment"`), HEIC conversion settings on iPhones, handheld scanners and printing job sheets still need checking on real devices.
- **Docker Compose:** not available (unchanged).

## Git commit checklist

- [ ] `git status` shows no `.env` file.
- [ ] No secrets, real names, real hospitals or patient data in the diff; seed faults say "Fictional".
- [ ] `npm run check` passes.
- [ ] New migrations only; applied migrations never edited.
- [ ] New tenant tables: `organization_id`, RLS enabled and forced, no DELETE grant, composite keys, isolation tests.
- [ ] New services: `requirePermission()` first, scope check, audit event; "who may act" decided on the server.
- [ ] Uploads: type checked by decoding, size limits, metadata stripped, served with `nosniff`.
- [ ] Commit on a branch and open a pull request.

## Proposed Stage 6: Preventive Maintenance, Electrical Safety Tests and Calibration

1. **Schema (Stage 2):** `maintenance_plans` (per model or category: type, interval, checklist, standard), `pm_schedules` (per asset: next due, last done, grace), `test_equipment` (analysers with calibration due dates), `test_records` (measured values against limits, pass/fail), `calibration_records` (as-found/as-left, next due). All with RLS, composite keys and tests.
2. **PM plans and schedules:**
   - Category defaults from the existing `default_pm_interval_months`, overridable per model.
   - Schedules created for existing assets.
3. **PM work orders:** generated before the due date (a button first; a nightly job once hosting is chosen), grouped by department for PM rounds, using the Stage 5 workflow with checklist steps.
4. **Electrical safety tests:**
   - Structured measurements against limits for the chosen standard.
   - Test equipment must be within calibration.
   - **A failed test takes the device out of service and opens a corrective job automatically.**
5. **Acceptance testing** for newly registered devices (Stage 2 rule: no In service without a passed acceptance test).
6. **Calibration records** for devices that need them.
7. **Dashboard:** live PM compliance and tests due, replacing the last fictional figures.
8. **Escalation:** overdue PMs and jobs notify managers, using a scheduled job runner (the decision depends on hosting).
9. **Tests:** schedule maths, generation idempotency, failed-test consequences, test equipment validity, isolation.

Open questions for Stage 6:

- **Testing standard** (decision 10): IEC 62353 (common internationally) or AS/NZS 3551 (Australia), and which electrical-safety limits apply in the pilot country?
- Who reviews a **failed electrical safety test** before the device returns to service? With technician self-sign-off, do failed tests need a second person?
- Default PM intervals per device type, or use the manufacturers' intervals as entered per model?
- Hosting choice (decision 4), so scheduled jobs and photo storage can move off the database.
