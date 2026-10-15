// Input validation for equipment assets (Stage 4).
// These schemas run on the SERVER for every create/edit; the browser is never
// trusted. No field asks for patient information.
import { z } from "zod";
import { warrantyDetailFields } from "./inventory";

export const ASSET_STATUSES = ["IN_SERVICE", "UNDER_REPAIR", "OUT_OF_SERVICE", "DECOMMISSIONED"] as const;
export type AssetStatusValue = (typeof ASSET_STATUSES)[number];

/** Statuses a person can set directly. DECOMMISSIONED only comes from an approved request. */
export const EDITABLE_STATUSES = ["IN_SERVICE", "UNDER_REPAIR", "OUT_OF_SERVICE"] as const;

export const STATUS_LABELS: Record<AssetStatusValue, string> = {
  IN_SERVICE: "In service",
  UNDER_REPAIR: "Under repair / maintenance",
  OUT_OF_SERVICE: "Out of service",
  DECOMMISSIONED: "Decommissioned",
};

export const RISK_CLASSES = ["HIGH", "MEDIUM", "LOW"] as const;
export type RiskClassValue = (typeof RISK_CLASSES)[number];
export const RISK_LABELS: Record<RiskClassValue, string> = { HIGH: "High", MEDIUM: "Medium", LOW: "Low" };

export const SORT_FIELDS = ["assetTag", "name", "status", "updatedAt", "createdAt"] as const;
export const PAGE_SIZE = 25;

const uuid = z.string().uuid("Invalid id");

/** Empty or missing form values become null. */
const blankToNull = (v: unknown) => (v === undefined || (typeof v === "string" && v.trim() === "") ? null : v);

// Printable text without control characters (prevents hidden characters in records and labels).
const NO_CONTROL = /^[^\u0000-\u001f\u007f]*$/;
const NO_CONTROL_MULTILINE = /^[^\u0000-\u0009\u000b\u000c\u000e-\u001f\u007f]*$/;

const optionalText = (max: number, label: string) =>
  z.preprocess(
    blankToNull,
    z
      .string()
      .trim()
      .max(max, `${label} must be ${max} characters or fewer`)
      .regex(NO_CONTROL, `${label} contains invalid characters`)
      .nullable(),
  );

export const assetTagSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(
    /^[A-Z0-9][A-Z0-9./-]{0,39}$/,
    "Use 1–40 capital letters, digits, dots, slashes or hyphens, starting with a letter or digit (e.g. INF-0412)",
  );

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function isRealDate(value: string): boolean {
  if (!ISO_DATE.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

const todayIso = () => new Date().toISOString().slice(0, 10);

/** Optional YYYY-MM-DD date; `pastOnly` rejects future dates (purchase, commissioning). */
const optionalDate = (label: string, pastOnly: boolean) =>
  z.preprocess(
    blankToNull,
    z
      .string()
      .trim()
      .refine(isRealDate, `${label} must be a real date (YYYY-MM-DD)`)
      .refine((v) => v >= "1970-01-01", `${label} is too far in the past`)
      .refine((v) => v <= "2100-12-31", `${label} is too far in the future`)
      .refine((v) => !pastOnly || v <= todayIso(), `${label} cannot be in the future`)
      .nullable(),
  );

const requiredDate = (label: string) =>
  z
    .string()
    .trim()
    .refine(isRealDate, `${label} must be a real date (YYYY-MM-DD)`)
    .refine((v) => v >= "1970-01-01" && v <= "2100-12-31", `${label} is out of range`);

const optionalUuid = z.preprocess(blankToNull, uuid.nullable());

const assetFields = {
  name: z
    .string()
    .trim()
    .min(2, "Name must be at least 2 characters")
    .max(120, "Name must be 120 characters or fewer")
    .regex(NO_CONTROL, "Name contains invalid characters"),
  assetTag: assetTagSchema,
  modelId: uuid,
  hospitalId: uuid,
  departmentId: uuid,
  locationId: optionalUuid,
  serialNumber: optionalText(80, "Serial number"),
  inventoryNumber: optionalText(40, "Inventory number"),
  supplier: optionalText(120, "Supplier"),
  description: z.preprocess(
    blankToNull,
    z
      .string()
      .trim()
      .max(2000, "Description must be 2,000 characters or fewer")
      .regex(NO_CONTROL_MULTILINE, "Description contains invalid characters")
      .nullable(),
  ),
  status: z.enum(EDITABLE_STATUSES, { message: "Choose a supported status" }),
  riskClass: z.preprocess(blankToNull, z.enum(RISK_CLASSES, { message: "Choose High, Medium or Low" }).nullable()),
  purchaseDate: optionalDate("Purchase date", true),
  commissionedAt: optionalDate("Commissioning date", true),
  eolDate: optionalDate("End-of-life date", false),
  purchaseCost: z.preprocess(
    blankToNull,
    z
      .string()
      .trim()
      .regex(/^\d{1,12}(\.\d{1,2})?$/, "Enter an amount like 1250 or 1250.50")
      .nullable(),
  ),
  purchaseCurrency: z.preprocess(
    (v) => (typeof v === "string" ? (v.trim() === "" ? null : v.trim().toUpperCase()) : (v ?? null)),
    z
      .string()
      .regex(/^[A-Z]{3}$/, "Use a 3-letter currency code, e.g. KES, UGX or USD")
      .nullable(),
  ),
  /** Set when the user has confirmed a duplicate serial number is really a different device. */
  confirmDuplicateSerial: z.boolean().default(false),
};

type AssetShape = {
  purchaseDate: string | null;
  commissionedAt: string | null;
  purchaseCost: string | null;
  purchaseCurrency: string | null;
};

function crossFieldChecks(data: AssetShape, ctx: z.RefinementCtx) {
  if (data.purchaseDate && data.commissionedAt && data.commissionedAt < data.purchaseDate) {
    ctx.addIssue({
      code: "custom",
      path: ["commissionedAt"],
      message: "Commissioning date cannot be before the purchase date",
    });
  }
  if ((data.purchaseCost === null) !== (data.purchaseCurrency === null)) {
    ctx.addIssue({
      code: "custom",
      path: [data.purchaseCost === null ? "purchaseCost" : "purchaseCurrency"],
      message: "Enter both the purchase cost and its currency, or neither",
    });
  }
}

export const createAssetSchema = z.object(assetFields).superRefine(crossFieldChecks);

export const updateAssetSchema = z
  .object({
    ...assetFields,
    id: uuid,
    /** updatedAt the form was loaded with; stops two people overwriting each other. */
    version: z.string().datetime({ message: "Reload the page and try again" }),
  })
  .superRefine(crossFieldChecks);

export type CreateAssetInput = z.output<typeof createAssetSchema>;

export const quickStatusSchema = z.object({
  id: uuid,
  status: z.enum(EDITABLE_STATUSES, { message: "Choose a supported status" }),
  reason: optionalText(500, "Reason"),
  locationId: optionalUuid.optional(),
});

export const assetIdSchema = z.object({ id: uuid });

export const decommissionRequestSchema = z.object({
  id: uuid,
  reason: z
    .string()
    .trim()
    .min(5, "Give a reason of at least 5 characters")
    .max(1000, "Reason must be 1,000 characters or fewer")
    .regex(NO_CONTROL_MULTILINE, "Reason contains invalid characters"),
  effectiveOn: optionalDate("Effective date", false),
});

export const decommissionDecisionSchema = z
  .object({
    requestId: uuid,
    decision: z.enum(["APPROVE", "REJECT"]),
    note: optionalText(500, "Note"),
  })
  .superRefine((d, ctx) => {
    if (d.decision === "REJECT" && !d.note) {
      ctx.addIssue({ code: "custom", path: ["note"], message: "Say why the request is rejected" });
    }
  });

export const warrantySchema = z
  .object({
    assetId: uuid,
    kind: z.enum(["WARRANTY", "SERVICE_CONTRACT"]),
    provider: z
      .string()
      .trim()
      .min(2, "Provider must be at least 2 characters")
      .max(160)
      .regex(NO_CONTROL, "Provider contains invalid characters"),
    startsOn: optionalDate("Start date", false),
    endsOn: requiredDate("End date"),
    coverage: optionalText(500, "Coverage"),
    // Stage 8 details (all optional; blank coverage answers mean "not recorded").
    ...warrantyDetailFields,
  })
  .superRefine((d, ctx) => {
    if (d.startsOn && d.endsOn < d.startsOn) {
      ctx.addIssue({ code: "custom", path: ["endsOn"], message: "End date cannot be before the start date" });
    }
  });

// ─── Catalog ─────────────────────────────────────────────────────────────────

const catalogName = z
  .string()
  .trim()
  .min(2, "Name must be at least 2 characters")
  .max(120, "Name must be 120 characters or fewer")
  .regex(NO_CONTROL, "Name contains invalid characters");

export const manufacturerSchema = z.object({
  name: catalogName,
  country: z.preprocess(
    (v) => (typeof v === "string" ? (v.trim() === "" ? null : v.trim().toUpperCase()) : (v ?? null)),
    z
      .string()
      .regex(/^[A-Z]{2}$/, "Use a 2-letter country code, e.g. KE")
      .nullable(),
  ),
  supportContact: optionalText(200, "Support contact"),
});

export const categorySchema = z.object({
  name: catalogName,
  defaultRiskClass: z.preprocess(blankToNull, z.enum(RISK_CLASSES).nullable()),
  defaultPmIntervalMonths: z.preprocess(
    blankToNull,
    z.coerce.number().int("Whole months only").min(1).max(120).nullable(),
  ),
});

export const modelSchema = z.object({
  manufacturerId: uuid,
  categoryId: uuid,
  modelName: catalogName,
  expectedLifeYears: z.preprocess(blankToNull, z.coerce.number().int("Whole years only").min(1).max(50).nullable()),
});

export const locationSchema = z.object({
  hospitalId: uuid,
  departmentId: uuid,
  name: catalogName,
  building: optionalText(80, "Building"),
  floor: optionalText(40, "Floor"),
});

// ─── Register search ─────────────────────────────────────────────────────────

/**
 * Query-string filters for the register and the CSV export. Anything invalid
 * falls back to a safe default instead of failing the page.
 */
export const assetQuerySchema = z.object({
  q: z.string().trim().max(80).regex(NO_CONTROL).optional().catch(undefined),
  hospital: uuid.optional().catch(undefined),
  department: uuid.optional().catch(undefined),
  category: uuid.optional().catch(undefined),
  manufacturer: uuid.optional().catch(undefined),
  status: z.enum(ASSET_STATUSES).optional().catch(undefined),
  risk: z.enum(RISK_CLASSES).optional().catch(undefined),
  archived: z.enum(["exclude", "include", "only"]).default("exclude").catch("exclude"),
  sort: z.enum(SORT_FIELDS).default("assetTag").catch("assetTag"),
  dir: z.enum(["asc", "desc"]).default("asc").catch("asc"),
  page: z.coerce.number().int().min(1).max(100000).default(1).catch(1),
});

export type AssetQuery = z.output<typeof assetQuerySchema>;
