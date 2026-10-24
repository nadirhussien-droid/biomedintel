import type { ReactNode } from "react";
import { requireAccess } from "@/server/auth/session";
import { can } from "@/server/authz/access";
import { ReportNav } from "@/components/analytics/report-nav";
import { Card } from "@/components/ui/card";

/** Reports and Analytics: shared sub-navigation. Every page also checks permissions on the server. */
export default async function ReportsLayout({ children }: { children: ReactNode }) {
  const ctx = await requireAccess();
  if (!can(ctx, "analytics.view")) {
    return (
      <Card>
        <h1 className="text-lg font-semibold">Reports and Analytics</h1>
        <p className="text-ink-muted text-sm">
          Your role does not include engineering reports. To report a problem with a device, use Work Orders → Report a
          fault.
        </p>
      </Card>
    );
  }
  const tabs = [
    { href: "/reports", label: "Dashboard" },
    { href: "/reports/pm-compliance", label: "PM compliance" },
    { href: "/reports/work-orders", label: "Work orders" },
    { href: "/reports/reliability", label: "Reliability" },
    { href: "/reports/safety", label: "Electrical safety" },
    { href: "/reports/governance", label: "Plan governance" },
    { href: "/reports/lifecycle", label: "Lifecycle & cost" },
    { href: "/reports/costs", label: "Parts & service" },
    ...(can(ctx, "analytics.financial") ? [{ href: "/reports/department-spend", label: "Department spend" }] : []),
    ...(can(ctx, "analytics.workload") ? [{ href: "/reports/staff", label: "Staff effectiveness" }] : []),
    ...(can(ctx, "labour.rates") ? [{ href: "/reports/labour-rates", label: "Labour rates" }] : []),
    { href: "/reports/scheduled", label: "Scheduled reports" },
  ];
  return (
    <>
      <ReportNav tabs={tabs} />
      {children}
    </>
  );
}
