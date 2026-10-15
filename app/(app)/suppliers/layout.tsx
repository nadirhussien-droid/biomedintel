import type { ReactNode } from "react";
import { requireAccess } from "@/server/auth/session";
import { can } from "@/server/authz/access";
import { SubNav } from "@/components/shell/sub-nav";
import { Card } from "@/components/ui/card";

/** Suppliers, contracts and warranties: shared sub-navigation. Every page also checks permissions on the server. */
export default async function SuppliersLayout({ children }: { children: ReactNode }) {
  const ctx = await requireAccess();
  if (!can(ctx, "supplier.view") && !can(ctx, "warranty.view")) {
    return (
      <Card>
        <h1 className="text-lg font-semibold">Suppliers and Contracts</h1>
        <p className="text-ink-muted text-sm">Your role does not include supplier, contract or warranty records.</p>
      </Card>
    );
  }
  const tabs = [
    ...(can(ctx, "supplier.view") ? [{ href: "/suppliers", label: "Suppliers" }] : []),
    ...(can(ctx, "warranty.view") ? [{ href: "/suppliers/warranties", label: "Warranties and contracts" }] : []),
    ...(can(ctx, "supplier.view") ? [{ href: "/suppliers/services", label: "Supplier work in progress" }] : []),
  ];
  return (
    <>
      <SubNav tabs={tabs} root="/suppliers" label="Supplier sections" />
      {children}
    </>
  );
}
