// Protected endpoint for a daily scheduler (Stage 6).
//
//   POST (or GET) /api/cron/pm-generate
//   Authorization: Bearer <CRON_SECRET>
// GET is accepted because some hosting schedulers (e.g. Vercel Cron) only
// send GET; the bearer secret protects both.
//
// Runs the same generation as `npm run pm:generate` for every organisation.
// Without CRON_SECRET configured the endpoint is switched off (503). A wrong
// secret gets 401 and is audited. Responses contain counts only.
import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { auditStandalone } from "@/server/audit/audit";
import { runScheduledGeneration } from "@/server/services/pm-generation";

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
        ipAddress: request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
        userAgent: request.headers.get("user-agent"),
      },
    });
    return NextResponse.json({ message: "Unauthorised." }, { status: 401 });
  }
  try {
    const results = await runScheduledGeneration();
    return NextResponse.json({
      organisations: results.length,
      created: results.reduce((n, r) => n + r.created, 0),
      missed: results.reduce((n, r) => n + r.missed, 0),
      skipped: results.reduce((n, r) => n + r.skipped, 0),
      failed: results.reduce((n, r) => n + r.failed, 0),
      remindersSent: results.reduce((n, r) => n + r.remindersSent, 0),
    });
  } catch (error) {
    console.error("[cron pm-generate]", (error as Error).message);
    return NextResponse.json({ message: "Generation stopped; see the server log." }, { status: 500 });
  }
}

export const GET = POST;
