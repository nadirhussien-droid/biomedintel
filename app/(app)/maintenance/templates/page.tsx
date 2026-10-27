import type { Metadata } from "next";
import Link from "next/link";
import { requireAccess } from "@/server/auth/session";
import { can } from "@/server/authz/access";
import { listOwnTemplates } from "@/server/services/checklist-templates";
import { TEST_TEMPLATES } from "@/lib/pm/test-templates";
import { PageHeader } from "@/components/shell/page-header";
import { Badge, Card, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ConfirmSubmit } from "@/components/ui/confirm-submit";
import type { ChecklistItem } from "@/lib/validation/pm";
import { archiveTemplateAction, restoreTemplateAction } from "./actions";

export const metadata: Metadata = { title: "Checklist templates" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
const linkButton = "inline-flex min-h-10 items-center justify-center rounded-md border px-3 text-sm font-semibold";
const SAVED: Record<string, string> = {
  created: "Template saved.",
  updated: "Template saved.",
  archived: "Template archived. Plans already made from it are not affected.",
  restored: "Template restored.",
};

export default async function TemplatesPage({ searchParams }: { searchParams: SearchParams }) {
  const ctx = await requireAccess();
  const sp = await searchParams;
  const own = await listOwnTemplates(ctx);
  const manage = can(ctx, "pm.manage");
  const saved = SAVED[first(sp.saved) ?? ""];
  return (
    <>
      <PageHeader
        title="Checklist templates"
        description="Ready-made and saved checklists for each type of device. Pick one when you make a maintenance or safety test plan, then adjust the items and limits from the manufacturer manual."
        actions={
          manage ? (
            <Link
              href="/maintenance/templates/new"
              className={`${linkButton} text-navy-900 border-teal-400 bg-teal-400`}
            >
              New template
            </Link>
          ) : null
        }
      />
      {saved ? (
        <p role="status" className="bg-ok-bg text-ok rounded-md px-4 py-3 text-sm font-medium">
          {saved}
        </p>
      ) : null}
      <Card>
        <CardTitle>Your saved templates</CardTitle>
        {own.length === 0 ? (
          <p className="text-ink-muted text-sm">
            You have not saved a template yet.
            {manage ? " Press New template, or copy one of the starter templates below and edit it." : ""}
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {own.map((t) => (
              <li
                key={t.id}
                className="border-line flex flex-wrap items-center justify-between gap-3 rounded-md border p-3"
              >
                <div className="text-sm">
                  <div className="font-semibold">
                    {t.name} {t.status === "ARCHIVED" ? <Badge>archived</Badge> : null}
                  </div>
                  <div className="text-ink-muted text-xs">
                    {[t.deviceType, `${(t.checklist as unknown as ChecklistItem[]).length} items`]
                      .filter(Boolean)
                      .join(" · ")}
                  </div>
                </div>
                {manage ? (
                  <div className="flex flex-wrap items-center gap-2">
                    {t.status === "ACTIVE" ? (
                      <>
                        <Link
                          href={`/maintenance/templates/${t.id}/edit`}
                          className={`${linkButton} border-line-strong text-navy-900 bg-white`}
                        >
                          Edit
                        </Link>
                        <form action={archiveTemplateAction}>
                          <input type="hidden" name="id" value={t.id} />
                          <ConfirmSubmit
                            message={`Archive the template ${t.name}? Plans already made from it are not affected, and you can restore it later.`}
                            className={`${linkButton} border-danger/40 text-danger bg-white`}
                          >
                            Archive
                          </ConfirmSubmit>
                        </form>
                      </>
                    ) : (
                      <form action={restoreTemplateAction}>
                        <input type="hidden" name="id" value={t.id} />
                        <Button type="submit" variant="secondary">
                          Restore
                        </Button>
                      </form>
                    )}
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Card>
        <CardTitle>Starter templates</CardTitle>
        <p className="text-ink-muted mb-3 text-sm">
          Starting points only. They leave almost every limit blank on purpose: set the limits from the manufacturer
          service manual or your verified standard.
          {manage ? " Copy one to save your own version." : ""}
        </p>
        <ul className="grid gap-2 md:grid-cols-2">
          {TEST_TEMPLATES.map((t) => (
            <li key={t.id} className="border-line flex flex-col gap-1 rounded-md border p-3 text-sm">
              <div className="font-semibold">{t.name}</div>
              <div className="text-ink-muted text-xs">{t.description}</div>
              <div className="text-ink-muted text-xs">{t.items.length} items</div>
              {manage ? (
                <Link
                  href={`/maintenance/templates/new?from=${t.id}`}
                  className="text-xs font-semibold text-teal-700 hover:underline"
                >
                  Copy and edit
                </Link>
              ) : null}
            </li>
          ))}
        </ul>
      </Card>
    </>
  );
}
