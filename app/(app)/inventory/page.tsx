import type { Metadata } from "next";
import { ModulePlaceholder } from "@/components/shell/module-placeholder";

export const metadata: Metadata = { title: "Spare Parts Inventory" };

export default function Page() {
  return (
    <ModulePlaceholder
      title={"Spare Parts Inventory"}
      stage={7}
      summary={"Spare parts, stock movements and annual stock audits."}
      features={[
        "Stock levels updated when parts are used on work orders",
        "Low-stock alerts",
        "Receipts, transfers and adjustments with reasons",
        "Annual stock audit with approval of variances",
      ]}
    />
  );
}
