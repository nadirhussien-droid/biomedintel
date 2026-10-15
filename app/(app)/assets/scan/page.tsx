import type { Metadata } from "next";
import { requireAccess } from "@/server/auth/session";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/shell/page-header";
import { Scanner } from "./scanner";

export const metadata: Metadata = { title: "Scan equipment barcode" };

export default async function ScanPage() {
  await requireAccess();
  return (
    <>
      <PageHeader
        title="Scan equipment barcode"
        description="Open an asset by scanning the barcode on its BiomedIntel.ai label with a handheld scanner or this device's camera, or by typing its asset ID. You only see equipment in your hospitals and departments."
      />
      <Card className="max-w-3xl">
        <Scanner />
      </Card>
    </>
  );
}
