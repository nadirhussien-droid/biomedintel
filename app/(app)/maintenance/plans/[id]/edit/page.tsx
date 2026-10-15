import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireAccess } from "@/server/auth/session";
import { NotFoundError } from "@/server/authz/errors";
import { getPlan, planFormOptions } from "@/server/services/pm-plans";
import { PageHeader } from "@/components/shell/page-header";
import { Card } from "@/components/ui/card";
import { fromDbDate } from "@/lib/pm/dates";
import { PlanForm } from "../../plan-form";

export const metadata: Metadata = { title: "Edit maintenance plan" };

export default async function EditPlanPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireAccess();
  const { id } = await params;
  const plan = await getPlan(ctx, id).catch((e) => {
    if (e instanceof NotFoundError) notFound();
    throw e;
  });
  if (!plan.allowed.edit) notFound();
  const options = await planFormOptions(ctx);
  return (
    <>
      <PageHeader
        title={`Edit: ${plan.name}`}
        description="Your changes are saved as a working copy. Work orders keep using the approved version until an Engineering Manager approves the change."
      />
      <Card>
        <PlanForm
          options={options}
          defaults={{
            id: plan.id,
            name: plan.name,
            description: plan.description ?? "",
            hospitalId: plan.hospitalId ?? "",
            workType: plan.workType,
            targetKind: plan.targetKind,
            targetId: plan.assetId ?? plan.modelId ?? plan.categoryId ?? "",
            intervalCount: plan.intervalCount,
            intervalUnit: plan.intervalUnit,
            intervalSource: plan.intervalSource,
            sourceReference: plan.sourceReference ?? "",
            justification: plan.justification ?? "",
            startsOn: fromDbDate(plan.startsOn),
            endsOn: plan.endsOn ? fromDbDate(plan.endsOn) : "",
            leadDays: plan.leadDays,
            graceDays: plan.graceDays,
            estimatedMinutes: plan.estimatedMinutes ? String(plan.estimatedMinutes) : "",
            defaultAssigneeId: plan.defaultAssigneeId ?? "",
            requiredCompetency: plan.requiredCompetency ?? "",
            priority: plan.priority,
            documentReference: plan.documentReference ?? "",
            instructions: plan.instructions ?? "",
            checklist: plan.checklistItems,
            locked: Boolean(plan.approvedRevisionId),
          }}
        />
      </Card>
    </>
  );
}
