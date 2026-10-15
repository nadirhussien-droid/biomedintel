# Stage 8 — Equipment Lifecycle, Warranties, Spare Parts Inventory and Supplier Service

BiomedIntel.ai · Smarter Maintenance. Safer Healthcare.

This stage adds four connected things to the existing asset register (Stage 4), work orders (Stage 5), preventive maintenance and safety holds (Stage 6) and reports (Stage 7):

1. **Equipment lifecycle** — a lifecycle section and full history on every asset page.
2. **Warranties and claims** — richer warranty and service contract records, and warranty claims with a recorded status history.
3. **Spare parts inventory** — parts, stores, stock levels kept by an append-only movement log, and parts on work orders.
4. **Suppliers, external service and purchase requests** — a supplier register, supplier work attached to existing work orders, and a controlled purchase request workflow.

Everything seeded is **fictional demonstration data** (suppliers, part numbers, prices, contracts).

Nothing in this stage can return a device to service, mark a device repaired or safe, place an order, send a message outside the app, or spend money.

---

## 1. Using it (who does what)

| Task                                          | Where                              | Who                                                                                                                      |
| --------------------------------------------- | ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| See parts, stock, movements, parts on jobs    | Spare Parts Inventory              | Org Admin, Eng. Manager, Technician, Inventory Manager, Auditor (stores in their hospitals)                              |
| Add or edit parts, stores, reorder levels     | Inventory → Parts / Stores         | Eng. Manager, Inventory Manager                                                                                          |
| Record opening stock, receipts, transfers     | Part page                          | Eng. Manager, Inventory Manager                                                                                          |
| Adjust a count or write off stock             | Part page                          | Eng. Manager; Inventory Manager up to the adjustment limit (default 10 units)                                            |
| Reserve, issue and return parts on a job      | Work order page → Spare parts      | Technician (own jobs only), Eng. Manager, Inventory Manager                                                              |
| See unit costs and stock value                | everywhere                         | Org Admin, Eng. Manager, Inventory Manager, Auditor                                                                      |
| Raise a purchase request                      | Inventory → Purchase requests      | Eng. Manager, Technician, Inventory Manager                                                                              |
| Approve or reject it                          | Request page                       | Eng. Manager or Org Admin — **never the requester**                                                                      |
| Mark it ordered (done outside BiomedIntel.ai) | Request page                       | Eng. Manager, Inventory Manager                                                                                          |
| Supplier register                             | Suppliers and Contracts            | view: Org Admin, Eng. Manager, Technician, Inventory Manager, Auditor · edit: Org Admin, Eng. Manager, Inventory Manager |
| Record external service on a job              | Work order page → External service | Eng. Manager, Org Admin, assigned Technician                                                                             |
| Warranties and contracts                      | Asset page → Warranties            | view: all but Fault Reporters · edit: Org Admin, Eng. Manager, Technician                                                |
| Warranty claims                               | Asset page → Warranties            | Org Admin, Eng. Manager                                                                                                  |
| Lifecycle review, disposal record             | Asset page → Lifecycle             | Org Admin, Eng. Manager                                                                                                  |
| Parts, service and cost report                | Reports → Parts & service          | quantities: analytics roles · costs: Org Admin, Eng. Manager, Auditor                                                    |
| Reminder thresholds, adjustment limit         | Inventory → Settings               | Org Admin, Eng. Manager                                                                                                  |

Fault Reporters see none of these. Engineering Managers and Org Admins still sign in with authenticator-app MFA.

## 2. Equipment lifecycle

- **No second status system.** The asset keeps its one operational status (Stage 4) and its safety hold (Stage 6). The **lifecycle stage** shown is _worked out_ from them, in this order: Decommissioned → Failed Safety Test — Do Not Use → Decommissioning awaiting decision → Under repair → Awaiting assessment (out of service with a fault not yet started) → Temporarily unavailable → Awaiting replacement review → Awaiting commissioning (commissioning date in the future) → In service.
- **New fields:** next lifecycle review date, replacement review status (review due / under review / keep in service / replacement planned), and an optional link to the supplier register (the Stage 4 free-text supplier is kept).
- **Disposal / transfer out** can be recorded once, only after an approved decommissioning, never dated in the future or before decommissioning.
- **History** on the asset page is assembled from records that already exist: status changes, decommissioning, reviews, disposal, warranties and claim status changes, work orders, safety holds and audit entries (including transfers between hospitals or departments). Warranty entries are hidden from roles that may not see warranties.
- Recording a review or a disposal **never changes** whether the device may be used, and the database refuses to move a decommissioned device back to any other status.

## 3. Warranties and claims

- The existing `warranties` table gained: supplier (from the register), reference, **parts covered**, **labour covered**, exclusions, notes, where the document is kept, and a response target (service contracts only).
- Coverage answers are three-way: Yes / No / **Not recorded**. Blank never means "covered".
- **States:** active, expiring (within the largest reminder window), expired, not started — from the recorded dates only.
- Views under Suppliers and Contracts → Warranties: active, expiring, expired, **missing** (assets not decommissioned with no warranty or contract recorded at all), contracts, claims.
- When **reporting a fault** and on a **corrective work order**, the device's warranties are shown "as recorded" to roles that may see warranties, with a reminder that dates inside a warranty period do not mean a repair is covered.
- **Claims:** Draft → Submitted → Accepted / Partly accepted / Rejected, or Withdrawn. Decided claims are final. Each change records who, when and a note; amounts claimed and recovered are financial (hidden from other roles). The database refuses a decided claim without a decision date, or an amount recovered on a rejected claim.

## 4. Spare parts inventory

**Parts** have: internal part number (unique per organisation, printed as a **Code 128 barcode**), name, description, manufacturer and manufacturer part number, compatible models / categories / manufacturers, suppliers (with their part numbers), unit of measure, minimum level, target level, unit cost and currency (optional), lot tracking, expiry tracking, status, created-by and updated-by. Archiving is refused while stock is held.

**Stores** belong to one hospital. Stock is visible and movable only for stores in the user's hospitals.

**How stock is kept:**

- Every change is a **stock movement**: initial stock, receipt, issue to a work order, return from a work order, transfer (a paired out/in), adjustment, write-off.
- Each movement records the part, store, lot, signed quantity, balance after, date and time, person, work order or reference, and reason (required for adjustments and write-offs).
- **Stock levels are written only by a database trigger** from these movements. The app's database role cannot update or delete either table. A mistake is corrected by a new movement, never by editing.
- **Stock can never go below zero** (checked in the service and by a database constraint), and an issue or transfer cannot take stock that is reserved for another job.
- Every stock form carries a **one-time key** (`UNIQUE (organisation, key)`), so a double-click, a retry or two simultaneous submissions are recorded once.

**Definitions:**

- **On hand** = sum of recorded movements (per store and lot).
- **Usable** = on hand in lots that have not expired.
- **Available = usable − active reservations.**
- **Low stock**: available ≤ minimum level. **Out of stock**: available ≤ 0.
- **Suggested reorder** = target level − (available + quantity on order), shown only when a target level is set.
- Issues take the **earliest-expiring usable lot first**; expired lots are never issued.

**Views:** all parts, in stock, low, out of stock, reserved, expiring/expired, archived; stock movements; parts on open work orders. Search, filters, sorting and paging.

**Barcodes:** the Inventory page has a scan / type box. A USB or Bluetooth scanner types the part number and presses Enter; the server looks it up in the organisation's catalogue (internal number first, then manufacturer number) and explains unknown, archived or ambiguous codes. Part labels use the same Code 128 technology as equipment labels. No QR codes; asset IDs are unchanged.

## 5. Parts on work orders

On the work order page, people allowed to act on the job can:

- see parts recorded as fitting the device and their availability per store;
- **reserve** parts, **issue** them (from a reservation or directly), **return** unused parts, and record that a part is **not available** (written to the job timeline);
- see the part history and the recorded parts cost (financial roles only).

Rules:

- Technicians act only on jobs assigned to them; managers and inventory managers on any job in scope; only on open jobs.
- Issuing parts **never** changes the job status or the device status.
- **Cancelling a job releases its reservations but does not return issued parts.** Someone must record the actual return.
- Every action is recorded in the job timeline and the audit log.

## 6. Purchase requests (a controlled request workflow, not procurement)

Draft → Submitted → Approved / Rejected → Ordered → Partially received → Received (or Cancelled).

- Approval by an Engineering Manager or Org Admin who is **not the requester** (service and database CHECK).
- "Ordered" is set by hand after ordering through the hospital's own purchasing process. **BiomedIntel.ai never sends an order or spends money.**
- **Stock increases only when a receipt is recorded**, against an ordered request, never beyond the quantity requested.
- Low-stock parts show a suggested quantity and a "request more" link.

Approval rules, budgets, quotes and invoices remain outside the system.

## 7. Suppliers and external service

- **Supplier register** (organisation-wide): name, types, contact, business email/phone/address, manufacturers supported, parts and service categories, notes, status. Names are unique per organisation; archived, never deleted.
- **Service contracts** are the Stage 4/8 warranty records of type "service contract", linked to the supplier; expiring and expired contracts are listed and reminded.
- **External service** is recorded **on an existing work order** (no second repair system): supplier, supplier reference, description, request / dispatch / expected / completion dates, service report reference, parts supplied, recorded cost (financial roles), status and notes. Dates are validated (no completion in the future or before dispatch).
- **Performance** ("completed by the expected date") is shown only when both an expected date and a completion date are recorded. A closed work order is not taken as evidence that a target was met.
- A supplier completing its part never completes the job or returns the device to service.

## 8. Reports

**Reports → Parts & service** (`/reports/costs`), with a period and hospital filter and CSV export:

- quantities: parts used (issued − returned), stock movements by type, write-offs with reasons, supplier service history, warranty claims by status;
- costs (Org Admin, Engineering Manager, Auditor; every view audited): recorded parts cost, recorded external service cost, write-off value, amounts recovered through claims, maintenance cost by asset (parts + external service), parts cost by work order.

**Cost definitions:** parts cost = units issued minus units returned × the unit cost recorded when issued; external service cost = the cost entered from the supplier's invoice. **In-house labour is not included** (no rates are recorded). Taxes are included only if they were included in the entered figure. **Currencies are never converted or added together.** Parts with no unit cost, and completed supplier work without a cost, are counted and reported as such.

**Reports → Lifecycle & cost** now also lists lifecycle reviews due and decommissioned assets with their disposal status.

## 9. Reminders (in-app only, part of the daily job)

`npm run jobs:daily` (or the existing cron endpoint) now runs: PM generation → scheduled reports → **lifecycle and inventory reminders**:

| Reminder                                                                    | Sent to                                                               |
| --------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| Warranty / service contract ending (default 90, 60, 30 days; configurable)  | Warranty claim roles covering the device                              |
| Low stock, out of stock (once per drop, again only after new stock arrives) | Inventory managers and engineering managers of that hospital          |
| Stock lot expiring (default 60 days) or expired                             | same                                                                  |
| Supplier work past its expected date                                        | the person who recorded it (if still allowed) and work order managers |
| Purchase request awaiting approval for 3+ days                              | approvers of that hospital                                            |
| Lifecycle review due (default 30 days ahead)                                | lifecycle managers covering the device                                |

Each reminder carries a de-duplication key, so retries and repeated runs never send it twice. Reminder text never contains costs. A failure in one organisation is recorded and does not stop the others. Recipients follow roles and scope; per-person recipient lists are not configurable yet.

## 10. Audit events added

`inventory.part_created/updated/archived/restored`, `inventory.store_created/archived/restored`, `inventory.settings_changed`, `stock.initial_recorded/received/transferred/adjusted/written_off/reserved/reservation_released/issued/returned/part_unavailable`, `purchase.created/submitted/approved/rejected/ordered/cancelled`, `supplier.created/updated/archived/restored`, `service.requested/updated/status_changed`, `warranty.updated/archived/claim_created/claim_status_changed`, `lifecycle.review_recorded/disposal_recorded/supplier_linked`, `analytics.financial_viewed` (cost report), `reminders.failed`, and `inventory.access_denied` for refusals.

## 11. Database changes

- `20261015180000_inventory` (additive): 15 new tables — `suppliers`, `supplier_manufacturers`, `warranty_claims`, `warranty_claim_events`, `stock_locations`, `parts`, `part_compatibility`, `part_suppliers`, `stock_levels`, `stock_movements`, `part_reservations`, `purchase_requests`, `purchase_request_lines`, `external_services`, `inventory_settings` — new columns on `assets` (supplier link, lifecycle review date, replacement review) and `warranties` (Stage 8 details), new lifecycle event types and statuses.
- `20261015180100_inventory_security`: CHECK constraints (no negative stock, reason for adjustments, approver ≠ requester, valid claim and service dates, cost/currency pairs, part number format, …); the **stock movement trigger** that keeps stock levels and receipts; append-only triggers on movements and claim history; RLS **enabled and forced** on every new table; column-level grants (the app role cannot change stock levels or movements at all).

Both migrations only add things. No existing rows are changed or deleted.

## 12. Running and testing

```bash
npm run db:test:prepare     # after pulling new migrations
npm test                    # unit + integration tests (uses the TEST database)
npm run build && npm run start
npm run jobs:daily          # PM generation, scheduled reports, then reminders
```

**Try it (fictional seed users, password from your `.env` `SEED_USER_PASSWORD`):**

1. Sign in as **grace.mwangi@coastal.example** (Inventory Manager). Open **Spare Parts Inventory**: BAT-0001, PAD-0001, FLT-0001 (low stock) and SPO2-0001. Type `BAT-0001` in the scan box and press Enter.
2. On the part page, record a receipt of 2. Then raise a purchase request for FLT-0001 and submit it.
3. Sign in as **james.otieno@coastal.example** (Engineering Manager — set up the authenticator app when asked). Approve the request, mark it ordered, then receive it: stock rises only now.
4. Open asset **INF-0001**: see the Lifecycle section and history, the warranty with its recorded coverage; record a review and a claim.
5. Sign in as **amina.warsame@coastal.example** (Technician). Open job **WO-2026-00002**: issue a filter, return one, record external service.
6. Sign in as **fatuma.hassan@coastal.example** (Auditor): **Reports → Parts & service** shows the recorded parts cost in KES.

No new environment variables are needed.

## 13. Tests

- `tests/integration/inventory.test.ts` (38): definitions; parts; receipts recorded once even when submitted twice or concurrently; store scope; lots and expiry; reservations, issues and returns; negative stock refused by the service and the database; concurrent issue of the last units; first-expiry-first-out; cancelled jobs keep issued parts; adjustments, limits and history; views and look-up; purchase requests (second-person approval, receipts only against ordered requests); suppliers and isolation; external service validation and performance rules; warranties, states and claims; lifecycle reviews, disposal and no re-activation; reminders (recipients, no duplicates, no costs); cost reporting and financial restriction; RLS isolation.
- `tests/e2e/inventory.test.ts` (12, against a running server): sign-in redirects, page access by role, hidden unit costs, editor access, cross-organisation supplier/part 404, scanned code isolation, cost CSV 403/200, Fault Reporter refusal.
- Browser walk-through (36 checks): the steps in section 12 end to end, including MFA still required for the manager, refused over-issue, phone layout, audited cost view, and that stock levels equal the sum of movements at the end.

## 14. Known limitations

- **Documents are not uploaded.** Warranty and contract documents are recorded as a reference ("where the document is kept"). Secure document storage fits the Stage 9 knowledge module.
- No labour rates, so no labour cost or total cost of ownership; no depreciation; no currency conversion.
- Purchase requests are records only: no budgets, quotes, supplier e-mail or invoices; approval steps beyond one second-person approval stay outside the system.
- Backorders and negative stock are not allowed (no approved policy).
- Reminders are in-app only and go to roles, not a configurable list of people.
- Supplier service-level targets are recorded on contracts (response hours) but response time is not measured automatically (no "first response" timestamp is recorded).
- Fault Reporters cannot see warranty information when reporting a fault (by design).
