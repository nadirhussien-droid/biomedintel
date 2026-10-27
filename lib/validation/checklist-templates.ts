// Saved checklist templates (27 Oct 2026). Checked on the server for every save.
import { z } from "zod";
import { checklistSchema } from "./pm";

const SINGLE_LINE = /^[^\u0000-\u001f\u007f]*$/;
const MULTILINE_TEXT = /^[^\u0000-\u0009\u000b\u000c\u000e-\u001f\u007f]*$/;
const blankToNull = (v: unknown) => (v === undefined || (typeof v === "string" && v.trim() === "") ? null : v);

/** Accepts the checklist as a JSON string (from the form) or as an array. */
const checklistInput = z.preprocess((v) => {
  if (typeof v !== "string") return v;
  try {
    return JSON.parse(v);
  } catch {
    return "invalid";
  }
}, checklistSchema);

export const checklistTemplateSchema = z.object({
  name: z
    .string()
    .trim()
    .min(3, "The template name must be at least 3 characters")
    .max(120, "The template name must be 120 characters or fewer")
    .regex(SINGLE_LINE, "The template name contains invalid characters"),
  deviceType: z.preprocess(
    blankToNull,
    z
      .string()
      .trim()
      .max(120, "At most 120 characters")
      .regex(SINGLE_LINE, "Device type contains invalid characters")
      .nullable(),
  ),
  description: z.preprocess(
    blankToNull,
    z
      .string()
      .trim()
      .max(1000, "At most 1,000 characters")
      .regex(MULTILINE_TEXT, "Description contains invalid characters")
      .nullable(),
  ),
  checklist: checklistInput,
});

export type ChecklistTemplateInput = z.input<typeof checklistTemplateSchema>;
