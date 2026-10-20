# Deploying a private staging copy of BiomedIntel.ai on Render

BiomedIntel.ai — _Smarter Maintenance. Safer Healthcare._

This guide is for a **staging** environment: a private, hosted copy used for acceptance testing with **fictional data only**. It is not a production guide. Nothing in this repository deploys by itself. Every step below is done by you, in your own accounts, when you decide to.

> **Before you start:** Render is a paid service. Read section 1 and decide whether to go ahead. Do not put real hospital, staff or patient data on staging.

Words used in this guide:

- **Terminal** — the text window where you type commands. On a Mac: open _Terminal_ (search with ⌘+Space). On Windows: open _PowerShell_ (Start menu → type "PowerShell").
- **Repository ("repo")** — the project folder tracked by Git.
- **Environment variable** — a named setting (like `DATABASE_URL`) given to the app by the host instead of being written in the code.

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

1. A **GitHub** account (free), at github.com.
2. A **Render** account, at render.com. Sign up with your GitHub account; that connects the two.
3. On your own computer, for the one-time setup in section 5:
   - **Node.js 22** (from nodejs.org, the "LTS" version 22.x). Check it in a terminal with `node -v`; it should print `v22.` followed by numbers.
   - The project folder (unzip `biomedintel-stage10.zip`), and inside it run **once**:

     ```bash
     npm install
     ```

---

## 3. Put the code in a private GitHub repository

Render deploys from GitHub.

1. On github.com click **New repository**. Name it `biomedintel`, choose **Private**, and do **not** add a README. Click **Create repository**.
2. In a terminal, go into the project folder. Replace the path with yours:

   ```bash
   cd ~/Downloads/biomedintel
   ```

3. The zip has no Git history, so make the folder a Git repository first. Use your own name and email:

   ```bash
   git init -b main
   git config user.name "Your Name"
   git config user.email "you@example.com"
   git add -A
   git commit -m "BiomedIntel.ai Stage 10"
   ```

4. Send the code to GitHub. Replace `YOUR-NAME` with your GitHub user name:

   ```bash
   git remote add origin https://github.com/YOUR-NAME/biomedintel.git
   git push -u origin main
   ```

   GitHub asks you to sign in the first time (a browser window opens, or it asks for a "personal access token" — follow the link it shows).

5. Check that the file `.env` is **not** in the repository on github.com. It is ignored on purpose, because it holds passwords.

---

## 4. Create the services from `render.yaml`

1. In Render: **New** → **Blueprint** → choose the `biomedintel` repository and the branch `main`.
2. Render reads `render.yaml` and lists the three resources and one settings group (`biomedintel-staging-shared`). Check that the database plan shows **0.5c-1g**, not Free.
3. Render asks for **`DATABASE_URL`** for the website and the daily job. You do not know it yet. Type `postgresql://pending` for now; section 6 replaces it.
4. Click **Apply**.

**What happens next is expected.** Render creates the database. The website's first deploy then **fails at the pre-deploy step** with a message that the app database user `biomedintel_app` does not exist. Nothing is broken: the safety step refused to continue. Sections 5 and 6 fix it.

Note the website address Render gives you (for example `https://biomedintel-staging.onrender.com`). If it is **different** from that example, open **Environment Groups → biomedintel-staging-shared** and set `BETTER_AUTH_URL` to your exact address. Sign-ins from any other address are refused on purpose.

---

## 5. One-time database setup (from your computer)

The website must **not** connect as the database owner. It uses a restricted user, `biomedintel_app`, that can never bypass the organisation-isolation rules (row-level security). You create that user once.

**5.1 Let your computer reach the database, temporarily**

1. Render → `biomedintel-staging-db` → **Networking** (or **Access Control**) → add **your current IP address**. Render shows a button for it.
2. On the database's **Info** page, copy the **External Database URL**. Keep it private: it contains the owner password.

**5.2 Make a password for the app user**

```bash
node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"
```

Copy the 48-character result into a password manager. This is `APP_DB_PASSWORD`.

**5.3 Create the app user.** Paste your values between the quotes.

Mac / Linux:

```bash
DATABASE_URL_ADMIN="PASTE-EXTERNAL-URL" APP_DB_PASSWORD="PASTE-48-CHARACTERS" npm run db:create-app-role
```

Windows PowerShell:

```powershell
$env:DATABASE_URL_ADMIN="PASTE-EXTERNAL-URL"; $env:APP_DB_PASSWORD="PASTE-48-CHARACTERS"; npm run db:create-app-role
```

The script never prints the password. It signs in as the new user to prove the password works and that the user cannot bypass row-level security. Running it twice changes nothing; to set a new password, add `-- --reset-password`.

**5.4 Close the door again:** remove your IP address from the database's access list.

You create the first administrator later, in section 8.

---

## 6. Give the website its database address

1. Copy the database's **Internal Database URL**. It looks like `postgresql://biomedintel_owner:OWNERPASSWORD@dpg-xxxx-a:5432/biomedintel_staging`.
2. Make the app version of it: replace `biomedintel_owner:OWNERPASSWORD` with `biomedintel_app:` followed by your 48-character password:
   `postgresql://biomedintel_app:YOUR48CHARS@dpg-xxxx-a:5432/biomedintel_staging`
3. Paste that as **`DATABASE_URL`** in **both**:
   - `biomedintel-staging` → **Environment**;
   - `biomedintel-staging-daily` → **Environment**.

You do **not** set `DATABASE_URL_ADMIN` yourself. Render fills it in from the database, and only the pre-deploy step uses it.

> Not verified: this guide was rehearsed on a local PostgreSQL configured like a managed host, not on Render itself. If the app reports an SSL error when connecting, add `?sslmode=require` to the end of `DATABASE_URL`.

---

## 7. Deploy

1. `biomedintel-staging` → **Manual Deploy** → **Deploy latest commit**. (`render.yaml` turns automatic deploys off, so nothing goes live by accident.)
2. Watch the log. The pre-deploy step (`npm run db:predeploy`) prints four checks:
   1. the app user exists and `DATABASE_URL` uses it;
   2. no migration contains an unreviewed destructive statement;
   3. migrations applied;
   4. every migration is recorded as finished.
      If any check fails, the deploy stops and nothing changes.

   > Rehearsed on 20 Oct 2026 on a local PostgreSQL 16 set up like a managed host (owner without superuser or bypass rights), with only the settings in section 13 and no `.env`: app-user creation, pre-deploy checks 1–2, the first administrator, the production server, both health checks, MFA enforcement and the daily job all worked. **Not rehearsed:** step 3 itself on Render. This workspace cannot download Prisma's migration engine, so migrations were applied with an equivalent stand-in tool. Watch the first real deploy's log.

3. When it says **Live**, open `https://YOUR-ADDRESS/api/health/ready`. You should see `{"status":"ok","database":"ok",...}`. Render also polls this address and shows the service as unhealthy if it fails.

---

## 8. Create the first administrator

The same as section 5.1: add your IP address to the database's access list, then from the project folder on your computer:

Mac / Linux:

```bash
DATABASE_URL_ADMIN="PASTE-EXTERNAL-URL" BOOTSTRAP_ADMIN_EMAIL="you@example.com" BOOTSTRAP_ADMIN_NAME="Your Name" npm run admin:bootstrap
```

Windows PowerShell:

```powershell
$env:DATABASE_URL_ADMIN="PASTE-EXTERNAL-URL"; $env:BOOTSTRAP_ADMIN_EMAIL="you@example.com"; $env:BOOTSTRAP_ADMIN_NAME="Your Name"; npm run admin:bootstrap
```

It asks for a password; the typing is hidden. Use a long, unique password. Then **remove your IP address** from the access list again.

Open the staging address and sign in. You are asked to set up an **authenticator app** (for example Microsoft Authenticator or Google Authenticator) before anything else. Save the backup codes it shows somewhere safe. You land on **/platform**. Create a **fictional** organisation and its first Organization Administrator, who also sets up MFA at first sign-in.

---

## 9. Check the daily job

`biomedintel-staging-daily` → **Trigger Run**. The log should end without errors. It runs every day at 19:00 UTC (22:00 in Nairobi, 06:00 in Melbourne during daylight saving).

---

## 10. Visitor IP addresses

Audit records and the per-address sign-in limit use the visitor's IP address from the request header named in `TRUSTED_IP_HEADER` (default `x-forwarded-for`). Render's own documentation does not name this header; community answers say Render sets `X-Forwarded-For`. **Check it after the first sign-in:**

1. Look up your own public IP address (search "what is my IP").
2. Sign in to staging as the Organization Administrator and make one small change, for example add a fictional department to a hospital.
3. Open **User and Organization Administration** and scroll to the **audit log** table at the bottom. The newest line (your change) should show **your** IP address in the **IP address** column. If it shows an address starting with `10.` or similar, the header is wrong. Set `TRUSTED_IP_HEADER` in the settings group to the header Render support names, then redeploy.

The per-**account** sign-in limit does not depend on this setting, so passwords stay protected either way.

---

## 11. Releasing a new version

1. Push the new code to GitHub (`git push`).
2. Render → **Manual Deploy**. The pre-deploy step applies any new migrations safely, or stops.
3. Open `/api/health/ready` and sign in to check.

**Never** run `npm run db:reset`, `prisma migrate reset`, `prisma db push` or any `DROP` command against staging or production. `db:reset` refuses non-local databases on purpose.

---

## 12. Turning staging off

To stop paying: Render → each service → **Settings** → **Suspend** (keeps the data), or **Delete**. Deleting the database deletes its data and its backups.

---

## 13. Settings reference (no secret values)

| Variable                           | Where                     | Value                                                                                                           |
| ---------------------------------- | ------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `NODE_VERSION`                     | settings group            | `22.22.0`                                                                                                       |
| `BETTER_AUTH_SECRET`               | settings group            | generated by Render; never share it                                                                             |
| `BETTER_AUTH_URL`                  | settings group            | your exact `https://…onrender.com` address                                                                      |
| `REQUIRE_MFA_FOR_PRIVILEGED_ROLES` | settings group            | `true` (the app refuses to start in production with `false`)                                                    |
| `TRUSTED_IP_HEADER`                | settings group            | `x-forwarded-for` (section 10)                                                                                  |
| `AI_PROVIDER`                      | settings group            | empty = AI off. Never `mock` for acceptance testing                                                             |
| `DATABASE_URL`                     | website and daily job     | `biomedintel_app` internal address (section 6)                                                                  |
| `DATABASE_URL_ADMIN`               | website                   | filled in by Render from the database; used only by pre-deploy                                                  |
| `AI_MODEL`, `ANTHROPIC_API_KEY`    | settings group (optional) | only if you decide to use the paid Claude API; add the key as a secret in the dashboard, never in `render.yaml` |
| `CRON_SECRET`                      | optional                  | not needed on Render: the daily job runs `npm run jobs:daily` directly                                          |

The full list, with explanations, is in `.env.example`.
