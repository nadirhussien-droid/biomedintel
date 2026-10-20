// npm run db:backup -- [output-folder]
//
// Makes a logical backup (pg_dump, custom format) of the database in
// DATABASE_URL_ADMIN and checks it can be read back. Stage 10 rules:
//   • it refuses to run as a user that cannot read every row: with forced
//     row-level security pg_dump would stop half-way and leave an incomplete
//     file that looks like a backup (found in the hosted-database simulation);
//   • it fails loudly if pg_dump or the read-back check fails;
//   • the file can contain personal data and audit records: store it
//     encrypted, in the agreed region, and delete it when its retention ends.
// A backup is only trusted after a restore drill: npm run db:restore-drill.
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { parseUrl, readAllMode, run, tableCounts } from "../lib/pg-tools";

const url = process.env.DATABASE_URL_ADMIN;
if (!url) throw new Error("DATABASE_URL_ADMIN is not set.");
const conn = parseUrl(url);
const mode = readAllMode(conn);
if (!mode) {
  console.error(
    `Refusing to back up as "${conn.user}": this user cannot read every row (row-level security).\n` +
      "Use a database user with BYPASSRLS, or rely on the hosting platform's own backups (see docs/OPERATIONS.md).",
  );
  process.exit(1);
}
const folder = process.argv[2] ?? "backups";
fs.mkdirSync(folder, { recursive: true, mode: 0o700 });
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const file = path.join(folder, `${conn.database}-${stamp}.dump`);
// On a managed host the owner reads through its row-level security policies,
// so pg_dump must be told to apply them instead of refusing.
const rls = mode === "owner-policies" ? ["--enable-row-security"] : [];
run("pg_dump", ["-d", conn.database, "-Fc", "--no-password", ...rls, "-f", file], conn);
fs.chmodSync(file, 0o600);
// Read-back check: the archive's table of contents must list every table.
const list = spawnSync("pg_restore", ["--list", file], { encoding: "utf8" });
if (list.status !== 0) throw new Error("The backup file could not be read back.");
const counts = tableCounts(conn);
const missing = [...counts.keys()].filter((t) => !new RegExp(`TABLE DATA public ${t} `).test(list.stdout));
if (missing.length) throw new Error(`The backup is missing table data for: ${missing.join(", ")}`);
const rows = [...counts.values()].reduce((a, b) => a + b, 0);
console.log(
  `Backup written: ${file} (${(fs.statSync(file).size / 1024).toFixed(0)} KB, ${counts.size} tables, ${rows} rows).`,
);
console.log("Next: prove it restores with  npm run db:restore-drill -- " + file);
