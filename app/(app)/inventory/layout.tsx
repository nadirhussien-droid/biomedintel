import type { ReactNode } from "react";
import { requireAccess } from "@/server/auth/session";
import { can } from "@/server/authz/access";
import { SubNav } from "@/components/shell/sub-nav";
import { Card } from "@/components/ui/card";

/** Spare Parts Inventory: shared sub-navigation. Every page also checks permissions on the server. */
export default async function InventoryLayout({ children }: { children: ReactNode }) {
  const ctx = await requireAccess();
  if (!can(ctx, "inventory.view")) {
    return (
      <Card>
        <h1 className="text-lg font-semibold">Spare Parts Inventory</h1>
        <p className="text-ink-muted text-sm">
          Your role does not include the spare parts inventory. Ask the biomedical engineering team if a part is needed
          for a repair.
        </p>
      </Card>
    );
  }
  const tabs = [
    { href: "/inventory", label: "Parts" },
    { href: "/inventory/work-orders", label: "On work orders" },
    { href: "/inventory/movements", label: "Stock movements" },
    ...(can(ctx, "purchase.view") ? [{ href: "/inventory/purchasing", label: "Purchase requests" }] : []),
    { href: "/inventory/stores", label: "Stores" },
    { href: "/inventory/settings", label: "Settings" },
  ];
  return (
    <>
      <SubNav tabs={tabs} root="/inventory" label="Inventory sections" />
      {children}
    </>
  );
}
