// Fictional development data. Every organisation, hospital, person and email
// below is invented. Emails use the reserved ".example" domain, which can never
// receive real mail. No patient data.
import type { MembershipRole } from "../server/authz/roles";

export type SeedScope = { hospital: string; department?: string };

export type SeedMember = {
  key: string;
  name: string;
  email: string;
  role: MembershipRole;
  orgWide?: boolean;
  scopes?: SeedScope[];
};

export type SeedOrganization = {
  name: string;
  slug: string;
  country: string;
  hospitals: { code: string; name: string; timezone: string; departments: { code: string; name: string }[] }[];
  members: SeedMember[];
};

const standardDepartments = [
  { code: "ICU", name: "Intensive Care" },
  { code: "THEATRES", name: "Operating Theatres" },
  { code: "ED", name: "Emergency" },
  { code: "RAD", name: "Radiology" },
  { code: "RENAL", name: "Renal / Dialysis" },
  { code: "WARDS", name: "General Wards" },
];

export const SEED_ORGANIZATIONS: SeedOrganization[] = [
  {
    name: "Coastal Health Group",
    slug: "coastal-health",
    country: "KE",
    hospitals: [
      { code: "RGH", name: "Riverside General Hospital", timezone: "Africa/Nairobi", departments: standardDepartments },
      {
        code: "NCH",
        name: "Northlake Community Hospital",
        timezone: "Africa/Nairobi",
        departments: standardDepartments.filter((d) => ["ICU", "THEATRES", "ED", "WARDS"].includes(d.code)),
      },
    ],
    members: [
      { key: "hodan", name: "Hodan Ali", email: "hodan.ali@coastal.example", role: "ORG_ADMIN", orgWide: true },
      {
        key: "james",
        name: "James Otieno",
        email: "james.otieno@coastal.example",
        role: "ENGINEERING_MANAGER",
        scopes: [{ hospital: "RGH" }],
      },
      {
        key: "amina",
        name: "Amina Warsame",
        email: "amina.warsame@coastal.example",
        role: "TECHNICIAN",
        scopes: [
          { hospital: "RGH" },
          { hospital: "NCH", department: "ICU" },
          { hospital: "NCH", department: "THEATRES" },
        ],
      },
      {
        key: "grace",
        name: "Grace Mwangi",
        email: "grace.mwangi@coastal.example",
        role: "INVENTORY_MANAGER",
        scopes: [{ hospital: "RGH" }],
      },
      {
        key: "peter",
        name: "Peter Kamau",
        email: "peter.kamau@coastal.example",
        role: "DEPARTMENT_HEAD",
        scopes: [{ hospital: "RGH", department: "ICU" }],
      },
      { key: "fatuma", name: "Fatuma Hassan", email: "fatuma.hassan@coastal.example", role: "AUDITOR", orgWide: true },
      {
        key: "lucy",
        name: "Lucy Achieng",
        email: "lucy.achieng@coastal.example",
        role: "FAULT_REPORTER",
        scopes: [{ hospital: "NCH", department: "ED" }],
      },
    ],
  },
  {
    name: "Highland Medical Network",
    slug: "highland-medical",
    country: "UG",
    hospitals: [
      {
        code: "SRH",
        name: "Summit Regional Hospital",
        timezone: "Africa/Kampala",
        departments: standardDepartments.filter((d) => ["ICU", "THEATRES", "RAD", "WARDS"].includes(d.code)),
      },
      {
        code: "LVC",
        name: "Lakeview Clinic",
        timezone: "Africa/Kampala",
        departments: [{ code: "OPD", name: "Outpatients" }],
      },
    ],
    members: [
      { key: "david", name: "David Mutua", email: "david.mutua@highland.example", role: "ORG_ADMIN", orgWide: true },
      {
        key: "sara",
        name: "Sara Nakato",
        email: "sara.nakato@highland.example",
        role: "TECHNICIAN",
        scopes: [{ hospital: "SRH" }],
      },
      // James also audits Highland: one login, two organisations, two roles.
      { key: "james", name: "James Otieno", email: "james.otieno@coastal.example", role: "AUDITOR", orgWide: true },
    ],
  },
];
