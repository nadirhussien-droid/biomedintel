# BiomedIntel.ai — Stage 4 report

Stage 4: Equipment Asset Register and **Barcode** Management.
Built 14–15 October 2026 on the Stage 3 foundation, following the Stage 2 blueprint (section 4, Equipment tables) and the **Barcode Standard and Stage 4/5 amendments** of 15 October 2026, which replace QR codes with Code 128 barcodes.

## Prerequisites confirmed before coding

| Prerequisite                             | Status                                                                                                                            |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Stage 3 project, database and migrations | Present (commit `2e0d409`). Re-checked: typecheck clean, 65/65 tests passing                                                      |
| Approved Stage 2 equipment schema        | Located (blueprint section 4: manufacturers, categories, models, locations, assets, status history, warranties, lifecycle events) |
| Authentication, roles, RLS, audit        | Better Auth, permission table, `withTenant()` RLS context, append-only audit log — reused unchanged                               |

No technology was changed and no second ORM, auth system or permission system was added. New runtime libraries:

- `bwip-js` 4.11.4 generates Code 128 barcodes on the server.
- `@zxing/browser` 0.2.1 and `@zxing/library` 0.23.0 provide optional camera decoding in the browser.

`qrcode` 1.5.4 remains only for the Stage 3 authenticator-app (MFA) setup screen, which is unrelated to equipment.

## QR → barcode change (15 October 2026)

The first Stage 4 build (commit `8da44c6`) used QR codes. Nadir then asked for barcodes: barcode only, holding the asset ID. The migration was carried out as follows:

- **Database:** migration `20261015000000_barcode_labels` drops the random `qr_token` and `qr_token_issued_at` columns and the `app_resolve_asset_qr` function. It adds an index for inventory-number look-ups. No asset record, asset ID, permission, scope rule or audit row is removed; old `asset.qr_*` audit rows stay as history.
- **Identifier:** the existing per-organisation asset ID (`asset_tag`, e.g. `INF-0412`) is the barcode value. No second identifier was introduced, as the amendment requires. The example format `BMI-000123` works too, but organisations keep their own numbering.
- **Removed:** QR generation, QR labels, the QR scanner, the `/a/<token>` link route, QR re-issue (and its permission), and the `APP_URL` setting (only QR codes used it).
- **Nothing real affected:** the QR build was never deployed and only fictional demo data used it.

## Decisions applied

| Topic                                          | Applied                                                                                                                                                                                                                                                                                                        |
| ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Statuses                                       | Stage 2 values kept: In service, Under repair (shown as "Under repair / maintenance"), Out of service, Decommissioned. "Archived" is the separate `archived_at` flag, as in Stage 2. No new status values                                                                                                      |
| New asset fields (Stage 4 asks; Stage 2 lacks) | `name`, `inventory_number` (unique per hospital), `description`, `supplier`, `purchase_currency`, plus audit columns (`created_by`, `updated_by`, `archived_by`). All additive                                                                                                                                 |
| Risk                                           | Stage 2 `risk_class` as High / Medium / Low — an organisation's maintenance risk rating, explicitly **not** a regulatory device class                                                                                                                                                                          |
| Serial numbers                                 | Not unique. A repeated serial for the same model in the same organisation needs explicit confirmation (Stage 2: "warns on duplicates")                                                                                                                                                                         |
| Asset IDs                                      | Unique per organisation, never reused (archived assets keep theirs)                                                                                                                                                                                                                                            |
| Decision 8 — who registers assets              | **Technicians may register assets** (approved 14 Oct 2026). Org Admins and Engineering Managers too                                                                                                                                                                                                            |
| Decision 8 — decommissioning                   | Request by Technician / Manager / Org Admin. **Approval by the NUM** (Department Head of that department). **If the department has no NUM:** the hospital's Biomedical Engineering Manager or the Facility Manager (a Department Head covering the whole hospital). Never the requester (approved 14 Oct 2026) |
| Fault Reporters                                | Can view assets in their own scope (needed for the Stage 5 scan-to-report flow); cannot change anything                                                                                                                                                                                                        |
| Purchase cost                                  | Visible to Org Admin, Engineering Manager, Auditor; editable by Org Admin and Engineering Manager only                                                                                                                                                                                                         |
| Labels and scanning                            | **Code 128 barcode of the asset ID** (decision of 15 Oct 2026, barcode only). Look-up inside the signed-in app by handheld scanner, camera or typing; also accepts the hospital inventory number for existing hospital labels                                                                                  |

## Database (4 new migrations)

1. `20261014230000_equipment` (generated from `schema.prisma`): `locations`, `manufacturers`, `equipment_categories`, `equipment_models`, `assets`, `asset_status_history`, `warranties`, with composite foreign keys `(organization_id, …)`, `unique (org, asset_tag)`, `unique qr_token`, `unique (org, hospital, inventory_number)`, and indexes for the register's filters.
2. `20261014230100_equipment_security` (hand-written): case-insensitive unique names, format/date/money CHECK constraints, RLS enabled and forced on every table, append-only status history, the `app_resolve_asset_qr` lookup function, and grants (no DELETE; organisation and creator columns not updatable).
3. `20261014233000_decommission_approval`: Stage 2 `lifecycle_events` for decommission requests, one pending request per asset, the "requester never decides" CHECK, RLS and grants.
4. `20261015000000_barcode_labels`: removes the QR code columns and function (see above) and adds an inventory-number index.

No Stage 3 table or row was changed. Migrations 1 and 2 still create the QR columns and function that migration 4 removes; applied migrations are never edited, so the history shows the change honestly.

## Implemented

- **Register** (`/assets`):
  - Server-side search (asset ID, name, manufacturer, model, serial, inventory number).
  - Filters: hospital, department, category, manufacturer, status, risk, archived.
  - Sorting (allow-listed fields), 25 per page.
  - Empty, loading and error states. The header's hospital/department choice is the default filter.
- **Register asset** (`/assets/new`):
  - Validated on the server; scope-checked; status history and audit events (including `asset.barcode_issued`) written.
  - Values are kept after a failed save; duplicate-serial confirmation.
- **Asset page** (`/assets/<id>`):
  - Identity, model, location, status, risk, dates, supplier, cost (permitted roles only), registered/updated timestamps and people, and the Code 128 barcode with the asset ID printed under it.
  - Quick status/room update, status history, warranties and service contracts (add), decommissioning request and approval, archive/restore, and the audit trail (admins, managers, auditors).
  - Clearly labelled placeholders for work orders, service history, PM, calibration and safety tests, spare parts, documents and IntellAssist.
- **Edit** (`/assets/<id>/edit`): the same validation and scope checks, field-level cost rule, and optimistic locking. Archived and decommissioned assets are read-only. Changing the asset ID records `asset.barcode_replaced` and tells the user to reprint the label.
- **Equipment catalog** (`/assets/catalog`): manufacturers, categories (default risk and PM interval), models (expected life), and rooms per department.
- **Barcodes:** Code 128 of the asset ID, drawn as SVG bars on the server (crisp at any print size), with white quiet zones of 10 modules on each side.
- **Scan page** (`/assets/scan`):
  - **Handheld USB/Bluetooth scanners** (keyboard wedge): the input is focused on arrival, so a scan plus Enter opens the asset with no clicks.
  - **Camera** (optional): starts only on tap and decodes Code 128 and Code 39 in the browser.
  - **Typing** the asset ID or inventory number.
  - All scanned text is treated as untrusted. The server finds the asset only in the current organisation and only within the user's scope, and the browser only ever opens `/assets/<id>`.
- **Register search** also finds an asset by its barcode value, so a handheld scanner works there too.
- **Labels** (`/assets/labels`):
  - Single or batch (tick assets in the register, up to 100).
  - A4 24-up (63.5 × 33.9 mm) or 62 × 29 mm label-printer formats.
  - Each label: BiomedIntel.ai mark, equipment name, optional hospital/department, full-width Code 128 barcode (59.5 × 12 mm or 58 × 11 mm), and the asset ID in large text.
  - A warning appears for asset IDs too long for reliable bars on the chosen size. The app shell is hidden when printing.
- **CSV export** (`/assets/export`): same scope and filters, capped at 5,000 rows, formula-injection safe, audited.
- **Dashboard:** live equipment counts replace the fictional equipment figure (other demo figures remain labelled as fictional).
- **Navigation:** "Equipment Assets" is no longer marked "Soon".
- **Seed:** fictional demonstration equipment for both organisations (see README).

## Not built in Stage 4 (by design or deferred)

- **Acceptance-test rule:** Stage 2 says an asset cannot be "in service" without a passed acceptance test. This needs the testing module (Stage 6).
- **Open work orders blocking decommissioning:** Stage 2 rule, added with work orders (Stage 5).
- **Spreadsheet import** of an existing equipment list (Stage 2 milestone). Not requested in the Stage 4 brief; recommended early in Stage 5 or as a short Stage 4.1.
- **Editing or archiving catalog entries**, and editing or removing warranties (they can only be added).
- **Attachments, manufacturer documents and photos** (Stage 8: IntellKnowledge).
- **Custodian person per asset** (department is the responsible owner for now). **Parent/child categories** have a column but no screen.
- **Notifications** (e.g. telling the NUM a request is waiting), warranty expiry alerts and EOL flags (lifecycle stage).
- **Reversing a decommission:** not allowed in Stage 4.

Security limitations: see [SECURITY.md](SECURITY.md), items 1–15.

## Test and build results

| Check                | Command                                                                                         | Result                                                                                                      |
| -------------------- | ----------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Type check           | `npm run typecheck`                                                                             | Passed, 0 errors                                                                                            |
| Lint                 | `npm run lint`                                                                                  | Passed, 0 errors, 0 warnings                                                                                |
| Formatting           | `npx prettier --check .`                                                                        | Passed                                                                                                      |
| Automated tests      | `npm test`                                                                                      | **148 passed**, 0 failed (8 files: 65 from Stage 3 + 83 new); the 2 HTTP files are skipped without a server |
| HTTP tests           | `E2E_BASE_URL=… E2E_PASSWORD=… npm test -- tests/e2e` against `next start` on the test database | **24 passed**, 0 failed (13 Stage 3 + 11 Stage 4)                                                           |
| Production build     | `npm run build`                                                                                 | Passed (28 routes)                                                                                          |
| Browser walk-through | Headless Chromium with a simulated camera and a simulated handheld scanner                      | **14 checks passed**, no console errors (grouped below)                                                     |
| Printed labels       | Labels printed to PDF, rendered at 300 dpi, decoded with ZXing                                  | **12 of 12 barcodes decoded** to the right asset ID (6 on an A4 sheet, 6 label-printer labels)              |
| Mutation check       | RLS switched off on `assets` in the test database                                               | 10 isolation tests failed as expected; RLS restored, all 148 pass again                                     |

Run on 15 October 2026 against PostgreSQL 16, the production build (`next start`) and the test database, after the barcode change.

Browser walk-through (headless Chromium; simulated camera showing a printed Code 128 label; simulated keyboard-wedge scanner):

1. Technician dashboard shows live equipment counts.
2. Register search finds the ventilator; empty state shown for no matches.
3. A future purchase date is rejected and the typed values are kept.
4. A new asset is registered after confirming a duplicate serial; its barcode is shown (no QR code anywhere); no purchase cost is visible to the technician.
5. Quick status change saved.
6. Decommissioning requested with a visible confirmation.
7. Batch labels render, and the app shell is hidden when printing.
8. **Camera scan** of a printed Code 128 label opened INF-0101.
9. **Handheld scanner:** typing `INF-0101` + Enter on arrival (exactly what a keyboard-wedge scanner does) opened the asset with no clicks.
10. Manual entry: an out-of-scope ID is refused, a web link is refused (no navigation), and a typed ID opens the asset.
11. 390 px phone width: no horizontal scrolling on the register, scan or asset pages.
12. The NUM (Peter Kamau) approves; the asset becomes Decommissioned and read-only.
13. Signed-out visit to an asset page → sign-in page only (no asset details) → lands on the asset after sign-in.

Labels were also printed to PDF:

- **A4 sheet:** 1 page, A4, 3 × 2 labels in exact 63.5 mm columns.
- **Label printer:** 6 pages of 62 × 29 mm for 6 labels.
- All 12 barcodes **decoded** with ZXing from 300 dpi renderings. Each contained only its asset ID.

### Problems found during verification and fixed

- After approving, rejecting or withdrawing a decommissioning request, and after archiving, restoring or requesting, the success message disappeared with its form (the form is replaced once the action succeeds). These actions now reopen the asset page with a confirmation banner.
- On the A4 sheet the label columns stretched to the page width instead of 63.5 mm, which would drift off real label sheets. They are now fixed to 63.5 × 33.9 mm.
- The label-printer format added a blank label after the last one. Fixed.
- After the barcode change, one new test renamed a shared demo asset that a later test relied on. The test now creates its own asset.

New tests in Stage 4:

- `tests/integration/assets-db.test.ts` (16): RLS forced on all 8 tables, no DELETE, per-organisation IDs, malformed asset IDs rejected by the database, date/cost checks, composite keys, append-only history, "requester never decides", no-context denial, cross-tenant read/update/insert, QR columns/function removed, a shared asset ID resolving only within the organisation, and pooled-connection reuse including a failed transaction.
- `tests/integration/assets-authz.test.ts` (52):
  - Create/edit/archive per role.
  - Scope (hospital and department) and smuggled organisation ids.
  - Validation: required fields, real dates, future dates, unsupported statuses.
  - Uniqueness, the serial warning and inventory numbers.
  - Field-level cost rule, optimistic locking and escalation attempts.
  - Search, filter, sort and paging isolation, and export isolation and CSV injection.
  - Direct-id guessing and fault-reporter scope.
  - Barcode look-up: in scope, out of scope, malformed and link-like values, cross-tenant, a person in two organisations, inventory-number labels, duplicate barcode values, and `asset.barcode_issued` / `asset.barcode_replaced` audit events.
  - Labels.
  - The full NUM / manager / facility-manager approval rule.
  - Catalog uniqueness and scope.
- `tests/unit/barcode.test.ts` (15):
  - Real ZXing decodes of generated barcodes for several asset-ID shapes, including at a small size.
  - Stability, quiet zones, payload contents, invalid values refused, bar width per label size, and SVG rendering.
  - Untrusted-input parsing (links, `javascript:`, control characters), the safe-redirect allow-list, CSV cells and query fallbacks.
- `tests/e2e/assets.test.ts` (11, HTTP):
  - Signed-out asset page → sign-in only, `next` restricted, retired `/a/` route remembers nothing.
  - Camera policy.
  - Asset page shows the Code 128 barcode and no QR code; `/a/` returns 404; the scan page is ready for a handheld scanner.
  - A guessed id returns 404; search by barcode value and search isolation; label output; export refusal.

### Not run, and why

- **Prisma CLI migrations** (`migrate dev/deploy/reset`): still blocked in the build environment (engine download). The migrations were generated and applied with Prisma's official WebAssembly build of the same engine version, as in Stage 3. Please run `npm run db:deploy` and `npm run db:test:prepare` once on your computer.
- **Real scanners, phones and printers:** no physical device was available.
  - The camera was tested with a simulated camera showing a printed label, and the handheld scanner by simulating its keystrokes.
  - Printed barcodes were checked by decoding the PDFs in software.
  - **Operational compatibility is therefore not yet confirmed.** Please print a test sheet and scan it with your actual handheld scanners, label printer and phones (README → Printing labels) before labelling real equipment.
- **Docker Compose:** not available in the build environment (unchanged from Stage 3).

## Git commit checklist

Before every commit:

- [ ] `git status` shows no `.env` file (only `.env.example`).
- [ ] No passwords, secrets, tokens, real names, real hospitals or patient data in the diff (`git diff --staged`).
- [ ] `npm run check` passes (typecheck, lint, tests, build).
- [ ] Schema changes come with a NEW migration; applied migrations are never edited.
- [ ] Every new tenant table has `organization_id`, RLS enabled and forced, grants without DELETE, composite foreign keys, and an isolation test.
- [ ] Every new service function calls `requirePermission()` first and checks hospital/department scope.
- [ ] Asset changes write an audit event with field names, not record copies.
- [ ] Demo data is clearly fictional ("(demo)", `DEMO-` serials).
- [ ] Commit message says what changed and why; push to a branch and open a pull request.

## Proposed Stage 5: Work Order Management

1. **Schema (Stage 2):** `work_orders` (number `WO-2026-00143` per organisation, asset, hospital/department, type corrective/PM, priority, status), `work_order_events`, `attachments` (photos), `downtime_events`. All with RLS, composite keys and tests.
2. **Fault reporting from a barcode scan:**
   - "Report a fault" on the asset page, and straight after scanning a barcode (handheld scanner, camera or typed asset ID), for Fault Reporters, Department Heads and engineering staff.
   - Uses the Stage 4 look-up (`findAssetByCode`); there is no second barcode registry. The server re-checks that the asset, organisation, hospital and department match.
   - Takes a description (with a no-patient-data warning), photos and an "out of use" flag. The flag sets the asset Out of service and starts downtime.
   - Assets can also be chosen by searching their asset ID.
3. **Triage and assignment:** an Engineering Manager queue; priority suggested from risk category (decision 9 list); duplicate-open-job warning; assign to a technician in scope.
4. **Technician workflow:** accept, start, record findings and actions, parts placeholder (inventory arrives in Stage 7), and submit for sign-off.
5. **Sign-off:** Manager approval (decision 8); the technician who did the job can never approve it; the asset returns to service with status history.
6. **Rules carried over from Stage 4:** open work orders block decommissioning; "Work orders" and "service history" on the asset page become real.
7. **Asset ID on work orders:** shown on work order details and on the printable job sheet (as text and Code 128 barcode, so a technician can scan it at the device). Opening the asset from a work order uses the same access checks.
8. **Notifications (in-app first):** new fault, assignment, waiting for sign-off, and decommissioning requests waiting for a NUM.
9. **Optional quick win:** spreadsheet import of an existing equipment list (validation preview, audited).
10. **Tests:** barcode-based work order creation (in scope, out of scope, cross-tenant, unknown and malformed barcodes), cross-tenant and cross-scope work orders, reporter visibility, self-approval block, status and downtime consistency, and photo type/size limits.

Open questions for Stage 5:

- Can Engineers peer-verify low-risk jobs (decision 8, sign-off part)?
- The starting safety-critical list (decision 9).
- The photo size limit and storage location (decision 4: hosting and region).
