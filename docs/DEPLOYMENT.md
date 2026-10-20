# Deploying a private staging copy of BiomedIntel.ai on Render

BiomedIntel.ai — _Smarter Maintenance. Safer Healthcare._

This guide is for a **staging** environment: a private, hosted copy used for acceptance testing with **fictional data only**. It is not a production guide. Nothing in this repository deploys by itself. Every step below is done by you, in your own accounts, when you decide to.

> **Before you start:** Render is a paid service. Read section 1 and decide whether to go ahead. Do not put real hospital, staff or patient data on staging.

Words used in this guide:

- **Terminal** — the text window where you type commands. On a Mac: open _Terminal_ (search with ⌘+Space). On Windows: open _PowerShell_ (Start menu → type "PowerShell").
- **Repository ("repo")** — the project folder tracked by Git.
- **Environment variable** — a named setting (like `BETTER_AUTH_URL`) given to the app by the host instead of being written in the code.
- **Render Shell** — a terminal inside your browser, on the Render page of the running website. You only need it once (section 7).

---

## 1. What you will create and what it costs

`render.yaml` (in the project folder) describes three things. Render creates them when you apply it:

| Name                        | What it is                                                           | Plan in `render.yaml` | Price (render.com/pricing, checked 20 Oct 2026)            |
| --------------------------- | -------------------------------------------------------------------- | --------------------- | ---------------------------------------------------------- |
| `biomedintel-staging`       | The website                                                          | `1c-2g` (1 CPU, 2 GB) | US$25 / month                                              |
| `biomedintel-staging-db`    | PostgreSQL 16 database                                               | `0.5c-1g`             | US$19 / month, 1 GB storage included, then US$0.30 per GB  |
| `biomedintel-staging-daily` | The daily job: PM work orders, reminders, scheduled report snapshots | `0.5c-512mb`          | US$0.00016 per minute it runs (a run takes about a minute) |

Your Render **workspace** plan also matters: _Hobby_ is US$0 and keeps 3 days of database point-in-time recovery; _Pro_ is US$25/month and keeps 7 days.

**Expected staging total:** about **US$44 per month** on the Hobby workspace (US$69 on Pro), plus extra database storage if you upload many documents. Prices change; check render.com/pricing before you start.

Why these sizes:

- **Website, 2 GB.** In the Stage 10 load test the server used about 456–464 MB while serving 20 pages at once. That is too close to the 512 MB size.
- **Database, paid.** Render's Free database plan has **no backups and no point-in-time recovery**, so it is not used.
- **Paid website plan, required anyway.** The safety step that runs migrations before each release (the "pre-deploy command") only exists on paid plans.
- **Region: Singapore.** Render has no Australian or African region. Singapore is the nearest to both. A region cannot be changed later.

> **Data residency.** Singapore hosting is acceptable for fictional staging data. For a real hospital, where data may be stored is a legal and contractual question. Answer it before production (see `docs/OPERATIONS.md`, section 8). AWS Sydney is the likely route if Australian residency is required. That is a separate decision, and nothing has been set up for it.

---

## 2. What you need first

1. A **GitHub** account (free), at github.com, with an empty **private** repository called `biomedintel`.
2. A **Render** account, at render.com. Sign up **with your GitHub account**; that connects the two.

Nothing needs installing on your own computer.

---

## 3. Put the code in your GitHub repository

Render deploys from GitHub.

**Easiest:** Claude pushes the code into your empty repository for you, if this chat session is allowed to reach your GitHub.

**Yourself** (needs Git and the project folder on your computer; skip if Claude did it). In a terminal inside the unzipped project folder:

```bash
git init -b main
git config user.name "Your Name"
git config user.email "you@example.com"
git add -A
git commit -m "BiomedIntel.ai"
git remote add origin https://github.com/YOUR-NAME/biomedintel.git
git push -u origin main
```

Check on github.com that the file `.env` is **not** in the repository. It is ignored on purpose, because it holds passwords.

---

## 4. Create everything from `render.yaml`

1. In Render: **New** (top right) → **Blueprint**.
2. Choose the `biomedintel` repository. If Render cannot see it, click **Configure GitHub** and give Render access to that repository.
3. Render reads `render.yaml` and lists what it will create:
   - `biomedintel-staging-db` (database);
   - `biomedintel-staging` (website);
   - `biomedintel-staging-daily` (daily job);
   - the settings group `biomedintel-staging-shared`.

   Check the database plan says **0.5c-1g** (not Free) and the region says **Singapore**.

4. Give the Blueprint a name (for example `biomedintel-staging`) and click **Apply** (or **Deploy Blueprint**). Render shows the monthly cost before you confirm. This is where you start paying.

You do **not** type any database address or password. Render generates two secrets (`BETTER_AUTH_SECRET`, `APP_DB_PASSWORD`) and gives the app the database's address.

---

## 5. Watch the first deploy

Open `biomedintel-staging` → **Events** / **Logs**. In order:

1. **Build** (`npm ci`, `npm run build`): a few minutes.
2. **Pre-deploy** (`npm run db:predeploy`) prints:
   - `Created the database user biomedintel_app.` — the restricted user the app works with. It can never bypass the rules that keep organisations apart;
   - `OK: biomedintel_app can sign in … and cannot bypass row-level security.`;
   - `OK: no unreviewed destructive statements.`;
   - the migrations being applied;
   - `Pre-deploy finished: all 20 migrations are applied.`
3. **Deploy live.** The service shows **Live** in green.

If anything fails, the deploy stops, nothing is half-changed, and the log line starting `Pre-deploy stopped:` says why (see section 12).

> Rehearsed on 20 Oct 2026 on a local PostgreSQL 16 set up like a managed host (the owner is not a superuser and cannot bypass row-level security). It was given only what `render.yaml` provides and no `.env` file. The pre-deploy step created the app user, the app connected only as that user, and sign-in, MFA, the health checks and the daily job worked. **Not rehearsed:** applying migrations on Render itself. This workspace cannot download Prisma's migration engine, so an equivalent tool was used. Watch this step on the first deploy.

---

## 6. Check the address and the health check

1. At the top of `biomedintel-staging`, Render shows the website address, for example `https://biomedintel-staging.onrender.com`.
2. If yours is **different**, open **Environment Groups** → `biomedintel-staging-shared` → set `BETTER_AUTH_URL` to your exact address → **Save**. Then on the website: **Manual Deploy** → **Deploy latest commit**. Sign-ins from any other address are refused on purpose.
3. Open `https://YOUR-ADDRESS/api/health/ready` in your browser. You should see `{"status":"ok","database":"ok",...}`.

---

## 7. Create the first administrator (once, in the browser)

1. `biomedintel-staging` → **Shell** (left menu). A terminal opens in your browser.
2. Type this, with your email and name, then press Enter:

   ```bash
   BOOTSTRAP_ADMIN_EMAIL="you@example.com" BOOTSTRAP_ADMIN_NAME="Your Name" npm run admin:bootstrap
   ```

3. It asks for a password twice. The typing is hidden; that is normal. Use a long, unique password and store it in a password manager.
4. It ends with `✓ Platform Super Administrator created`. It refuses to run a second time.

If the Shell does not accept the hidden password typing, say so and use the alternative in section 12.

Then open your staging address and sign in. You must first set up an **authenticator app** (Microsoft Authenticator, Google Authenticator or similar): scan the code it shows, type the 6-digit code, and **save the backup codes** somewhere safe. You land on **/platform**.

### 7b. Load the fictional pilot data (staging only)

The pilot scenarios use two fictional organisations, "Coastal Health Group" and "Highland Medical Network". They hold equipment, maintenance plans, spare parts, suppliers and a demo manual: the same data every automated test uses. Load them once, in the website's **Shell**:

```bash
npm run pilot:data -- --fictional
```

It asks for **one password for all the fictional test users** (twice, hidden). Choose a new one for staging and keep it in a password manager. It then lists the test accounts, for example `amina.warsame@coastal.example` (Technician) and `james.otieno@coastal.example` (Engineering Manager). The full list with roles is in the README, "Fictional seed users".

It refuses to run if:

- the database already has an organisation (it never mixes with other data);
- `PILOT_DATA_ALLOWED` is not `true` (it is set for staging only in `render.yaml` and must never be set on a production copy);
- the first administrator from step 7 does not exist yet.

Everything is loaded in one go, or nothing is.

Rehearsed on 20 Oct 2026 on the host-like database: loaded with the isolation rules fully on; a fictional technician signed in and opened a device; the other organisation's technician got "not found"; a second run was refused.

To use your own **fictional** organisation instead, skip this step. In **/platform**, create it and its first Organization Administrator, who also sets up MFA at first sign-in.

---

## 8. Check the daily job

`biomedintel-staging-daily` → **Trigger Run**. The log should end with one line starting `PM:` and no `Daily job stopped`. It then runs every day at 19:00 UTC (22:00 in Nairobi, 06:00 in Melbourne during daylight saving).

---

## 9. Visitor IP addresses

Audit records and the per-address sign-in limit read the visitor's IP address from the header named in `TRUSTED_IP_HEADER` (default `x-forwarded-for`). Render's own documentation does not name this header; community answers say Render sets `X-Forwarded-For`. **Check it once:**

1. Look up your own public IP address (search "what is my IP").
2. Sign in as the Organization Administrator and make one small change, for example add a fictional department to a hospital.
3. Open **User and Organization Administration** and scroll to the **audit log** at the bottom. The newest line should show **your** IP address in the **IP address** column. If it shows an address starting with `10.` or similar, the header is wrong. Set `TRUSTED_IP_HEADER` in the settings group to the header Render support names, then redeploy.

The per-**account** sign-in limit does not depend on this setting, so passwords stay protected either way.

---

## 10. Releasing a new version

1. Put the new code on GitHub (Claude can push it, or `git push`).
2. Render → `biomedintel-staging` → **Manual Deploy** → **Deploy latest commit**. Automatic deploys are off on purpose. The pre-deploy step applies new migrations safely, or stops.
3. Open `/api/health/ready` and sign in to check.

**Never** run `npm run db:reset`, `prisma migrate reset`, `prisma db push` or any `DROP` command against staging or production. `db:reset` refuses non-local databases on purpose.

---

## 11. Turning staging off

To stop paying: Render → each service and the database → **Settings** → **Suspend** (keeps the data), or **Delete**. Deleting the database deletes its data and its backups.

---

## 12. If something goes wrong

| Message or symptom                                                                   | What it means                                                                 | What to do                                                                                                                                                                                                                       |
| ------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Pre-deploy stopped: biomedintel_app exists but signing in with its password failed` | `APP_DB_PASSWORD` was changed or regenerated after the first deploy           | In the website's **Shell**: `npm run db:create-app-role -- --reset-password` (it uses the current settings), then **Manual Deploy** again                                                                                        |
| `… is not allowed to create or change database users`                                | The database's main user cannot create users on this host                     | Stop and ask for help. This needs a different setup, and is not expected on Render.                                                                                                                                              |
| `Pre-deploy stopped: migration(s) …`                                                 | A migration did not finish                                                    | Do not retry blindly. Copy the log and ask for help. The previous version keeps running.                                                                                                                                         |
| `BiomedIntel.ai configuration error … DATABASE_URL: not set`                         | The website or daily job is missing `DATABASE_URL_ADMIN` or `APP_DB_PASSWORD` | Check both exist on the service (Environment tab) and in the settings group                                                                                                                                                      |
| Sign-in says the address is not allowed / 403                                        | `BETTER_AUTH_URL` differs from the real address                               | Section 6, step 2                                                                                                                                                                                                                |
| `/api/health/ready` shows `unavailable`                                              | The database cannot be reached                                                | Check the database is **Available** in Render; see `docs/OPERATIONS.md`                                                                                                                                                          |
| The Shell will not take the hidden password in section 7                             | The browser terminal does not support hidden input                            | Run `BOOTSTRAP_ADMIN_EMAIL="…" BOOTSTRAP_ADMIN_NAME="…" BOOTSTRAP_ADMIN_PASSWORD="…" npm run admin:bootstrap`. Then sign in straight away and **change that password** under Account security, because it was typed in the open. |

---

## 13. Settings reference (no secret values)

| Variable                           | Where                     | Value                                                                                                                                                                       |
| ---------------------------------- | ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `NODE_VERSION`                     | settings group            | `22.22.0`                                                                                                                                                                   |
| `BETTER_AUTH_SECRET`               | settings group            | generated by Render; never share it                                                                                                                                         |
| `APP_DB_PASSWORD`                  | settings group            | generated by Render: the password of the restricted app database user                                                                                                       |
| `BETTER_AUTH_URL`                  | settings group            | your exact `https://…onrender.com` address                                                                                                                                  |
| `REQUIRE_MFA_FOR_PRIVILEGED_ROLES` | settings group            | `true` (the app refuses to start in production with `false`)                                                                                                                |
| `TRUSTED_IP_HEADER`                | settings group            | `x-forwarded-for` (section 9)                                                                                                                                               |
| `AI_PROVIDER`                      | settings group            | empty = AI off. Never `mock` for acceptance testing                                                                                                                         |
| `DATABASE_URL_ADMIN`               | website and daily job     | filled in by Render from the database. The pre-deploy step uses it to create the app user and apply migrations; the app uses it only to build its `biomedintel_app` address |
| `DATABASE_URL`                     | not set on Render         | if set, it is used instead of the derived address (local development, other hosts)                                                                                          |
| `AI_MODEL`, `ANTHROPIC_API_KEY`    | settings group (optional) | only if you decide to use the paid Claude API; add the key as a secret in the dashboard, never in `render.yaml`                                                             |
| `CRON_SECRET`                      | not needed                | the daily job runs `npm run jobs:daily` directly                                                                                                                            |

The full list, with explanations, is in `.env.example`.

**Why the app is safe even though it can see the owner's address:** the address it builds always uses `biomedintel_app`. Both the website and the daily job check, every time they start, that their database user cannot bypass row-level security, and refuse to run if it can. The owner's address is in the same place Render keeps all of the service's secrets.

---

## Appendix: other hosts

On a host without Render's pre-deploy step or generated values, create the app user once from a computer that can reach the database (`DATABASE_URL_ADMIN=… APP_DB_PASSWORD=… npm run db:create-app-role`). Then either set `DATABASE_URL` to the database address with user `biomedintel_app` and that password, or set `DATABASE_URL_ADMIN` and `APP_DB_PASSWORD` and let the app build it. Run `npm run db:predeploy` before starting each new version.
