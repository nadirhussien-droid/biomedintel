import type { Metadata } from "next";
import Link from "next/link";
import { requireAccess } from "@/server/auth/session";
import { can } from "@/server/authz/access";
import { NotFoundError } from "@/server/authz/errors";
import { getAsset } from "@/server/services/assets";
import { listWorkOrdersForAsset } from "@/server/services/work-orders";
import { PageHeader } from "@/components/shell/page-header";
import { Card } from "@/components/ui/card";
import { FieldShell, InputField, SelectField } from "@/components/ui/field";
import { ActionForm } from "@/components/forms/action-form";
import { recordLink } from "@/components/analytics/ui";
import { startSessionAction } from "../actions";

export const metadata: Metadata = { title: "Start troubleshooting" };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const textarea = "min-h-24 w-full rounded-sm border border-line-strong bg-white px-3 py-2 text-sm text-ink";

export default async function NewSessionPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await requireAccess();
  const sp = await searchParams;
  const assetId = typeof sp.asset === "string" && UUID.test(sp.asset) ? sp.asset : null;
  const woId = typeof sp.workOrder === "string" && UUID.test(sp.workOrder) ? sp.workOrder : "";
  if (!can(ctx, "troubleshoot.work") || !assetId) {
    return (
      <Card>
        <p className="text-sm">
          {can(ctx, "troubleshoot.work")
            ? "Choose a device first on the "
            : "Your role does not include starting troubleshooting sessions. See the "}
          <Link href="/assist" className={recordLink}>
            IntellAssist page
          </Link>
          .
        </p>
      </Card>
    );
  }
  const asset = await getAsset(ctx, assetId).catch((e) => {
    if (e instanceof NotFoundError) return null;
    throw e;
  });
  if (!asset) {
    return (
      <Card>
        <p role="alert" className="text-danger text-sm">
          That asset could not be found, or you do not have access to it.
        </p>
      </Card>
    );
  }
  const jobs = (await listWorkOrdersForAsset(ctx, asset.id)).filter((w) => w.status !== "CANCELLED");
  const preset = jobs.find((j) => j.id === woId);
  return (
    <>
      <PageHeader
        title="Start troubleshooting"
        description={`${asset.assetTag} · ${asset.name} · ${asset.model.manufacturer.name} ${asset.model.modelName}`}
      />
      <Card className="max-w-4xl">
        <ActionForm
          action={startSessionAction}
          hidden={{ assetId: asset.id }}
          label="Start session"
          className="flex flex-col gap-4"
        >
          <SelectField label="Work order (optional)" name="workOrderId" id="ns-wo" defaultValue={preset?.id ?? ""}>
            <option value="">Not linked to a work order</option>
            {jobs.map((j) => (
              <option key={j.id} value={j.id}>
                {j.number} · {j.status.toLowerCase().replace("_", " ")} · {j.faultDescription.slice(0, 60)}
              </option>
            ))}
          </SelectField>
          <FieldShell label="Reported fault" name="ns-fault">
            <textarea
              id="ns-fault"
              name="faultDescription"
              required
              className={textarea}
              defaultValue={preset?.faultDescription ?? ""}
            />
          </FieldShell>
          <FieldShell label="Symptoms you observed (optional)" name="ns-symptoms">
            <textarea id="ns-symptoms" name="symptoms" className={textarea} />
          </FieldShell>
          <div className="grid gap-4 md:grid-cols-2">
            <InputField
              label="Displayed error codes (optional)"
              name="errorCodes"
              id="ns-codes"
              placeholder="e.g. E-207, AL3"
              className="font-mono"
            />
            <InputField label="Alarms (optional)" name="alarms" id="ns-alarms" />
          </div>
          <FieldShell label="Operating conditions (optional)" name="ns-cond">
            <textarea
              id="ns-cond"
              name="operatingConditions"
              className={textarea}
              placeholder="e.g. on battery, after transport, in a humid room"
            />
          </FieldShell>
          <p className="text-ink-muted text-xs">
            Describe the equipment only. Do not enter patient names, record numbers or other patient information.
          </p>
        </ActionForm>
      </Card>
    </>
  );
}
