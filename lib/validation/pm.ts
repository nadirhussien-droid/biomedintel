// Input validation for preventive maintenance (Stage 6). Runs on the server
// for every action; the browser is never trusted.
import { z } from "zod";
import { isDateOnly } from "@/lib/pm/dates";
import { PRIORITIES } from "./work-orders";

export const PLAN_STATUSES = ["DRAFT", "ACTIVE", "PAUSED", "ARCHIVED"] as const;
export const PLAN_STATUS_LABELS: Record<(typeof PLAN_STATUSES)[number], string> = {
  DRAFT: "Draft — awaiting approval",
  ACTIVE: "Active",
  PAUSED: "Paused",
  ARCHIVED: "Archived",
};

export const TARGET_KINDS = ["ASSET", "MODEL", "CATEGORY"] as const;
export const TARGET_LABELS: Record<(typeof TARGET_KINDS)[number], string> = {
  ASSET: "One asset",
  MODEL: "Every asset of one model",
  CATEGORY: "Every asset in one category",
};

export const PLAN_WORK_TYPES = ["PREVENTIVE", "SAFETY_TEST", "INSPECTION", "CALIBRATION"] as const;
export const WORK_TYPE_LABELS: Record<string, string> = {
  CORRECTIVE: "Corrective (fault)",
  PREVENTIVE: "Preventive maintenance",
  SAFETY_TEST: "Electrical safety test",
  INSPECTION: "Inspection",
  CALIBRATION: "Calibration",
  ACCEPTANCE: "Acceptance test",
};

export const INTERVAL_UNITS = ["DAY", "WEEK", "MONTH"] as const;
export const INTERVAL_UNIT_LABELS: Record<(typeof INTERVAL_UNITS)[number], string> = {
  DAY: "days",
  WEEK: "weeks",
  MONTH: "months",
};

/** Interval presets offered in the form (custom = any count and unit). */
export const INTERVAL_PRESETS = [
  { key: "weekly", label: "Weekly", count: 1, unit: "WEEK" },
  { key: "monthly", label: "Monthly", count: 1, unit: "MONTH" },
  { key: "quarterly", label: "Quarterly (3 months)", count: 3, unit: "MONTH" },
  { key: "semiannual", label: "Semiannual (6 months)", count: 6, unit: "MONTH" },
  { key: "annual", label: "Annual (12 months)", count: 12, unit: "MONTH" },
] as const;

/** Decision of 15 Oct 2026, in priority order. */
export const INTERVAL_SOURCES = [
  "REGULATORY_REQUIREMENT",
  "ORGANIZATIONAL_REQUIREMENT",
  "MANUFACTURER",
  "ORGANIZATION_DEFINED",
] as const;
export type IntervalSourceValue = (typeof INTERVAL_SOURCES)[number];
export const INTERVAL_SOURCE_LABELS: Record<IntervalSourceValue, string> = {
  REGULATORY_REQUIREMENT: "1 · Regulatory requirement",
  ORGANIZATIONAL_REQUIREMENT: "1 · Organisational requirement (policy)",
  MANUFACTURER: "2 · Manufacturer recommendation for this model",
  ORGANIZATION_DEFINED: "3 · Organisation-defined (no manufacturer guidance)",
};

export const CHECKLIST_SECTIONS = ["INSPECTION", "FUNCTIONAL", "SERVICING", "ELECTRICAL_SAFETY"] as const;
export type ChecklistSection = (typeof CHECKLIST_SECTIONS)[number];
export const SECTION_LABELS: Record<ChecklistSection, string> = {
  INSPECTION: "Inspection",
  FUNCTIONAL: "Functional test",
  SERVICING: "Cleaning / servicing",
  ELECTRICAL_SAFETY: "Electrical safety",
};

export const OCCURRENCE_STATUS_LABELS: Record<string, string> = {
  SCHEDULED: "Scheduled",
  WORK_ORDER_CREATED: "Work order open",
  COMPLETED: "Completed",
  CANCELLED: "Cancelled",
  MISSED: "Missed",
  FAILED: "Generation failed",
  SKIPPED: "Skipped",
};

export const HOLD_STATUS_LABELS: Record<string, string> = {
  AWAITING_REPAIR: "Awaiting repair",
  AWAITING_RETEST: "Awaiting retest",
  AWAITING_APPROVAL: "Retest passed — awaiting second-person approval",
  RELEASED: "Released to service",
};

export const DO_NOT_USE_LABEL = "Failed Safety Test — Do Not Use";

const uuid = z.string().uuid("Invalid id");
const blankToNull = (v: unknown) => (v === undefined || (typeof v === "string" && v.trim() === "") ? null : v);
const blankToUndefined = (v: unknown) => (typeof v === "string" && v.trim() === "" ? undefined : v);
const MULTILINE_TEXT = /^[^\u0000-\u0009\u000b\u000c\u000e-\u001f\u007f]*$/;
const SINGLE_LINE = /^[^\u0000-\u001f\u007f]*$/;

const text = (min: number, max: number, label: string, multiline = false) =>
  z
    .string()
    .trim()
    .min(min, min > 1 ? `${label} must be at least ${min} characters` : `${label} is required`)
    .max(max, `${label} must be ${max.toLocaleString("en-GB")} characters or fewer`)
    .regex(multiline ? MULTILINE_TEXT : SINGLE_LINE, `${label} contains invalid characters`);

const optionalText = (max: number, label: string, multiline = false) =>
  z.preprocess(blankToNull, text(1, max, label, multiline).nullable());

export const dateOnly = (label: string) =>
  z
    .string({ message: `${label} is required` })
    .trim()
    .refine((v) => isDateOnly(v), `${label} must be a real date (YYYY-MM-DD)`);

const optionalDate = (label: string) => z.preprocess(blankToNull, dateOnly(label).nullable());

const optionalNumber = z.preprocess(
  (v) => (v === "" || v === null || v === undefined ? null : v),
  z.coerce.number({ message: "Enter a number" }).finite().nullable(),
);

// ─── Checklist ───────────────────────────────────────────────────────────────

export const checklistItemSchema = z
  .object({
    key: z
      .string()
      .trim()
      .regex(/^[a-z0-9_-]{1,40}$/i, "Invalid item key"),
    label: text(3, 200, "Checklist item"),
    section: z.enum(CHECKLIST_SECTIONS, { message: "Choose a section" }),
    kind: z.enum(["CHECK", "MEASUREMENT"]).default("CHECK"),
    required: z.boolean().default(true),
    unit: z.preprocess(blankToNull, text(1, 20, "Unit").nullable()).default(null),
    min: optionalNumber.default(null),
    max: optionalNumber.default(null),
    guidance: optionalText(300, "Guidance").default(null),
  })
  .superRefine((item, ctx) => {
    if (item.kind === "MEASUREMENT" && !item.unit) {
      ctx.addIssue({ code: "custom", path: ["unit"], message: "A measurement needs a unit, e.g. Ω or µA" });
    }
    if (item.min !== null && item.max !== null && item.min > item.max) {
      ctx.addIssue({ code: "custom", path: ["max"], message: "The upper limit must not be below the lower limit" });
    }
  });

export type ChecklistItem = z.output<typeof checklistItemSchema>;

export const checklistSchema = z
  .array(checklistItemSchema)
  .min(1, "Add at least one checklist item")
  .max(60, "A checklist can have at most 60 items")
  .superRefine((items, ctx) => {
    const seen = new Set<string>();
    items.forEach((i, idx) => {
      if (seen.has(i.key)) ctx.addIssue({ code: "custom", path: [idx, "key"], message: "Duplicate item key" });
      seen.add(i.key);
    });
  });

/** Accepts the checklist as a JSON string (from the form) or as an array. */
const checklistInput = z.preprocess((v) => {
  if (typeof v !== "string") return v;
  try {
    return JSON.parse(v);
  } catch {
    return "invalid";
  }
}, checklistSchema);

export const hasElectricalSafety = (items: readonly { section: string }[]) =>
  items.some((i) => i.section === "ELECTRICAL_SAFETY");

// ─── Plans ───────────────────────────────────────────────────────────────────

export const planSchema = z
  .object({
    name: text(3, 120, "Plan name"),
    description: optionalText(1000, "Description", true),
    hospitalId: z.preprocess(blankToNull, uuid.nullable()),
    workType: z.enum(PLAN_WORK_TYPES, { message: "Choose a maintenance type" }),
    targetKind: z.enum(TARGET_KINDS, { message: "Choose what the plan applies to" }),
    targetId: uuid,
    intervalCount: z.coerce.number({ message: "Enter the interval" }).int("Whole numbers only").min(1, "At least 1"),
    intervalUnit: z.enum(INTERVAL_UNITS, { message: "Choose days, weeks or months" }),
    intervalSource: z.enum(INTERVAL_SOURCES, { message: "Say where the interval comes from" }),
    sourceReference: optionalText(300, "Source reference"),
    justification: optionalText(1000, "Justification", true),
    startsOn: dateOnly("Start date"),
    endsOn: optionalDate("End date"),
    leadDays: z.coerce.number().int("Whole days").min(0, "0 or more").max(90, "At most 90 days").default(14),
    graceDays: z.coerce.number().int("Whole days").min(0, "0 or more").max(60, "At most 60 days").default(0),
    estimatedMinutes: z.preprocess(
      blankToNull,
      z.coerce.number().int("Whole minutes").min(1, "At least 1 minute").max(2880, "At most 2 days").nullable(),
    ),
    defaultAssigneeId: z.preprocess(blankToNull, z.string().trim().min(1).max(100).nullable()),
    requiredCompetency: optionalText(200, "Required competency"),
    priority: z.enum(PRIORITIES, { message: "Choose a priority" }).default("MEDIUM"),
    documentReference: optionalText(300, "Service documentation reference"),
    instructions: optionalText(4000, "Instructions", true),
    checklist: checklistInput,
  })
  .superRefine((d, ctx) => {
    const max = d.intervalUnit === "DAY" ? 366 : d.intervalUnit === "WEEK" ? 104 : 120;
    if (d.intervalCount > max) {
      ctx.addIssue({
        code: "custom",
        path: ["intervalCount"],
        message: `At most ${max} ${INTERVAL_UNIT_LABELS[d.intervalUnit]}`,
      });
    }
    if (d.endsOn && d.endsOn < d.startsOn) {
      ctx.addIssue({ code: "custom", path: ["endsOn"], message: "The end date must be after the start date" });
    }
    if (d.intervalSource === "ORGANIZATION_DEFINED") {
      if (!d.justification || d.justification.length < 20) {
        ctx.addIssue({
          code: "custom",
          path: ["justification"],
          message: "Explain why this interval was chosen (at least 20 characters)",
        });
      }
    } else if (!d.sourceReference || d.sourceReference.length < 3) {
      ctx.addIssue({
        code: "custom",
        path: ["sourceReference"],
        message:
          d.intervalSource === "MANUFACTURER"
            ? "Name the manufacturer document, e.g. service manual and section"
            : "Name the requirement, e.g. the regulation or policy and clause",
      });
    }
    if (d.targetKind === "CATEGORY" && d.intervalSource === "MANUFACTURER") {
      ctx.addIssue({
        code: "custom",
        path: ["intervalSource"],
        message: "A category contains different makes: use a model plan for a manufacturer interval",
      });
    }
  });

export type PlanInput = z.output<typeof planSchema>;

export const planIdSchema = z.object({ id: uuid });

export const approvePlanSchema = z.object({
  id: uuid,
  effectiveFrom: dateOnly("Effective date"),
  nextReviewOn: dateOnly("Next interval review date"),
  note: optionalText(500, "Approval note"),
  confirm: z.literal(true, { message: "Confirm that you have checked the procedure, limits and interval" }),
});

export const reviewPlanSchema = z.object({
  id: uuid,
  nextReviewOn: dateOnly("Next interval review date"),
  note: text(10, 500, "Review note"),
});

export const pausePlanSchema = z.object({ id: uuid, reason: text(3, 500, "Reason") });
export const archivePlanSchema = z.object({ id: uuid, reason: text(3, 500, "Reason") });

export const enrolSchema = z.object({
  id: uuid,
  firstDueOn: dateOnly("First due date"),
  assetIds: z.array(uuid).max(500, "At most 500 assets at a time").default([]),
});

export const endScheduleSchema = z.object({ id: uuid, reason: text(3, 300, "Reason") });

// ─── Standards and manufacturer intervals ─────────────────────────────────────

export const standardSchema = z.object({
  code: text(2, 40, "Standard"),
  version: text(1, 40, "Version or edition"),
  title: text(3, 200, "Title"),
  jurisdictionNote: optionalText(300, "Where it applies"),
});

export const verifyStandardSchema = z.object({
  id: uuid,
  note: text(10, 500, "Verification note"),
});

export const standardRuleSchema = z
  .object({
    standardId: uuid,
    hospitalId: z.preprocess(blankToNull, uuid.nullable()),
    country: z.preprocess(
      (v) => (typeof v === "string" ? (v.trim() === "" ? null : v.trim().toUpperCase()) : v),
      z
        .string()
        .regex(/^[A-Z]{2}$/, "Use a two-letter country code, e.g. KE")
        .nullable(),
    ),
    categoryId: z.preprocess(blankToNull, uuid.nullable()),
  })
  .refine((d) => !(d.hospitalId && d.country), {
    path: ["country"],
    message: "Choose a hospital OR a country, not both",
  });

export const modelIntervalSchema = z
  .object({
    modelId: uuid,
    count: z.preprocess(blankToNull, z.coerce.number().int().min(1, "At least 1").max(366).nullable()),
    unit: z.preprocess(blankToNull, z.enum(INTERVAL_UNITS).nullable()),
    reference: optionalText(300, "Manufacturer document"),
  })
  .superRefine((d, ctx) => {
    const any = d.count !== null || d.unit !== null || d.reference !== null;
    if (any && (d.count === null || d.unit === null || !d.reference || d.reference.length < 3)) {
      ctx.addIssue({
        code: "custom",
        path: ["reference"],
        message: "Give the interval, its unit and the manufacturer document (or clear all three)",
      });
    }
  });

// ─── Completing a PM job ──────────────────────────────────────────────────────

export const checklistAnswerSchema = z.object({
  key: z.string().trim().min(1).max(40),
  result: z.enum(["PASS", "FAIL", "NOT_APPLICABLE"], { message: "Answer every item" }),
  value: optionalNumber,
  notes: optionalText(500, "Notes"),
});

export const pmCompleteSchema = z.object({
  id: uuid,
  resolution: text(3, 2000, "Work done and findings", true),
  diagnosis: optionalText(2000, "Notes", true),
  answers: z.array(checklistAnswerSchema).max(60),
  declaration: z.literal(true, { message: "Confirm the declaration to sign off" }),
});

// ─── Safety holds ─────────────────────────────────────────────────────────────

export const holdDecisionSchema = z.object({
  id: uuid,
  note: text(10, 1000, "Review note", true),
  confirm: z.literal(true, { message: "Confirm that you reviewed the retest results" }),
});

export const holdRejectSchema = z.object({ id: uuid, note: text(10, 1000, "Reason", true) });

// ─── Lists, calendar and reports ──────────────────────────────────────────────

export const SCHEDULE_VIEWS = ["upcoming", "today", "overdue", "history", "all"] as const;
export const SCHEDULE_STATUSES = [
  "SCHEDULED",
  "WORK_ORDER_CREATED",
  "COMPLETED",
  "CANCELLED",
  "MISSED",
  "FAILED",
  "SKIPPED",
] as const;
export const PM_PAGE_SIZE = 25;

const dateFilter = z.preprocess(blankToUndefined, dateOnly("Date").optional()).catch(undefined);

export const scheduleQuerySchema = z.object({
  view: z.enum(SCHEDULE_VIEWS).default("upcoming").catch("upcoming"),
  q: z.string().trim().max(80).regex(SINGLE_LINE).optional().catch(undefined),
  from: dateFilter,
  to: dateFilter,
  within: z.coerce.number().int().min(1).max(366).optional().catch(undefined),
  hospital: uuid.optional().catch(undefined),
  department: uuid.optional().catch(undefined),
  category: uuid.optional().catch(undefined),
  location: uuid.optional().catch(undefined),
  asset: uuid.optional().catch(undefined),
  plan: uuid.optional().catch(undefined),
  assignee: z.string().trim().min(1).max(100).optional().catch(undefined),
  status: z.enum(SCHEDULE_STATUSES).optional().catch(undefined),
  priority: z.enum(PRIORITIES).optional().catch(undefined),
  sort: z.enum(["due", "asset", "plan", "priority"]).default("due").catch("due"),
  dir: z.enum(["asc", "desc"]).default("asc").catch("asc"),
  page: z.coerce.number().int().min(1).max(100000).default(1).catch(1),
});
export type ScheduleQuery = z.output<typeof scheduleQuerySchema>;

export const planQuerySchema = z.object({
  q: z.string().trim().max(80).regex(SINGLE_LINE).optional().catch(undefined),
  status: z.enum(PLAN_STATUSES).optional().catch(undefined),
  type: z.enum(PLAN_WORK_TYPES).optional().catch(undefined),
  page: z.coerce.number().int().min(1).max(100000).default(1).catch(1),
});

export const reportQuerySchema = z.object({
  from: dateFilter,
  to: dateFilter,
  hospital: uuid.optional().catch(undefined),
  by: z.enum(["category", "department", "hospital", "assignee", "location"]).default("category").catch("category"),
});
export type ReportQuery = z.output<typeof reportQuerySchema>;
