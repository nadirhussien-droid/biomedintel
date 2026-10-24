import { z } from "zod";

export const PROBLEM_KINDS = ["NOT_WORKING", "UNCLEAR", "SUGGESTION"] as const;
export const PROBLEM_KIND_LABELS: Record<(typeof PROBLEM_KINDS)[number], string> = {
  NOT_WORKING: "Something is not working",
  UNCLEAR: "I don't understand this screen",
  SUGGESTION: "Suggestion",
};

/** A sender may file this many reports in 24 hours (stops accidental floods). */
export const MAX_REPORTS_PER_DAY = 10;

const PAGE = /^\/[A-Za-z0-9/_-]{0,199}$/;

export const problemReportSchema = z.object({
  kind: z.enum(PROBLEM_KINDS, { message: "Choose what kind of problem it is" }),
  message: z
    .string()
    .trim()
    .min(5, "Describe the problem in a few words (at least 5 characters)")
    .max(2000, "At most 2,000 characters"),
  // The page the panel was opened on. Query strings and fragments are dropped;
  // anything that is not a plain app path is recorded as "/".
  pagePath: z.preprocess((v) => {
    const p = typeof v === "string" ? v.split(/[?#]/)[0] : "";
    return PAGE.test(p) ? p : "/";
  }, z.string()),
});

export const resolveProblemSchema = z.object({ id: z.uuid() });
