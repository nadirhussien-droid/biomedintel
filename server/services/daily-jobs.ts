// The daily scheduled job (Stage 6 + Stage 7): first preventive maintenance
// generation and reminders, then scheduled report snapshots. Both steps are
// idempotent, so running the job twice in a day is harmless.
import { runScheduledGeneration } from "./pm-generation";
import { runScheduledReports } from "./report-schedules";

export async function runDailyJobs(opts: { now?: Date } = {}) {
  const pm = await runScheduledGeneration(opts);
  const reports = await runScheduledReports(opts);
  return {
    pm: {
      organisations: pm.length,
      created: pm.reduce((t, r) => t + r.created, 0),
      missed: pm.reduce((t, r) => t + r.missed, 0),
      skipped: pm.reduce((t, r) => t + r.skipped, 0),
      failed: pm.reduce((t, r) => t + r.failed, 0),
      remindersSent: pm.reduce((t, r) => t + r.remindersSent, 0),
    },
    reports: {
      created: reports.filter((r) => r.outcome === "created").length,
      alreadyDone: reports.filter((r) => r.outcome === "exists").length,
      failed: reports.filter((r) => r.outcome === "failed").length,
    },
  };
}
