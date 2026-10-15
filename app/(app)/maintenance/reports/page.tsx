import { redirect } from "next/navigation";

// Stage 7: PM compliance moved to Reports and Analytics, so the same figures
// have a single source. Old links and bookmarks land there.
export default function MaintenanceReportsMoved() {
  redirect("/reports/pm-compliance");
}
