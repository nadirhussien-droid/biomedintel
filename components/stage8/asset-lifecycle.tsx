// Lifecycle section on the asset page (Stage 8). Server component; data from
// getAssetLifecycle (permission and scope checked there). The lifecycle stage
// is worked out from the existing status and safety hold — not stored twice —
// and nothing here changes the device's operational status.
import Link from "next/link";
import { Card, CardTitle } from "@/components/ui/card";
import { InputField, SelectField } from "@/components/ui/field";
import { ActionForm } from "@/components/forms/action-form";
import { Empty, fmtDate, fmtDateTime, recordLink, ToneTag } from "@/components/analytics/ui";
import {
  DISPOSAL_LABELS,
  DISPOSAL_METHODS,
  REPLACEMENT_REVIEW_LABELS,
  REPLACEMENT_REVIEWS,
} from "@/lib/validation/inventory";
import type { getAssetLifecycle } from "@/server/services/lifecycle";
import { assetSupplierAction, disposalAction, reviewAction } from "@/app/(app)/suppliers/actions";

type Data = Awaited<ReturnType<typeof getAssetLifecycle>>;
const textarea = "min-h-20 w-full rounded-sm border border-line-strong bg-white px-3 py-2 text-sm text-ink";
const KIND_LABELS: Record<string, string> = {
  lifecycle: "Lifecycle",
  status: "Status",
  maintenance: "Maintenance",
  safety: "Safety",
  warranty: "Warranty",
  transfer: "Transfer",
  record: "Record",
};

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-ink-muted text-xs font-semibold uppercase">{label}</dt>
      <dd className="text-sm">{children}</dd>
    </div>
  );
}

export function AssetLifecycle({ data, suppliers }: { data: Data; suppliers: { id: string; name: string }[] }) {
  const { asset, stage, today, expectedEnd, decommission, disposal, history, allowed } = data;
  const tone = stage.tone === "neutral" ? null : stage.tone;
  const reviewOverdue = asset.lifecycleReviewOn ? asset.lifecycleReviewOn.toISOString().slice(0, 10) < today : false;
  return (
    <Card id="lifecycle">
      <CardTitle
        action={
          tone ? (
            <ToneTag tone={tone}>{stage.label}</ToneTag>
          ) : (
            <span className="text-sm font-semibold">{stage.label}</span>
          )
        }
      >
        Lifecycle
      </CardTitle>
      <p className="text-ink-muted text-xs">
        The lifecycle stage is worked out from the device&apos;s status, safety hold and open requests. Recording a
        review or a disposal never changes whether the device may be used.
      </p>
      <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Row label="Purchased">{fmtDate(asset.purchaseDate)}</Row>
        <Row label="Commissioned">{fmtDate(asset.commissionedAt)}</Row>
        <Row label="Expected end of life (model)">{expectedEnd ? fmtDate(expectedEnd) : "Not recorded"}</Row>
        <Row label="End-of-life date (set)">{fmtDate(asset.eolDate)}</Row>
        <Row label="Next lifecycle review">
          {asset.lifecycleReviewOn ? (
            <>
              {fmtDate(asset.lifecycleReviewOn)} {reviewOverdue ? <ToneTag tone="danger">Overdue</ToneTag> : null}
            </>
          ) : (
            "Not set"
          )}
        </Row>
        <Row label="Replacement review">
          {asset.replacementReview
            ? REPLACEMENT_REVIEW_LABELS[asset.replacementReview as keyof typeof REPLACEMENT_REVIEW_LABELS]
            : "None recorded"}
        </Row>
        <Row label="Supplier">
          {asset.supplierRef ? (
            <Link href={`/suppliers/${asset.supplierRef.id}`} className={recordLink}>
              {asset.supplierRef.name}
            </Link>
          ) : asset.supplier ? (
            `${asset.supplier} (free text)`
          ) : (
            "Not recorded"
          )}
        </Row>
        {decommission ? (
          <Row label="Decommissioned">
            {fmtDate(decommission.effectiveOn ?? decommission.decidedAt)} · {decommission.reason}
          </Row>
        ) : null}
        {disposal ? (
          <Row label="Disposal / transfer out">
            {DISPOSAL_LABELS[disposal.disposalMethod as keyof typeof DISPOSAL_LABELS] ?? disposal.disposalMethod} ·{" "}
            {fmtDate(disposal.effectiveOn)}
            {disposal.reference ? ` · Ref. ${disposal.reference}` : ""}
          </Row>
        ) : null}
      </dl>

      <div className="grid gap-4 lg:grid-cols-2">
        {allowed.review ? (
          <details>
            <summary className="cursor-pointer text-sm font-semibold text-teal-700">
              Record a replacement / lifecycle review
            </summary>
            <ActionForm
              action={reviewAction}
              hidden={{ assetId: asset.id }}
              label="Record review"
              className="mt-2 grid gap-3"
            >
              <SelectField
                label="Review status"
                name="outcome"
                id="lc-outcome"
                defaultValue={asset.replacementReview ?? "DUE"}
              >
                {REPLACEMENT_REVIEWS.map((r) => (
                  <option key={r} value={r}>
                    {REPLACEMENT_REVIEW_LABELS[r]}
                  </option>
                ))}
              </SelectField>
              <InputField
                label="Next lifecycle review (optional)"
                name="nextReviewOn"
                id="lc-next"
                type="date"
                min={today}
              />
              <div>
                <label htmlFor="lc-reason" className="text-sm font-semibold">
                  Notes for the record
                </label>
                <textarea id="lc-reason" name="reason" required className={`${textarea} mt-1.5`} />
              </div>
            </ActionForm>
          </details>
        ) : null}
        {allowed.supplier && suppliers.length ? (
          <details>
            <summary className="cursor-pointer text-sm font-semibold text-teal-700">
              Link to a supplier in the register
            </summary>
            <ActionForm
              action={assetSupplierAction}
              hidden={{ assetId: asset.id }}
              label="Save supplier"
              resetOnSuccess={false}
              className="mt-2 grid gap-3"
            >
              <SelectField label="Supplier" name="supplierId" id="lc-sup" defaultValue={asset.supplierRef?.id ?? ""}>
                <option value="">— None —</option>
                {suppliers.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </SelectField>
            </ActionForm>
          </details>
        ) : null}
        {allowed.dispose ? (
          <details>
            <summary className="cursor-pointer text-sm font-semibold text-teal-700">
              Record disposal or transfer out
            </summary>
            <ActionForm
              action={disposalAction}
              hidden={{ assetId: asset.id }}
              label="Record disposal"
              confirm="Record what happened to this decommissioned device? This can only be recorded once."
              className="mt-2 grid gap-3"
            >
              <SelectField label="What happened" name="method" id="lc-method">
                {DISPOSAL_METHODS.map((m) => (
                  <option key={m} value={m}>
                    {DISPOSAL_LABELS[m]}
                  </option>
                ))}
              </SelectField>
              <InputField
                label="Date"
                name="effectiveOn"
                id="lc-date"
                type="date"
                max={today}
                defaultValue={today}
                required
              />
              <InputField label="Reference (certificate, receipt or recipient)" name="reference" id="lc-ref" />
              <div>
                <label htmlFor="lc-details" className="text-sm font-semibold">
                  Details
                </label>
                <textarea id="lc-details" name="reason" required className={`${textarea} mt-1.5`} />
              </div>
            </ActionForm>
          </details>
        ) : null}
      </div>

      <details open={history.length <= 8}>
        <summary className="cursor-pointer text-sm font-semibold">Lifecycle history ({history.length})</summary>
        {history.length === 0 ? (
          <Empty>No events recorded yet.</Empty>
        ) : (
          <ol className="mt-2 flex flex-col text-sm">
            {history.map((e, i) => (
              <li key={i} className="border-line flex flex-wrap gap-x-2 border-b py-1.5">
                <span className="text-ink-muted w-36 shrink-0 text-xs">
                  {e.dateOnly ? fmtDate(e.at) : fmtDateTime(e.at)}
                </span>
                <span className="bg-surface-sunken text-ink-muted rounded-sm px-1.5 text-xs font-semibold uppercase">
                  {KIND_LABELS[e.kind] ?? e.kind}
                </span>
                <span className="font-medium">
                  {e.href ? (
                    <Link href={e.href} className={recordLink}>
                      {e.title}
                    </Link>
                  ) : (
                    e.title
                  )}
                </span>
                {e.detail ? <span className="text-ink-muted">· {e.detail}</span> : null}
                {e.by ? <span className="text-ink-muted">· {e.by}</span> : null}
              </li>
            ))}
          </ol>
        )}
      </details>
    </Card>
  );
}
