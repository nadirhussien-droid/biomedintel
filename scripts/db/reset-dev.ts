// Safely resets the LOCAL development database: drops all data, re-applies
// every migration and re-runs the fictional seed.
//
//   npm run db:reset
//
// It refuses to run unless NODE_ENV is not "production", the database name ends
// in _dev or _test, and the host is local. Never run `prisma migrate reset`
// against a shared, staging or production database.
import "dotenv/config";
import { spawnSync } from "node:child_process";
import { assertLocalDevelopmentDatabase } from "../lib/admin-db";

const url = process.env.DATABASE_URL_ADMIN;
if (!url) {
  console.error("DATABASE_URL_ADMIN is not set.");
  process.exit(1);
}
try {
  assertLocalDevelopmentDatabase(url, "reset the database");
} catch (error) {
  console.error(`✗ ${error instanceof Error ? error.message : error}`);
  process.exit(1);
}

console.log("Resetting the local development database (all local data will be replaced)…");
const run = (args: string[]) =>
  spawnSync("npx", args, { stdio: "inherit", shell: process.platform === "win32" }).status ?? 1;

if (run(["prisma", "migrate", "reset", "--force"]) !== 0) process.exit(1);
// Some Prisma versions seed automatically after a reset; --if-empty makes this a no-op then.
process.exit(run(["tsx", "--conditions=react-server", "prisma/seed.ts", "--if-empty"]));
