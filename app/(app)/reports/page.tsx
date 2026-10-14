import type { Metadata } from "next";
import { ModulePlaceholder } from "@/components/shell/module-placeholder";

export const metadata: Metadata = { title: "Reports and Analytics" };

export default function Page() {
  return (
    <ModulePlaceholder
      title={"Reports and Analytics"}
      stage={7}
      summary={"Monthly departmental, annual engineering and audit-readiness reports."}
      features={[
        "Monthly and annual reports from verified database figures",
        "Audit-readiness lists of unlocated and untested equipment",
        "Downtime, PM completion and cost analytics",
        "Reports support audits but never certify compliance on their own",
      ]}
    />
  );
}
