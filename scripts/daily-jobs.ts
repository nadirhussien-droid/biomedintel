// Runs the daily job once: PM work orders and reminders, then scheduled
// report snapshots. Safe to repeat. Use this from a server cron job.
//
//   npm run jobs:daily
//
// Uses the restricted app database role (RLS applies). Prints counts only.
import "dotenv/config";
import { runDailyJobs } from "../server/services/daily-jobs";
import { db } from "../server/db/client";

runDailyJobs()
  .then((r) => {
    console.log(
      `PM: ${r.pm.created} work order(s) created · ${r.pm.missed} missed · ${r.pm.failed} failed · ${r.pm.remindersSent} reminder(s). ` +
        `Reports: ${r.reports.created} created · ${r.reports.alreadyDone} already done · ${r.reports.failed} failed.`,
    );
    if (r.pm.failed || r.reports.failed) process.exitCode = 2;
  })
  .catch((error) => {
    console.error("Daily job stopped:", (error as Error).message);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
