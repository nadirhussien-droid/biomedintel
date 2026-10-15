import type { Metadata } from "next";
import { requireAccess } from "@/server/auth/session";
import { can } from "@/server/authz/access";
import { planFormOptions } from "@/server/services/pm-plans";
import { PageHeader } from "@/components/shell/page-header";
import { Card } from "@/components/ui/card";
import { todayFor } from "@/server/services/pm-schedule";
import { PlanForm } from "../plan-form";

export const metadata: Metadata = { title: "New maintenance plan" };

export default async function NewPlanPage() {
  const ctx = await requireAccess();
  if (!can(ctx, "pm.manage")) {
    return (
      <Card>
        <p className="text-sm">Only Engineering Managers and Organization Administrators write maintenance plans.</p>
      </Card>
    );
  }
  const options = await planFormOptions(ctx);
  return (
    <>
      <PageHeader
        title="New maintenance plan"
        description="Saved as a draft. It creates no work until an Engineering Manager approves the procedure, limits and interval."
      />
      <Card>
        <PlanForm
          options={options}
          defaults={{
            name: "",
            description: "",
            hospitalId: options.orgWide ? "" : (options.hospitals[0]?.id ?? ""),
            workType: "PREVENTIVE",
            targetKind: "MODEL",
            targetId: "",
            intervalCount: 12,
            intervalUnit: "MONTH",
            intervalSource: "MANUFACTURER",
            sourceReference: "",
            justification: "",
            startsOn: await todayFor(ctx),
            endsOn: "",
            leadDays: 14,
            graceDays: 0,
            estimatedMinutes: "",
            defaultAssigneeId: "",
            requiredCompetency: "",
            priority: "MEDIUM",
            documentReference: "",
            instructions: "",
            checklist: [],
          }}
        />
      </Card>
    </>
  );
}
