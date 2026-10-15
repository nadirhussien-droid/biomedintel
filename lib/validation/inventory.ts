// Input validation for Stage 8: suppliers, spare parts and stock, work order
// parts, purchase requests, warranty claims, external service, lifecycle and
// reminder settings. These schemas run on the SERVER; the browser is never trusted.
import { z } from "zod";

const uuid = z.string().uuid("Invalid id");
const blankToNull = (v: unknown) => (v === undefined || (typeof v === "string" && v.trim() === "") ? null : v);
const ONE_LINE = /^[^\u0000-\u001f\u007f]*$/;
const MULTILINE = /^[^\u0000-\u0009\u000b\u000c\u000e-\u001f\u007f]*$/;

export const text = (min: number, max: number, label: string, multiline = false) =>
  z
    .string({ message: `${label} is required` })
    .trim()
    .min(min, min > 1 ? `${label} must be at least ${min} characters` : `${label} is required`)
    .max(max, `${label} must be ${max.toLocaleString("en-GB")} characters or fewer`)
    .regex(multiline ? MULTILINE : ONE_LINE, `${label} contains invalid characters`);
export const optionalText = (max: number, label: string, multiline = false) =>
  z.preprocess(blankToNull, text(1, max, label, multiline).nullable());
const optionalUuid = z.preprocess(blankToNull, uuid.nullable());

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
export function isRealDate(value: string): boolean {
  if (!ISO_DATE.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}
const dateText = (label: string) =>
  z
    .string({ message: `${label} is required` })
    .trim()
    .refine(isRealDate, `${label} must be a real date (YYYY-MM-DD)`)
    .refine((v) => v >= "1970-01-01" && v <= "2100-12-31", `${label} is out of range`);
export const requiredDate = (label: string) => dateText(label);
export const optionalDate = (label: string) => z.preprocess(blankToNull, dateText(label).nullable());

const money = (label: string) =>
  z.preprocess(
    blankToNull,
    z
      .string()
      .trim()
      .regex(/^\d{1,12}(\.\d{1,2})?$/, `${label}: enter an amount like 120 or 120.50`)
      .nullable(),
  );
const currency = z.preprocess(
  (v) => (typeof v === "string" ? (v.trim() === "" ? null : v.trim().toUpperCase()) : (v ?? null)),
  z
    .string()
    .regex(/^[A-Z]{3}$/, "Use a 3-letter currency code, e.g. KES, AUD or USD")
    .nullable(),
);
const wholeNumber = (label: string, min: number, max: number) =>
  z.coerce
    .number({ message: `Enter ${label.toLowerCase()} as a whole number` })
    .int(`${label} must be a whole number`)
    .min(min, `${label} must be at least ${min}`)
    .max(max, `${label} must be ${max.toLocaleString("en-GB")} or less`);
const optionalWhole = (label: string, min: number, max: number) =>
  z.preprocess(blankToNull, wholeNumber(label, min, max).nullable());
const bool = z.preprocess((v) => v === true || v === "on" || v === "true", z.boolean());
/** A tri-state answer: "yes" / "no" / not recorded. */
const triState = z.preprocess((v) => (v === "yes" ? true : v === "no" ? false : null), z.boolean().nullable());

/** The one-time key a form carries so a retried submission is recorded once. */
export const requestKey = z
  .string({ message: "This form has expired. Reload the page and try again." })
  .trim()
  .regex(/^[A-Za-z0-9-]{8,80}$/, "This form has expired. Reload the page and try again.");

function costPair<T extends { [k: string]: unknown }>(costKey: keyof T & string, currencyKey: keyof T & string) {
  return (d: T, ctx: z.RefinementCtx) => {
    if ((d[costKey] === null) !== (d[currencyKey] === null)) {
      ctx.addIssue({
        code: "custom",
        path: [d[costKey] === null ? costKey : currencyKey],
        message: "Enter both the amount and its currency, or neither",
      });
    }
  };
}

// ─── Labels ──────────────────────────────────────────────────────────────────

export const SUPPLIER_KINDS = ["MANUFACTURER", "DISTRIBUTOR", "PARTS_SUPPLIER", "SERVICE_PROVIDER", "OTHER"] as const;
export const SUPPLIER_KIND_LABELS: Record<(typeof SUPPLIER_KINDS)[number], string> = {
  MANUFACTURER: "Manufacturer",
  DISTRIBUTOR: "Distributor / agent",
  PARTS_SUPPLIER: "Parts supplier",
  SERVICE_PROVIDER: "Service provider",
  OTHER: "Other",
};

export const STOCK_UNITS = ["EACH", "PAIR", "SET", "KIT", "PACK", "BOX", "ROLL", "BOTTLE", "METRE"] as const;
export const STOCK_UNIT_LABELS: Record<(typeof STOCK_UNITS)[number], string> = {
  EACH: "each",
  PAIR: "pair",
  SET: "set",
  KIT: "kit",
  PACK: "pack",
  BOX: "box",
  ROLL: "roll",
  BOTTLE: "bottle",
  METRE: "metre",
};

export const MOVEMENT_LABELS: Record<string, string> = {
  INITIAL: "Initial stock",
  RECEIPT: "Received",
  ISSUE: "Issued to work order",
  RETURN: "Returned from work order",
  TRANSFER_OUT: "Transferred out",
  TRANSFER_IN: "Transferred in",
  ADJUSTMENT: "Stock adjustment",
  WRITE_OFF: "Written off",
};

export const PURCHASE_STATUS_LABELS: Record<string, string> = {
  DRAFT: "Draft",
  SUBMITTED: "Submitted — awaiting approval",
  APPROVED: "Approved — not yet ordered",
  REJECTED: "Rejected",
  ORDERED: "Ordered (outside BiomedIntel.ai)",
  PARTIALLY_RECEIVED: "Partly received",
  RECEIVED: "Received in full",
  CANCELLED: "Cancelled",
};

export const CLAIM_STATUSES = [
  "DRAFT",
  "SUBMITTED",
  "ACCEPTED",
  "PARTIALLY_ACCEPTED",
  "REJECTED",
  "WITHDRAWN",
] as const;
export type ClaimStatusValue = (typeof CLAIM_STATUSES)[number];
export const CLAIM_STATUS_LABELS: Record<ClaimStatusValue, string> = {
  DRAFT: "Draft (not sent)",
  SUBMITTED: "Submitted to supplier",
  ACCEPTED: "Accepted by supplier",
  PARTIALLY_ACCEPTED: "Partly accepted",
  REJECTED: "Rejected by supplier",
  WITHDRAWN: "Withdrawn",
};
/** Allowed claim status changes. Decided claims are final. */
export const CLAIM_TRANSITIONS: Record<ClaimStatusValue, ClaimStatusValue[]> = {
  DRAFT: ["SUBMITTED", "WITHDRAWN"],
  SUBMITTED: ["ACCEPTED", "PARTIALLY_ACCEPTED", "REJECTED", "WITHDRAWN"],
  ACCEPTED: [],
  PARTIALLY_ACCEPTED: [],
  REJECTED: [],
  WITHDRAWN: [],
};

export const SERVICE_STATUSES = ["REQUESTED", "IN_PROGRESS", "COMPLETED", "CANCELLED"] as const;
export const SERVICE_STATUS_LABELS: Record<(typeof SERVICE_STATUSES)[number], string> = {
  REQUESTED: "Requested",
  IN_PROGRESS: "With the supplier",
  COMPLETED: "Completed by supplier",
  CANCELLED: "Cancelled",
};

export const REPLACEMENT_REVIEWS = ["DUE", "IN_REVIEW", "RETAIN", "REPLACE_PLANNED"] as const;
export const REPLACEMENT_REVIEW_LABELS: Record<(typeof REPLACEMENT_REVIEWS)[number], string> = {
  DUE: "Review due",
  IN_REVIEW: "Under review",
  RETAIN: "Reviewed — keep in service",
  REPLACE_PLANNED: "Reviewed — replacement planned",
};

export const DISPOSAL_METHODS = [
  "RECYCLED",
  "DESTROYED",
  "RETURNED_TO_SUPPLIER",
  "SOLD",
  "DONATED",
  "TRANSFERRED_OUT",
  "OTHER",
] as const;
export const DISPOSAL_LABELS: Record<(typeof DISPOSAL_METHODS)[number], string> = {
  RECYCLED: "Recycled (e-waste)",
  DESTROYED: "Destroyed",
  RETURNED_TO_SUPPLIER: "Returned to supplier",
  SOLD: "Sold",
  DONATED: "Donated",
  TRANSFERRED_OUT: "Transferred to another organisation",
  OTHER: "Other",
};

// ─── Suppliers ───────────────────────────────────────────────────────────────

const labelList = z.preprocess(
  (v) =>
    (typeof v === "string" ? v.split(/[,\n]/) : Array.isArray(v) ? v : []).map((x) => String(x).trim()).filter(Boolean),
  z.array(text(2, 60, "Category")).max(20, "At most 20 categories"),
);

export const supplierSchema = z.object({
  id: optionalUuid,
  name: text(2, 160, "Name"),
  kinds: z.array(z.enum(SUPPLIER_KINDS)).min(1, "Choose at least one type").max(5),
  contactName: optionalText(120, "Contact person"),
  email: z.preprocess(blankToNull, z.string().trim().email("Enter a valid business email").max(200).nullable()),
  phone: z.preprocess(
    blankToNull,
    z
      .string()
      .trim()
      .regex(/^[0-9+() .-]{5,30}$/, "Enter a valid phone number")
      .nullable(),
  ),
  address: optionalText(400, "Address", true),
  serviceCategories: labelList,
  manufacturerIds: z.array(uuid).max(50).default([]),
  notes: optionalText(2000, "Notes", true),
});

// ─── Stores and parts ────────────────────────────────────────────────────────

export const storeSchema = z.object({
  hospitalId: uuid,
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9][A-Z0-9._-]{0,19}$/, "Use 1–20 capital letters, digits, dots, underscores or hyphens"),
  name: text(2, 120, "Name"),
  description: optionalText(400, "Description"),
});

export const partNumberSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(
    /^[A-Z0-9][A-Z0-9./_-]{0,39}$/,
    "Use 1–40 capital letters, digits, dots, slashes, underscores or hyphens (printed as a barcode)",
  );

export const partSchema = z
  .object({
    id: optionalUuid,
    partNumber: partNumberSchema,
    name: text(2, 160, "Name"),
    description: optionalText(1000, "Description", true),
    manufacturerId: optionalUuid,
    manufacturerPartNumber: optionalText(80, "Manufacturer part number"),
    unit: z.enum(STOCK_UNITS, { message: "Choose a unit" }),
    minLevel: wholeNumber("Minimum stock", 0, 1_000_000),
    targetLevel: optionalWhole("Target stock", 0, 1_000_000),
    unitCost: money("Unit cost"),
    currency,
    tracksLots: bool,
    tracksExpiry: bool,
    modelIds: z.array(uuid).max(100).default([]),
    categoryIds: z.array(uuid).max(50).default([]),
    compatManufacturerIds: z.array(uuid).max(50).default([]),
    supplierIds: z.array(uuid).max(20).default([]),
  })
  .superRefine((d, ctx) => {
    if (d.targetLevel !== null && d.targetLevel < d.minLevel) {
      ctx.addIssue({ code: "custom", path: ["targetLevel"], message: "Target stock cannot be below the minimum" });
    }
    if (d.tracksExpiry && !d.tracksLots) {
      ctx.addIssue({
        code: "custom",
        path: ["tracksExpiry"],
        message: "Expiry dates are recorded per lot: also track lots",
      });
    }
    costPair<typeof d>("unitCost", "currency")(d, ctx);
  });

const lotFields = {
  lotNumber: z.preprocess(
    (v) => (typeof v === "string" ? v.trim() : ""),
    z
      .string()
      .max(60, "Lot number must be 60 characters or fewer")
      .regex(/^[A-Za-z0-9./_ -]*$/, "Lot number contains invalid characters"),
  ),
  expiresOn: optionalDate("Expiry date"),
};

/** Initial stock or a receipt (with or without a purchase request). */
export const receiveSchema = z
  .object({
    requestKey,
    partId: uuid,
    locationId: uuid,
    initial: bool,
    quantity: wholeNumber("Quantity", 1, 1_000_000),
    ...lotFields,
    unitCost: money("Unit cost"),
    currency,
    supplierId: optionalUuid,
    purchaseLineId: optionalUuid,
    reference: optionalText(120, "Reference"),
  })
  .superRefine((d, ctx) => costPair<typeof d>("unitCost", "currency")(d, ctx));

export const transferSchema = z.object({
  requestKey,
  partId: uuid,
  fromLocationId: uuid,
  toLocationId: uuid,
  lotNumber: lotFields.lotNumber,
  quantity: wholeNumber("Quantity", 1, 1_000_000),
  reason: optionalText(300, "Reason"),
});

export const adjustSchema = z.object({
  requestKey,
  partId: uuid,
  locationId: uuid,
  lotNumber: lotFields.lotNumber,
  writeOff: bool,
  /** Signed for adjustments (e.g. -2 after a stock count); positive for write-offs. */
  quantity: z.coerce
    .number({ message: "Enter the quantity as a whole number" })
    .int("Whole units only")
    .refine((v) => v !== 0, "The quantity cannot be zero")
    .refine((v) => Math.abs(v) <= 1_000_000, "Quantity too large"),
  reason: text(5, 500, "Reason", true),
});

// ─── Work order parts ────────────────────────────────────────────────────────

export const reserveSchema = z.object({
  requestKey,
  workOrderId: uuid,
  partId: uuid,
  locationId: uuid,
  quantity: wholeNumber("Quantity", 1, 10_000),
});
export const reservationIdSchema = z.object({ reservationId: uuid });
export const issueSchema = z.object({
  requestKey,
  workOrderId: uuid,
  /** Issue a reservation in full, or a part directly from a store. */
  reservationId: optionalUuid,
  partId: optionalUuid,
  locationId: optionalUuid,
  lotNumber: lotFields.lotNumber,
  quantity: optionalWhole("Quantity", 1, 10_000),
});
export const returnSchema = z.object({
  requestKey,
  workOrderId: uuid,
  partId: uuid,
  locationId: uuid,
  lotNumber: lotFields.lotNumber,
  quantity: wholeNumber("Quantity", 1, 10_000),
  reason: optionalText(300, "Reason"),
});
export const unavailableSchema = z.object({
  workOrderId: uuid,
  partId: optionalUuid,
  description: text(3, 300, "Part needed"),
  quantity: wholeNumber("Quantity", 1, 10_000),
});

// ─── Purchase requests ───────────────────────────────────────────────────────

export const purchaseLineSchema = z
  .object({
    partId: uuid,
    quantity: wholeNumber("Quantity", 1, 1_000_000),
    estimatedUnitCost: money("Estimated unit cost"),
    currency,
  })
  .superRefine((d, ctx) => costPair<typeof d>("estimatedUnitCost", "currency")(d, ctx));

export const purchaseCreateSchema = z.object({
  hospitalId: uuid,
  supplierId: optionalUuid,
  justification: optionalText(1000, "Reason for the request", true),
  lines: z.array(purchaseLineSchema).min(1, "Add at least one part").max(50, "At most 50 lines"),
});
export const purchaseDecisionSchema = z.object({
  id: uuid,
  approve: bool,
  note: optionalText(500, "Note", true),
});
export const purchaseOrderedSchema = z.object({
  id: uuid,
  orderReference: text(2, 120, "Order reference"),
});
export const purchaseIdSchema = z.object({ id: uuid, reason: optionalText(500, "Reason", true) });

// ─── Warranty claims ─────────────────────────────────────────────────────────

export const claimCreateSchema = z
  .object({
    warrantyId: uuid,
    workOrderId: optionalUuid,
    description: text(5, 2000, "What is being claimed", true),
    evidence: optionalText(2000, "Evidence supplied", true),
    claimReference: optionalText(120, "Claim reference"),
    amountClaimed: money("Amount claimed"),
    currency,
  })
  .superRefine((d, ctx) => costPair<typeof d>("amountClaimed", "currency")(d, ctx));

export const claimStatusSchema = z.object({
  claimId: uuid,
  status: z.enum(CLAIM_STATUSES, { message: "Choose a status" }),
  date: optionalDate("Date"),
  claimReference: optionalText(120, "Claim reference"),
  outcome: optionalText(2000, "Outcome", true),
  evidence: optionalText(2000, "Evidence supplied", true),
  amountRecovered: money("Amount recovered"),
  currency,
  note: optionalText(500, "Note", true),
});

// ─── Warranties (edit and archive; creation keeps the Stage 4 form fields) ───

export const warrantyDetailFields = {
  supplierId: optionalUuid,
  reference: optionalText(120, "Reference"),
  coversParts: triState,
  coversLabour: triState,
  exclusions: optionalText(2000, "Exclusions and limitations", true),
  notes: optionalText(2000, "Notes", true),
  documentReference: optionalText(300, "Where the document is kept"),
  responseTargetHours: optionalWhole("Response target (hours)", 1, 8760),
};

export const warrantyUpdateSchema = z
  .object({
    id: uuid,
    provider: text(2, 160, "Provider"),
    startsOn: optionalDate("Start date"),
    endsOn: requiredDate("End date"),
    coverage: optionalText(500, "Coverage"),
    ...warrantyDetailFields,
  })
  .superRefine((d, ctx) => {
    if (d.startsOn && d.endsOn < d.startsOn) {
      ctx.addIssue({ code: "custom", path: ["endsOn"], message: "End date cannot be before the start date" });
    }
  });

// ─── External service ────────────────────────────────────────────────────────

export const serviceCreateSchema = z
  .object({
    workOrderId: uuid,
    supplierId: uuid,
    warrantyClaimId: optionalUuid,
    description: text(5, 2000, "What the supplier is asked to do", true),
    supplierReference: optionalText(120, "Supplier reference"),
    requestedOn: requiredDate("Request date"),
    expectedBy: optionalDate("Expected by"),
  })
  .superRefine((d, ctx) => {
    if (d.expectedBy && d.expectedBy < d.requestedOn) {
      ctx.addIssue({ code: "custom", path: ["expectedBy"], message: "Cannot be before the request date" });
    }
  });

export const serviceUpdateSchema = z
  .object({
    id: uuid,
    status: z.enum(SERVICE_STATUSES, { message: "Choose a status" }),
    supplierReference: optionalText(120, "Supplier reference"),
    dispatchedOn: optionalDate("Sent / dispatched on"),
    expectedBy: optionalDate("Expected by"),
    completedOn: optionalDate("Completed on"),
    serviceReportRef: optionalText(120, "Service report reference"),
    partsSupplied: optionalText(1000, "Parts supplied", true),
    cost: money("Cost"),
    currency,
    notes: optionalText(2000, "Notes", true),
  })
  .superRefine((d, ctx) => {
    if (d.status === "COMPLETED" && !d.completedOn) {
      ctx.addIssue({
        code: "custom",
        path: ["completedOn"],
        message: "Enter the date the supplier completed the work",
      });
    }
    if (d.status !== "COMPLETED" && d.completedOn) {
      ctx.addIssue({ code: "custom", path: ["completedOn"], message: "Only completed work has a completion date" });
    }
    if (d.completedOn && d.dispatchedOn && d.completedOn < d.dispatchedOn) {
      ctx.addIssue({ code: "custom", path: ["completedOn"], message: "Cannot be before the dispatch date" });
    }
    costPair<typeof d>("cost", "currency")(d, ctx);
  });

// ─── Lifecycle ───────────────────────────────────────────────────────────────

export const lifecycleReviewSchema = z.object({
  assetId: uuid,
  outcome: z.enum(REPLACEMENT_REVIEWS, { message: "Choose a review status" }),
  nextReviewOn: optionalDate("Next lifecycle review"),
  reason: text(5, 1000, "Notes for the record", true),
});

export const disposalSchema = z.object({
  assetId: uuid,
  method: z.enum(DISPOSAL_METHODS, { message: "Choose what happened to the device" }),
  effectiveOn: requiredDate("Date"),
  reference: optionalText(200, "Reference (certificate, receipt or recipient)"),
  reason: text(5, 1000, "Details", true),
});

export const assetSupplierSchema = z.object({ assetId: uuid, supplierId: optionalUuid });

// ─── Settings ────────────────────────────────────────────────────────────────

const dayList = z.preprocess(
  (v) =>
    (typeof v === "string" ? v.split(/[,\s]+/) : Array.isArray(v) ? v : [])
      .map((x) => String(x).trim())
      .filter(Boolean)
      .map(Number),
  z
    .array(z.number().int("Whole days only").min(1, "At least 1 day").max(365, "At most 365 days"))
    .min(1, "Enter at least one number of days")
    .max(6, "At most 6 reminders"),
);
export const inventorySettingsSchema = z.object({
  warrantyReminderDays: dayList,
  contractReminderDays: dayList,
  stockExpiryWarningDays: wholeNumber("Expiring stock warning", 1, 365),
  lifecycleReviewLeadDays: wholeNumber("Lifecycle review reminder", 1, 365),
  adjustmentLimit: wholeNumber("Adjustment limit", 0, 100_000),
});

// ─── Queries ─────────────────────────────────────────────────────────────────

export const INVENTORY_VIEWS = ["all", "available", "low", "out", "reserved", "expiring", "archived"] as const;
export const INVENTORY_VIEW_LABELS: Record<(typeof INVENTORY_VIEWS)[number], string> = {
  all: "All parts",
  available: "In stock",
  low: "Low stock",
  out: "Out of stock",
  reserved: "Reserved",
  expiring: "Expiring or expired",
  archived: "Archived",
};
export const partQuerySchema = z.object({
  view: z.enum(INVENTORY_VIEWS).default("all").catch("all"),
  q: z.preprocess(blankToNull, z.string().trim().max(80).nullable()).catch(null),
  location: z.preprocess(blankToNull, uuid.nullable()).catch(null),
  sort: z.enum(["partNumber", "name", "available"]).default("partNumber").catch("partNumber"),
  dir: z.enum(["asc", "desc"]).default("asc").catch("asc"),
  page: z.coerce.number().int().min(1).max(10000).default(1).catch(1),
});
export const PART_PAGE_SIZE = 25;
