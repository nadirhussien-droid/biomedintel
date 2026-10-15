import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { requireAccess } from "@/server/auth/session";
import { can } from "@/server/authz/access";
import { NotFoundError } from "@/server/authz/errors";
import { getAsset } from "@/server/services/assets";
import { Badge, Card } from "@/components/ui/card";
import { PageHeader } from "@/components/shell/page-header";
import { StatusBadge } from "@/components/assets/status-badge";
import { AssetPicker, ReportForm } from "./report-form";
import { warrantyForAsset } from "@/server/services/warranties";
import { WarrantyPanel } from "@/components/stage8/work-order-extras";

export const metadata: Metadata = { title: "Report a fault" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function ReportFaultPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await requireAccess();
  if (!can(ctx, "workorder.report")) redirect("/work-orders");
  const raw = (await searchParams).asset;
  const assetId = typeof raw === "string" && UUID.test(raw) ? raw : null;
  // The asset is loaded through the normal asset service: same scope checks
  // as opening the asset page. A barcode or link alone grants nothing.
  const asset = assetId
    ? await getAsset(ctx, assetId).catch((error) => {
        if (error instanceof NotFoundError) return null;
        throw error;
      })
    : null;
  const unusable = asset && (asset.archivedAt !== null || asset.status === "DECOMMISSIONED");
  // Stage 8: warranty information as recorded, for roles that may see it (null otherwise).
  const warranty = asset && !unusable ? await warrantyForAsset(ctx, asset.id) : null;

  return (
    <>
      <PageHeader
        title="Report a fault"
        description="Scan the device's barcode or type its asset ID, then describe what is wrong. The engineering team is notified straight away."
      />
      {!asset || unusable ? (
        <Card className="max-w-3xl">
          {assetId && !asset ? (
            <p role="alert" className="bg-danger-bg text-danger rounded-sm px-3 py-2 text-sm font-medium">
              That asset could not be found, or you do not have access to it.
            </p>
          ) : null}
          {unusable ? (
            <p role="alert" className="bg-warn-bg rounded-sm px-3 py-2 text-sm text-[#6b3f00]">
              {asset.assetTag} is {asset.archivedAt ? "archived" : "decommissioned"}; faults cannot be reported on it.
            </p>
          ) : null}
          <AssetPicker />
          <p className="text-ink-muted text-sm">
            Can&apos;t find the label? Search the{" "}
            <Link href="/assets" className="font-semibold text-teal-700 hover:underline">
              equipment register
            </Link>{" "}
            and use <strong>Report a fault</strong> on the asset page.
          </p>
        </Card>
      ) : (
        <Card className="max-w-3xl">
          <div className="bg-surface flex flex-col gap-1 rounded-md p-4">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-lg font-bold">{asset.assetTag}</span>
              <StatusBadge status={asset.status} />
              {asset.model.category && asset.riskClass === "HIGH" ? <Badge tone="danger">High risk</Badge> : null}
            </div>
            <div className="font-semibold">{asset.name}</div>
            <div className="text-ink-muted text-sm">
              {asset.model.manufacturer.name} {asset.model.modelName} · {asset.hospital.name}, {asset.department.name}
              {asset.location ? ` · ${asset.location.name}` : ""}
            </div>
            <Link href="/work-orders/new" className="mt-1 text-sm font-semibold text-teal-700 hover:underline">
              Not this device? Scan again
            </Link>
          </div>
          <ReportForm assetId={asset.id} assetTag={asset.assetTag} />
        </Card>
      )}
      {asset && !unusable && warranty ? (
        <div className="max-w-3xl">
          <WarrantyPanel data={warranty} assetId={asset.id} />
        </div>
      ) : null}
    </>
  );
}
