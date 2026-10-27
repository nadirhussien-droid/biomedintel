import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireAccess } from "@/server/auth/session";
import { can } from "@/server/authz/access";
import { NotFoundError } from "@/server/authz/errors";
import { getOwnTemplate, templateOptions } from "@/server/services/checklist-templates";
import { PageHeader } from "@/components/shell/page-header";
import { Card } from "@/components/ui/card";
import { TemplateForm } from "../../template-form";

export const metadata: Metadata = { title: "Edit checklist template" };

export default async function EditTemplatePage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireAccess();
  if (!can(ctx, "pm.manage")) {
    return (
      <Card>
        <p className="text-sm">Only Engineering Managers and Organization Administrators edit checklist templates.</p>
      </Card>
    );
  }
  const { id } = await params;
  let t;
  try {
    t = await getOwnTemplate(ctx, id);
  } catch (e) {
    if (e instanceof NotFoundError) notFound();
    throw e;
  }
  const saved = await templateOptions(ctx);
  const templates = [
    { label: "Your saved templates", list: saved.own.filter((x) => x.id !== id) },
    { label: "Starter templates", list: saved.builtIn },
  ].filter((g) => g.list.length > 0);
  return (
    <>
      <PageHeader
        title={`Edit template: ${t.name}`}
        description="Changes apply to plans you make from now on. Plans already made keep the checklist they were approved with."
      />
      <Card>
        <TemplateForm
          templates={templates}
          defaults={{
            id: t.id,
            name: t.name,
            deviceType: t.deviceType ?? "",
            description: t.description ?? "",
            checklist: t.items,
          }}
        />
      </Card>
    </>
  );
}
