import type { Metadata } from "next";
import { ModulePlaceholder } from "@/components/shell/module-placeholder";

export const metadata: Metadata = { title: "Work Orders" };

export default function Page() {
  return (
    <ModulePlaceholder
      title={"Work Orders"}
      stage={5}
      summary={"Corrective maintenance from fault report to engineer sign-off."}
      features={[
        "Fault reports with photos from ward staff (Fault Reporter role)",
        "Assignment, diagnosis, parts used and repair notes",
        "Verification tests before a device returns to service",
        "Sign-off by a different, authorised person",
      ]}
    />
  );
}
