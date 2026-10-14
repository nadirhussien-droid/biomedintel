import type { Metadata } from "next";
import { ModulePlaceholder } from "@/components/shell/module-placeholder";

export const metadata: Metadata = { title: "Safety Tests and Calibration" };

export default function Page() {
  return (
    <ModulePlaceholder
      title={"Safety Tests and Calibration"}
      stage={6}
      summary={"Electrical safety tests, calibration and inspections with recorded results."}
      features={[
        "Measured values entered by technicians, never generated",
        "Failed tests take the device out of service automatically",
        "Calibration as-found and as-left values with certificates",
        "Test equipment calibration tracking",
      ]}
    />
  );
}
