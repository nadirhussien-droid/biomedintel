// Upload test results (27 Oct 2026). Many devices tested in one session with a safety analyser are
// entered through a spreadsheet instead of one form at a time.
//
// Every row is signed off through the SAME code as the normal sign-off form (completeWorkOrder), so
// every rule that applies there applies here: the checklist limits, the failed-item note, the
// verified test standard, the calibrated test tool, the Do Not Use hold after an electrical fail and
// the audit trail. The spreadsheet only supplies the answers. A row that fails a check is reported
// and skipped; other rows still go through. Nothing is saved at the preview step.
import { z } from "zod";
import { Prisma } from "../db/generated/client";
import { withTenant } from "../db/tenant";
import { audit } from "../audit/audit";
import { requirePermission, type AccessContext } from "../authz/access";
import { ValidationError } from "../authz/errors";
import { completeWorkOrder, startWorkOrder, takeWorkOrder, workOrderScopeWhere } from "./work-orders";
import { requireUsableTestEquipment } from "./testing";
import { checklistSchema, type ChecklistItem } from "@/lib/validation/pm";
import { evaluateRow, MAX_RESULT_ROWS, type SheetJob, type UploadRow } from "@/lib/test-results-upload";

const tenant = (ctx: AccessContext) => ({ userId: ctx.user.id, organizationId: ctx.organization.id });

export const uploadRowSchema = z.object({
  line: z.number().int().min(1).max(100000),
  workOrder: z.string().max(60).nullable(),
  assetTag: z.string().max(100),
  cells: z.record(z.string().max(100), z.string().max(300)),
  notes: z.string().max(500).nullable(),
  findings: z.string().max(2000).nullable(),
});

type Job = SheetJob & { id: string; status: string; assignedToId: string | null };

/** Open planned jobs the person can work on: unassigned ones, and jobs assigned to them. */
export async function listUploadableJobs(ctx: AccessContext, opts: { includeUnassigned: boolean }): Promise<Job[]> {
  await requirePermission(ctx, "workorder.work", { entityType: "work_order" });
  return withTenant(tenant(ctx), async (tx) => {
    const rows = await tx.workOrder.findMany({
      where: {
        AND: [
          workOrderScopeWhere(ctx),
          { checklist: { not: Prisma.DbNull } },
          {
            OR: [
              { assignedToId: ctx.user.id, status: { in: ["ASSIGNED", "IN_PROGRESS", "ON_HOLD"] } },
              ...(opts.includeUnassigned ? [{ assignedToId: null, status: "REQUESTED" as const }] : []),
            ],
          },
        ],
      },
      orderBy: [{ number: "asc" }],
      take: 600,
      select: {
        id: true,
        number: true,
        status: true,
        assignedToId: true,
        checklist: true,
        asset: { select: { assetTag: true, name: true } },
      },
    });
    const jobs: Job[] = [];
    for (const r of rows) {
      const parsed = checklistSchema.safeParse(r.checklist);
      if (!parsed.success) continue;
      jobs.push({
        id: r.id,
        number: r.number,
        status: r.status,
        assignedToId: r.assignedToId,
        assetTag: r.asset.assetTag,
        name: r.asset.name,
        checklist: parsed.data as ChecklistItem[],
      });
    }
    return jobs;
  });
}

export type RowPreview = {
  line: number;
  assetTag: string;
  workOrder: string | null;
  outcome: "READY" | "PROBLEM";
  problems: string[];
  counts: { pass: number; fail: number; na: number };
  electricalFail: boolean;
  usesElectrical: boolean;
  /** The device will be taken from the unassigned list by this person. */
  willTake: boolean;
};

export type ResultsPreview = {
  rows: RowPreview[];
  counts: { ready: number; problem: number; fail: number };
  needsTestEquipment: boolean;
  noOpenJobs: boolean;
};

type Matched = { row: UploadRow; job?: Job; problems: string[] };

function match(jobs: Job[], rows: UploadRow[]): Matched[] {
  const used = new Set<string>();
  const lower = (s: string) => s.trim().toLowerCase();
  return rows.map((row) => {
    let job: Job | undefined;
    const problems: string[] = [];
    if (row.workOrder) {
      job = jobs.find((j) => lower(j.number) === lower(row.workOrder!));
      if (!job) problems.push(`Work order ${row.workOrder} is not one of your open planned jobs.`);
      else if (row.assetTag && lower(job.assetTag) !== lower(row.assetTag))
        problems.push(`Work order ${job.number} is for ${job.assetTag}, not ${row.assetTag}.`);
    } else {
      const found = jobs.filter((j) => lower(j.assetTag) === lower(row.assetTag));
      if (found.length === 0) problems.push(`No open planned job for ${row.assetTag || "this row"}.`);
      else if (found.length > 1)
        problems.push(`${row.assetTag} has more than one open job: fill in the Work order column.`);
      else job = found[0];
    }
    if (job) {
      if (used.has(job.id)) problems.push(`${job.number} appears more than once in the sheet.`);
      used.add(job.id);
    }
    return { row, job, problems };
  });
}

function evaluateAll(jobs: Job[], rows: UploadRow[]) {
  return match(jobs, rows).map((m) => {
    const ev = m.job ? evaluateRow(m.job.checklist, m.row) : null;
    const problems = [...m.problems, ...(ev?.problems ?? [])];
    return { ...m, ev, problems };
  });
}

export async function previewTestResults(
  ctx: AccessContext,
  input: { rows: unknown; includeUnassigned: boolean },
): Promise<ResultsPreview> {
  const rows = parseRows(input.rows);
  const jobs = await listUploadableJobs(ctx, { includeUnassigned: input.includeUnassigned });
  const out = evaluateAll(jobs, rows).map<RowPreview>((m) => ({
    line: m.row.line,
    assetTag: m.row.assetTag,
    workOrder: m.job?.number ?? m.row.workOrder,
    outcome: m.problems.length ? "PROBLEM" : "READY",
    problems: m.problems,
    counts: m.ev?.counts ?? { pass: 0, fail: 0, na: 0 },
    electricalFail: m.ev?.electricalFail ?? false,
    usesElectrical: m.ev?.usesElectrical ?? false,
    willTake: m.job?.status === "REQUESTED",
  }));
  const ready = out.filter((r) => r.outcome === "READY");
  return {
    rows: out,
    counts: {
      ready: ready.length,
      problem: out.length - ready.length,
      fail: ready.filter((r) => r.counts.fail > 0).length,
    },
    needsTestEquipment: ready.some((r) => r.usesElectrical),
    noOpenJobs: jobs.length === 0,
  };
}

function parseRows(raw: unknown): UploadRow[] {
  const r = z.array(uploadRowSchema).min(1).max(MAX_RESULT_ROWS).safeParse(raw);
  if (!r.success) throw new ValidationError("The checked rows were lost. Please check the file again.");
  return r.data;
}

export type UploadResult = {
  signedOff: number;
  withFailures: number;
  holds: number;
  failed: { line: number; assetTag: string; reason: string }[];
};

export async function uploadTestResults(
  ctx: AccessContext,
  input: {
    rows: unknown;
    includeUnassigned: boolean;
    testEquipmentId: string;
    declaration: boolean;
    fileName: string;
  },
): Promise<UploadResult> {
  await requirePermission(ctx, "workorder.work", { entityType: "work_order" });
  if (!input.declaration)
    throw new ValidationError("Confirm the declaration to sign off these results.", { declaration: ["Required"] });
  const rows = parseRows(input.rows);
  const jobs = await listUploadableJobs(ctx, { includeUnassigned: input.includeUnassigned });
  const all = evaluateAll(jobs, rows);
  const good = all.filter((m) => m.problems.length === 0 && m.job && m.ev);
  if (good.some((m) => m.ev!.usesElectrical)) {
    // Checked once, up front: the tool must exist, be in use and not have failed calibration.
    await withTenant(tenant(ctx), (tx) => requireUsableTestEquipment(tx, input.testEquipmentId));
  }
  const failed: UploadResult["failed"] = all
    .filter((m) => m.problems.length)
    .map((m) => ({ line: m.row.line, assetTag: m.row.assetTag, reason: m.problems.join(" ") }));
  let signedOff = 0;
  let withFailures = 0;
  let holds = 0;
  for (const m of good) {
    const job = m.job!;
    const ev = m.ev!;
    try {
      if (job.status === "REQUESTED") await takeWorkOrder(ctx, { id: job.id });
      if (job.status !== "IN_PROGRESS") await startWorkOrder(ctx, { id: job.id });
      await completeWorkOrder(ctx, {
        id: job.id,
        testEquipmentId: ev.usesElectrical ? input.testEquipmentId : undefined,
        resolution:
          m.row.findings ?? `Tested and recorded from an uploaded results sheet (${input.fileName.slice(0, 80)}).`,
        diagnosis: m.row.notes ?? "",
        answers: ev.answers,
        declaration: true,
      });
      signedOff++;
      if (ev.counts.fail > 0) withFailures++;
      if (ev.electricalFail) holds++;
    } catch (error) {
      failed.push({
        line: m.row.line,
        assetTag: m.row.assetTag,
        reason:
          error instanceof ValidationError
            ? firstMessage(error)
            : "Could not be signed off. Open the job and complete it there.",
      });
    }
  }
  await withTenant(tenant(ctx), (tx) =>
    audit(tx, {
      organizationId: ctx.organization.id,
      actorUserId: ctx.user.id,
      action: "workorder.results_uploaded",
      entityType: "work_order",
      metadata: {
        fileName: input.fileName.slice(0, 200),
        rowsChecked: rows.length,
        signedOff,
        withFailures,
        holdsOpened: holds,
        notSignedOff: failed.length,
        testEquipmentId: input.testEquipmentId || null,
        declaration: true,
      },
      request: ctx.request,
    }),
  );
  return { signedOff, withFailures, holds, failed: failed.sort((a, b) => a.line - b.line) };
}

function firstMessage(e: ValidationError) {
  const details = Object.values(e.fieldErrors).flat();
  return details.length ? `${e.message} ${details[0]}` : e.message;
}
