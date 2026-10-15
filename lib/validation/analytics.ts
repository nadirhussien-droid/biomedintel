// Query validation for analytics (Stage 7). Filters arrive in the URL; they
// are validated here and then checked against the user's scope on the server.
import { z } from "zod";
import { PERIOD_PRESETS } from "@/lib/analytics/period";
import { PRIORITIES, WO_STATUSES } from "./work-orders";

const uuid = z.string().uuid();
const opt = <T extends z.ZodTypeAny>(s: T) =>
  z.preprocess((v) => (v === "" ? undefined : v), s.optional()).catch(undefined);

export const analyticsQuerySchema = z.object({
  period: z.enum(PERIOD_PRESETS).default("this_month").catch("this_month"),
  from: opt(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)),
  to: opt(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)),
  hospital: opt(uuid),
  department: opt(uuid),
  location: opt(uuid),
  category: opt(uuid),
  priority: opt(z.enum(PRIORITIES)),
  assignee: opt(z.string().trim().min(1).max(100)),
  status: opt(z.enum(WO_STATUSES)),
  by: opt(z.enum(["hospital", "department", "category", "location", "asset", "plan", "assignee", "model", "month"])),
  page: z.coerce.number().int().min(1).max(10000).default(1).catch(1),
  threshold: z.coerce.number().int().min(0).max(120).default(12).catch(12),
});

export type AnalyticsQuery = z.output<typeof analyticsQuerySchema>;

export const REPORTS = [
  "overview",
  "pm-compliance",
  "work-orders",
  "reliability",
  "safety",
  "governance",
  "lifecycle",
] as const;
export type ReportName = (typeof REPORTS)[number];

export const REPORT_TITLES: Record<ReportName, string> = {
  overview: "Engineering analytics dashboard",
  "pm-compliance": "Preventive maintenance compliance",
  "work-orders": "Work order performance",
  reliability: "Equipment reliability and failures",
  safety: "Electrical safety and return to service",
  governance: "Maintenance plan governance",
  lifecycle: "Equipment lifecycle and cost",
};

export const scheduleSchema = z.object({
  name: z
    .string()
    .trim()
    .min(3, "At least 3 characters")
    .max(120)
    .regex(/^[^\u0000-\u001f\u007f]*$/),
  kind: z.enum(["OVERVIEW", "PM_COMPLIANCE", "WORK_ORDERS", "RELIABILITY", "SAFETY"], { message: "Choose a report" }),
  frequency: z.enum(["WEEKLY", "MONTHLY"], { message: "Choose how often" }),
  hospitalId: z.preprocess((v) => (v === "" || v === undefined ? null : v), uuid.nullable()),
  recipientIds: z.array(z.string().trim().min(1).max(100)).min(1, "Choose at least one recipient").max(50),
});

export const REPORT_KIND_LABELS: Record<string, string> = {
  OVERVIEW: "Analytics dashboard summary",
  PM_COMPLIANCE: "PM compliance",
  WORK_ORDERS: "Work order performance",
  RELIABILITY: "Equipment reliability",
  SAFETY: "Electrical safety",
};
