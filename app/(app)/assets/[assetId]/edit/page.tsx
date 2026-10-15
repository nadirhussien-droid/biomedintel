import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireAccess } from "@/server/auth/session";
import { can } from "@/server/authz/access";
import { NotFoundError } from "@/server/authz/errors";
import { getAssetForEdit, getAssetFormOptions } from "@/server/services/assets";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/shell/page-header";
import { AssetForm } from "../../asset-form";

export const metadata: Metadata = { title: "Edit equipment" };

export default async function EditAssetPage({ params }: { params: Promise<{ assetId: string }> }) {
  const { assetId } = await params;
  const ctx = await requireAccess();
  if (!can(ctx, "asset.edit")) redirect(`/assets/${encodeURIComponent(assetId)}`);

  const asset = await getAssetForEdit(ctx, assetId).catch((error) => {
    if (error instanceof NotFoundError) notFound();
    throw error;
  });
  const options = await getAssetFormOptions(ctx);

  return (
    <>
      <PageHeader title={`Edit ${asset.values.assetTag}`} description={asset.values.name} />
      <Card className="max-w-5xl">
        {asset.archived || asset.decommissioned ? (
          <p className="bg-warn-bg rounded-sm px-3 py-2 text-sm text-[#6b3f00]">
            This asset is {asset.archived ? "archived" : "decommissioned"} and cannot be edited.{" "}
            <Link href={`/assets/${asset.id}`} className="font-semibold underline">
              Back to the asset
            </Link>
          </p>
        ) : (
          <AssetForm
            mode="edit"
            options={options}
            initial={asset.values}
            canEditCost={can(ctx, "asset.editCost")}
            assetId={asset.id}
            version={asset.version}
          />
        )}
      </Card>
    </>
  );
}
