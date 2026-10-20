# Running BiomedIntel.ai: environments, monitoring, backups and incidents

BiomedIntel.ai — _Smarter Maintenance. Safer Healthcare._

This guide covers what has to be in place **before** a hosted copy is trusted with a pilot, and what to do when something goes wrong. Section 1 tells you what each statement is based on. Where something has not been set up or tested, it says so.

---

## 1. What is verified and what is not

| Topic                                                                 | Status (20 Oct 2026)                                                                                                                       |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Health checks, structured logs, refusal to start with unsafe settings | Built and tested in this workspace                                                                                                         |
| Backup script and restore drill                                       | Built and run here: 68 tables / 261,285 synthetic rows backed up and restored with identical counts in 6.3 s                               |
| First-run on a database set up like a managed host                    | Rehearsed locally (owner without superuser or bypass rights), with no `.env` file                                                          |
| Render's own backups (point-in-time recovery, exports)                | **Not tested.** No Render account exists yet. Described from Render's documentation (render.com/docs/postgresql-backups, read 20 Oct 2026) |
| Alerts (email/SMS to a person when something fails)                   | **Not set up.** Needs a hosted environment and a decision on who is alerted                                                                |
| Staging and production environments                                   | **Do not exist yet.** `render.yaml` describes staging only                                                                                 |

---

## 2. The four environments

| Environment           | Where                                        | Database                                                    | Data                                             | Who                                   |
| --------------------- | -------------------------------------------- | ----------------------------------------------------------- | ------------------------------------------------ | ------------------------------------- |
| **Local development** | your computer                                | `biomedintel_dev` on your computer                          | fictional seed only                              | developer                             |
| **Automated testing** | your computer (or a CI service later)        | `biomedintel_test`, wiped and re-seeded on every `npm test` | fictional, created by the tests                  | the test suite                        |
| **Staging**           | Render (`render.yaml`, `docs/DEPLOYMENT.md`) | its own Render database                                     | **fictional only**                               | you and invited testers               |
| **Production**        | not created; hosting decision pending        | its own database, never shared                              | real organisation data, under a signed agreement | the pilot hospital's authorised staff |

Rules that keep them apart:

- **Separate databases and separate passwords** for each environment. Never reuse `BETTER_AUTH_SECRET`, database passwords or API keys between environments.
- **The tests refuse to run** unless the database name ends in `_test` **and** the database is on this computer (`localhost`, `127.0.0.1` or a local socket). A remote database whose name happens to end in `_test` is refused too.
- **`npm run db:reset` refuses** anything that is not a local `_dev` or `_test` database, and refuses when `NODE_ENV=production`.
- **The performance data loader** only accepts a local database whose name ends in `_perf_dev`.
- **The restore drill** only restores into a new, throwaway database on this computer.
- **Production data is never copied** into development, testing or staging. If that is ever needed (for example to investigate a fault), it needs a written, approved procedure first, with anonymisation and a data-protection review. No such procedure exists.
- **Production starts only with safe settings.** With `NODE_ENV=production` the app refuses to start if MFA for privileged roles is switched off or `BETTER_AUTH_SECRET` is still the placeholder.

---

## 3. Health checks

| Address             | Answers                                                          | Use                                                                                                      |
| ------------------- | ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `/api/health`       | `{"status":"ok"}`. Only checks that the process is running.      | "Is the server up?"                                                                                      |
| `/api/health/ready` | `{"status":"ok","database":"ok"}`, or **HTTP 503** `unavailable` | "Can it serve users?" Checks the database answers within 3 seconds. Render's health check uses this one. |

Both are public and reveal nothing else. Tested: with the database stopped, `/ready` returns 503 and logs `health.database_unavailable`, while `/api/health` stays 200.

---

## 4. Logs

The server writes **one JSON object per line**, so a log viewer can filter by `level`, `event` or `requestId`. Before anything is written, values that look like passwords, secrets, tokens, API keys, cookies, one-time codes, bearer credentials, reset links or database passwords are replaced by `[redacted]` (tested in `tests/unit/hardening.test.ts`). Request bodies, cookies and query strings are never logged.

Events worth watching:

| Level | Event                                                                                                        | Meaning                                                                                                                                  |
| ----- | ------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------- |
| error | `request.unhandled_error`                                                                                    | A page or action failed unexpectedly. Has a `requestId` to match the user's report                                                       |
| error | `health.database_unavailable`, `startup.database_check_failed`                                               | The database cannot be reached                                                                                                           |
| error | `cron.daily_jobs_failed`, `pm.generation_failed`, `reminders.organisation_failed`, `reports.schedule_failed` | The daily job did not finish; PM work orders or reminders may be missing                                                                 |
| error | `action.failed`, `knowledge.upload_failed`, `work_order.photo_upload_failed`, `ai.provider_error`            | One user action failed                                                                                                                   |
| warn  | `authz.page_denied`                                                                                          | Someone opened a page their role does not allow (they saw a refusal message). Normal now and then; many from one account is worth a look |
| warn  | `inventory.movement_refused`, `request.client_disconnected`, `ai.provider_error`                             | Expected refusals or closed browsers; not faults                                                                                         |
| info  | `startup.ready`                                                                                              | The server started                                                                                                                       |

**Security events are in the audit log**, not only the server log:

- **Within an organisation:** every refused permission (`authz.denied`, `…access_denied`) and every change, with time, account, IP address and outcome. Organization Administrators and Auditors see the latest entries under **User and Organization Administration**.
- **Account-level events:** sign-ins, failed and throttled sign-ins, MFA set-up, codes, resets and refused resets, and password changes. These are recorded with the IP address but **without an organisation**, because one person can belong to several. **No screen shows them yet.** Reading them needs database access as the owner, for example:

  ```sql
  SELECT created_at, action, outcome, actor_user_id, ip_address
  FROM audit_logs WHERE organization_id IS NULL ORDER BY created_at DESC LIMIT 50;
  ```

  A platform-level security view is recommended before the pilot (see `docs/SECURITY.md`, limitation 45).

On Render the server log is under the service → **Logs**. Render keeps logs for a limited time; for a pilot, also send them to a log service (section 5).

---

## 5. Monitoring and alerting (to set up for a pilot)

None of these alerts exist yet. Before a pilot, someone must be named to receive them, and they must be tested by triggering each one once.

| Watch                                     | How                                                                                                                        | Who is told                 |
| ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- | --------------------------- |
| Site down / database down                 | Render health check on `/api/health/ready` (in `render.yaml`) plus an external uptime monitor polling it every 1–5 minutes | on-call person, immediately |
| Daily job failed or did not run           | Render notification settings (check they cover failed cron runs); the job log should show one summary line per day         | on-call person, same day    |
| Server errors                             | Log alert on `"level":"error"` (via a log service connected to Render's log streams)                                       | developer, within a day     |
| Database disk nearly full                 | Render database metrics (documents are stored in the database)                                                             | administrator, weekly check |
| Many failed sign-ins / throttled accounts | Weekly query of the account-level audit events (section 4) until a screen exists                                           | system owner                |

Adding an external uptime monitor or log service may cost money. Decide that first.

---

## 6. Backups

### 6.1 What Render provides (paid database plans only)

From Render's documentation, read 20 Oct 2026; not tested by us:

- **Point-in-time recovery:** the past **3 days** on a Hobby workspace, **7 days** on Pro or higher.
- **Logical exports** you download from the database's **Recovery** page. Each export is kept for 7 days.
- **Free database plans have no backups at all.** `render.yaml` uses a paid plan for that reason.
- A restore creates a **new** database at the chosen time (at least 10 minutes in the past). The original is not overwritten.

### 6.2 Our own extra copy

Render's retention is short. For a pilot, keep your own copies as well.

**What you need:** the PostgreSQL client tools, version 16 or newer (`pg_dump --version`), and the database's external address with your IP allowed (as in `docs/DEPLOYMENT.md`, section 5.1).

```bash
DATABASE_URL_ADMIN="PASTE-EXTERNAL-URL" npm run db:backup -- ./backups
```

The script:

- refuses to run as a user that cannot read every row, so a half-empty backup cannot be mistaken for a good one;
- fails loudly if `pg_dump` fails;
- checks that the file lists every table.

**The file contains personal data and audit records.** Store it encrypted, in the agreed region, and delete it when its retention period ends.

### 6.3 Retention (to be decided before the pilot)

No retention period has been agreed. A starting proposal for discussion: Render point-in-time recovery for 7 days (Pro workspace), a weekly encrypted copy kept for 3 months, and a monthly copy kept for 12 months. The pilot agreement must confirm, or replace, these periods.

---

## 7. Restoring: prove backups work

**A backup is not trusted until it has been restored.** Do a drill before the pilot, then at least every three months, and record the date and result.

### 7.1 Drill on your computer (safe; touches nothing hosted)

```bash
npm run db:restore-drill -- ./backups/THE-FILE.dump
```

It restores into a **new throwaway database on your computer**. It then compares the row count of every table, checks that row-level security is still switched on and forced, and checks that the app user sees nothing without an organisation. Finally it deletes the throwaway database. Result on 20 Oct 2026: 68 tables, 261,285 rows, OK.

### 7.2 Real recovery on Render (if data is lost or damaged)

1. **Stop changes:** suspend `biomedintel-staging-daily`, and tell users not to work in the system.
2. Render → database → **Recovery** → choose a time just **before** the problem → create the new database.
3. Check the new database: sign in through a temporary copy, or run the restore drill against an export of it.
4. Point the services at it. Update `DATABASE_URL` (app user) and `DATABASE_URL_ADMIN` (owner) on the web service, and `DATABASE_URL` on the daily job. Database users live outside the data itself. If the restored database refuses `biomedintel_app`, create it again with `npm run db:create-app-role` (`docs/DEPLOYMENT.md`, section 5).
5. Deploy, check `/api/health/ready`, sign in, and spot-check recent records.
6. Write down what was lost between the restore point and the incident, and tell the affected users.

This procedure has **not** been carried out on Render yet. Rehearse it on staging before the pilot.

---

## 8. Before a real hospital uses it

These are decisions, not code. Each needs an owner and a date:

- **Data residency and hosting:** where the hospital's data may be stored (Singapore staging vs. AWS Sydney or another region), data-protection law in each market, and a data processing agreement.
- **Retention:** for backups, audit logs, AI request records and documents.
- **On-call:** who receives alerts and who can make decisions out of hours.
- **AI:** whether the paid Claude API is used at all, with a spend limit and a data-protection review.
- **Regulatory assessment:** whether any feature could be treated as medical device software (see `docs/SECURITY.md`).

---

## 9. Incident response

An **incident** is anything that may have exposed data, let someone do what their role should not allow, lost or corrupted maintenance records, or stopped the service when it is needed.

**Severity:**

| Level | Examples                                                                                                         | Respond          |
| ----- | ---------------------------------------------------------------------------------------------------------------- | ---------------- |
| **1** | Data visible to another organisation; a failed-safety-test device shown as usable; a leaked secret; records lost | immediately      |
| **2** | Site down; the daily job not running (PM work orders missing); sign-in broken for a role                         | within hours     |
| **3** | One feature failing with a workaround; a slow report                                                             | next working day |

**Steps:**

1. **Record** what was seen, when, by whom, and the `requestId` if there is one. Do not delete logs or records.
2. **Contain:**
   - Data exposure or a role bypass: suspend the web service (Render → **Suspend**).
   - A leaked secret: rotate it (section 10).
   - Wrong data: stop the daily job.
3. **Tell people:**
   - Severity 1: the organisation's administrator and the hospital's biomedical engineering manager, the same day.
   - A safety-relevant error (for example, a device wrongly shown as available): the hospital's clinical engineering lead **immediately**, so they can check the device physically.
   - If personal data may have been exposed: follow the data-protection notification rules agreed in the pilot contract. Notification deadlines are short in many jurisdictions.
4. **Fix** the cause. Restore data (section 7) if needed. Add an automated test that would have caught it.
5. **Review** in writing within a week: cause, impact, fix and prevention.

**Contacts (fill in before the pilot):**

| Role                               | Name | Phone / email |
| ---------------------------------- | ---- | ------------- |
| System owner                       |      |               |
| Developer / on-call                |      |               |
| Pilot hospital BME manager         |      |               |
| Hospital privacy / data-protection |      |               |

---

## 10. Rotating secrets

| Secret                  | How                                                                                                                                                                                  | Effect                                         |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------- |
| `BETTER_AUTH_SECRET`    | Render → settings group → regenerate → deploy                                                                                                                                        | everyone is signed out                         |
| App database password   | new password, then `DATABASE_URL_ADMIN=… APP_DB_PASSWORD=… npm run db:create-app-role -- --reset-password`, then update `DATABASE_URL` on the web service and daily job, then deploy | brief errors until the deploy finishes         |
| Owner database password | follow Render's documentation for changing the database password                                                                                                                     | `DATABASE_URL_ADMIN` updates from the database |
| `ANTHROPIC_API_KEY`     | revoke it in the Claude Console, create a new one, update the setting, deploy                                                                                                        | AI unavailable until updated                   |

Rotate all of them when someone with access leaves, and immediately after any suspected leak.
