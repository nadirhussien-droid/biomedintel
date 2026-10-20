// Small helpers around the PostgreSQL command-line tools (pg_dump, pg_restore,
// psql) for the backup and restore-drill scripts (Stage 10). Passwords are
// passed through the PGPASSWORD environment variable, never on the command
// line, and are never printed.
import { spawnSync } from "node:child_process";

export type Conn = { host: string; port: string; user: string; password: string; database: string };

export function parseUrl(url: string): Conn {
  const u = new URL(url);
  const socket = u.searchParams.get("host");
  return {
    host: socket ?? (u.hostname || "localhost"),
    port: u.port || "5432",
    user: decodeURIComponent(u.username),
    password: decodeURIComponent(u.password),
    database: decodeURIComponent(u.pathname.replace(/^\//, "")),
  };
}

function env(c: Conn) {
  return { ...process.env, PGPASSWORD: c.password, PGSSLMODE: process.env.PGSSLMODE ?? "prefer" };
}
const base = (c: Conn) => ["-h", c.host, "-p", c.port, "-U", c.user];

/** Runs one SQL query and returns trimmed rows (tab-separated). Throws on any error. */
export function psql(c: Conn, sql: string, database = c.database): string[] {
  const r = spawnSync("psql", [...base(c), "-d", database, "-v", "ON_ERROR_STOP=1", "-tA", "-F", "\t", "-c", sql], {
    env: env(c),
    encoding: "utf8",
  });
  if (r.status !== 0) throw new Error(`psql failed: ${(r.stderr || "").trim().slice(0, 500)}`);
  return r.stdout.split("\n").filter(Boolean);
}

export function run(cmd: string, args: string[], c: Conn): void {
  const r = spawnSync(cmd, [...base(c), ...args], { env: env(c), encoding: "utf8" });
  if (r.status !== 0) throw new Error(`${cmd} failed (exit ${r.status}): ${(r.stderr || "").trim().slice(0, 800)}`);
}

/** Row count of every table in the public schema (needs a user that can read every row: see readAllMode). */
export function tableCounts(c: Conn, database = c.database): Map<string, number> {
  const tables = psql(c, "SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY 1", database);
  const sql = tables.map((t) => `SELECT '${t}', count(*) FROM public."${t}"`).join(" UNION ALL ");
  return new Map(psql(c, sql, database).map((line) => [line.split("\t")[0], Number(line.split("\t")[1])]));
}

/**
 * How this user can read every row:
 *   "bypass"        superuser or BYPASSRLS (local development);
 *   "owner-policies" the table owner on a managed host, through the
 *                   <table>_owner_read policies (migration 20261016000200);
 *   null            it cannot: a dump would be incomplete.
 */
export function readAllMode(c: Conn): "bypass" | "owner-policies" | null {
  const [row] = psql(c, "SELECT (rolsuper OR rolbypassrls)::text FROM pg_roles WHERE rolname = current_user");
  if (row === "true") return "bypass";
  const [missing] = psql(
    c,
    `SELECT count(*) FROM pg_class t JOIN pg_namespace n ON n.oid = t.relnamespace
     WHERE n.nspname = 'public' AND t.relkind = 'r' AND t.relrowsecurity
       AND NOT EXISTS (
         SELECT 1 FROM pg_policies p
         WHERE p.schemaname = 'public' AND p.tablename = t.relname
           AND p.policyname = t.relname || '_owner_read' AND current_user = ANY (p.roles))`,
  );
  return missing === "0" ? "owner-policies" : null;
}
