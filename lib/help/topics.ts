// Help shown in the Help panel: short steps for the page the user is on,
// written for their role. Button and field names are the app's own words, so
// keep them in step when a screen changes (tests/unit/help-topics.test.ts
// checks every page has help and every role gets something).
//
// Write steps with **bold** for the exact words on screen. No patient data,
// no promises the software does not keep.

export type HelpRole =
  | "ORG_ADMIN"
  | "ENGINEERING_MANAGER"
  | "TECHNICIAN"
  | "INVENTORY_MANAGER"
  | "DEPARTMENT_HEAD"
  | "AUDITOR"
  | "FAULT_REPORTER";

export type HelpTopic = {
  id: string;
  /** Which pages: matched against the path, most specific topics first. */
  path: RegExp;
  /** Who it is written for; omitted = everyone. */
  roles?: HelpRole[];
  section: string;
  title: string;
  steps: string[];
  warning?: string;
};

const MANAGERS: HelpRole[] = ["ORG_ADMIN", "ENGINEERING_MANAGER"];
const ID = "[^/]+";

export const HELP_TOPICS: HelpTopic[] = [
  {
    id: "report-fault",
    path: /^\/work-orders\/new\/?$/,
    section: "Report a fault",
    title: "Reporting a faulty device",
    steps: [
      "**Scan the barcode** on the device's label, or type its asset ID, then press **Find device**.",
      "Check it is the right device, then describe **what is wrong**: what you saw, any alarm or error message.",
      "If you have stopped using it, tick **I have taken this device out of use**.",
      "Add a photo if it helps (optional).",
      "Press **Report fault**. The engineering team is notified straight away.",
    ],
    warning: "Never write patient names or details in a fault report or photo.",
  },
  {
    id: "job-technician",
    path: new RegExp(`^/work-orders/${ID}/?$`),
    roles: ["TECHNICIAN"],
    section: "Work order",
    title: "Completing a repair job",
    steps: [
      "**Take this job**, then **Start work** when you begin.",
      "Record each block of work in **Log work**: what you did and the minutes.",
      "Waiting for a part? **Put on hold** with a reason, then **Resume work**.",
      "In **Sign off and complete**, write the cause in **Diagnosis** and what you did in **Work done and result**.",
      "Enter the functional check and electrical safety test results you measured yourself, then tick the declaration.",
    ],
    warning:
      "Failed safety test? The device cannot go back into service. Fix and re-test, or choose Not repairable, and tell your Engineering Manager.",
  },
  {
    id: "job-manager",
    path: new RegExp(`^/work-orders/${ID}/?$`),
    roles: MANAGERS,
    section: "Work order",
    title: "Managing a job",
    steps: [
      "Choose a **Technician** and press **Assign** (or **Reassign**). Only technicians with access to this department are listed.",
      "Use **Change priority** if the job is more or less urgent than reported.",
      "When the technician signs off, check the diagnosis, the work and both checks.",
      "Press **Mark as reviewed**, or **Reopen job** with a reason if something is missing.",
      "**Cancel job** (with a reason) only for duplicates or reports made in error.",
    ],
    warning: "A device with a failed electrical safety test can never be signed off as repaired.",
  },
  {
    id: "job-follow",
    path: new RegExp(`^/work-orders/${ID}/?$`),
    section: "Work order",
    title: "Following a job",
    steps: [
      "The status at the top shows where the job is: reported, assigned, in progress, on hold or completed.",
      "The timeline lists every step and who did it.",
      "Use **Add note** to give the engineers more information.",
      "You are notified in the bell at the top when the job changes.",
    ],
    warning: "No patient information in notes or photos.",
  },
  {
    id: "jobs-list",
    path: /^\/work-orders\/?$/,
    section: "Work orders",
    title: "Finding a job",
    steps: [
      "Use the search and filters to narrow the list.",
      "Open a job by its number to see the details and timeline.",
      "To report a new problem with a device, use **Report a fault**.",
    ],
  },
  {
    id: "asset-new",
    path: /^\/assets\/new\/?$/,
    section: "Equipment",
    title: "Adding a device",
    steps: [
      "The make and model must exist first: add them in **Equipment catalog** if they are missing.",
      "Enter the **Asset ID** (the number on your label) and the **Asset name**.",
      "Choose the **Model (manufacturer · category)**, the **Hospital** and the **Department (responsible)**.",
      "Add the serial number, location and dates if you have them, then save.",
    ],
  },
  {
    id: "asset-catalog",
    path: /^\/assets\/catalog\/?$/,
    section: "Equipment",
    title: "The equipment catalog",
    steps: [
      "Add a **manufacturer** (for example the company that makes the device).",
      "Add a **category** (for example Infusion pump).",
      "Add a **model** using that manufacturer and category.",
      "The model then appears when you add a device. Enter each model once and reuse it.",
    ],
  },
  {
    id: "asset-scan",
    path: /^\/assets\/scan\/?$/,
    section: "Equipment",
    title: "Opening a device by barcode",
    steps: [
      "Scan the barcode on the BiomedIntel.ai label with a handheld scanner or this device's camera.",
      "Or type the asset ID.",
      "You only see equipment in your own hospitals and departments.",
    ],
  },
  {
    id: "asset-register",
    path: /^\/assets(\/.*)?$/,
    section: "Equipment",
    title: "The equipment register",
    steps: [
      "Search by asset ID, name or serial number, and narrow with the filters.",
      "Open a device to see its details, jobs and maintenance.",
      "**Export register** gives the current list as **Excel**, **PDF** or **CSV**.",
    ],
  },
  {
    id: "plan-form",
    path: new RegExp(`^/maintenance/plans/(new|${ID}/edit)/?$`),
    section: "Preventive maintenance",
    title: "Writing a maintenance plan",
    steps: [
      "Choose **Applies to**: one asset, every asset of one model, every asset in one category, or every asset in one department.",
      "Set the interval and say where it comes from: a requirement first, then the manufacturer, and an organisation-defined interval only where no manufacturer guidance exists.",
      "Add the checklist items and any limits.",
      "Save. The plan is a draft and creates no work until an Engineering Manager approves it.",
    ],
  },
  {
    id: "plan-detail",
    path: new RegExp(`^/maintenance/plans/${ID}/?$`),
    roles: MANAGERS,
    section: "Preventive maintenance",
    title: "Approving and using a plan",
    steps: [
      "Check the interval, the source and the checklist, tick the confirmation and press **Approve plan**.",
      "Under the assets list, choose the devices, set the **First due date** and press **Enrol selected assets**.",
      "Work orders are then created automatically before each due date.",
      "**Pause plan** stops new work orders until you resume it.",
    ],
  },
  {
    id: "safety-holds",
    path: /^\/maintenance\/holds(\/.*)?$/,
    section: "Safety holds",
    title: "Devices on a safety hold",
    steps: [
      "A device whose electrical safety test failed is held as Do not use.",
      "It needs a repair and a passed retest.",
      "A second, authorised person then reviews it and presses **Approve return to service**, or sends it back for repair.",
    ],
    warning:
      "The person who did the retest cannot approve it, and the software never returns a device to service by itself.",
  },
  {
    id: "maintenance",
    path: /^\/maintenance(\/.*)?$/,
    section: "Preventive maintenance",
    title: "Planned maintenance",
    steps: [
      "**Schedule** shows what is due, upcoming and overdue.",
      "**Plans** lists the maintenance plans; a new plan needs approval before it creates work.",
      "PM jobs appear in Work orders and are completed with their checklist.",
    ],
  },
  {
    id: "reports",
    path: /^\/reports(\/.*)?$/,
    section: "Reports",
    title: "Reports and exports",
    steps: [
      "Choose the **Period** and any filters, then press **Show**.",
      "Where a report shows **How these figures are calculated**, it explains each number.",
      "**Export** gives the report as **Excel** (to work with the numbers), **PDF** (to print or share) or **CSV**.",
    ],
  },
  {
    id: "admin",
    path: /^\/admin\/?$/,
    roles: ["ORG_ADMIN"],
    section: "Administration",
    title: "Setting up your organisation",
    steps: [
      "Add each **hospital** (name and short code) and its **departments**.",
      "Add people under **Members** with their role and hospital. Copy each **temporary password** straight away: it is shown only once.",
      "Engineering Managers and administrators set up an authenticator app at first sign-in.",
      "Optional: upload your **Hospital logo** for printed job sheets and PDF reports.",
      "Read and resolve **Problem reports** sent by your staff.",
    ],
  },
  {
    id: "inventory",
    path: /^\/inventory(\/.*)?$/,
    section: "Spare parts",
    title: "Spare parts",
    steps: [
      "Find a part by barcode or number, or browse by store.",
      "Available stock is usable stock minus what is reserved for work orders.",
      "Every change in stock is recorded as a movement.",
    ],
  },
  {
    id: "knowledge",
    path: /^\/(knowledge|assist)(\/.*)?$/,
    section: "Technical knowledge",
    title: "Manuals and troubleshooting",
    steps: [
      "**Technical Knowledge** holds your organisation's manuals, procedures and error codes.",
      "Draft documents are labelled and are not used for troubleshooting until approved.",
      "**IntellAssist** suggestions are advisory: they never change a device, a job or a safety decision.",
    ],
  },
  {
    id: "dashboard",
    path: /^\/dashboard\/?$/,
    section: "Dashboard",
    title: "Your dashboard",
    steps: [
      "Use **Hospital** and **Department** at the top to narrow everything you see.",
      "The tiles show the work that needs attention.",
      "To report a faulty device, open **Work Orders** and choose **Report a fault**.",
    ],
  },
];

const GENERAL: HelpTopic = {
  id: "general",
  path: /.*/,
  section: "Help",
  title: "Getting around",
  steps: [
    "Use the menu on the left to move between sections.",
    "**Hospital** and **Department** at the top narrow what you see.",
    "The bell shows your notifications.",
    "Something not working or unclear? Use **Report a problem**.",
  ],
};

/** The help for a page and role: the first matching topic written for that role, else the general help. */
export function helpFor(pathname: string, role: HelpRole): HelpTopic {
  const path = pathname.split(/[?#]/)[0] || "/";
  return HELP_TOPICS.find((t) => t.path.test(path) && (!t.roles || t.roles.includes(role))) ?? GENERAL;
}

/** Splits "a **b** c" into text and bold parts for rendering (no HTML is ever interpreted). */
export function boldParts(text: string): { text: string; bold: boolean }[] {
  return text
    .split(/(\*\*[^*]+\*\*)/)
    .filter(Boolean)
    .map((p) =>
      p.startsWith("**") && p.endsWith("**") ? { text: p.slice(2, -2), bold: true } : { text: p, bold: false },
    );
}
