// Input checks for the test equipment register and calibration records.
// These run on the SERVER for every save; the browser is never trusted.
import { z } from "zod";
import { addDays, addMonthsClamped, localToday } from "@/lib/pm/dates";

export const TEST_KINDS = [
  "SAFETY_ANALYSER",
  "DEFIBRILLATOR_TESTER",
  "FLOW_ANALYSER",
  "PRESSURE_METER",
  "SIMULATOR",
  "MULTIMETER",
  "THERMOMETER",
  "WEIGHTS_OR_SCALE",
  "OTHER",
] as const;
export type TestKind = (typeof TEST_KINDS)[number];
export const KIND_LABELS: Record<TestKind, string> = {
  SAFETY_ANALYSER: "Electrical safety analyser",
  DEFIBRILLATOR_TESTER: "Defibrillator tester",
  FLOW_ANALYSER: "Gas or airflow analyser (ventilator tester)",
  PRESSURE_METER: "Pressure meter or NIBP tester",
  SIMULATOR: "Patient simulator (ECG, SpO2)",
  MULTIMETER: "Multimeter or electrical meter",
  THERMOMETER: "Thermometer or temperature probe",
  WEIGHTS_OR_SCALE: "Weights or scale",
  OTHER: "Other",
};

export const TEST_STATUSES = ["IN_USE", "OUT_OF_SERVICE", "RETIRED"] as const;
export type TestStatus = (typeof TEST_STATUSES)[number];
export const TEST_STATUS_LABELS: Record<TestStatus, string> = {
  IN_USE: "In use",
  OUT_OF_SERVICE: "Out of service",
  RETIRED: "Retired",
};

export const CAL_RESULTS = ["PASS", "PASS_ADJUSTED", "FAIL"] as const;
export type CalResult = (typeof CAL_RESULTS)[number];
export const RESULT_LABELS: Record<CalResult, string> = {
  PASS: "Passed",
  PASS_ADJUSTED: "Passed after adjustment",
  FAIL: "Failed",
};

export const MAX_CERTIFICATE_BYTES = 5 * 1024 * 1024;
/** East Africa for now; the date rule uses this zone. */
export const TESTING_TIME_ZONE = "Africa/Nairobi";
export const DUE_SOON_DAYS = 30;

const NO_CONTROL = /^[^\u0000-\u001f\u007f]*$/;
const NO_CONTROL_MULTILINE = /^[^\u0000-\u0009\u000b\u000c\u000e-\u001f\u007f]*$/;
const blankToNull = (v: unknown) => (v === undefined || (typeof v === "string" && v.trim() === "") ? null : v);

const text = (label: string, min: number, max: number) =>
  z
    .string()
    .trim()
    .min(min, min === 1 ? `${label} is required` : `${label} must be at least ${min} characters`)
    .max(max, `${label} must be ${max} characters or fewer`)
    .regex(NO_CONTROL, `${label} contains invalid characters`);

const optionalText = (label: string, max: number) =>
  z.preprocess(
    blankToNull,
    z
      .string()
      .trim()
      .max(max, `${label} must be ${max} characters or fewer`)
      .regex(NO_CONTROL, `${label} contains invalid characters`)
      .nullable(),
  );

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const realDate = (v: string) => ISO.test(v) && new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) === v;

export const testEquipmentSchema = z.object({
  name: text("Name", 2, 120),
  kind: z.enum(TEST_KINDS, { message: "Choose the type of equipment" }),
  manufacturer: text("Manufacturer", 1, 120),
  model: text("Model", 1, 120),
  serialNumber: text("Serial number", 1, 80),
  equipmentTag: z.preprocess(
    (v) => (typeof v === "string" ? (v.trim() === "" ? null : v.trim().toUpperCase()) : (v ?? null)),
    z
      .string()
      .regex(
        /^[A-Z0-9][A-Z0-9./-]{0,39}$/,
        "Use capital letters, digits, dots, slashes or hyphens (for example TE-001)",
      )
      .nullable(),
  ),
  measures: optionalText("What it measures", 500),
  calibrationIntervalMonths: z.coerce
    .number({ message: "Enter a number of months" })
    .int("Whole months only")
    .min(1, "At least 1 month")
    .max(60, "At most 60 months"),
  heldBy: optionalText("Held by", 120),
  location: optionalText("Location", 120),
  status: z.enum(TEST_STATUSES, { message: "Choose a status" }),
  notes: z.preprocess(
    blankToNull,
    z
      .string()
      .trim()
      .max(2000, "Notes must be 2,000 characters or fewer")
      .regex(NO_CONTROL_MULTILINE, "Notes contain invalid characters")
      .nullable(),
  ),
});
export type TestEquipmentInput = z.output<typeof testEquipmentSchema>;

export const calibrationSchema = z
  .object({
    testEquipmentId: z.string().uuid("Invalid equipment"),
    calibratedOn: z.string().trim().refine(realDate, "Enter the calibration date as YYYY-MM-DD"),
    dueOn: z.preprocess(blankToNull, z.string().trim().refine(realDate, "Enter the due date as YYYY-MM-DD").nullable()),
    certificateNumber: optionalText("Certificate number", 80),
    laboratory: text("Laboratory", 2, 160),
    accreditation: optionalText("Accreditation", 160),
    traceableTo: optionalText("Traceable to", 160),
    result: z.enum(CAL_RESULTS, { message: "Choose the result" }),
    notes: z.preprocess(
      blankToNull,
      z
        .string()
        .trim()
        .max(2000, "Notes must be 2,000 characters or fewer")
        .regex(NO_CONTROL_MULTILINE, "Notes contain invalid characters")
        .nullable(),
    ),
  })
  .superRefine((d, ctx) => {
    const today = localToday(TESTING_TIME_ZONE);
    if (d.calibratedOn > today)
      ctx.addIssue({ code: "custom", path: ["calibratedOn"], message: "The calibration date cannot be in the future" });
    if (d.calibratedOn < "2000-01-01")
      ctx.addIssue({ code: "custom", path: ["calibratedOn"], message: "That date is too far in the past" });
    if (d.dueOn && d.dueOn <= d.calibratedOn)
      ctx.addIssue({ code: "custom", path: ["dueOn"], message: "The due date must be after the calibration date" });
    if (d.dueOn && d.dueOn > "2100-12-31")
      ctx.addIssue({ code: "custom", path: ["dueOn"], message: "That date is too far in the future" });
  });
export type CalibrationInput = z.output<typeof calibrationSchema>;

/** The due date to use: the one typed, or the calibration date plus the tool's interval. */
export function dueDateFor(calibratedOn: string, dueOn: string | null, intervalMonths: number): string {
  return dueOn ?? addMonthsClamped(calibratedOn, intervalMonths);
}

export type CalState = "NOT_CALIBRATED" | "FAILED" | "OVERDUE" | "DUE_SOON" | "CURRENT";
export const CAL_STATE_LABELS: Record<CalState, string> = {
  NOT_CALIBRATED: "No calibration recorded",
  FAILED: "Failed calibration: do not use",
  OVERDUE: "Calibration overdue",
  DUE_SOON: "Due soon",
  CURRENT: "In calibration",
};

/** How a tool stands today, from its latest calibration record. Dates are YYYY-MM-DD. */
export function calibrationState(
  latest: { dueOn: string; result: string } | null,
  today: string = localToday(TESTING_TIME_ZONE),
): CalState {
  if (!latest) return "NOT_CALIBRATED";
  if (latest.result === "FAIL") return "FAILED";
  if (latest.dueOn < today) return "OVERDUE";
  return latest.dueOn <= addDays(today, DUE_SOON_DAYS) ? "DUE_SOON" : "CURRENT";
}
