import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireAccess } from "@/server/auth/session";
import { can } from "@/server/authz/access";
import { NotFoundError } from "@/server/authz/errors";
import { getSupplier, manufacturerOptions } from "@/server/services/suppliers";
import { PageHeader } from "@/components/shell/page-header";
import { Card } from "@/components/ui/card";
import { ActionForm } from "@/components/forms/action-form";
import { SupplierFields } from "@/components/stage8/supplier-fields";
import { saveSupplierAction } from "../../actions";

export const metadata: Metadata = { title: "Edit supplier" };

export default async function EditSupplierPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireAccess();
  const { id } = await params;
  if (!can(ctx, "supplier.manage")) notFound();
  let data;
  try {
    data = await Promise.all([getSupplier(ctx, id), manufacturerOptions(ctx)]);
  } catch (e) {
    if (e instanceof NotFoundError) notFound();
    throw e;
  }
  const [{ supplier: s }, manufacturers] = data;
  if (s.status !== "ACTIVE") notFound();
  return (
    <>
      <PageHeader title={`Edit ${s.name}`} />
      <Card>
        <ActionForm action={saveSupplierAction} hidden={{ id: s.id }} label="Save changes" resetOnSuccess={false}>
          <SupplierFields
            manufacturers={manufacturers}
            values={{ ...s, manufacturerIds: s.manufacturers.map((m) => m.manufacturerId) }}
          />
        </ActionForm>
      </Card>
    </>
  );
}
