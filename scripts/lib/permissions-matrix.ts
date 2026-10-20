// Builds docs/PERMISSIONS.md from server/authz/permissions.ts (Stage 10), so
// the published table can never drift from what the code enforces. A unit
// test fails if the file is out of date: run `npm run docs:permissions`.
import { PERMISSIONS, type Action } from "../../server/authz/permissions";
import { MEMBERSHIP_ROLES, MFA_REQUIRED_ROLES, ROLE_LABELS } from "../../server/authz/roles";

const SHORT: Record<string, string> = {
  ORG_ADMIN: "Org admin",
  ENGINEERING_MANAGER: "Eng. manager",
  TECHNICIAN: "Technician",
  INVENTORY_MANAGER: "Inventory mgr",
  DEPARTMENT_HEAD: "Dept head",
  AUDITOR: "Auditor",
  FAULT_REPORTER: "Fault reporter",
};

export function permissionsMarkdown(): string {
  const actions = Object.keys(PERMISSIONS) as Action[];
  const groups = new Map<string, Action[]>();
  for (const a of actions) {
    const g = a.split(".")[0];
    groups.set(g, [...(groups.get(g) ?? []), a]);
  }
  const lines: string[] = [
    "# BiomedIntel.ai — permissions matrix",
    "",
    "<!-- Generated from server/authz/permissions.ts by `npm run docs:permissions`. Do not edit by hand. -->",
    "",
    "**What a role may do.** Every server action and page checks this table on the server before doing anything (deny by default). Hiding a button is only a convenience.",
    "",
    "**Where it may do it.** Separately, every record is checked against the person's organisation (database row-level security) and their hospitals and departments (scope). A permission never reaches another organisation's records.",
    "",
    "## Roles",
    "",
    "| Role | Name in the app | MFA |",
    "| --- | --- | --- |",
    ...MEMBERSHIP_ROLES.map(
      (r) =>
        `| ${SHORT[r]} | ${ROLE_LABELS[r]} | ${MFA_REQUIRED_ROLES.has(r) ? "Required (authenticator app)" : "Optional"} |`,
    ),
    "| Platform Super Administrator | Runs the platform; not a member role | Required |",
    "",
    `## Actions (${actions.length})`,
    "",
    "✔ = allowed. Blank = refused.",
    "",
  ];
  for (const [group, list] of groups) {
    lines.push(
      `### ${group}`,
      "",
      `| Action | ${MEMBERSHIP_ROLES.map((r) => SHORT[r]).join(" | ")} |`,
      `| --- |${MEMBERSHIP_ROLES.map(() => " :-: |").join("")}`,
    );
    for (const a of list) {
      const allowed: readonly string[] = PERMISSIONS[a];
      lines.push(`| \`${a}\` | ${MEMBERSHIP_ROLES.map((r) => (allowed.includes(r) ? "✔" : "")).join(" | ")} |`);
    }
    lines.push("");
  }
  lines.push(
    "## Rules enforced in the services as well (not visible in this table)",
    "",
    "- Nobody can change their own role or reset their own MFA; an MFA reset is refused when the person also belongs to another organisation (Stage 10).",
    "- Technicians sign off, issue parts for and troubleshoot only jobs assigned to them (or sessions they started).",
    "- A Failed Safety Test hold is released only by an Engineering Manager who is NOT the person who did the retest, after a passed retest; the database enforces the same rule.",
    "- Decommissioning is approved by the department's Department Head (fallback: Engineering Manager or facility-wide Department Head), never by the requester.",
    "- Purchase requests are approved by a second person (never the requester; database check).",
    "- Knowledge documents are approved by an Engineering Manager; managers-only documents and withdrawn documents are hidden from technicians.",
    "- Costs are shown only to roles with the cost permissions; the cost report and financial views are audited.",
    "- AI suggestions can never change a record's status, approve repairs or release a safety hold (no code path exists).",
    "",
  );
  return lines.join("\n");
}
