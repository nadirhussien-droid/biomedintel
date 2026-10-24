// Input checks for hourly labour rates. These run on the SERVER for every save.
import { z } from "zod";

export const labourRateSchema = z.object({
  userId: z.string().trim().min(1, "Choose a person").max(100),
  hourlyRate: z
    .string()
    .trim()
    .regex(/^\d{1,6}(\.\d{1,2})?$/, "Enter an amount like 12 or 12.50"),
  currency: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{3}$/, "Use a 3-letter currency code such as USD, KES or AUD"),
  effectiveFrom: z
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Enter a date")
    .refine((v) => v >= "2000-01-01" && v <= "2100-12-31", "Date is out of range"),
  note: z.preprocess(
    (v) => (v === undefined || (typeof v === "string" && v.trim() === "") ? null : v),
    z.string().trim().max(300, "300 characters or fewer").nullable(),
  ),
});
