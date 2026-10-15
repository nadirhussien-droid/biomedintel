import type { ReactNode } from "react";
import { requireAccess } from "@/server/auth/session";
import { can } from "@/server/authz/access";
import { MaintenanceNav } from "@/components/pm/maintenance-nav";
import { Card } from "@/components/ui/card";

/** Preventive Maintenance: shared sub-navigation. Every page also checks permissions on the server. */
export default async function MaintenanceLayout({ children }: { children: ReactNode }) {
  const ctx = await requireAccess();
  if (!can(ctx, "pm.view")) {
    return (
      <Card>
        <h1 className="text-lg font-semibold">Preventive maintenance</h1>
        <p className="text-ink-muted text-sm">
          Your role does not include maintenance schedules. To report a problem with a device, use Work Orders → Report
          a fault.
        </p>
      </Card>
    );
  }
  const tabs = [
    { href: "/maintenance", label: "Overview" },
    { href: "/maintenance/schedule", label: "Schedule" },
    { href: "/maintenance/calendar", label: "Calendar" },
    { href: "/maintenance/plans", label: "Plans" },
    { href: "/maintenance/review", label: "Needs review" },
    { href: "/maintenance/holds", label: "Safety holds" },
    ...(can(ctx, "pm.report") ? [{ href: "/maintenance/reports", label: "Reports" }] : []),
    { href: "/maintenance/settings", label: "Settings" },
  ];
  return (
    <>
      <MaintenanceNav tabs={tabs} />
      {children}
    </>
  );
}
