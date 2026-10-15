// Input validation for work orders (Stage 5). Runs on the server for every
// action; the browser is never trusted. Free-text fields warn against patient
// information on screen and are length-limited here.
import { z } from "zod";

export const WO_STATUSES = ["REQUESTED", "ASSIGNED", "IN_PROGRESS", "ON_HOLD", "COMPLETED", "CANCELLED"] as const;
export type WorkOrderStatusValue = (typeof WO_STATUSES)[number];
export const OPEN_STATUSES = ["REQUESTED", "ASSIGNED", "IN_PROGRESS", "ON_HOLD"] as const;

export const WO_STATUS_LABELS: Record<WorkOrderStatusValue, string> = {
  REQUESTED: "Reported",
  ASSIGNED: "Assigned",
  IN_PROGRESS: "In progress",
  ON_HOLD: "On hold",
  COMPLETED: "Completed",
  CANCELLED: "Cancelled",
};

export const PRIORITIES = ["URGENT", "HIGH", "MEDIUM", "LOW"] as const;
export type PriorityValue = (typeof PRIORITIES)[number];
export const PRIORITY_LABELS: Record<PriorityValue, string> = {
  URGENT: "Urgent",
  HIGH: "High",
  MEDIUM: "Medium",
  LOW: "Low",
};

/** Response targets from the time a fault is reported (configurable later). */
export const PRIORITY_TARGET_HOURS: Record<PriorityValue, number> = { URGENT: 4, HIGH: 24, MEDIUM: 72, LOW: 168 };

export const OUTCOMES = ["REPAIRED", "NO_FAULT_FOUND", "NOT_REPAIRABLE"] as const;
export const OUTCOME_LABELS: Record<(typeof OUTCOMES)[number], string> = {
  REPAIRED: "Repaired — device returned to service",
  NO_FAULT_FOUND: "No fault found — device returned to service",
  NOT_REPAIRABLE: "Not repairable — device stays out of service",
};

export const CHECKS = ["PASS", "FAIL", "NOT_APPLICABLE"] as const;
export const CHECK_LABELS: Record<(typeof CHECKS)[number], string> = {
  PASS: "Pass",
  FAIL: "Fail",
  NOT_APPLICABLE: "Not applicable",
};

export const WO_PAGE_SIZE = 25;
export const MAX_PHOTOS = 5;
export const MAX_PHOTO_BYTES = 5 * 1024 * 1024;
export const PHOTO_MIME = ["image/jpeg", "image/png", "image/webp"] as const;

const uuid = z.string().uuid("Invalid id");
const blankToNull = (v: unknown) => (typeof v === "string" && v.trim() === "" ? null : v);
const MULTILINE_TEXT = /^[^\u0000-\u0009\u000b\u000c\u000e-\u001f\u007f]*$/;

const text = (min: number, max: number, label: string) =>
  z
    .string()
    .trim()
    .min(min, min > 1 ? `${label} must be at least ${min} characters` : `${label} is required`)
    .max(max, `${label} must be ${max.toLocaleString("en-GB")} characters or fewer`)
    .regex(MULTILINE_TEXT, `${label} contains invalid characters`);

const optionalText = (max: number, label: string) => z.preprocess(blankToNull, text(1, max, label).nullable());

export const reportFaultSchema = z.object({
  assetId: uuid,
  faultDescription: text(5, 2000, "Fault description"),
  outOfUse: z.boolean().default(false),
  /** The reporter has seen that another job is already open on this device. */
  confirmDuplicate: z.boolean().default(false),
});

export const workOrderIdSchema = z.object({ id: uuid });

export const assignSchema = z.object({ id: uuid, assigneeId: z.string().trim().min(1).max(100) });

export const prioritySchema = z.object({
  id: uuid,
  priority: z.enum(PRIORITIES, { message: "Choose a supported priority" }),
});

export const holdSchema = z.object({ id: uuid, reason: text(3, 500, "Reason") });

export const noteSchema = z.object({ id: uuid, note: text(2, 2000, "Note") });

export const logWorkSchema = z.object({
  id: uuid,
  description: text(2, 1000, "Work done"),
  minutes: z.coerce
    .number({ message: "Enter the time in minutes" })
    .int("Whole minutes only")
    .min(1, "At least 1 minute")
    .max(1440, "At most 1,440 minutes (24 hours) per entry"),
});

export const completeSchema = z
  .object({
    id: uuid,
    diagnosis: text(3, 2000, "Diagnosis"),
    resolution: text(3, 2000, "Work done and result"),
    outcome: z.enum(OUTCOMES, { message: "Choose the outcome" }),
    functionalCheck: z.enum(CHECKS, { message: "Record the functional check" }),
    electricalSafetyCheck: z.enum(CHECKS, { message: "Record the electrical safety check" }),
    checkNotes: optionalText(1000, "Check notes"),
    declaration: z.literal(true, { message: "Confirm the declaration to sign off" }),
  })
  .superRefine((d, ctx) => {
    if (d.outcome !== "NOT_REPAIRABLE" && d.functionalCheck !== "PASS") {
      ctx.addIssue({
        code: "custom",
        path: ["functionalCheck"],
        message: "A device can only return to service after a passed functional check",
      });
    }
    if (d.outcome !== "NOT_REPAIRABLE" && d.electricalSafetyCheck === "FAIL") {
      ctx.addIssue({
        code: "custom",
        path: ["electricalSafetyCheck"],
        message: "A device with a failed electrical safety test cannot return to service",
      });
    }
    if (d.electricalSafetyCheck === "NOT_APPLICABLE" && !d.checkNotes) {
      ctx.addIssue({
        code: "custom",
        path: ["checkNotes"],
        message: "Say why an electrical safety test was not applicable",
      });
    }
  });

export const reasonSchema = z.object({ id: uuid, reason: text(3, 500, "Reason") });

export const workOrderQuerySchema = z.object({
  q: z
    .string()
    .trim()
    .max(80)
    .regex(/^[^\u0000-\u001f\u007f]*$/)
    .optional()
    .catch(undefined),
  view: z.enum(["open", "mine", "triage", "review", "completed", "all"]).default("open").catch("open"),
  status: z.enum(WO_STATUSES).optional().catch(undefined),
  priority: z.enum(PRIORITIES).optional().catch(undefined),
  hospital: uuid.optional().catch(undefined),
  department: uuid.optional().catch(undefined),
  safety: z.enum(["only"]).optional().catch(undefined),
  sort: z.enum(["createdAt", "dueAt", "priority", "number"]).default("createdAt").catch("createdAt"),
  dir: z.enum(["asc", "desc"]).default("desc").catch("desc"),
  page: z.coerce.number().int().min(1).max(100000).default(1).catch(1),
});

export type WorkOrderQuery = z.output<typeof workOrderQuerySchema>;
