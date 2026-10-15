// The daily scheduled job (Stages 6–8): preventive maintenance generation and
// reminders, then scheduled report snapshots, then lifecycle/inventory reminders. Every step is
// idempotent, so running the job twice in a day is harmless.
import { runScheduledGeneration } from "./pm-generation";
import { runScheduledReports } from "./report-schedules";
import { runInventoryReminders } from "./inventory-reminders";

export async function runDailyJobs(opts: { now?: Date } = {}) {
  const pm = await runScheduledGeneration(opts);
  const reports = await runScheduledReports(opts);
  // Stage 8: warranty, contract, stock, supplier, purchasing and lifecycle reminders.
  const reminders = await runInventoryReminders(opts);
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
    reminders: {
      sent: reminders.reduce((t, r) => t + r.sent, 0),
      failed: reminders.filter((r) => r.failed).length,
    },
  };
}
