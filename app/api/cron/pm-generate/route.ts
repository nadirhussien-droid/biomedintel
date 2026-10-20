// Protected endpoint for a daily scheduler (Stage 6).
//
//   POST (or GET) /api/cron/pm-generate
//   Authorization: Bearer <CRON_SECRET>
// GET is accepted because some hosting schedulers (e.g. Vercel Cron) only
// send GET; the bearer secret protects both.
//
// Runs the daily job (`npm run jobs:daily`) for every organisation: PM work
// orders and reminders (Stage 6), then scheduled report snapshots (Stage 7).
// Without CRON_SECRET configured the endpoint is switched off (503). A wrong
// secret gets 401 and is audited. Responses contain counts only.
import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { auditStandalone } from "@/server/audit/audit";
import { clientIp } from "@/server/request-ip";
import { runDailyJobs } from "@/server/services/daily-jobs";
import { log } from "@/server/log";

export const dynamic = "force-dynamic";

function secretMatches(given: string, expected: string): boolean {
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(request: Request) {
  const expected = process.env.CRON_SECRET ?? "";
  if (expected.length < 32) {
    return NextResponse.json({ message: "Scheduled generation is not configured." }, { status: 503 });
  }
  const header = request.headers.get("authorization") ?? "";
  const given = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!secretMatches(given, expected)) {
    await auditStandalone({
      organizationId: null,
      actorUserId: null,
      action: "pm.scheduler_denied",
      outcome: "DENIED",
      request: {
        requestId: request.headers.get("x-request-id"),
        ipAddress: clientIp(request.headers),
        userAgent: request.headers.get("user-agent"),
      },
    });
    return NextResponse.json({ message: "Unauthorised." }, { status: 401 });
  }
  try {
    const r = await runDailyJobs();
    return NextResponse.json({ ...r.pm, reports: r.reports, reminders: r.reminders });
  } catch (error) {
    log.error("cron.daily_jobs_failed", { requestId: request.headers.get("x-request-id") }, error);
    return NextResponse.json({ message: "Generation stopped; see the server log." }, { status: 500 });
  }
}

export const GET = POST;
