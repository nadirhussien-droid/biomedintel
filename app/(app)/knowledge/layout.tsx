import type { ReactNode } from "react";
import { requireAccess } from "@/server/auth/session";
import { can } from "@/server/authz/access";
import { Card } from "@/components/ui/card";

/** Technical Knowledge: every page also checks permissions on the server. */
export default async function KnowledgeLayout({ children }: { children: ReactNode }) {
  const ctx = await requireAccess();
  if (!can(ctx, "knowledge.view")) {
    return (
      <Card>
        <h1 className="text-lg font-semibold">Technical Knowledge</h1>
        <p className="text-ink-muted text-sm">
          Your role does not include the technical knowledge base. To report a problem with a device, use Work Orders →
          Report a fault.
        </p>
      </Card>
    );
  }
  return <>{children}</>;
}
