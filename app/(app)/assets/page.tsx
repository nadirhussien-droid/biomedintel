import type { Metadata } from "next";
import { ModulePlaceholder } from "@/components/shell/module-placeholder";

export const metadata: Metadata = { title: "Equipment Assets" };

export default function Page() {
  return (
    <ModulePlaceholder
      title={"Equipment Assets"}
      stage={4}
      summary={"The register of every medical device across your hospitals and departments."}
      features={[
        "Asset register with search and filters by hospital, department, type and status",
        "QR code labels; scanning one opens the asset and its history",
        "Serial numbers, risk class, warranty and service contracts per asset",
        "Import an existing equipment list from a spreadsheet",
      ]}
    />
  );
}
