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
      {
        // Facility Manager: a Department Head covering the WHOLE hospital. Approves
        // decommissioning only where a department has no NUM of its own.
        key: "mary",
        name: "Mary Njeri",
        email: "mary.njeri@coastal.example",
        role: "DEPARTMENT_HEAD",
        scopes: [{ hospital: "NCH" }],
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

// ─── Fictional equipment (Stage 4) ───────────────────────────────────────────
// FICTIONAL DEMONSTRATION DATA. Manufacturer and model names are invented and
// marked "(demo)"; serial numbers start with DEMO-. No real device, technical
// specification, certification or service history is implied.

export const DEMO_NOTE = "Fictional demonstration record — not a real device.";

export type SeedCatalog = {
  manufacturers: string[];
  categories: { name: string; risk: "HIGH" | "MEDIUM" | "LOW"; pmMonths: number }[];
  models: { key: string; manufacturer: string; category: string; name: string; lifeYears: number }[];
};

export const SEED_CATALOG: SeedCatalog = {
  manufacturers: ["Demo Medical Devices Co. (demo)", "Example Biomedical Ltd (demo)", "Sample Clinical Systems (demo)"],
  // Default risk categories follow the Stage 2 starting list of safety-critical
  // device types (decision 9); each organisation can change them.
  categories: [
    { name: "Infusion pump", risk: "HIGH", pmMonths: 12 },
    { name: "Patient monitor", risk: "MEDIUM", pmMonths: 12 },
    { name: "Defibrillator", risk: "HIGH", pmMonths: 6 },
    { name: "Ventilator", risk: "HIGH", pmMonths: 6 },
    { name: "Suction unit", risk: "LOW", pmMonths: 12 },
    { name: "ECG machine", risk: "MEDIUM", pmMonths: 12 },
  ],
  models: [
    {
      key: "INF",
      manufacturer: "Demo Medical Devices Co. (demo)",
      category: "Infusion pump",
      name: "DM-Infuse 100",
      lifeYears: 8,
    },
    {
      key: "MON",
      manufacturer: "Example Biomedical Ltd (demo)",
      category: "Patient monitor",
      name: "EB-Vitals 5",
      lifeYears: 8,
    },
    {
      key: "DEF",
      manufacturer: "Sample Clinical Systems (demo)",
      category: "Defibrillator",
      name: "SC-Shock 2",
      lifeYears: 10,
    },
    {
      key: "VEN",
      manufacturer: "Example Biomedical Ltd (demo)",
      category: "Ventilator",
      name: "EB-Breathe 300",
      lifeYears: 10,
    },
    {
      key: "SUC",
      manufacturer: "Demo Medical Devices Co. (demo)",
      category: "Suction unit",
      name: "DM-Suction S",
      lifeYears: 7,
    },
    {
      key: "ECG",
      manufacturer: "Sample Clinical Systems (demo)",
      category: "ECG machine",
      name: "SC-Trace 12",
      lifeYears: 8,
    },
  ],
};

export type SeedAsset = {
  tag: string;
  name: string;
  model: string;
  hospital: string;
  department: string;
  location?: string;
  serial: string;
  status: "IN_SERVICE" | "UNDER_REPAIR" | "OUT_OF_SERVICE";
  risk?: "HIGH" | "MEDIUM" | "LOW";
  purchased?: string;
  cost?: [string, string];
  warrantyEnds?: string;
};

export const SEED_LOCATIONS: Record<string, { hospital: string; department: string; name: string; floor?: string }[]> =
  {
    "coastal-health": [
      { hospital: "RGH", department: "ICU", name: "ICU Bay 1", floor: "2" },
      { hospital: "RGH", department: "ICU", name: "ICU Bay 2", floor: "2" },
      { hospital: "RGH", department: "THEATRES", name: "Theatre 1", floor: "1" },
      { hospital: "RGH", department: "ED", name: "Resuscitation room", floor: "G" },
      { hospital: "NCH", department: "ICU", name: "ICU Bed 4" },
    ],
    "highland-medical": [{ hospital: "SRH", department: "ICU", name: "ICU Room A" }],
  };

export const SEED_ASSETS: Record<string, SeedAsset[]> = {
  "coastal-health": [
    {
      tag: "INF-0001",
      name: "Infusion pump",
      model: "INF",
      hospital: "RGH",
      department: "ICU",
      location: "ICU Bay 1",
      serial: "DEMO-SN-1001",
      status: "IN_SERVICE",
      risk: "HIGH",
      purchased: "2022-03-14",
      cost: ["185000.00", "KES"],
      warrantyEnds: "2027-03-13",
    },
    {
      tag: "INF-0002",
      name: "Infusion pump",
      model: "INF",
      hospital: "RGH",
      department: "ICU",
      location: "ICU Bay 2",
      serial: "DEMO-SN-1002",
      status: "UNDER_REPAIR",
      risk: "HIGH",
      purchased: "2022-03-14",
    },
    {
      tag: "MON-0001",
      name: "Bedside patient monitor",
      model: "MON",
      hospital: "RGH",
      department: "ICU",
      location: "ICU Bay 1",
      serial: "DEMO-SN-2001",
      status: "IN_SERVICE",
      risk: "MEDIUM",
    },
    {
      tag: "VEN-0001",
      name: "ICU ventilator",
      model: "VEN",
      hospital: "RGH",
      department: "ICU",
      location: "ICU Bay 2",
      serial: "DEMO-SN-3001",
      status: "IN_SERVICE",
      risk: "HIGH",
      purchased: "2021-07-01",
      cost: ["2400000.00", "KES"],
    },
    {
      tag: "DEF-0001",
      name: "Defibrillator",
      model: "DEF",
      hospital: "RGH",
      department: "ED",
      location: "Resuscitation room",
      serial: "DEMO-SN-4001",
      status: "IN_SERVICE",
      risk: "HIGH",
    },
    {
      tag: "SUC-0001",
      name: "Portable suction unit",
      model: "SUC",
      hospital: "RGH",
      department: "THEATRES",
      location: "Theatre 1",
      serial: "DEMO-SN-5001",
      status: "OUT_OF_SERVICE",
      risk: "LOW",
    },
    {
      tag: "ECG-0001",
      name: "12-lead ECG machine",
      model: "ECG",
      hospital: "RGH",
      department: "WARDS",
      serial: "DEMO-SN-6001",
      status: "IN_SERVICE",
      risk: "MEDIUM",
    },
    {
      tag: "MON-0002",
      name: "Transport monitor",
      model: "MON",
      hospital: "RGH",
      department: "ED",
      serial: "DEMO-SN-2002",
      status: "IN_SERVICE",
      risk: "MEDIUM",
    },
    {
      tag: "INF-0003",
      name: "Infusion pump",
      model: "INF",
      hospital: "RGH",
      department: "RENAL",
      serial: "DEMO-SN-1003",
      status: "IN_SERVICE",
      risk: "HIGH",
    },
    {
      tag: "MON-0003",
      name: "Recovery monitor",
      model: "MON",
      hospital: "RGH",
      department: "RAD",
      serial: "DEMO-SN-2003",
      status: "IN_SERVICE",
    },
    {
      tag: "INF-0101",
      name: "Infusion pump",
      model: "INF",
      hospital: "NCH",
      department: "ICU",
      location: "ICU Bed 4",
      serial: "DEMO-SN-1101",
      status: "IN_SERVICE",
      risk: "HIGH",
    },
    {
      tag: "DEF-0101",
      name: "Defibrillator",
      model: "DEF",
      hospital: "NCH",
      department: "ED",
      serial: "DEMO-SN-4101",
      status: "IN_SERVICE",
      risk: "HIGH",
    },
    {
      tag: "SUC-0101",
      name: "Wall suction unit",
      model: "SUC",
      hospital: "NCH",
      department: "THEATRES",
      serial: "DEMO-SN-5101",
      status: "IN_SERVICE",
      risk: "LOW",
    },
    {
      tag: "ECG-0101",
      name: "ECG machine",
      model: "ECG",
      hospital: "NCH",
      department: "WARDS",
      serial: "DEMO-SN-6101",
      status: "UNDER_REPAIR",
      risk: "MEDIUM",
    },
  ],
  // Highland deliberately REUSES the tag INF-0001 and serial DEMO-SN-1001:
  // asset IDs are unique per organisation, and serial numbers are not unique.
  "highland-medical": [
    {
      tag: "INF-0001",
      name: "Infusion pump",
      model: "INF",
      hospital: "SRH",
      department: "ICU",
      location: "ICU Room A",
      serial: "DEMO-SN-1001",
      status: "IN_SERVICE",
      risk: "HIGH",
      purchased: "2023-01-20",
      cost: ["3200000.00", "UGX"],
    },
    {
      tag: "VEN-0001",
      name: "ICU ventilator",
      model: "VEN",
      hospital: "SRH",
      department: "ICU",
      serial: "DEMO-SN-3101",
      status: "IN_SERVICE",
      risk: "HIGH",
    },
    {
      tag: "MON-0001",
      name: "Patient monitor",
      model: "MON",
      hospital: "SRH",
      department: "THEATRES",
      serial: "DEMO-SN-2101",
      status: "OUT_OF_SERVICE",
      risk: "MEDIUM",
    },
    {
      tag: "ECG-0001",
      name: "ECG machine",
      model: "ECG",
      hospital: "LVC",
      department: "OPD",
      serial: "DEMO-SN-6201",
      status: "IN_SERVICE",
      risk: "MEDIUM",
    },
  ],
};
