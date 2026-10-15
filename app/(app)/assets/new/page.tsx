import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { requireAccess } from "@/server/auth/session";
import { can } from "@/server/authz/access";
import { getAssetFormOptions } from "@/server/services/assets";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/shell/page-header";
import { AssetForm } from "../asset-form";

export const metadata: Metadata = { title: "Register equipment" };

export default async function NewAssetPage() {
  const ctx = await requireAccess();
  if (!can(ctx, "asset.create")) redirect("/assets");
  const options = await getAssetFormOptions(ctx);

  return (
    <>
      <PageHeader
        title="Register equipment"
        description="Add one physical device to the register. Its barcode label is the asset ID in Code 128, ready to print."
      />
      <Card className="max-w-5xl">
        {options.models.length === 0 ? (
          <p className="bg-warn-bg rounded-sm px-3 py-2 text-sm text-[#6b3f00]">
            Your organisation has no equipment models yet.{" "}
            <Link href="/assets/catalog" className="font-semibold underline">
              Add a manufacturer, category and model first
            </Link>
            .
          </p>
        ) : (
          <AssetForm
            mode="create"
            options={options}
            canEditCost={can(ctx, "asset.editCost")}
            initial={{
              hospitalId: ctx.selection.hospitalId ?? "",
              departmentId: ctx.selection.departmentId ?? "",
            }}
          />
        )}
      </Card>
    </>
  );
}
