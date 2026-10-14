// Input validation for organisation administration.
// The same schemas check data on the server; forms may reuse them for hints,
// but only the server-side check counts.
import { z } from "zod";

const uuid = z.string().uuid("Invalid id");

const code = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9][A-Z0-9-]{0,15}$/, "Use 1–16 capital letters, digits or hyphens, e.g. RGH or ICU-2");

const name = z
  .string()
  .trim()
  .min(2, "Name must be at least 2 characters")
  .max(120, "Name must be 120 characters or fewer");

export const createHospitalSchema = z.object({
  name,
  code,
  timezone: z
    .string()
    .trim()
    .min(3)
    .max(64)
    .refine((tz) => {
      try {
        new Intl.DateTimeFormat("en", { timeZone: tz });
        return true;
      } catch {
        return false;
      }
    }, "Unknown time zone"),
});

export const createDepartmentSchema = z.object({ hospitalId: uuid, name, code });

export const archiveSchema = z.object({ id: uuid });

export const membershipRoleSchema = z.enum([
  "ORG_ADMIN",
  "ENGINEERING_MANAGER",
  "TECHNICIAN",
  "INVENTORY_MANAGER",
  "DEPARTMENT_HEAD",
  "AUDITOR",
  "FAULT_REPORTER",
]);

export const changeMemberRoleSchema = z.object({
  membershipId: uuid,
  role: membershipRoleSchema,
});

export const addMemberSchema = z
  .object({
    email: z.string().trim().toLowerCase().email("Enter a valid email address").max(200),
    name,
    role: membershipRoleSchema,
    orgWide: z.boolean(),
    hospitalId: uuid.nullable(),
    departmentId: uuid.nullable(),
  })
  .superRefine((v, ctx) => {
    if (v.role === "ORG_ADMIN" && !v.orgWide) {
      ctx.addIssue({
        code: "custom",
        path: ["orgWide"],
        message: "Organization Administrators always cover the whole organisation",
      });
    }
    if (!v.orgWide && !v.hospitalId) {
      ctx.addIssue({
        code: "custom",
        path: ["hospitalId"],
        message: "Choose a hospital, or give access to the whole organisation",
      });
    }
    if (v.departmentId && !v.hospitalId) {
      ctx.addIssue({ code: "custom", path: ["departmentId"], message: "A department needs its hospital" });
    }
  });

export const createOrganizationSchema = z.object({
  name,
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9][a-z0-9-]{1,62}$/, "Use 2–63 lowercase letters, digits or hyphens"),
  country: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{2}$/, "Use a two-letter country code, e.g. KE"),
  adminEmail: z.string().trim().toLowerCase().email().max(200),
  adminName: name,
});

export type CreateHospitalInput = z.input<typeof createHospitalSchema>;
export type CreateDepartmentInput = z.input<typeof createDepartmentSchema>;
export type ChangeMemberRoleInput = z.input<typeof changeMemberRoleSchema>;
export type AddMemberInput = z.input<typeof addMemberSchema>;
export type CreateOrganizationInput = z.input<typeof createOrganizationSchema>;
