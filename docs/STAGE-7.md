# Stage 7 — Maintenance Compliance, Performance Analytics and Equipment Reliability Reporting

BiomedIntel.ai · Smarter Maintenance. Safer Healthcare.

This stage turns the **Reports and Analytics** placeholder into a working module. Every figure comes from records BiomedIntel.ai already holds: assets, work orders, PM due dates, checklist results, safety holds and downtime. Nothing is estimated, forecast or invented, and no AI is involved.

Reports are **read-only**. They never change an asset, a work order, a plan or a safety hold, and they cannot return a device to service.

---

## 1. Pages

| Page              | Address                    | What it shows                                                                                                                            |
| ----------------- | -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Dashboard         | `/reports`                 | 14 headline figures in five groups, each with its definition, basis (right now / in period) and a link to the records behind it.         |
| PM compliance     | `/reports/pm-compliance`   | On-time compliance and completion, monthly trend, breakdown by category, department, hospital, location, plan, asset, month or engineer. |
| Work orders       | `/reports/work-orders`     | Counts, durations (mean and median), completed within target, backlog age, repeat repairs, workload (managers only).                     |
| Reliability       | `/reports/reliability`     | Fault reports per category or model, fault categories, repeat-fault assets, downtime, prolonged downtime, highest-workload assets.       |
| Electrical safety | `/reports/safety`          | Tests performed / passed / failed, devices on hold, returned to service (with both people), overdue safety testing, test history.        |
| Plan governance   | `/reports/governance`      | Assets without an approved plan, models without a manufacturer interval, interval exceptions with approver, approvals and reviews due.   |
| Lifecycle & cost  | `/reports/lifecycle`       | Age, warranty status, replacement review prompts, acquisition cost (financial roles only).                                               |
| Scheduled reports | `/reports/scheduled`       | Weekly or monthly snapshots, recipients, pause / resume, generate now; each snapshot at `/reports/scheduled/<id>`.                       |
| CSV export        | `/reports/export?report=…` | One CSV per report, with the same filters as the screen.                                                                                 |

Stage 6's PM report moved here, so there is **one** calculation of PM compliance. `/maintenance/reports` now redirects to `/reports/pm-compliance`, and the Maintenance tab is called **Compliance report**. The Stage 6 per-due-date CSV is still offered on the compliance page.

The fault category (power/battery, accessory, mechanical, electrical, software, calibration, physical damage, use/operation, environmental, other) is a new optional field when signing off a **corrective** job. It is shown on the work order and used by the reliability report. Older jobs show as **Not classified**, and the report states how many faults are classified.

## 2. Periods, time zones and filters

- **Periods:** this month, last month, this year, last 12 months, or a custom range (at most about 3 years). A period that has not ended counts up to today and says so.
- **Dates are hospital-local.** "In the period" means the record's date in its hospital's time zone. PM due dates are already calendar dates.
- **Durations are calendar time.** No working hours, shifts or public holidays are configured, so none are assumed.
- **Filters:** period, hospital, department, location, equipment category, priority, work order status and (managers only) assigned engineer. Filters are in the URL, so a filtered view can be bookmarked or shared with someone who has the same access.
- Every filter is re-checked on the server. A hospital or department outside the user's access returns **not found**.

## 3. Definitions and formulas

**PM compliance** (single source: `pmComplianceMetrics` in `server/services/pm-schedule.ts`)

- **Due:** PM due dates in the period, up to today. Skipped dates (asset decommissioned/archived) are excluded.
- **On time:** signed off on or before due date + grace days. Recorded at sign-off, against the plan revision in force when the date was scheduled.
- **Late**, **Open/overdue**, **Missed**, **Cancelled**, **Failed to generate:** as named; the last four count as not done.
- **On-time compliance = On time ÷ Due × 100.** **N/A** when nothing was due — never 0 % or 100 %.
- **Completion = (On time + Late) ÷ Due × 100.** Creating a work order never counts as completing maintenance.

**Work orders**

- Completion time: reported → signed off. Time to assignment: reported → first Assigned/Taken event. Assignment to start: first assignment → started. Repair duration: started → signed off (includes time on hold). Time on hold: On hold → next resume/start/sign-off/cancel event.
- Completed within target: signed off by the job's target date (set from priority). Jobs without one are left out.
- Repeat repair: a new fault report on the same asset within 30 days after a corrective job signed off as Repaired.
- Workload by engineer: open jobs now, jobs signed off in the period, time logged, mean completion. **Org Admin and Engineering Manager only**, alphabetical, with a caveat that it is not a performance measure. No individual ranking appears anywhere.

**Reliability**

- **MTBF and MTTR are not calculated.** Operating hours are not recorded, so a true MTBF is not possible. Instead, clearly labelled measures are used:
  - fault reports per asset (reports ÷ assets in the register);
  - mean **calendar** days between fault reports on the same asset — labelled "proxy, not MTBF";
  - mean downtime per event (downtime periods that ended in the period);
  - mean repair duration, start → signed off as Repaired — labelled "not MTTR".
- Downtime overlapping the period is clipped to it; open downtime counts up to now.

**Electrical safety**

- A test performed is a job signed off with an electrical safety result of Pass or Fail.
- The standard and version are those stored on the work order at sign-off (IEC 62353 by default; AS/NZS 3551 where configured).
- Holds are listed by stage. Released holds show the retester **and** the second-person approver.

**Lifecycle and cost**

- Age uses the purchase date, else the commissioning date; otherwise "Unknown".
- Replacement review lists assets whose recorded EOL date, or the model's expected life from acquisition, falls within the chosen window (default 12 months). It is a review prompt, not a decision.
- Cost is **acquisition cost only**, as entered, per currency (never converted or added across currencies), with the share of assets that have a cost. Maintenance, parts and contract costs are not recorded yet, so none are shown.

## 4. Permissions

| Permission            | Roles                                                                      | Allows                                                    |
| --------------------- | -------------------------------------------------------------------------- | --------------------------------------------------------- |
| `analytics.view`      | Org Admin, Eng. Manager, Technician, Inventory Manager, Dept Head, Auditor | All report pages, within the user's hospitals/departments |
| `analytics.workload`  | Org Admin, Eng. Manager                                                    | Per-engineer workload, engineer filter and breakdown      |
| `analytics.export`    | Org Admin, Eng. Manager, Auditor                                           | CSV exports                                               |
| `analytics.financial` | Org Admin, Eng. Manager, Auditor                                           | Acquisition cost (each view audited)                      |
| `reports.schedule`    | Org Admin, Eng. Manager                                                    | Create, pause, resume and generate scheduled reports      |

Fault Reporters have no access to analytics. Engineering Managers and Org Admins still sign in with authenticator-app MFA.

## 5. CSV exports

- Same permission, scope and filters as the screen. Unknown report → 404, missing permission → 403, out-of-scope filter → 404.
- The first lines state the report, organisation, generation time (UTC), period and that times are calendar time in hospital time zones.
- Every cell is protected against spreadsheet formulas (`csvCell`): values starting with `=`, `+`, `-`, `@`, tab or carriage return are prefixed.
- Each export is audited as `analytics.exported` with the filters and row count.
- Export buttons are plain links, so opening a page never triggers an export.

## 6. Scheduled reports

- A schedule has a report (dashboard summary, PM compliance, work orders, reliability or electrical safety), a frequency (weekly Monday–Sunday or calendar month), what it covers (one hospital, or the whole organisation for org-wide staff) and recipients.
- **Recipients** must be active members who may view analytics and cover the whole of what the report covers. This is checked when the schedule is saved **and again at every run**; anyone who has lost access is dropped and the drop is recorded.
- The daily job stores a **read-only snapshot** for the last complete period. `UNIQUE (schedule, period)` means a retried, repeated or concurrent run never creates a second snapshot or a second notification.
- Snapshots are computed with a read-only context limited to the schedule's scope, as an Auditor would see it. They never contain per-engineer workload or cost.
- **Delivery is in-app only.** No email provider is configured, so recipients get a BiomedIntel.ai notification linking to the snapshot. Nothing leaves the application.
- Failures are audited (`report.generation_failed`) without internal details, logged on the server, and retried on the next run.
- Snapshots are append-only (database trigger).

## 7. Running the daily job

```bash
npm run jobs:daily      # PM generation and reminders (Stage 6), then scheduled reports
```

`npm run pm:generate` still runs PM generation alone. The protected endpoint `POST`/`GET /api/cron/pm-generate` (Bearer `CRON_SECRET`) now runs the whole daily job and returns counts for both steps. No new environment variables.

## 8. Database changes

- `20261015150000_analytics`: enums `failure_category`, `report_kind`, `report_frequency`; `work_orders.failure_category`; tables `report_schedules`, `report_snapshots`; indexes on work order created/completed dates and downtime start.
- `20261015150100_analytics_security`: CHECKs (fault category only on corrective jobs; name length; 1–50 recipients; period order); RLS enabled and forced on both tables (snapshots: select and insert only); snapshot append-only trigger; `app_report_organizations()` (SECURITY DEFINER, returns ids only); column-level grants.

Both migrations are additive. No data is changed or deleted.

## 9. Tests

- `tests/unit/analytics-period.test.ts` — periods (month ends, leap years, year change), complete weeks and months, median, percentage with N/A, report links allowed after sign-in.
- `tests/integration/analytics.test.ts` (20) — an isolated fictional organisation with two hospitals in different time zones and exact timestamps. Asserts exact values for PM compliance (including N/A and historical due dates), work order durations and target, reliability and downtime, safety holds and history, governance, lifecycle. Also: read-only behaviour, financial restriction, workload restriction, scope and tenant isolation, CSV formula safety, scheduled-report idempotency, recipient revocation, paused schedules, fault-category validation, and performance (20,000 work orders and 10,000 PM dates, each report under 5 s).
- `tests/e2e/analytics.test.ts` (12, against a running server) — signed-out redirects, page access by role, hidden cost and workload, CSV 403/200/404, cross-tenant 404, Fault Reporter refusal, old address redirect.
- Browser walk-through (33 checks) — dashboard, filters and links, every report, phone width, auditor cost and CSV download, audit events, MFA still required for a manager, schedule creation, generate now twice (one snapshot, one notification), snapshot view, and that reports changed no asset status or safety hold.

## 10. Known limitations

- No operating hours, so no true MTBF/MTTR.
- No working-hours calendar, so all durations are calendar time.
- No maintenance, parts or contract costs yet; cost is acquisition cost only.
- No email delivery for scheduled reports (in-app only); adding a provider needs a cost decision.
- Fault categories exist only for jobs signed off from Stage 7 onward.
- Department-scoped staff cannot receive or create organisation-wide or whole-hospital scheduled reports (by design).
