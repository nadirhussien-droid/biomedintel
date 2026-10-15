import type { Metadata } from "next";
import { requireAccess } from "@/server/auth/session";
import { can } from "@/server/authz/access";
import { manufacturerOptions } from "@/server/services/suppliers";
import { PageHeader } from "@/components/shell/page-header";
import { Card } from "@/components/ui/card";
import { ActionForm } from "@/components/forms/action-form";
import { SupplierFields } from "@/components/stage8/supplier-fields";
import { saveSupplierAction } from "../actions";

export const metadata: Metadata = { title: "Add supplier" };

export default async function NewSupplierPage() {
  const ctx = await requireAccess();
  if (!can(ctx, "supplier.manage")) {
    return (
      <Card>
        <p className="text-sm">Only Inventory Managers, Engineering Managers and Org Admins add suppliers.</p>
      </Card>
    );
  }
  const manufacturers = await manufacturerOptions(ctx);
  return (
    <>
      <PageHeader title="Add a supplier" description="Business details only. Nothing is sent to the supplier." />
      <Card>
        <ActionForm action={saveSupplierAction} label="Save supplier">
          <SupplierFields manufacturers={manufacturers} />
        </ActionForm>
      </Card>
    </>
  );
}
