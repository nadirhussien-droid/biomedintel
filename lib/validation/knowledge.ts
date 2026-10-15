// Input validation for Stage 9: the technical knowledge base and
// troubleshooting sessions. These schemas run on the SERVER; the browser is never trusted.
import { z } from "zod";
import { optionalDate, optionalText, text } from "./inventory";

const uuid = z.string().uuid("Invalid id");
const blankToNull = (v: unknown) => (v === undefined || (typeof v === "string" && v.trim() === "") ? null : v);
const optionalUuid = z.preprocess(blankToNull, uuid.nullable());
const uuidList = z.preprocess(
  (v) => (Array.isArray(v) ? v : v ? [v] : []).filter((x) => typeof x === "string" && x !== ""),
  z.array(uuid).max(50, "At most 50"),
);

// ─── Knowledge base ──────────────────────────────────────────────────────────

export const DOC_TYPES = [
  "SERVICE_MANUAL",
  "TROUBLESHOOTING_GUIDE",
  "INTERNAL_PROCEDURE",
  "ERROR_CODE_REFERENCE",
  "KNOWN_FAULT",
  "SERVICE_BULLETIN",
  "ENGINEERING_NOTE",
  "OTHER_REFERENCE",
] as const;
export type DocTypeValue = (typeof DOC_TYPES)[number];
export const DOC_TYPE_LABELS: Record<DocTypeValue, string> = {
  SERVICE_MANUAL: "Manufacturer service manual / instructions",
  TROUBLESHOOTING_GUIDE: "Troubleshooting guide",
  INTERNAL_PROCEDURE: "Internal technical procedure",
  ERROR_CODE_REFERENCE: "Error code reference",
  KNOWN_FAULT: "Known fault and resolution",
  SERVICE_BULLETIN: "Technical advisory / service bulletin",
  ENGINEERING_NOTE: "Engineering note",
  OTHER_REFERENCE: "Other technical reference",
};

export const ACCESS_LEVELS = ["ENGINEERING", "MANAGERS"] as const;
export const ACCESS_LABELS: Record<(typeof ACCESS_LEVELS)[number], string> = {
  ENGINEERING: "Everyone who uses the knowledge base",
  MANAGERS: "Managers, administrators and auditors only",
};

export const MAX_DOCUMENT_BYTES = 20 * 1024 * 1024;
export const ALLOWED_MIME = ["application/pdf", "text/plain", "text/markdown"] as const;
export type AllowedMime = (typeof ALLOWED_MIME)[number];

export const documentFields = {
  title: text(3, 200, "Title"),
  docType: z.enum(DOC_TYPES, { message: "Choose a document type" }),
  summary: optionalText(2000, "Summary", true),
  source: optionalText(160, "Issued by"),
  sourceReference: optionalText(120, "Reference / document number"),
  revision: optionalText(60, "Revision or version"),
  publishedOn: optionalDate("Publication date"),
  accessLevel: z.enum(ACCESS_LEVELS, { message: "Choose who may see it" }).default("ENGINEERING"),
  hospitalId: optionalUuid,
  modelIds: uuidList,
  categoryIds: uuidList,
  manufacturerIds: uuidList,
};

export const documentCreateSchema = z.object({
  ...documentFields,
  /** For typed notes: the text itself (no file). */
  body: optionalText(200_000, "Text", true),
});
export const documentUpdateSchema = z.object({ id: uuid, ...documentFields });

export const approveDocumentSchema = z.object({
  id: uuid,
  authorisation: text(5, 1000, "Why the organisation may use this document", true),
  reviewNote: optionalText(1000, "Review note", true),
  confirm: z.preprocess(
    (v) => v === true || v === "on" || v === "true",
    z.literal(true, { message: "Confirm that you reviewed the content" }),
  ),
});
export const documentStatusSchema = z
  .object({
    id: uuid,
    status: z.enum(["SUPERSEDED", "WITHDRAWN"], { message: "Choose superseded or withdrawn" }),
    supersededById: optionalUuid,
    reason: text(5, 500, "Reason", true),
  })
  .superRefine((d, ctx) => {
    if (d.status === "SUPERSEDED" && !d.supersededById) {
      ctx.addIssue({ code: "custom", path: ["supersededById"], message: "Choose the document that replaces it" });
    }
    if (d.status === "WITHDRAWN" && d.supersededById) {
      ctx.addIssue({ code: "custom", path: ["supersededById"], message: "A withdrawn document is not replaced" });
    }
  });

/** Error and alarm codes: letters, digits and . _ / - only (spaces removed). */
export function codeKey(code: string): string {
  return code.toUpperCase().replace(/\s+/g, "");
}
export const errorCodeSchema = z.object({
  documentId: uuid,
  code: text(1, 40, "Code").refine(
    (v) => /^[A-Z0-9._/-]{1,40}$/.test(codeKey(v)),
    "Use letters, digits and . _ / - only",
  ),
  meaning: text(3, 2000, "Documented meaning", true),
  page: z.preprocess(blankToNull, z.coerce.number().int("Whole page number").min(1).max(100_000).nullable()),
});

export const knowledgeQuerySchema = z.object({
  q: z.preprocess(blankToNull, z.string().trim().max(200).nullable()).catch(null),
  type: z.preprocess(blankToNull, z.enum(DOC_TYPES).nullable()).catch(null),
  manufacturer: optionalUuid.catch(null),
  model: optionalUuid.catch(null),
  category: optionalUuid.catch(null),
  code: z.preprocess(blankToNull, z.string().trim().max(40).nullable()).catch(null),
  review: z.enum(["any", "approved", "draft"]).default("any").catch("any"),
  status: z.enum(["active", "superseded", "withdrawn", "all"]).default("active").catch("active"),
  page: z.coerce.number().int().min(1).max(1000).default(1).catch(1),
});
export type KnowledgeQuery = z.output<typeof knowledgeQuerySchema>;

// ─── Troubleshooting ─────────────────────────────────────────────────────────

/** "E-104, AL 22" → ["E-104", "AL22"]. */
const codeList = z.preprocess(
  (v) =>
    (typeof v === "string" ? v.split(/[,;\n]+/) : Array.isArray(v) ? v : [])
      .map((x) => codeKey(String(x)))
      .filter(Boolean),
  z
    .array(z.string().regex(/^[A-Z0-9._/-]{1,40}$/, "Error codes: letters, digits and . _ / - only"))
    .max(20, "At most 20 error codes"),
);

export const sessionFields = {
  faultDescription: text(5, 4000, "Fault description", true),
  symptoms: optionalText(4000, "Symptoms", true),
  errorCodes: codeList,
  alarms: optionalText(2000, "Alarms", true),
  operatingConditions: optionalText(2000, "Operating conditions", true),
};
export const sessionStartSchema = z.object({ assetId: uuid, workOrderId: optionalUuid, ...sessionFields });
export const sessionDetailsSchema = z.object({ id: uuid, ...sessionFields });

export const ENTRY_KINDS = ["OBSERVATION", "TEST", "NOTE"] as const;
export const ENTRY_KIND_LABELS: Record<string, string> = {
  OBSERVATION: "Observation",
  TEST: "Test performed",
  NOTE: "Note",
  FEEDBACK: "Feedback on a suggestion",
  ROOT_CAUSE: "Root cause recorded",
  CORRECTIVE_ACTION: "Corrective action",
  VERIFICATION: "Verification",
  STATUS: "Status",
  DETAILS: "Details updated",
};
export const TS_RESULTS = ["NORMAL", "ABNORMAL", "INCONCLUSIVE"] as const;
export const TS_RESULT_LABELS: Record<(typeof TS_RESULTS)[number], string> = {
  NORMAL: "Normal / as expected",
  ABNORMAL: "Abnormal / fault found",
  INCONCLUSIVE: "Inconclusive",
};
export const entrySchema = z
  .object({
    sessionId: uuid,
    kind: z.enum(ENTRY_KINDS, { message: "Choose what you are recording" }),
    text: text(2, 4000, "What you found", true),
    testName: optionalText(200, "Test name"),
    result: z.preprocess(blankToNull, z.enum(TS_RESULTS).nullable()),
  })
  .superRefine((d, ctx) => {
    if (d.kind === "TEST" && !d.testName)
      ctx.addIssue({ code: "custom", path: ["testName"], message: "Name the test performed" });
    if (d.kind === "TEST" && !d.result)
      ctx.addIssue({ code: "custom", path: ["result"], message: "Record the result" });
    if (d.kind !== "TEST" && (d.testName || d.result)) {
      ctx.addIssue({ code: "custom", path: ["testName"], message: "Test name and result are only for tests" });
    }
  });

export const FEEDBACK = ["ACCEPTED", "REJECTED", "INCONCLUSIVE", "NOT_APPLICABLE"] as const;
export const FEEDBACK_LABELS: Record<string, string> = {
  PENDING: "Not yet assessed",
  ACCEPTED: "Accepted",
  REJECTED: "Rejected",
  INCONCLUSIVE: "Inconclusive",
  NOT_APPLICABLE: "Not applicable",
};
export const feedbackSchema = z.object({
  suggestionId: uuid,
  feedback: z.enum(FEEDBACK, { message: "Choose your assessment" }),
  note: optionalText(1000, "Reason", true),
});

export const rootCauseSchema = z.object({ id: uuid, rootCause: text(5, 4000, "Confirmed root cause", true) });

export const VERIFICATION = ["FAULT_CLEARED", "FAULT_PERSISTS", "NOT_VERIFIED"] as const;
export const VERIFICATION_LABELS: Record<(typeof VERIFICATION)[number], string> = {
  FAULT_CLEARED: "Fault cleared on re-test",
  FAULT_PERSISTS: "Fault still present",
  NOT_VERIFIED: "Not verified yet",
};
export const closeSchema = z
  .object({
    id: uuid,
    outcome: z.enum(["RESOLVED", "UNRESOLVED"], { message: "Choose how the session ends" }),
    correctiveAction: optionalText(4000, "Corrective action", true),
    verificationOutcome: z.preprocess(blankToNull, z.enum(VERIFICATION).nullable()),
    verificationNote: optionalText(4000, "Verification details", true),
  })
  .superRefine((d, ctx) => {
    if (d.outcome === "RESOLVED") {
      if (!d.correctiveAction)
        ctx.addIssue({ code: "custom", path: ["correctiveAction"], message: "Describe the corrective action" });
      if (!d.verificationOutcome)
        ctx.addIssue({ code: "custom", path: ["verificationOutcome"], message: "Record the verification outcome" });
    }
  });
export const reopenSchema = z.object({ id: uuid, reason: text(5, 500, "Reason", true) });

export const askSchema = z.object({
  sessionId: uuid,
  question: optionalText(1000, "Question", true),
  allowUnverified: z.preprocess((v) => v === true || v === "on" || v === "true", z.boolean()),
});

export const sessionQuerySchema = z.object({
  status: z.enum(["open", "resolved", "unresolved", "all"]).default("open").catch("open"),
  mine: z.preprocess((v) => v === "1" || v === "on", z.boolean()).catch(false),
  asset: optionalUuid.catch(null),
  page: z.coerce.number().int().min(1).max(1000).default(1).catch(1),
});

export const SESSION_STATUS_LABELS: Record<string, string> = {
  OPEN: "Open",
  RESOLVED: "Resolved — root cause confirmed",
  UNRESOLVED: "Closed without a confirmed cause",
};
