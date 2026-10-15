import type { ReactNode } from "react";
import { requireAccess } from "@/server/auth/session";
import { can } from "@/server/authz/access";
import { Card } from "@/components/ui/card";

/** IntellAssist: every page also checks permissions on the server. */
export default async function AssistLayout({ children }: { children: ReactNode }) {
  const ctx = await requireAccess();
  if (!can(ctx, "troubleshoot.view") && !can(ctx, "ai.settings")) {
    return (
      <Card>
        <h1 className="text-lg font-semibold">IntellAssist</h1>
        <p className="text-ink-muted text-sm">
          Your role does not include troubleshooting sessions. To report a problem with a device, use Work Orders →
          Report a fault.
        </p>
      </Card>
    );
  }
  return <>{children}</>;
}
