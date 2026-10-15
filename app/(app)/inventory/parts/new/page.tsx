import type { Metadata } from "next";
import { requireAccess } from "@/server/auth/session";
import { can } from "@/server/authz/access";
import { partFormOptions } from "@/server/services/inventory";
import { PageHeader } from "@/components/shell/page-header";
import { Card } from "@/components/ui/card";
import { ActionForm } from "@/components/forms/action-form";
import { PartFields } from "@/components/stage8/part-fields";
import { savePartAction } from "../../actions";

export const metadata: Metadata = { title: "Add part" };

export default async function NewPartPage() {
  const ctx = await requireAccess();
  if (!can(ctx, "inventory.manage")) {
    return (
      <Card>
        <p className="text-sm">Only Inventory Managers and Engineering Managers add parts to the catalogue.</p>
      </Card>
    );
  }
  const options = await partFormOptions(ctx);
  return (
    <>
      <PageHeader
        title="Add a part"
        description="Adds the part to your organisation's catalogue. Stock is then added with a recorded receipt or initial stock movement."
      />
      <Card>
        <ActionForm action={savePartAction} label="Save part">
          <PartFields options={options} />
        </ActionForm>
      </Card>
    </>
  );
}
