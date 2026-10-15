import type { Metadata } from "next";
import { randomUUID } from "node:crypto";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAccess } from "@/server/auth/session";
import { can } from "@/server/authz/access";
import { NotFoundError } from "@/server/authz/errors";
import { getPurchaseRequest } from "@/server/services/purchasing";
import { listStores } from "@/server/services/inventory";
import { PageHeader } from "@/components/shell/page-header";
import { Card, CardTitle } from "@/components/ui/card";
import { InputField, SelectField } from "@/components/ui/field";
import { ActionForm } from "@/components/forms/action-form";
import { fmtDateTime, recordLink, rowCls, tableHead, td, tdr, th, thr } from "@/components/analytics/ui";
import { PurchaseTag } from "@/components/stage8/badges";
import { STOCK_UNIT_LABELS } from "@/lib/validation/inventory";
import {
  cancelPurchaseAction,
  decidePurchaseAction,
  orderedPurchaseAction,
  receiveAction,
  submitPurchaseAction,
} from "../../actions";

export const metadata: Metadata = { title: "Purchase request" };

const SAVED: Record<string, string> = {
  "1": "Draft saved. Check the lines, then submit it for approval.",
  submitted: "Submitted for approval. A manager who is not you will approve or reject it.",
  approved: "Approved. This is not an order: order through your purchasing process, then mark it as ordered.",
  rejected: "Rejected. The requester has been told.",
  ordered: "Marked as ordered. Record deliveries as they arrive — stock only increases when a receipt is recorded.",
  cancelled: "Request cancelled.",
  received: "Stock received and recorded against this request.",
};

export default async function PurchasePage({
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
    data = await getPurchaseRequest(ctx, id);
  } catch (e) {
    if (e instanceof NotFoundError) notFound();
    throw e;
  }
  const { request: r, names, estimate, allowed } = data;
  const stores = allowed.receive
    ? (await listStores(ctx)).filter((s) => s.status === "ACTIVE" && s.hospital.id === r.hospitalId)
    : [];
  const person = (uid: string | null) => (uid ? (names[uid] ?? "Unknown") : "—");
  const showCost = can(ctx, "inventory.viewCost");
  return (
    <>
      <PageHeader
        title={`Purchase request ${r.number}`}
        description={`${r.hospital.code} · ${r.hospital.name}${r.supplier ? ` · preferred supplier ${r.supplier.name}` : ""}`}
        actions={<PurchaseTag status={r.status} />}
      />
      {saved ? (
        <p role="status" className="bg-ok-bg text-ok rounded-md px-4 py-3 text-sm font-semibold">
          {SAVED[saved] ?? SAVED["1"]}
        </p>
      ) : null}
      <Card>
        <CardTitle>Parts requested</CardTitle>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <caption className="sr-only">Lines</caption>
            <thead className={tableHead}>
              <tr>
                <th className={th}>Part</th>
                <th className={thr}>Requested</th>
                <th className={thr}>Received</th>
                {showCost ? <th className={thr}>Estimated unit cost</th> : null}
              </tr>
            </thead>
            <tbody>
              {r.lines.map((l) => (
                <tr key={l.id} className={rowCls}>
                  <td className={td}>
                    <Link href={`/inventory/parts/${l.part.id}`} className={`${recordLink} font-mono`}>
                      {l.part.partNumber}
                    </Link>{" "}
                    {l.part.name}
                  </td>
                  <td className={tdr}>
                    {l.quantity} {STOCK_UNIT_LABELS[l.part.unit as keyof typeof STOCK_UNIT_LABELS]}
                  </td>
                  <td className={tdr}>{l.receivedQuantity}</td>
                  {showCost ? (
                    <td className={tdr}>
                      {l.estimatedUnitCost ? `${l.currency} ${Number(l.estimatedUnitCost).toFixed(2)} (estimate)` : "—"}
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {estimate?.length ? (
          <p className="text-ink-muted text-xs">
            Estimated total (not a price quote):{" "}
            {estimate.map((e) => `${e.currency} ${e.total.toFixed(2)}`).join(" · ")}
          </p>
        ) : null}
        {r.justification ? <p className="text-sm whitespace-pre-line">{r.justification}</p> : null}
      </Card>
      <Card>
        <CardTitle>History</CardTitle>
        <ul className="text-sm">
          <li>
            Requested by {person(r.requestedById)} · {fmtDateTime(r.createdAt)}
          </li>
          {r.submittedAt ? <li>Submitted · {fmtDateTime(r.submittedAt)}</li> : null}
          {r.decidedAt ? (
            <li>
              {r.status === "REJECTED" ? "Rejected" : "Approved"} by {person(r.decidedById)} ·{" "}
              {fmtDateTime(r.decidedAt)}
              {r.decisionNote && r.status !== "CANCELLED" ? ` · “${r.decisionNote}”` : ""}
            </li>
          ) : null}
          {r.orderedAt ? (
            <li>
              Marked as ordered by {person(r.orderedById)} · {fmtDateTime(r.orderedAt)} · order reference{" "}
              {r.orderReference}
            </li>
          ) : null}
          {r.cancelledAt ? (
            <li>
              Cancelled by {person(r.cancelledById)} · {fmtDateTime(r.cancelledAt)} · “{r.decisionNote}”
            </li>
          ) : null}
        </ul>
      </Card>
      <div className="grid gap-6 xl:grid-cols-2">
        {allowed.submit ? (
          <Card>
            <CardTitle>Submit for approval</CardTitle>
            <ActionForm
              action={submitPurchaseAction}
              hidden={{ id: r.id }}
              label="Submit"
              confirm="Submit this request? Its lines can no longer be changed."
            />
          </Card>
        ) : null}
        {allowed.decide ? (
          <Card>
            <CardTitle>Decision</CardTitle>
            <p className="text-ink-muted text-xs">
              You are approving a request, not placing an order. After approval, order through your hospital&apos;s
              purchasing process.
            </p>
            <ActionForm action={decidePurchaseAction} hidden={{ id: r.id, approve: "on" }} label="Approve request" />
            <ActionForm
              action={decidePurchaseAction}
              hidden={{ id: r.id, approve: "" }}
              label="Reject request"
              variant="danger"
            >
              <InputField label="Reason for rejecting" name="note" id="pr-note" />
            </ActionForm>
          </Card>
        ) : null}
        {allowed.order ? (
          <Card>
            <CardTitle>Mark as ordered</CardTitle>
            <p className="text-ink-muted text-xs">
              Only after the order was actually placed through your purchasing process. Stock does not change until the
              delivery is received.
            </p>
            <ActionForm action={orderedPurchaseAction} hidden={{ id: r.id }} label="Mark as ordered">
              <InputField label="Order reference (e.g. LPO number)" name="orderReference" id="pr-ref" required />
            </ActionForm>
          </Card>
        ) : null}
        {allowed.receive ? (
          <Card>
            <CardTitle>Receive delivery</CardTitle>
            {r.lines
              .filter((l) => l.receivedQuantity < l.quantity)
              .map((l) => (
                <ActionForm
                  key={l.id}
                  action={receiveAction}
                  hidden={{
                    requestKey: randomUUID(),
                    partId: l.part.id,
                    purchaseLineId: l.id,
                    purchaseRequestId: r.id,
                    supplierId: r.supplier?.id ?? "",
                  }}
                  label={`Receive ${l.part.partNumber}`}
                  className="bg-surface grid gap-2 rounded-md p-3 md:grid-cols-3"
                >
                  <p className="text-sm font-semibold md:col-span-3">
                    {l.part.partNumber}: {l.quantity - l.receivedQuantity} still to receive
                  </p>
                  <SelectField label="Into store" name="locationId" id={`rc-s-${l.id}`}>
                    {stores.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.code} — {s.name}
                      </option>
                    ))}
                  </SelectField>
                  <InputField
                    label="Quantity received"
                    name="quantity"
                    id={`rc-q-${l.id}`}
                    type="number"
                    min={1}
                    max={l.quantity - l.receivedQuantity}
                    required
                  />
                  <InputField label="Delivery note (optional)" name="reference" id={`rc-r-${l.id}`} />
                  <InputField label="Lot (if tracked)" name="lotNumber" id={`rc-l-${l.id}`} />
                  <InputField label="Expiry (if tracked)" name="expiresOn" id={`rc-e-${l.id}`} type="date" />
                  {showCost ? (
                    <InputField
                      label="Unit price paid (optional)"
                      name="unitCost"
                      id={`rc-c-${l.id}`}
                      inputMode="decimal"
                    />
                  ) : null}
                  {showCost ? (
                    <InputField label="Currency" name="currency" id={`rc-cur-${l.id}`} maxLength={3} />
                  ) : null}
                </ActionForm>
              ))}
          </Card>
        ) : null}
        {allowed.cancel ? (
          <Card>
            <CardTitle>Cancel request</CardTitle>
            <ActionForm
              action={cancelPurchaseAction}
              hidden={{ id: r.id }}
              label="Cancel request"
              variant="danger"
              confirm="Cancel this purchase request?"
            >
              <InputField label="Reason" name="reason" id="pr-cancel" required />
            </ActionForm>
          </Card>
        ) : null}
      </div>
    </>
  );
}
