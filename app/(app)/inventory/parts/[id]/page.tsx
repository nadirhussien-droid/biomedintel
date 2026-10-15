import type { Metadata } from "next";
import { randomUUID } from "node:crypto";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAccess } from "@/server/auth/session";
import { can } from "@/server/authz/access";
import { NotFoundError } from "@/server/authz/errors";
import { getPart } from "@/server/services/inventory";
import { supplierOptions } from "@/server/services/suppliers";
import { peopleNamesFor } from "@/server/services/people";
import { partCode128 } from "@/server/barcode";
import { PageHeader } from "@/components/shell/page-header";
import { Card, CardTitle } from "@/components/ui/card";
import { InputField, SelectField } from "@/components/ui/field";
import { ActionForm } from "@/components/forms/action-form";
import { BarcodeSvg } from "@/components/assets/barcode-svg";
import {
  Empty,
  fmtDate,
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
import { StockTag } from "@/components/stage8/badges";
import { stockState } from "@/server/services/inventory";
import { MOVEMENT_LABELS, STOCK_UNIT_LABELS } from "@/lib/validation/inventory";
import { adjustAction, archivePartAction, receiveAction, transferAction } from "../../actions";
import { PrintButton } from "./print-button";

export const metadata: Metadata = { title: "Spare part" };

const linkButton = "inline-flex min-h-11 items-center justify-center rounded-md border px-4 text-sm font-semibold";

export default async function PartPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const ctx = await requireAccess();
  const { id } = await params;
  const saved = (await searchParams).saved;
  let data;
  try {
    data = await getPart(ctx, id);
  } catch (e) {
    if (e instanceof NotFoundError) notFound();
    throw e;
  }
  const { part, perStore, movements, reservations, showCost } = data;
  const suppliers = can(ctx, "stock.receive") ? await supplierOptions(ctx) : [];
  const names = await peopleNamesFor(
    ctx,
    movements.map((m) => m.performedById),
  );
  const unit = STOCK_UNIT_LABELS[part.unit as keyof typeof STOCK_UNIT_LABELS];
  const active = part.status === "ACTIVE";
  const activeStores = perStore.filter((s) => s.store.status === "ACTIVE");
  const totals = perStore.reduce(
    (t, s) => ({ onHand: t.onHand + s.onHand, usable: t.usable + s.usable, reserved: t.reserved + s.reserved }),
    { onHand: 0, usable: 0, reserved: 0 },
  );
  const available = totals.usable - totals.reserved;
  const barcode = partCode128(part.partNumber);
  const lots = [...new Set(perStore.flatMap((s) => s.lots.map((l) => l.lotNumber)))];
  return (
    <>
      <PageHeader
        title={`${part.partNumber} · ${part.name}`}
        description={[
          part.manufacturer?.name,
          part.manufacturerPartNumber && `Manufacturer part number ${part.manufacturerPartNumber}`,
          `Counted in ${unit}`,
        ]
          .filter(Boolean)
          .join(" · ")}
        actions={
          <div className="flex flex-wrap gap-2 print:hidden">
            <Link href="/inventory" className={`${linkButton} border-line-strong bg-white`}>
              All parts
            </Link>
            {can(ctx, "inventory.manage") && active ? (
              <Link
                href={`/inventory/parts/${part.id}/edit`}
                className={`${linkButton} text-navy-900 border-teal-400 bg-teal-400`}
              >
                Edit part
              </Link>
            ) : null}
          </div>
        }
      />
      {saved ? (
        <p role="status" className="bg-ok-bg text-ok rounded-md px-4 py-3 text-sm font-semibold">
          Part saved.
        </p>
      ) : null}
      {!active ? (
        <p className="bg-warn-bg rounded-md px-4 py-3 text-sm text-[#6b3f00]">
          This part is archived: it can no longer be received, reserved or issued. Its history is kept.
        </p>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-[2fr_1fr]">
        <Card>
          <CardTitle action={<StockTag state={stockState(available, part.minLevel)} />}>Stock in your stores</CardTitle>
          <div className="grid gap-3 sm:grid-cols-4">
            {[
              ["On hand", totals.onHand],
              ["Usable (not expired)", totals.usable],
              ["Reserved for jobs", totals.reserved],
              ["Available", Math.max(0, available)],
            ].map(([l, v]) => (
              <div key={l as string} className="bg-surface rounded-md p-3">
                <div className="text-ink-muted text-xs font-semibold uppercase">{l}</div>
                <div className="text-2xl font-bold">
                  {v} <span className="text-ink-muted text-sm font-normal">{unit}</span>
                </div>
              </div>
            ))}
          </div>
          <p className="text-ink-muted text-xs">
            Available = usable − reserved. Minimum {part.minLevel}
            {part.targetLevel !== null ? `, target ${part.targetLevel}` : ", no target level"}.
            {showCost && part.unitCost
              ? ` Recorded unit cost ${part.currency} ${Number(part.unitCost).toFixed(2)}.`
              : ""}
          </p>
          {perStore.length === 0 ? (
            <Empty>No stores in your hospitals yet.</Empty>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <caption className="sr-only">Stock per store and lot</caption>
                <thead className={tableHead}>
                  <tr>
                    <th className={th}>Store</th>
                    <th className={th}>Lot / expiry</th>
                    <th className={thr}>On hand</th>
                    <th className={thr}>Reserved (store)</th>
                    <th className={thr}>Available (store)</th>
                  </tr>
                </thead>
                <tbody>
                  {perStore.map((s) =>
                    (s.lots.length ? s.lots : [null]).map((l, i) => (
                      <tr key={`${s.store.id}-${l?.lotNumber ?? "none"}`} className={rowCls}>
                        <td className={td}>
                          {i === 0 ? `${s.store.hospital.code} · ${s.store.code} — ${s.store.name}` : ""}
                        </td>
                        <td className={td}>
                          {l ? (
                            <>
                              {l.lotNumber || "—"}
                              {l.expiresOn ? (
                                <span className="ml-2">
                                  {fmtDate(l.expiresOn)}{" "}
                                  {!s.usableLots.includes(l) ? (
                                    <ToneTag tone="danger">Expired — do not use</ToneTag>
                                  ) : null}
                                </span>
                              ) : null}
                            </>
                          ) : (
                            <span className="text-ink-muted">No stock</span>
                          )}
                        </td>
                        <td className={tdr}>{l?.onHand ?? 0}</td>
                        <td className={tdr}>{i === 0 ? s.reserved : ""}</td>
                        <td className={`${tdr} font-semibold`}>{i === 0 ? Math.max(0, s.available) : ""}</td>
                      </tr>
                    )),
                  )}
                </tbody>
              </table>
            </div>
          )}
        </Card>
        <Card>
          <CardTitle>Barcode label</CardTitle>
          <div className="mx-auto flex w-full max-w-64 flex-col items-center gap-1 bg-white p-2">
            <BarcodeSvg
              barcode={barcode}
              label={`Code 128 barcode for part ${part.partNumber}`}
              className="h-16 w-full"
            />
            <span className="font-mono text-base font-bold tracking-wider">{part.partNumber}</span>
            <span className="text-center text-xs">{part.name}</span>
          </div>
          <p className="text-ink-muted text-xs print:hidden">
            Code 128 of the internal part number, the same barcode type as equipment labels. Scan it on the Parts page
            with a handheld scanner, or type the number.
          </p>
          <div className="print:hidden">
            <PrintButton />
          </div>
        </Card>
      </div>

      {active && can(ctx, "stock.receive") && activeStores.length ? (
        <div className="grid gap-6 xl:grid-cols-2 print:hidden">
          <Card>
            <CardTitle>Receive stock</CardTitle>
            <p className="text-ink-muted text-xs">
              Record a delivery (or the first count of stock already on the shelf). To receive against a purchase
              request, open the request instead.
            </p>
            <ActionForm
              action={receiveAction}
              hidden={{ requestKey: randomUUID(), partId: part.id }}
              label="Record receipt"
              className="grid gap-3 md:grid-cols-2"
              fieldLabels={{ quantity: "Quantity", lotNumber: "Lot", expiresOn: "Expiry" }}
            >
              <SelectField label="Into store" name="locationId" id="r-store">
                {activeStores.map((s) => (
                  <option key={s.store.id} value={s.store.id}>
                    {s.store.hospital.code} · {s.store.code}
                  </option>
                ))}
              </SelectField>
              <InputField label={`Quantity (${unit})`} name="quantity" id="r-qty" type="number" min={1} required />
              {part.tracksLots ? <InputField label="Lot / batch number" name="lotNumber" id="r-lot" required /> : null}
              {part.tracksExpiry ? (
                <InputField label="Expiry date" name="expiresOn" id="r-exp" type="date" required />
              ) : null}
              {showCost ? (
                <>
                  <InputField label="Unit price paid (optional)" name="unitCost" id="r-cost" inputMode="decimal" />
                  <InputField
                    label="Currency"
                    name="currency"
                    id="r-cur"
                    maxLength={3}
                    defaultValue={part.currency ?? ""}
                  />
                </>
              ) : null}
              <SelectField label="Supplier (optional)" name="supplierId" id="r-sup">
                <option value="">—</option>
                {suppliers.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </SelectField>
              <InputField label="Delivery note / reference (optional)" name="reference" id="r-ref" />
              <label className="flex items-center gap-2 text-sm md:col-span-2">
                <input type="checkbox" name="initial" className="size-4 accent-teal-700" />
                This is initial stock (already on the shelf before BiomedIntel.ai), not a new delivery
              </label>
            </ActionForm>
          </Card>
          <Card>
            <CardTitle>Transfer between stores</CardTitle>
            <ActionForm
              action={transferAction}
              hidden={{ requestKey: randomUUID(), partId: part.id }}
              label="Record transfer"
              className="grid gap-3 md:grid-cols-2"
            >
              <SelectField label="From" name="fromLocationId" id="t-from">
                {activeStores.map((s) => (
                  <option key={s.store.id} value={s.store.id}>
                    {s.store.hospital.code} · {s.store.code} ({s.onHand})
                  </option>
                ))}
              </SelectField>
              <SelectField label="To" name="toLocationId" id="t-to" defaultValue={activeStores[1]?.store.id}>
                {activeStores.map((s) => (
                  <option key={s.store.id} value={s.store.id}>
                    {s.store.hospital.code} · {s.store.code}
                  </option>
                ))}
              </SelectField>
              {part.tracksLots ? (
                <SelectField label="Lot" name="lotNumber" id="t-lot">
                  {lots.map((l) => (
                    <option key={l} value={l}>
                      {l}
                    </option>
                  ))}
                </SelectField>
              ) : null}
              <InputField label={`Quantity (${unit})`} name="quantity" id="t-qty" type="number" min={1} required />
              <InputField label="Reason (optional)" name="reason" id="t-reason" />
            </ActionForm>
          </Card>
        </div>
      ) : null}

      {can(ctx, "stock.adjust") && perStore.length ? (
        <Card className="print:hidden">
          <CardTitle>Stock count adjustment or write-off</CardTitle>
          <p className="text-ink-muted text-xs">
            Use an adjustment after a stock count (for example −2 or +1), and a write-off for damaged, expired or lost
            stock. A reason is always recorded.
            {ctx.role === "INVENTORY_MANAGER"
              ? " Changes above your organisation's limit need an Engineering Manager."
              : ""}
          </p>
          <ActionForm
            action={adjustAction}
            hidden={{ requestKey: randomUUID(), partId: part.id }}
            label="Record"
            variant="secondary"
            className="grid gap-3 md:grid-cols-3"
            confirm="Record this change to stock? It cannot be edited afterwards (a mistake is corrected with a new adjustment)."
          >
            <SelectField label="Store" name="locationId" id="a-store">
              {perStore.map((s) => (
                <option key={s.store.id} value={s.store.id}>
                  {s.store.hospital.code} · {s.store.code} ({s.onHand})
                </option>
              ))}
            </SelectField>
            {part.tracksLots ? (
              <SelectField label="Lot" name="lotNumber" id="a-lot">
                {lots.map((l) => (
                  <option key={l} value={l}>
                    {l}
                  </option>
                ))}
              </SelectField>
            ) : null}
            <SelectField label="Type" name="writeOff" id="a-type">
              <option value="">Count adjustment (+ or −)</option>
              <option value="on">Write-off (damaged, expired, lost)</option>
            </SelectField>
            <InputField
              label="Quantity"
              name="quantity"
              id="a-qty"
              type="number"
              required
              hint="Adjustment: signed (e.g. -2). Write-off: how many units."
            />
            <InputField label="Reason" name="reason" id="a-reason" required className="md:col-span-2" />
          </ActionForm>
        </Card>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-2">
        <Card>
          <CardTitle>Reserved for work orders</CardTitle>
          {reservations.length === 0 ? (
            <Empty>No active reservations.</Empty>
          ) : (
            <ul className="divide-line divide-y text-sm">
              {reservations.map((r) => (
                <li key={r.id} className="flex justify-between gap-2 py-2">
                  <Link href={`/work-orders/${r.workOrder.id}#parts`} className={recordLink}>
                    {r.workOrder.number}
                  </Link>
                  <span>
                    {r.quantity} {unit} from {r.location.code}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card>
          <CardTitle>Fits and suppliers</CardTitle>
          <dl className="grid gap-2 text-sm">
            <div>
              <dt className="font-semibold">Fits</dt>
              <dd className="text-ink-muted">
                {part.compatibility.length
                  ? part.compatibility
                      .map((c) =>
                        c.model
                          ? `${c.model.manufacturer.name} ${c.model.modelName}`
                          : c.category
                            ? `Any ${c.category.name}`
                            : `Any ${c.manufacturer!.name} device`,
                      )
                      .join(" · ")
                  : "Not recorded"}
              </dd>
            </div>
            <div>
              <dt className="font-semibold">Suppliers</dt>
              <dd>
                {part.suppliers.length
                  ? part.suppliers.map((s, i) => (
                      <span key={s.supplier.id}>
                        {i ? " · " : ""}
                        <Link href={`/suppliers/${s.supplier.id}`} className={recordLink}>
                          {s.supplier.name}
                        </Link>
                      </span>
                    ))
                  : "Not recorded"}
              </dd>
            </div>
            {part.description ? (
              <div>
                <dt className="font-semibold">Description</dt>
                <dd className="text-ink-muted whitespace-pre-line">{part.description}</dd>
              </div>
            ) : null}
          </dl>
          {can(ctx, "inventory.manage") ? (
            <ActionForm
              action={archivePartAction}
              hidden={{ id: part.id, archived: active ? "1" : "0" }}
              label={active ? "Archive part" : "Restore part"}
              variant="secondary"
              confirm={
                active ? "Archive this part? It must have no stock or reservations. Its history is kept." : undefined
              }
            />
          ) : null}
        </Card>
      </div>

      <Card>
        <CardTitle>Recent stock movements</CardTitle>
        {movements.length === 0 ? (
          <Empty>No movements recorded yet.</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <caption className="sr-only">Recent stock movements of this part</caption>
              <thead className={tableHead}>
                <tr>
                  <th className={th}>When</th>
                  <th className={th}>Movement</th>
                  <th className={th}>Store / lot</th>
                  <th className={thr}>Quantity</th>
                  <th className={thr}>Lot balance after</th>
                  <th className={th}>Reference / reason</th>
                  <th className={th}>By</th>
                </tr>
              </thead>
              <tbody>
                {movements.map((m) => (
                  <tr key={m.id} className={rowCls}>
                    <td className={td}>{fmtDateTime(m.createdAt)}</td>
                    <td className={td}>
                      {MOVEMENT_LABELS[m.type]}
                      {m.workOrder ? (
                        <>
                          {" "}
                          <Link href={`/work-orders/${m.workOrder.id}`} className={recordLink}>
                            {m.workOrder.number}
                          </Link>
                        </>
                      ) : null}
                    </td>
                    <td className={td}>
                      {m.location.code}
                      {m.lotNumber ? ` / ${m.lotNumber}` : ""}
                    </td>
                    <td className={`${tdr} font-semibold`}>{m.quantity > 0 ? `+${m.quantity}` : m.quantity}</td>
                    <td className={tdr}>{m.balanceAfter}</td>
                    <td className={`${td} max-w-xs`}>{[m.reference, m.reason].filter(Boolean).join(" · ") || "—"}</td>
                    <td className={td}>{names[m.performedById] ?? "Unknown"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="text-ink-muted text-xs">
          Movements are never edited or deleted. A mistake is corrected by a new adjustment, so the history always adds
          up to the stock on hand.
        </p>
      </Card>
    </>
  );
}
