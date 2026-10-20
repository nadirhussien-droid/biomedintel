// npm run docs:permissions — rewrites docs/PERMISSIONS.md from the code.
import fs from "node:fs";
import { permissionsMarkdown } from "../lib/permissions-matrix";

fs.writeFileSync("docs/PERMISSIONS.md", permissionsMarkdown());
console.log("docs/PERMISSIONS.md updated.");
