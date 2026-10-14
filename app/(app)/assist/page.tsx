import type { Metadata } from "next";
import { ModulePlaceholder } from "@/components/shell/module-placeholder";

export const metadata: Metadata = { title: "IntellAssist" };

export default function Page() {
  return (
    <ModulePlaceholder
      title={"IntellAssist"}
      stage={9}
      summary={"AI troubleshooting assistant for biomedical technicians."}
      features={[
        "Answers only from authorised documents and your maintenance history",
        "Every suggestion cites its source; no source means no claim",
        "Asks clarifying questions and states its uncertainty",
        "Escalates safety-critical faults and never declares equipment safe for patient use",
      ]}
    />
  );
}
