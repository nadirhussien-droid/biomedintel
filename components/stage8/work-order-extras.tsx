// Warranty information and external service on the work order page (Stage 8).
// Server components: the data comes from services that check permission and
// scope. Warranty details are shown AS RECORDED — never as confirmed cover.
import Link from "next/link";
import { Card, CardTitle } from "@/components/ui/card";
import { InputField, SelectField } from "@/components/ui/field";
import { ActionForm } from "@/components/forms/action-form";
import { Empty, fmtDate, recordLink, ToneTag } from "@/components/analytics/ui";
import { ServiceTag, WarrantyTag, recorded } from "./badges";
import { SERVICE_STATUSES, SERVICE_STATUS_LABELS } from "@/lib/validation/inventory";
import type { warrantyForAsset } from "@/server/services/warranties";
import type { listServicesForWorkOrder } from "@/server/services/external-services";
import { createServiceAction, updateServiceAction } from "@/app/(app)/suppliers/actions";

type Warranty = NonNullable<Awaited<ReturnType<typeof warrantyForAsset>>>;
type Services = NonNullable<Awaited<ReturnType<typeof listServicesForWorkOrder>>>;
const textarea = "min-h-20 w-full rounded-sm border border-line-strong bg-white px-3 py-2 text-sm text-ink";
const iso = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : "");

export function WarrantyPanel({ data, assetId }: { data: Warranty; assetId: string }) {
  return (
    <Card id="warranty">
      <CardTitle>Warranty and service contracts (as recorded)</CardTitle>
      {data.rows.length === 0 ? (
        <Empty>No warranty or service contract is recorded for this device.</Empty>
      ) : (
        <ul className="divide-line divide-y text-sm">
          {data.rows.map((w) => (
            <li key={w.id} className="flex flex-col gap-1 py-2">
              <span className="flex flex-wrap items-center gap-2">
                <strong>{w.kind === "SERVICE_CONTRACT" ? "Service contract" : "Warranty"}</strong> ·{" "}
                {w.supplier?.name ?? w.provider}
                {w.reference ? <span className="text-ink-muted">ref {w.reference}</span> : null}
                <WarrantyTag state={w.state} />
              </span>
              <span className="text-ink-muted">
                {w.startsOn ? `${fmtDate(w.startsOn)} – ` : "Until "}
                {fmtDate(w.endsOn)} · Parts: {recorded(w.coversParts)} · Labour: {recorded(w.coversLabour)}
                {w.responseTargetHours ? ` · Response target ${w.responseTargetHours} h` : ""}
              </span>
              {w.exclusions ? <span className="text-ink-muted">Exclusions: {w.exclusions}</span> : null}
            </li>
          ))}
        </ul>
      )}
      <p className="text-ink-muted text-xs">
        Dates inside a warranty period do not mean a repair is covered. Check the terms and the supplier&apos;s
        decision, then record a claim on the{" "}
        <Link href={`/assets/${assetId}#warranties`} className={recordLink}>
          asset page
        </Link>
        .
      </p>
    </Card>
  );
}

export function ExternalServicePanel({
  data,
  workOrderId,
  open,
  suppliers,
  today,
  showCost,
}: {
  data: Services;
  workOrderId: string;
  open: boolean;
  suppliers: { id: string; name: string }[];
  today: string;
  showCost: boolean;
}) {
  return (
    <Card id="external-service">
      <CardTitle>External service</CardTitle>
      <p className="text-ink-muted text-xs">
        Work sent to an outside supplier as part of this job. The job keeps its own sign-off: a supplier completing its
        part never completes this job or returns the device to service.
      </p>
      {data.rows.length === 0 ? <Empty>No external service recorded on this job.</Empty> : null}
      {data.rows.map((s) => (
        <section key={s.id} className="border-line flex flex-col gap-2 rounded-md border p-3 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <Link href={`/suppliers/${s.supplier.id}`} className={recordLink}>
              {s.supplier.name}
            </Link>
            <ServiceTag status={s.status} />
            {s.supplierReference ? <span className="text-ink-muted">ref {s.supplierReference}</span> : null}
          </div>
          <p className="whitespace-pre-line">{s.description}</p>
          <dl className="text-ink-muted grid gap-x-4 gap-y-1 sm:grid-cols-2">
            <div>Requested: {fmtDate(s.requestedOn)}</div>
            <div>Sent / dispatched: {fmtDate(s.dispatchedOn)}</div>
            <div>Expected by: {fmtDate(s.expectedBy)}</div>
            <div>Completed: {fmtDate(s.completedOn)}</div>
            {s.serviceReportRef ? <div>Service report: {s.serviceReportRef}</div> : null}
            {s.partsSupplied ? <div>Parts supplied: {s.partsSupplied}</div> : null}
            {s.cost !== null && s.currency ? (
              <div>
                Recorded cost: {s.currency} {String(s.cost)}
              </div>
            ) : null}
          </dl>
          <div>
            {s.onTime === null ? (
              <span className="text-ink-muted text-xs">
                On-time: not assessed (needs both an expected and a completion date).
              </span>
            ) : s.onTime ? (
              <ToneTag tone="ok">Completed by the expected date</ToneTag>
            ) : (
              <ToneTag tone="warn">Completed after the expected date</ToneTag>
            )}
          </div>
          {s.notes ? <p className="text-ink-muted whitespace-pre-line">{s.notes}</p> : null}
          {data.canManage && !["COMPLETED", "CANCELLED"].includes(s.status) ? (
            <details>
              <summary className="cursor-pointer font-semibold text-teal-700">Update</summary>
              <ActionForm
                action={updateServiceAction}
                hidden={{ id: s.id, workOrderId }}
                label="Save update"
                resetOnSuccess={false}
                className="mt-2 grid gap-3 sm:grid-cols-2"
              >
                <SelectField label="Status" name="status" id={`es-st-${s.id}`} defaultValue={s.status}>
                  {SERVICE_STATUSES.map((v) => (
                    <option key={v} value={v}>
                      {SERVICE_STATUS_LABELS[v]}
                    </option>
                  ))}
                </SelectField>
                <InputField
                  label="Supplier reference"
                  name="supplierReference"
                  id={`es-ref-${s.id}`}
                  defaultValue={s.supplierReference ?? ""}
                />
                <InputField
                  label="Sent / dispatched on"
                  name="dispatchedOn"
                  id={`es-dis-${s.id}`}
                  type="date"
                  defaultValue={iso(s.dispatchedOn)}
                />
                <InputField
                  label="Expected by"
                  name="expectedBy"
                  id={`es-exp-${s.id}`}
                  type="date"
                  defaultValue={iso(s.expectedBy)}
                />
                <InputField
                  label="Completed on"
                  name="completedOn"
                  id={`es-done-${s.id}`}
                  type="date"
                  max={today}
                  defaultValue={iso(s.completedOn)}
                />
                <InputField
                  label="Service report reference"
                  name="serviceReportRef"
                  id={`es-rep-${s.id}`}
                  defaultValue={s.serviceReportRef ?? ""}
                />
                <InputField
                  label="Parts supplied"
                  name="partsSupplied"
                  id={`es-parts-${s.id}`}
                  defaultValue={s.partsSupplied ?? ""}
                />
                {showCost ? (
                  <>
                    <InputField
                      label="Recorded cost (from the invoice)"
                      name="cost"
                      id={`es-cost-${s.id}`}
                      inputMode="decimal"
                      defaultValue={s.cost === null ? "" : String(s.cost)}
                    />
                    <InputField
                      label="Currency (e.g. KES, AUD)"
                      name="currency"
                      id={`es-cur-${s.id}`}
                      maxLength={3}
                      defaultValue={s.currency ?? ""}
                    />
                  </>
                ) : null}
                <div className="sm:col-span-2">
                  <label htmlFor={`es-notes-${s.id}`} className="text-sm font-semibold">
                    Notes
                  </label>
                  <textarea
                    id={`es-notes-${s.id}`}
                    name="notes"
                    className={`${textarea} mt-1.5`}
                    defaultValue={s.notes ?? ""}
                  />
                </div>
              </ActionForm>
            </details>
          ) : null}
        </section>
      ))}
      {data.canManage && open ? (
        suppliers.length ? (
          <details>
            <summary className="cursor-pointer text-sm font-semibold text-teal-700">Record external service</summary>
            <ActionForm
              action={createServiceAction}
              hidden={{ workOrderId }}
              label="Record request"
              className="mt-2 grid gap-3 sm:grid-cols-2"
            >
              <SelectField label="Supplier" name="supplierId" id="es-new-sup">
                {suppliers.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </SelectField>
              <InputField label="Supplier reference (optional)" name="supplierReference" id="es-new-ref" />
              <InputField
                label="Requested on"
                name="requestedOn"
                id="es-new-req"
                type="date"
                defaultValue={today}
                max={today}
                required
              />
              <InputField label="Expected by (optional)" name="expectedBy" id="es-new-exp" type="date" />
              <div className="sm:col-span-2">
                <label htmlFor="es-new-desc" className="text-sm font-semibold">
                  What the supplier is asked to do
                </label>
                <textarea id="es-new-desc" name="description" required className={`${textarea} mt-1.5`} />
              </div>
            </ActionForm>
          </details>
        ) : (
          <p className="text-ink-muted text-xs">
            Add the supplier to the{" "}
            <Link href="/suppliers" className={recordLink}>
              supplier register
            </Link>{" "}
            first.
          </p>
        )
      ) : null}
    </Card>
  );
}
