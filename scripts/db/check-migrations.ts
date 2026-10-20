// npm run db:check-migrations
// Fails (exit code 1) if any migration contains a statement that can destroy
// data or weaken a protection and has not been reviewed. Run it before every
// deployment; the test suite runs it too.
import path from "node:path";
import { scanMigrations, unreviewed } from "../lib/migration-safety";

const dir = path.join(process.cwd(), "prisma/migrations");
const all = scanMigrations(dir);
const open = unreviewed(dir);
console.log(
  `Checked migrations: ${all.length} risky statement(s) found, ${all.length - open.length} already reviewed.`,
);
for (const f of open) console.log(`  NOT REVIEWED  ${f.kind}  ${f.migration}:${f.line}  ${f.statement}`);
if (open.length) {
  console.log(
    "\nReview these with the project owner. If approved, add the migration to prisma/migrations/reviewed-destructive.json.",
  );
  process.exit(1);
}
console.log("OK: no unreviewed destructive statements.");
