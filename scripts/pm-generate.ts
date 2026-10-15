// Creates due preventive maintenance work orders and sends PM reminders for
// every organisation, once. Safe to run as often as you like: a due date can
// only ever get one work order (see docs/STAGE-6.md).
//
//   npm run pm:generate
//
// Uses the web app's RESTRICTED database role (DATABASE_URL), so Row-Level
// Security applies exactly as in the app. Prints counts only, never data.
// For automatic daily runs, call this from your server's scheduler (cron), or
// use the protected endpoint POST /api/cron/pm-generate (CRON_SECRET).
import "dotenv/config";
import { runScheduledGeneration } from "../server/services/pm-generation";
import { db } from "../server/db/client";

async function main() {
  const results = await runScheduledGeneration();
  const total = results.reduce(
    (t, r) => ({
      created: t.created + r.created,
      missed: t.missed + r.missed,
      failed: t.failed + r.failed,
      skipped: t.skipped + r.skipped,
      reminders: t.reminders + r.remindersSent,
    }),
    { created: 0, missed: 0, failed: 0, skipped: 0, reminders: 0 },
  );
  console.log(
    `PM generation: ${results.length} organisation(s) · ${total.created} work order(s) created · ` +
      `${total.missed} missed · ${total.skipped} skipped · ${total.failed} failed · ${total.reminders} reminder(s) sent`,
  );
  if (total.failed) {
    console.log("Some work orders could not be created. Managers were notified; see Maintenance → Needs review.");
    process.exitCode = 2;
  }
}

main()
  .catch((error) => {
    console.error("PM generation stopped:", (error as Error).message);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
