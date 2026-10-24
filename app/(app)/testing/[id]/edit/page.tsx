import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { requireAccess } from "@/server/auth/session";
import { can } from "@/server/authz/access";
import { NotFoundError } from "@/server/authz/errors";
import { getTestEquipment } from "@/server/services/testing";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/shell/page-header";
import { EquipmentForm } from "../../forms";

export const metadata: Metadata = { title: "Edit test equipment" };

export default async function EditTestEquipmentPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireAccess();
  const { id } = await params;
  if (!can(ctx, "testing.manage")) redirect(`/testing/${id}`);
  const item = await getTestEquipment(ctx, id).catch((e) => {
    if (e instanceof NotFoundError) notFound();
    throw e;
  });
  return (
    <>
      <PageHeader
        title={`Edit ${item.name}`}
        description="Calibration records are not changed here: add a new record on the equipment page."
      />
      <Card className="max-w-4xl">
        <EquipmentForm
          mode="edit"
          id={item.id}
          initial={{
            name: item.name,
            kind: item.kind,
            manufacturer: item.manufacturer,
            model: item.model,
            serialNumber: item.serialNumber,
            equipmentTag: item.equipmentTag ?? "",
            measures: item.measures ?? "",
            calibrationIntervalMonths: String(item.calibrationIntervalMonths),
            heldBy: item.heldBy ?? "",
            location: item.location ?? "",
            status: item.status,
            notes: item.notes ?? "",
          }}
        />
      </Card>
    </>
  );
}
