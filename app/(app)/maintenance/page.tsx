import type { Metadata } from "next";
import { ModulePlaceholder } from "@/components/shell/module-placeholder";

export const metadata: Metadata = { title: "Preventive Maintenance" };

export default function Page() {
  return (
    <ModulePlaceholder
      title={"Preventive Maintenance"}
      stage={6}
      summary={"Scheduled maintenance plans and checklists for every device type."}
      features={[
        "PM plans by model or category with intervals and checklists",
        "Automatic PM work orders before the due date",
        "Overdue tracking and escalation",
        "Department-by-department PM rounds",
      ]}
    />
  );
}
