import type { Metadata } from "next";
import { requireAccess } from "@/server/auth/session";
import { can } from "@/server/authz/access";
import { knowledgeOptions } from "@/server/services/knowledge";
import { PageHeader } from "@/components/shell/page-header";
import { Card } from "@/components/ui/card";
import { NewDocumentForm } from "@/components/stage9/document-upload";

export const metadata: Metadata = { title: "Add a document" };

export default async function NewDocumentPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await requireAccess();
  if (!can(ctx, "knowledge.contribute")) {
    return (
      <Card>
        <p className="text-sm">Your role does not include adding documents.</p>
      </Card>
    );
  }
  const model = (await searchParams).model;
  const options = await knowledgeOptions(ctx);
  return (
    <>
      <PageHeader
        title="Add a document"
        description="Register a manual, procedure, bulletin, error-code list or engineering note. It is saved as a draft until an Engineering Manager approves it."
      />
      <Card className="max-w-5xl">
        <NewDocumentForm {...options} defaults={{ modelId: typeof model === "string" ? model : undefined }} />
      </Card>
    </>
  );
}
