import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireAccess } from "@/server/auth/session";
import { can } from "@/server/authz/access";
import { NotFoundError } from "@/server/authz/errors";
import { getPart, partFormOptions } from "@/server/services/inventory";
import { PageHeader } from "@/components/shell/page-header";
import { Card } from "@/components/ui/card";
import { ActionForm } from "@/components/forms/action-form";
import { PartFields } from "@/components/stage8/part-fields";
import { savePartAction } from "../../../actions";

export const metadata: Metadata = { title: "Edit part" };

export default async function EditPartPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireAccess();
  const { id } = await params;
  if (!can(ctx, "inventory.manage")) notFound();
  let data;
  try {
    data = await Promise.all([getPart(ctx, id), partFormOptions(ctx)]);
  } catch (e) {
    if (e instanceof NotFoundError) notFound();
    throw e;
  }
  const [{ part }, options] = data;
  if (part.status !== "ACTIVE") notFound();
  return (
    <>
      <PageHeader title={`Edit ${part.partNumber}`} description={part.name} />
      <Card>
        <ActionForm action={savePartAction} hidden={{ id: part.id }} label="Save changes" resetOnSuccess={false}>
          <PartFields
            editing
            options={options}
            values={{
              ...part,
              unitCost: part.unitCost?.toString() ?? null,
              modelIds: part.compatibility.flatMap((c) => (c.model ? [c.model.id] : [])),
              categoryIds: part.compatibility.flatMap((c) => (c.category ? [c.category.id] : [])),
              compatManufacturerIds: part.compatibility.flatMap((c) => (c.manufacturer ? [c.manufacturer.id] : [])),
              supplierIds: part.suppliers.map((s) => s.supplier.id),
            }}
          />
        </ActionForm>
      </Card>
    </>
  );
}
