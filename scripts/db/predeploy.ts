// npm run db:predeploy
//
// What a hosting platform runs before each new version starts (Render's
// "pre-deploy command"). If any step fails, the deploy stops and the previous
// version keeps running. Steps:
//   1. work out the app's database address (DATABASE_URL, or DATABASE_URL_ADMIN
//      + APP_DB_PASSWORD: server/db/app-url.ts); it must use the restricted
//      user biomedintel_app. If that user does not exist yet (first deploy),
//      create it with that password; either way prove it can sign in and
//      cannot bypass row-level security (Stage 11);
//   2. no migration may contain an unreviewed destructive statement
//      (npm run db:check-migrations);
//   3. apply pending migrations (prisma migrate deploy, using DATABASE_URL_ADMIN);
//   4. confirm in the database itself that EVERY migration folder is recorded
//      as finished and none failed (an exit code alone is not trusted).
// Nothing here deletes data. Passwords are never printed.
import "dotenv/config";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import { Client } from "pg";
import { APP_ROLE, appDatabaseUrl, passwordOf } from "../../server/db/app-url";
import { ensureAppRole } from "./create-app-role";

function fail(message: string): never {
  console.error(`Pre-deploy stopped: ${message}`);
  process.exit(1);
}

async function main() {
  const adminUrl = process.env.DATABASE_URL_ADMIN;
  if (!adminUrl) fail("DATABASE_URL_ADMIN is not set (the database's main connection URL).");
  const appUrl = appDatabaseUrl(process.env);
  if (!appUrl)
    fail("set APP_DB_PASSWORD (Render generates it from render.yaml), or DATABASE_URL. See docs/DEPLOYMENT.md.");
  let appUser = "";
  try {
    appUser = decodeURIComponent(new URL(appUrl).username);
  } catch {
    fail("DATABASE_URL is not a valid postgresql:// address.");
  }
  if (appUser !== APP_ROLE) {
    fail(`DATABASE_URL must sign in as ${APP_ROLE}, not "${appUser}". See docs/DEPLOYMENT.md.`);
  }
  console.log("Checking the app database user…");
  try {
    // Creates the user on the first deploy; afterwards only checks it.
    await ensureAppRole(adminUrl, passwordOf(appUrl), { log: (line) => console.log(line) });
  } catch (error) {
    fail((error as Error).message);
  }
  for (const [label, cmd, args] of [
    ["Checking migrations", "npx", ["tsx", "scripts/db/check-migrations.ts"]],
    ["Applying migrations", "npx", ["prisma", "migrate", "deploy"]],
  ] as const) {
    console.log(`${label}…`);
    const run = spawnSync(cmd, [...args], { stdio: "inherit", env: process.env });
    if (run.status !== 0) fail(`${label.toLowerCase()} failed (exit ${run.status}).`);
  }
  // 4. Independent check of the result.
  const expected = fs
    .readdirSync("prisma/migrations", { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();
  const check = new Client({ connectionString: adminUrl });
  await check.connect();
  try {
    const rows = await check.query<{ name: string; finished: boolean; failed: boolean }>(
      `SELECT migration_name AS name, finished_at IS NOT NULL AS finished,
              (rolled_back_at IS NOT NULL OR (finished_at IS NULL AND logs IS NOT NULL)) AS failed
       FROM _prisma_migrations`,
    );
    const done = new Set(rows.rows.filter((r) => r.finished && !r.failed).map((r) => r.name));
    // A migration that failed once and was later re-applied successfully is fine.
    const failed = rows.rows.filter((r) => (r.failed || !r.finished) && !done.has(r.name)).map((r) => r.name);
    const missing = expected.filter((name) => !done.has(name));
    if (failed.length) fail(`migration(s) recorded as failed or unfinished: ${failed.join(", ")}.`);
    if (missing.length) fail(`migration(s) not applied: ${missing.join(", ")}.`);
  } finally {
    await check.end();
  }
  console.log(`Pre-deploy finished: all ${expected.length} migrations are applied.`);
}

main().catch((error) => fail((error as Error).message.split("\n")[0]));
