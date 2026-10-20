// Migration safety check (Stage 10).
//
// Looks through every prisma/migrations/*/migration.sql for statements that
// can destroy data or weaken a protection. Each such migration must be listed
// in prisma/migrations/reviewed-destructive.json with the reason a person
// approved it; anything not listed fails the check. This catches a careless
// "DROP COLUMN" before it reaches a hosted database.
import fs from "node:fs";
import path from "node:path";

export type Finding = {
  migration: string;
  line: number;
  kind: "DATA_LOSS" | "REWRITES_DATA" | "WEAKENS_PROTECTION";
  statement: string;
};

const RULES: [RegExp, Finding["kind"]][] = [
  [/^\s*DROP\s+(TABLE|SCHEMA|DATABASE|TYPE|SEQUENCE|MATERIALIZED\s+VIEW|VIEW)\b/i, "DATA_LOSS"],
  [/\bDROP\s+COLUMN\b/i, "DATA_LOSS"],
  [/^\s*TRUNCATE\b/i, "DATA_LOSS"],
  [/^\s*DELETE\s+FROM\b/i, "DATA_LOSS"],
  [/^\s*UPDATE\s+"?\w+"?\s+SET\b/i, "REWRITES_DATA"],
  [/\bALTER\s+COLUMN\s+\S+\s+(SET\s+DATA\s+)?TYPE\b/i, "DATA_LOSS"],
  [/\bRENAME\s+(COLUMN|TO)\b/i, "DATA_LOSS"],
  [/\bDROP\s+(CONSTRAINT|INDEX|TRIGGER|POLICY|FUNCTION)\b/i, "WEAKENS_PROTECTION"],
  [/^\s*DROP\s+(INDEX|TRIGGER|POLICY|FUNCTION)\b/i, "WEAKENS_PROTECTION"],
  [/\bDROP\s+NOT\s+NULL\b/i, "WEAKENS_PROTECTION"],
  [/\bDISABLE\s+(ROW\s+LEVEL\s+SECURITY|TRIGGER)\b/i, "WEAKENS_PROTECTION"],
  [/\bNO\s+FORCE\s+ROW\s+LEVEL\s+SECURITY\b/i, "WEAKENS_PROTECTION"],
  [/\bBYPASSRLS\b/i, "WEAKENS_PROTECTION"],
  [/^\s*GRANT\s+.*\bTO\s+PUBLIC\b/i, "WEAKENS_PROTECTION"],
];

/** Removes -- comments and the bodies of $$ … $$ functions (their text is not a statement). */
function codeLines(sql: string): string[] {
  const out: string[] = [];
  let inBody = false;
  for (const raw of sql.split("\n")) {
    const dollars = (raw.match(/\$\$/g) ?? []).length;
    const line = inBody ? "" : raw.replace(/--.*$/, "");
    if (dollars % 2 === 1) inBody = !inBody;
    out.push(line);
  }
  return out;
}

export function scanMigrations(dir: string): Finding[] {
  const findings: Finding[] = [];
  const names = fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();
  for (const name of names) {
    const file = path.join(dir, name, "migration.sql");
    if (!fs.existsSync(file)) continue;
    codeLines(fs.readFileSync(file, "utf8")).forEach((line, i) => {
      const rule = RULES.find(([re]) => re.test(line));
      if (rule) findings.push({ migration: name, line: i + 1, kind: rule[1], statement: line.trim().slice(0, 160) });
    });
  }
  return findings;
}

export type Reviewed = Record<string, { reason: string; approvedBy: string; date: string }>;

export function unreviewed(dir: string): Finding[] {
  const listFile = path.join(dir, "reviewed-destructive.json");
  const reviewed: Reviewed = fs.existsSync(listFile) ? JSON.parse(fs.readFileSync(listFile, "utf8")) : {};
  return scanMigrations(dir).filter((f) => !reviewed[f.migration]);
}
