// npm run db:predeploy
//
// What a hosting platform runs before each new version starts (Render's
// "pre-deploy command"). If any step fails, the deploy stops and the previous
// version keeps running. Steps:
//   1. DATABASE_URL must use the restricted app user biomedintel_app, and that
//      user must exist (created once with npm run db:create-app-role);
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

function fail(message: string): never {
  console.error(`Pre-deploy stopped: ${message}`);
  process.exit(1);
}

async function main() {
  const appUrl = process.env.DATABASE_URL;
  const adminUrl = process.env.DATABASE_URL_ADMIN;
  if (!adminUrl) fail("DATABASE_URL_ADMIN is not set (the database's main connection URL).");
  if (!appUrl) fail("DATABASE_URL is not set. See docs/DEPLOYMENT.md, step 6.");
  let appUser = "";
  try {
    appUser = decodeURIComponent(new URL(appUrl).username);
  } catch {
    fail("DATABASE_URL is not a valid postgresql:// address.");
  }
  if (appUser !== "biomedintel_app") {
    fail(`DATABASE_URL must sign in as biomedintel_app, not "${appUser}". See docs/DEPLOYMENT.md, step 6.`);
  }
  const admin = new Client({ connectionString: adminUrl });
  await admin.connect();
  try {
    const r = await admin.query("SELECT 1 FROM pg_roles WHERE rolname = 'biomedintel_app'");
    if (r.rowCount !== 1) {
      fail(
        "the database user biomedintel_app does not exist yet. Run npm run db:create-app-role first (docs/DEPLOYMENT.md, step 5).",
      );
    }
  } finally {
    await admin.end();
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
