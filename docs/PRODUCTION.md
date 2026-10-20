# Stage 12 — Production launch readiness

BiomedIntel.ai — _Smarter Maintenance. Safer Healthcare._

**Decision on 20 Oct 2026: NO-GO. BiomedIntel.ai is not deployed to production, and no production environment exists.**

The go/no-go review found 7 of 27 checks met, 6 partly met and 14 not met. The reasons:

- The Stage 11 pilot has not been run.
- There is no staging environment yet (set-up in progress, `docs/DEPLOYMENT.md`).
- There is no customer, hospital sponsor, security and privacy review or launch approval.
- No production owners, alerting, backup retention, recovery targets or data-residency decision exist.

The software itself has no known Critical or High defect. Commit `456b3b6` passed 370 unit and integration tests, 86 HTTP tests and 48 of 48 browser checks on a local copy with fictional data.

The full assessment and the prepared, unexecuted plans are in the shared document **BiomedIntel.ai Production Readiness**. It covers:

- the go/no-go checklist and the ordered path to "go";
- the hosting choice (Render, or AWS if a customer's data residency requires it; regions verified 20 Oct 2026);
- the launch procedure, steps A–J, with a deployment record;
- stop and rollback rules;
- the backup and disaster-recovery plan (RPO and RTO left for stakeholders to agree);
- monitoring and alerts, and ownership (every production role unassigned);
- customer onboarding;
- costs from verified prices, and the continuous-improvement schedule.

## Rules for any future production release

- Deploy only after every go/no-go check is met and the launch owner and customer sponsor have authorised it in writing.
- `PILOT_DATA_ALLOWED` must never be set in production. No fictional organisations, test accounts or placeholder secrets.
- Migrations only add; `npm run db:predeploy` refuses unreviewed destructive ones. The database is **never rolled back automatically**. A code rollback (Render "Rollback") does not touch the database. If older code cannot run against the new schema, use a forward fix or a point-in-time restore to a new database, with any data loss written down and approved (`docs/OPERATIONS.md` §7.2).
- Zero downtime is not claimed: one web service, with migrations applied before the new version starts.
- Equipment data import is **not built**. A bulk import needs an approved data mapping and its own tested feature: preview, validation, duplicate-ID checks, confirmation, logs, reconciliation and reversal.
