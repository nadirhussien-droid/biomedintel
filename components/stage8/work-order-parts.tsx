// Parts panel on the work order page (Stage 8). Server component: data comes
// from getWorkOrderParts (permission and scope checked there); every form
// carries a one-time key so a retried submission is recorded once.
import { randomUUID } from "node:crypto";
import Link from "next/link";
import { Card, CardTitle } from "@/components/ui/card";
import { InputField, SelectField } from "@/components/ui/field";
import { ActionForm } from "@/components/forms/action-form";
import {
  Empty,
  fmtDateTime,
  recordLink,
  rowCls,
  tableHead,
  td,
  tdr,
  th,
  thr,
  ToneTag,
} from "@/components/analytics/ui";
import { MOVEMENT_LABELS, STOCK_UNIT_LABELS } from "@/lib/validation/inventory";
import type { getWorkOrderParts } from "@/server/services/work-order-parts";
import {
  issueAction,
  releaseAction,
  reserveAction,
  returnAction,
  unavailableAction,
} from "@/app/(app)/inventory/actions";

type Data = NonNullable<Awaited<ReturnType<typeof getWorkOrderParts>>>;
const unit = (u: string) => STOCK_UNIT_LABELS[u as keyof typeof STOCK_UNIT_LABELS] ?? u;

export function WorkOrderParts({
  data,
  partOptions,
}: {
  data: Data;
  partOptions: { id: string; partNumber: string; name: string }[];
}) {
  const { workOrder, stores, reservations, movements, used, unavailable, suggested, names, partsCost, canAct } = data;
  const activeRes = reservations.filter((r) => r.status === "ACTIVE");
  const act = canAct && workOrder.open;
  return (
    <Card id="parts">
      <CardTitle>Spare parts</CardTitle>
      <p className="text-ink-muted text-xs">
        Parts come from stores of this job&apos;s hospital. Issuing parts records what was used; it never marks the
        device repaired or safe to use.
      </p>

      {suggested.length ? (
        <div>
          <h3 className="text-sm font-semibold">Parts recorded as fitting this device</h3>
          <div
            className="overflow-x-auto"
            tabIndex={0}
            role="region"
            aria-label="Table (scroll sideways on small screens)"
          >
            <table className="w-full text-sm">
              <caption className="sr-only">Compatible parts and availability</caption>
              <thead className={tableHead}>
                <tr>
                  <th className={th}>Part</th>
                  {stores.map((s) => (
                    <th key={s.id} className={thr}>
                      {s.code} available
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {suggested.map((p) => (
                  <tr key={p.id} className={rowCls}>
                    <td className={td}>
                      <Link href={`/inventory/parts/${p.id}`} className={`${recordLink} font-mono`}>
                        {p.partNumber}
                      </Link>{" "}
                      {p.name}
                    </td>
                    {p.stores.map((s) => (
                      <td key={s.store.id} className={tdr}>
                        {Math.max(0, s.available)} {unit(p.unit)}
                        {s.available <= 0 ? (
                          <div>
                            <ToneTag tone="danger">None available</ToneTag>
                          </div>
                        ) : null}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-2">
        <div>
          <h3 className="text-sm font-semibold">Reserved for this job</h3>
          {activeRes.length === 0 ? (
            <Empty>Nothing reserved.</Empty>
          ) : (
            <ul className="divide-line divide-y text-sm">
              {activeRes.map((r) => (
                <li key={r.id} className="flex flex-col gap-2 py-2">
                  <span>
                    {r.quantity} {unit(r.part.unit)} × <span className="font-mono">{r.part.partNumber}</span>{" "}
                    {r.part.name} from {r.location.code}
                  </span>
                  {act ? (
                    <div className="flex flex-wrap gap-2">
                      <ActionForm
                        action={issueAction}
                        hidden={{ requestKey: randomUUID(), workOrderId: workOrder.id, reservationId: r.id }}
                        label="Issue to this job"
                      />
                      <ActionForm
                        action={releaseAction}
                        hidden={{ reservationId: r.id }}
                        label="Release"
                        variant="secondary"
                      />
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </div>
        <div>
          <h3 className="text-sm font-semibold">Used on this job (issued minus returned)</h3>
          {used.length === 0 ? (
            <Empty>No parts issued.</Empty>
          ) : (
            <ul className="divide-line divide-y text-sm">
              {used.map((u) => (
                <li key={`${u.part.id}-${u.location.id}-${u.lotNumber}`} className="py-2">
                  {u.net} {unit(u.part.unit)} × <span className="font-mono">{u.part.partNumber}</span> {u.part.name}
                  <span className="text-ink-muted">
                    {" "}
                    · from {u.location.code}
                    {u.lotNumber ? ` · lot ${u.lotNumber}` : ""}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {partsCost ? (
            <p className="text-ink-muted mt-1 text-xs">
              Recorded parts cost:{" "}
              {partsCost.length
                ? partsCost.map((c) => `${c.currency} ${c.total.toFixed(2)}`).join(" · ")
                : "no unit costs recorded"}{" "}
              (at the unit cost recorded when issued).
            </p>
          ) : null}
        </div>
      </div>

      {act && stores.length ? (
        <div className="grid gap-6 lg:grid-cols-2">
          <section className="bg-surface flex flex-col gap-2 rounded-md p-3">
            <h3 className="text-sm font-semibold">Reserve or issue a part</h3>
            <ActionForm
              action={reserveAction}
              hidden={{ requestKey: randomUUID(), workOrderId: workOrder.id }}
              label="Reserve"
              variant="secondary"
              className="grid gap-2 sm:grid-cols-3 sm:items-end"
            >
              <PartSelect id="rs-part" options={partOptions} />
              <StoreSelect id="rs-store" stores={stores} />
              <InputField label="Quantity" name="quantity" id="rs-qty" type="number" min={1} required />
            </ActionForm>
            <ActionForm
              action={issueAction}
              hidden={{ requestKey: randomUUID(), workOrderId: workOrder.id }}
              label="Issue now (not reserved)"
              className="grid gap-2 sm:grid-cols-3 sm:items-end"
            >
              <PartSelect id="is-part" options={partOptions} />
              <StoreSelect id="is-store" stores={stores} />
              <InputField label="Quantity" name="quantity" id="is-qty" type="number" min={1} required />
            </ActionForm>
          </section>
          <section className="bg-surface flex flex-col gap-2 rounded-md p-3">
            <h3 className="text-sm font-semibold">Part not available?</h3>
            <ActionForm
              action={unavailableAction}
              hidden={{ workOrderId: workOrder.id }}
              label="Record in timeline"
              variant="secondary"
              className="grid gap-2 sm:grid-cols-2 sm:items-end"
            >
              <SelectField label="Part (if in the catalogue)" name="partId" id="un-part">
                <option value="">— not in the catalogue —</option>
                {partOptions.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.partNumber} — {p.name}
                  </option>
                ))}
              </SelectField>
              <InputField label="Quantity needed" name="quantity" id="un-qty" type="number" min={1} defaultValue={1} />
              <InputField label="What is needed" name="description" id="un-desc" required className="sm:col-span-2" />
            </ActionForm>
            <p className="text-ink-muted text-xs">
              To wait for the part, also put the job on hold. A manager can raise a purchase request.
            </p>
          </section>
        </div>
      ) : null}

      {canAct && used.length ? (
        <section className="bg-surface flex flex-col gap-2 rounded-md p-3">
          <h3 className="text-sm font-semibold">Return unused parts</h3>
          <p className="text-ink-muted text-xs">
            Record a return only when the part is physically back in a store. Cancelling a job never returns issued
            parts by itself.
          </p>
          {used
            .filter((u) => u.net > 0)
            .map((u) => (
              <ActionForm
                key={`${u.part.id}-${u.lotNumber}`}
                action={returnAction}
                hidden={{
                  requestKey: randomUUID(),
                  workOrderId: workOrder.id,
                  partId: u.part.id,
                  lotNumber: u.lotNumber,
                }}
                label={`Return ${u.part.partNumber}${u.lotNumber ? ` (lot ${u.lotNumber})` : ""}`}
                variant="secondary"
                className="grid gap-2 sm:grid-cols-4 sm:items-end"
              >
                <StoreSelect id={`rt-s-${u.part.id}-${u.lotNumber}`} stores={stores} defaultValue={u.location.id} />
                <InputField
                  label={`Quantity (max ${u.net})`}
                  name="quantity"
                  id={`rt-q-${u.part.id}-${u.lotNumber}`}
                  type="number"
                  min={1}
                  max={u.net}
                  required
                />
                <InputField
                  label="Reason (optional)"
                  name="reason"
                  id={`rt-r-${u.part.id}-${u.lotNumber}`}
                  className="sm:col-span-2"
                />
              </ActionForm>
            ))}
        </section>
      ) : null}

      {movements.length || unavailable.length ? (
        <details>
          <summary className="cursor-pointer text-sm font-semibold">
            Part history on this job ({movements.length + unavailable.length})
          </summary>
          <ul className="mt-2 text-sm">
            {movements.map((m) => (
              <li key={m.id} className="border-line border-b py-1">
                {MOVEMENT_LABELS[m.type]}: {Math.abs(m.quantity)} ×{" "}
                <span className="font-mono">{m.part.partNumber}</span> ({m.location.code}
                {m.lotNumber ? `, lot ${m.lotNumber}` : ""}) · {names[m.performedById] ?? "Unknown"} ·{" "}
                {fmtDateTime(m.createdAt)}
              </li>
            ))}
            {unavailable.map((u) => (
              <li key={u.id} className="border-line border-b py-1">
                <ToneTag tone="warn">Not available</ToneTag> {u.note} · {names[u.actorId] ?? "Unknown"} ·{" "}
                {fmtDateTime(u.createdAt)}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </Card>
  );
}

function PartSelect({ id, options }: { id: string; options: { id: string; partNumber: string; name: string }[] }) {
  return (
    <SelectField label="Part" name="partId" id={id}>
      {options.map((p) => (
        <option key={p.id} value={p.id}>
          {p.partNumber} — {p.name}
        </option>
      ))}
    </SelectField>
  );
}

function StoreSelect({
  id,
  stores,
  defaultValue,
}: {
  id: string;
  stores: { id: string; code: string; name: string }[];
  defaultValue?: string;
}) {
  return (
    <SelectField label="Store" name="locationId" id={id} defaultValue={defaultValue}>
      {stores.map((s) => (
        <option key={s.id} value={s.id}>
          {s.code} — {s.name}
        </option>
      ))}
    </SelectField>
  );
}
