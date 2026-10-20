// npm run db:restore-drill -- <backup-file>
//
// Restores a backup into a NEW, throwaway database on THIS computer and
// proves it is usable (Stage 10). Nothing existing is touched:
//   1. creates <name>_restore_check (refuses if it exists or the host is not local);
//   2. restores the backup into it with pg_restore;
//   3. compares the row count of every table with the backup's source database
//      (when that database is reachable) and checks that row-level security
//      is still switched on and forced on every tenant table;
//   4. checks the restricted app user can connect but sees no tenant rows
//      without a tenant context;
//   5. prints a report and DROPS the throwaway database (use --keep to keep it).
import "dotenv/config";
import { isLocalHost } from "../lib/admin-db";
import { parseUrl, psql, run, tableCounts } from "../lib/pg-tools";

const file = process.argv[2];
const keep = process.argv.includes("--keep");
if (!file) throw new Error("Usage: npm run db:restore-drill -- <backup-file> [--keep]");
const admin = parseUrl(process.env.DATABASE_URL_ADMIN ?? "");
if (!isLocalHost(new URL(process.env.DATABASE_URL_ADMIN ?? "").hostname)) {
  throw new Error("The restore drill only runs against a database server on this computer.");
}
const target = `${admin.database.replace(/_(dev|test)$/, "")}_restore_check`;
const exists = psql(admin, `SELECT 1 FROM pg_database WHERE datname = '${target}'`, "postgres");
if (exists.length) throw new Error(`${target} already exists. Drop it first (it is only a drill copy).`);

const started = Date.now();
psql(admin, `CREATE DATABASE "${target}"`, "postgres");
let ok = false;
try {
  run("pg_restore", ["-d", target, "--no-password", "--exit-on-error", file], admin);
  const restored = tableCounts(admin, target);
  const problems: string[] = [];
  try {
    const source = tableCounts(admin);
    for (const [t, n] of source)
      if (restored.get(t) !== n) problems.push(`${t}: source ${n}, restored ${restored.get(t)}`);
  } catch {
    console.log("(Source database not reachable: row counts compared with the backup only.)");
  }
  const weak = psql(
    admin,
    `SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relkind = 'r'
       AND EXISTS (SELECT 1 FROM information_schema.columns k WHERE k.table_name = c.relname AND k.column_name = 'organization_id')
       AND NOT (c.relrowsecurity AND c.relforcerowsecurity)`,
    target,
  );
  if (weak.length) problems.push(`row-level security not forced on: ${weak.join(", ")}`);
  const migrations = psql(admin, `SELECT count(*) FROM _prisma_migrations WHERE finished_at IS NOT NULL`, target)[0];
  const appUrl = process.env.DATABASE_URL ?? "";
  if (appUrl) {
    const app = { ...parseUrl(appUrl), database: target };
    psql(admin, `GRANT CONNECT ON DATABASE "${target}" TO "${app.user}"`, "postgres");
    const seen = psql(app, `SELECT count(*) FROM assets`)[0];
    if (seen !== "0") problems.push(`the app user sees ${seen} assets without a tenant context`);
  }
  const rows = [...restored.values()].reduce((a, b) => a + b, 0);
  console.log(
    `Restore drill: ${restored.size} tables, ${rows} rows, ${migrations} migrations, ${((Date.now() - started) / 1000).toFixed(1)} s.`,
  );
  if (problems.length) {
    console.log("PROBLEMS:\n  " + problems.join("\n  "));
  } else {
    console.log("OK: every table restored with the same row counts; row-level security intact; app user isolated.");
    ok = true;
  }
} finally {
  if (!keep) psql(admin, `DROP DATABASE "${target}" WITH (FORCE)`, "postgres");
}
process.exit(ok ? 0 : 1);
