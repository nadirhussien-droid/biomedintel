import type { Metadata } from "next";
import { requireAccess } from "@/server/auth/session";
import { can } from "@/server/authz/access";
import { getOwnTemplate, templateOptions } from "@/server/services/checklist-templates";
import { PageHeader } from "@/components/shell/page-header";
import { Card } from "@/components/ui/card";
import { TEST_TEMPLATES } from "@/lib/pm/test-templates";
import { TemplateForm } from "../template-form";

export const metadata: Metadata = { title: "New checklist template" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default async function NewTemplatePage({ searchParams }: { searchParams: SearchParams }) {
  const ctx = await requireAccess();
  if (!can(ctx, "pm.manage")) {
    return (
      <Card>
        <p className="text-sm">Only Engineering Managers and Organization Administrators create checklist templates.</p>
      </Card>
    );
  }
  const from = first((await searchParams).from);
  const builtIn = TEST_TEMPLATES.find((t) => t.id === from);
  const own = !builtIn && from ? await getOwnTemplate(ctx, from).catch(() => null) : null;
  const saved = await templateOptions(ctx);
  const templates = [
    { label: "Your saved templates", list: saved.own },
    { label: "Starter templates", list: saved.builtIn },
  ].filter((g) => g.list.length > 0);
  return (
    <>
      <PageHeader
        title="New checklist template"
        description="Name it, list the checks for this type of device, and save it. You can pick it whenever you make a plan."
      />
      <Card>
        <TemplateForm
          templates={templates}
          defaults={{
            name: builtIn ? `${builtIn.name} (our version)` : own ? `${own.name} (copy)` : "",
            deviceType: own?.deviceType ?? "",
            description: builtIn?.description ?? own?.description ?? "",
            checklist: builtIn ? builtIn.items.map((i) => ({ ...i })) : (own?.items ?? []),
          }}
        />
      </Card>
    </>
  );
}
