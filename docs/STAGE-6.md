# Stage 6 — Preventive Maintenance Scheduling and Automation

BiomedIntel.ai · Smarter Maintenance. Safer Healthcare.

This stage adds preventive maintenance (PM) to the existing asset register (Stage 4) and work orders (Stage 5). It covers:

- maintenance plans with approved intervals and checklists;
- automatic, duplicate-proof PM work orders and reminders;
- checklist sign-off, with the electrical safety test standard recorded;
- the **"Failed Safety Test — Do Not Use"** hold with second-person approval;
- calendar, list, report and dashboard views;
- MFA follow-ups.

It uses the decisions of 15 Oct 2026:

1. **IEC 62353 by default; standards configurable.** The applicable standard is set by organisation, country, facility and equipment type. The standard and version are stored with each test result.
2. **Independent review before return to service** after a failed safety test.
3. **Interval priority:** requirement → manufacturer → organisation-defined (with justification). Nothing is scheduled without an approved interval.
4. **MFA:** required for Engineering Managers, with secure recovery and full auditing.

Everything shown in the seed is **fictional demonstration data**. That includes the "verified" standard and every checklist limit.

---

## 1. Using it

| Task                                                                  | Where                             | Who                                                              |
| --------------------------------------------------------------------- | --------------------------------- | ---------------------------------------------------------------- |
| See due, upcoming, overdue and past maintenance                       | Maintenance → Schedule / Calendar | Everyone except Fault Reporters (in their hospitals/departments) |
| Write or edit a plan, enrol assets, pause, resume, archive            | Maintenance → Plans               | Engineering Manager, Org Admin                                   |
| **Approve** a plan (procedure, limits, interval) and review intervals | Plan page                         | **Engineering Manager**                                          |
| Record a manufacturer interval for a model                            | Maintenance → Settings            | Engineering Manager, Org Admin                                   |
| Add test standards and rules                                          | Maintenance → Settings            | Engineering Manager, Org Admin                                   |
| **Verify** a test standard                                            | Maintenance → Settings            | **Engineering Manager**                                          |
| Run generation now                                                    | Maintenance → Overview            | Engineering Manager, Org Admin                                   |
| Do and sign off a PM job                                              | Work order page                   | The assigned technician (Stage 5 rule)                           |
| **Approve return to service** after a failed safety test              | Maintenance → Safety holds        | **Engineering Manager who did not do the retest**                |
| Reports                                                               | Maintenance → Reports             | Org Admin, Engineering Manager, Department Head, Auditor         |
| CSV export                                                            | Reports → Export CSV              | Org Admin, Engineering Manager, Auditor                          |

### Creating a plan

1. **Maintenance → Plans → New plan.** Give it a name and type: Preventive maintenance, Electrical safety test, Inspection or Calibration.
2. **What it applies to:**
   - **one asset**;
   - **every asset of one model** (recommended: one manufacturer, one procedure);
   - **every asset in a category** — only for intervals that come from a requirement, because a category mixes makes.
3. **Interval:** weekly, monthly, quarterly, semiannual, annual, or custom (days, weeks or months). Also say **where it comes from**:
   - _Regulatory_ or _Organisational requirement_: name the document and clause.
   - _Manufacturer_: the interval must match the one recorded for the model under Settings.
   - _Organisation-defined_: allowed only if the model has no manufacturer interval, with a written justification of at least 20 characters.
4. **Dates and timing:**
   - **start** and optional **end** date;
   - **lead time**: how many days before the due date the work order is created (default 14);
   - **grace days**: how late still counts as "on time" (default 0).
5. **Work:**
   - **priority**: safety-critical devices are always at least High;
   - estimated minutes;
   - default assignee: used only if they cover the asset's department, otherwise the job waits for a manager;
   - required competency;
   - service-documentation reference and instructions.
6. **Checklist.** Each item has a section: Inspection, Functional test, Cleaning/servicing or **Electrical safety**. Items are Pass/Fail/N/A, or a **measurement** with a unit and optional limits.
7. **Save as draft.** An Engineering Manager reviews and **approves** it with an effective date and a next interval review date. Each approval is a numbered version that cannot be edited afterwards.
8. **Enrol assets.** Choose the matching assets and their **first due date**.

Editing an approved plan changes only its working copy. Work orders keep using the approved version until the change is approved. An approved plan keeps its type and target; create a new plan to change them.

**Needs review** lists:

- equipment without an approved plan;
- plans awaiting approval;
- interval reviews due;
- work orders that could not be created.

## 2. How due dates are calculated

- Due dates are **calendar dates in the hospital's time zone**. They are stored as PostgreSQL `DATE`s, so UTC conversion can never shift them by a day. "Today" is worked out per hospital.
- Date _n_ of a schedule = **first due date + n × interval**, always counted from the first due date, so dates never drift.
- Month steps keep the day of the month and clamp to the end of shorter months:
  - 31 Jan monthly → 28 Feb (29 in leap years), 31 Mar, 30 Apr, …
  - 29 Feb yearly → 28 Feb in ordinary years.
- **Overdue** = the due date has passed and the work is not signed off.
- **On time** = signed off on or before the due date plus grace days.
- The work order's target time is the end of the due day, hospital time.
- **Paused plan:** nothing is generated. On resume, each asset continues from its next due date on or after today. Dates that fell during the pause are not created or counted; the pause is in the audit log.
- **New interval approved:** each asset's series restarts from its current next due date.
- **Plan end date reached:** the schedule ends.
- **Asset archived or decommissioned:** the next date is recorded as _Skipped_ with the reason, and the schedule ends. Decommissioning also ends schedules immediately.

## 3. How automatic generation works

One run looks at every active schedule of every active, approved plan. **Each schedule is handled in its own database transaction:**

1. Lock the schedule row (`SELECT … FOR UPDATE`).
2. Re-read the schedule, plan, approved version and asset.
3. If the next due date is not yet within the lead time, stop.
4. **Catch-up.** If several due dates have already passed (for example the scheduler was not running), the older ones are recorded as **Missed** and one work order is created for the latest.
5. Find the test standard if the checklist has electrical safety items. If none applies, or it is not verified, this is a **failure** with a clear reason.
6. Record the **occurrence**.
7. Create the work order with the **same Stage 5 code** used for fault reports: same numbering, timeline, audit and assignment. The work order stores:
   - the checklist copy;
   - the plan version;
   - the standard code and version;
   - a link to the occurrence.
8. **Only then** advance the schedule to its next due date.
9. Audit the run and notify the assignee (or the managers if there is no assignee).

At most one new work order per schedule per run.

After the schedules, the run sends **reminders** for open PM jobs:

- upcoming (within 7 days);
- due today;
- overdue (the managers are told too).

Each reminder goes **once per due date and person**.

### Duplicate prevention and retries

- The database refuses a second occurrence for the same schedule and due date (`UNIQUE (schedule_id, due_on)`), and a second work order for the same occurrence (`UNIQUE (organization_id, pm_occurrence_id)`).
- The row lock makes a second run at the same moment wait, then see that the schedule has already moved on. If a unique constraint ever fires, it is treated as "already done", not as a failure.
- **If anything fails**, the whole transaction rolls back, so the schedule is **not** advanced. In a separate transaction the failure is then:
  - recorded on the occurrence (_Generation failed_, attempt count, a short message);
  - audited (`pm.generation_failed`);
  - reported to managers once.

  The next run retries the same due date. Failures are never silently skipped.

- Reminders use a de-duplication key (`UNIQUE (organization_id, user_id, dedupe_key)`).
- Tests cover running twice, three concurrent runs, a simulated database outage followed by recovery, and an unverified standard.

## 4. Running the scheduler

There is no background job service in this project, so nothing paid was added. Generation is one function with three ways to start it:

| How                                                                              | When to use                                                                                                                                                                 |
| -------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Run generation now** (Maintenance overview)                                    | A manager wants it now. Covers that manager's hospitals only.                                                                                                               |
| `npm run pm:generate`                                                            | Development, or a server's own cron. Covers every organisation. Uses the restricted app database role, so RLS applies. Prints counts only. Exit code 2 if something failed. |
| `POST` or `GET /api/cron/pm-generate` with `Authorization: Bearer <CRON_SECRET>` | A hosting scheduler (for example Vercel Cron, GitHub Actions or a cloud scheduler). Off unless `CRON_SECRET` is set. A wrong secret gets 401 and is audited.                |

**Development:** after `npm run db:seed`, run `npm run pm:generate`.

**Production (choose one), once a day, early morning East Africa time:**

```bash
# Linux server cron (crontab -e): every day at 03:15 UTC (06:15 in Nairobi)
15 3 * * * cd /srv/biomedintel && /usr/bin/npm run pm:generate >> /var/log/biomedintel-pm.log 2>&1
```

```bash
# Any scheduler that can call a URL:
curl -fsS -X POST -H "Authorization: Bearer $CRON_SECRET" https://YOUR-DOMAIN/api/cron/pm-generate
```

Running more often is harmless: extra runs simply find nothing new.

**Remaining manual setup:** choose the hosting, set `CRON_SECRET`, and create the daily job. Until then, PM work orders appear only when someone runs generation.

## 5. Checklists and sign-off

- A PM job shows its plan, due date, test standard, instructions and checklist.
- The assigned technician answers **every item**: Pass, Fail or Not applicable, plus the value for measurements.
- The server refuses:
  - a missing answer;
  - a measurement outside its limits recorded as Pass;
  - a Fail without a description;
  - an N/A on a required item without a reason.
- The overall result is **worked out from the answers**: _Checks passed_ or _Checks failed_. The functional and electrical-safety summaries are also derived.
- Answers are stored as `checklist_results` rows (append-only). Electrical safety results carry the **standard code and version**. A reopened job records a new attempt and keeps the old answers.
- **Signing off a passed PM never changes the device status by itself.**
- **A failed non-safety check** takes the device out of use and creates a repair job through the normal Stage 5 workflow.
- **The printed job sheet** includes the checklist with tick boxes, for paper rounds. The results must then be entered by the technician who did the work.

## 6. Failed Safety Test — Do Not Use

If an electrical safety item fails:

1. A **safety hold** is placed. The device is set **Out of service**, downtime starts, and a red **"Failed Safety Test — Do Not Use"** banner appears on the asset, work order and hold pages.
2. A linked **urgent repair job** is created. It cannot be cancelled; if the device cannot be fixed, sign it off as _Not repairable_.
3. When the repair is signed off, a **retest job** (electrical safety test) is created. The device stays out of service.
4. When the retest passes, the hold waits for **approval by an Engineering Manager who did not do the retest**. They record a review note and a declaration. Rejecting creates a new repair job.
5. Approval returns the device to service (unless another open job keeps it out) and ends downtime.

Both people, all timestamps, the results and every decision are recorded in the hold history (append-only) and the audit log.

**The software never returns a held device to service automatically.** Three layers stop it:

- the sign-off logic;
- the asset screens;
- a database trigger that refuses "In service" while a hold is open.

**Exceptions are not available.** If your policy allows formally authorised exceptions, that process must be designed and approved first.

## 7. Test standards

- **Seeded:** IEC 62353 (Ed. 2.0, 2014) as the organisation default, and AS/NZS 3551 (2012) for Australia and New Zealand. Coastal's IEC 62353 entry is "verified" by the fictional Engineering Manager; Highland's is not verified, so its plan stays a draft.
- **Rules, most specific first:** hospital + category, hospital, country + category, country, category, organisation default. A hospital's country falls back to the organisation's country.
- A plan with electrical safety items can only be approved when a verified standard is in use. Generation fails, with an explanation, if none applies to a particular asset.
- **No standard is assumed to be legally correct everywhere.** Qualified biomedical engineering staff must confirm the standard, edition and limits for each jurisdiction.

## 8. Reports and dashboard

**Maintenance → Reports** shows a period (default: this month to today), optionally one hospital, broken down by category, department, hospital, location or assigned engineer.

| Metric             | Definition                                                                                                                              |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------- |
| Due                | Due dates in the period, up to today (hospital date), excluding skipped ones, including next due dates that passed without a work order |
| On time            | Signed off on or before due date + grace days                                                                                           |
| Late               | Signed off after that                                                                                                                   |
| Open / overdue     | Due date arrived, not signed off                                                                                                        |
| Missed             | Due date passed before a work order existed (catch-up)                                                                                  |
| Cancelled          | PM job cancelled (counts as not done)                                                                                                   |
| Failed to generate | Work order not yet created because of a failure                                                                                         |
| **Compliance**     | On time ÷ Due                                                                                                                           |
| **Completion**     | (On time + Late) ÷ Due                                                                                                                  |

A generated work order never counts as done. The figures are operational records, not a certification of regulatory compliance. The CSV export lists every due date in the period, with the same scope and permissions, and every export is audited.

The **main dashboard** now shows live figures (the demo numbers are gone):

- PM compliance this month;
- PM overdue and due today;
- safety tests due in the next 30 days (items with electrical safety checks, including overdue);
- open Failed Safety Test holds;
- generation failures.

## 9. Barcodes

- No new identifiers: the barcode is still the Stage 4 asset ID (Code 128).
- **Scan barcode** on the Maintenance pages opens `/assets/scan?then=pm`. A handheld scanner (keyboard input), the camera, or typing the asset ID all work. You land on the asset's **Preventive maintenance** section, which shows its schedules, next due date, last done and recent due dates, with links to the plans and work orders.
- Unknown or out-of-scope codes show the Stage 4 "not found" message, and the attempt is audited.
- The Schedule search box also accepts a scanned asset ID.

## 10. MFA (decision 4)

- **Required** at every sign-in for Engineering Managers, Org Admins and platform admins (unchanged). **Encouraged** for everyone else with a banner.
- "Trust this device" is refused.
- Better Auth stores the authenticator secret and backup codes **encrypted** at rest. A test reads the database and checks that neither appears in plain text, and that no audit record contains a code or the secret.
- **Recovery:**
  - sign in with a backup code (audited as recovery);
  - create new backup codes on Account security (password needed);
  - if both are lost, an Org Admin uses **Reset** on the admin member list, after confirming the person's identity outside the app. The reason is recorded, the person is signed out everywhere and must set up a new authenticator. Admins cannot reset themselves.
- **New audit events:** enrolment completed, code accepted, code refused (no code logged), backup code used, backup codes regenerated, password changed, password reset, and MFA reset by admin.

## 11. Database changes

**Two migrations**, both additive (nothing dropped, existing records preserved):

- `20261015120000_preventive_maintenance`, generated from `schema.prisma`:
  - **New tables:** `maintenance_plans`, `maintenance_plan_revisions`, `pm_schedules`, `pm_occurrences`, `pm_generation_runs`, `checklist_results`, `test_standards`, `test_standard_rules`, `safety_holds`, `safety_hold_events`.
  - **New columns:**
    - manufacturer PM interval and reference on `equipment_models`;
    - optional `country` on `hospitals`;
    - PM links, checklist copy, standard snapshot and hold link on `work_orders`;
    - `dedupe_key` on `notifications`.
  - **New outcomes:** _Checks passed_ and _Checks failed_.
- `20261015120100_preventive_maintenance_security`, hand-written. It contains:
  - the business-rule CHECKs;
  - the one-live-schedule-per-asset-and-type index;
  - the hold trigger and the second-person CHECK;
  - RLS policies, append-only triggers and grants;
  - the scheduler helper function.

  It also widens the work-order description limit to 4,000 characters for planned jobs; the fault form still allows 2,000.

Apply with `npm run db:deploy` (any environment) or `npm run db:migrate` (development). Then run `npm run db:test:prepare` before `npm test`. Prisma has no automatic "down" migrations. To reverse Stage 6 on a development database, restore a backup taken before migrating, or reset (`npm run db:reset`). Never reverse it on a database that holds real records.

## 12. Environment variables

| Variable      | Needed   | What                                                                                                                |
| ------------- | -------- | ------------------------------------------------------------------------------------------------------------------- |
| `CRON_SECRET` | Optional | 32+ random characters (`openssl rand -base64 32`). Switches on `/api/cron/pm-generate`. Leave empty to keep it off. |

There are no other new variables. Never commit `.env`.

## 13. Known limitations

- **Scheduling needs deployment setup:** a daily cron job or scheduler (section 4).
- **Reminders are in-app only.** Email or SMS needs an approved provider.
- **Calendar projections** show later due dates from the current interval. They are estimates until the work order exists.
- **One work order per schedule per run.** With a lead time longer than the interval (for example weekly checks with a 14-day lead), the next one is created on the next daily run.
- **Pausing skips dates.** Dates during a pause are not created or counted. If your compliance policy needs them counted as missed, that is a policy change.
- **Exceptions to the safety hold** are not built (by design, pending a policy).
- **Calibration certificates** (traceable references, uncertainty) are not modelled. _Calibration_ is available as a plan type with checklist measurements only.
- **Test analyser data** cannot be imported; results are typed in.
- **Seed limits and "verification" are fictional.**
