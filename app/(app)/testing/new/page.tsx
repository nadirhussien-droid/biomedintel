import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { requireAccess } from "@/server/auth/session";
import { can } from "@/server/authz/access";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/shell/page-header";
import { EMPTY_EQUIPMENT, EquipmentForm } from "../forms";

export const metadata: Metadata = { title: "Register test equipment" };

export default async function NewTestEquipmentPage() {
  const ctx = await requireAccess();
  if (!can(ctx, "testing.manage")) redirect("/testing");
  return (
    <>
      <PageHeader
        title="Register test equipment"
        description="Add a tool you test other devices with. You can add its calibration certificate on the next page."
      />
      <Card className="max-w-4xl">
        <EquipmentForm mode="create" initial={EMPTY_EQUIPMENT} />
      </Card>
    </>
  );
}
