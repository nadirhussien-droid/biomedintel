import type { Metadata } from "next";
import { ModulePlaceholder } from "@/components/shell/module-placeholder";

export const metadata: Metadata = { title: "Technical Knowledge" };

export default function Page() {
  return (
    <ModulePlaceholder
      title={"Technical Knowledge"}
      stage={8}
      summary={"IntellKnowledge: authorised manuals, procedures and training material."}
      features={[
        "Private upload of authorised documents per organisation",
        "Version control and replacement of documents",
        "Search by model, fault code and part number",
        "Access control per role and hospital",
      ]}
    />
  );
}
