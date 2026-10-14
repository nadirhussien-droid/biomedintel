// Applies all migrations to the TEST database (DATABASE_URL_ADMIN_TEST).
//   npm run db:test:prepare
import "dotenv/config";
import { spawnSync } from "node:child_process";
import { databaseName } from "../lib/admin-db";

const url = process.env.DATABASE_URL_ADMIN_TEST;
if (!url || !databaseName(url).endsWith("_test")) {
  console.error("DATABASE_URL_ADMIN_TEST must point to a database whose name ends in _test.");
  process.exit(1);
}
const result = spawnSync("npx", ["prisma", "migrate", "deploy"], {
  stdio: "inherit",
  shell: process.platform === "win32",
  env: { ...process.env, DATABASE_URL_ADMIN: url },
});
process.exit(result.status ?? 1);
