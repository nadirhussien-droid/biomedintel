import type { Metadata } from "next";
import { requireAccess } from "@/server/auth/session";
import { can } from "@/server/authz/access";
import { getInventorySettings } from "@/server/services/inventory";
import { PageHeader } from "@/components/shell/page-header";
import { Card, CardTitle } from "@/components/ui/card";
import { InputField } from "@/components/ui/field";
import { ActionForm } from "@/components/forms/action-form";
import { saveSettingsAction } from "../actions";

export const metadata: Metadata = { title: "Inventory and reminder settings" };

export default async function InventorySettingsPage() {
  const ctx = await requireAccess();
  const s = await getInventorySettings(ctx);
  const edit = can(ctx, "inventory.settings");
  return (
    <>
      <PageHeader
        title="Reminder and stock settings"
        description="Organisation-wide. Reminders are in-app notifications, sent once per item and threshold by the daily job."
      />
      <Card>
        <CardTitle>Current settings</CardTitle>
        <dl className="grid gap-3 text-sm md:grid-cols-2">
          <div>
            <dt className="font-semibold">Warranty expiry reminders</dt>
            <dd className="text-ink-muted">
              {s.warrantyReminderDays.join(", ")} days before the end date — sent to Engineering Managers and Org Admins
              covering the device.
            </dd>
          </div>
          <div>
            <dt className="font-semibold">Service contract expiry reminders</dt>
            <dd className="text-ink-muted">
              {s.contractReminderDays.join(", ")} days before the end date — same people.
            </dd>
          </div>
          <div>
            <dt className="font-semibold">Expiring stock warning</dt>
            <dd className="text-ink-muted">
              {s.stockExpiryWarningDays} days before a lot expires — Inventory Managers and Engineering Managers of that
              hospital.
            </dd>
          </div>
          <div>
            <dt className="font-semibold">Lifecycle review reminder</dt>
            <dd className="text-ink-muted">
              {s.lifecycleReviewLeadDays} days before an asset&apos;s lifecycle review date — Engineering Managers and
              Org Admins.
            </dd>
          </div>
          <div>
            <dt className="font-semibold">Inventory Manager adjustment limit</dt>
            <dd className="text-ink-muted">
              Up to {s.adjustmentLimit} units per adjustment or write-off; more needs an Engineering Manager.
            </dd>
          </div>
          <div>
            <dt className="font-semibold">Also sent</dt>
            <dd className="text-ink-muted">
              Low and out-of-stock parts (once, until new stock arrives), supplier work past its expected date, purchase
              requests waiting for approval for 3 days.
            </dd>
          </div>
        </dl>
      </Card>
      {edit ? (
        <Card>
          <CardTitle>Change settings</CardTitle>
          <ActionForm
            action={saveSettingsAction}
            label="Save settings"
            className="grid gap-3 md:grid-cols-2"
            resetOnSuccess={false}
          >
            <InputField
              label="Warranty reminders (days, comma-separated)"
              name="warrantyReminderDays"
              id="st-w"
              defaultValue={s.warrantyReminderDays.join(", ")}
              hint="Suggested 90, 60, 30. Up to 6 values."
            />
            <InputField
              label="Service contract reminders (days)"
              name="contractReminderDays"
              id="st-c"
              defaultValue={s.contractReminderDays.join(", ")}
            />
            <InputField
              label="Expiring stock warning (days)"
              name="stockExpiryWarningDays"
              id="st-e"
              type="number"
              min={1}
              max={365}
              defaultValue={s.stockExpiryWarningDays}
            />
            <InputField
              label="Lifecycle review reminder (days before)"
              name="lifecycleReviewLeadDays"
              id="st-l"
              type="number"
              min={1}
              max={365}
              defaultValue={s.lifecycleReviewLeadDays}
            />
            <InputField
              label="Inventory Manager adjustment limit (units)"
              name="adjustmentLimit"
              id="st-a"
              type="number"
              min={0}
              defaultValue={s.adjustmentLimit}
            />
          </ActionForm>
        </Card>
      ) : null}
    </>
  );
}
