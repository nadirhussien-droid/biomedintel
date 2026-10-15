// Warranties, service contracts and claims on the asset page (Stage 8).
// Server component; data from getAssetWarranties (permission and scope
// checked there). Coverage is shown as RECORDED; a claim's status is what a
// person recorded, never assumed from dates.
import { Card, CardTitle } from "@/components/ui/card";
import { InputField, SelectField } from "@/components/ui/field";
import { ActionForm } from "@/components/forms/action-form";
import { Empty, fmtDate, fmtDateTime } from "@/components/analytics/ui";
import { ClaimTag, WarrantyTag, recorded } from "./badges";
import { CLAIM_STATUS_LABELS, CLAIM_TRANSITIONS, type ClaimStatusValue } from "@/lib/validation/inventory";
import type { getAssetWarranties } from "@/server/services/warranties";
import {
  addWarrantyAction,
  archiveWarrantyAction,
  claimStatusAction,
  createClaimAction,
  updateWarrantyAction,
} from "@/app/(app)/suppliers/actions";

type Data = NonNullable<Awaited<ReturnType<typeof getAssetWarranties>>>;
const textarea = "min-h-20 w-full rounded-sm border border-line-strong bg-white px-3 py-2 text-sm text-ink";
const iso = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : "");
const tri = (v: boolean | null) => (v === true ? "yes" : v === false ? "no" : "");

function TextArea({
  id,
  name,
  label,
  defaultValue,
  required,
}: {
  id: string;
  name: string;
  label: string;
  defaultValue?: string | null;
  required?: boolean;
}) {
  return (
    <div className="sm:col-span-2">
      <label htmlFor={id} className="text-sm font-semibold">
        {label}
      </label>
      <textarea
        id={id}
        name={name}
        required={required}
        defaultValue={defaultValue ?? ""}
        className={`${textarea} mt-1.5`}
      />
    </div>
  );
}

function CoverageSelect({
  id,
  name,
  label,
  value,
}: {
  id: string;
  name: string;
  label: string;
  value?: boolean | null;
}) {
  return (
    <SelectField label={label} name={name} id={id} defaultValue={value === undefined ? "" : tri(value)}>
      <option value="">Not recorded</option>
      <option value="yes">Yes — stated in the terms</option>
      <option value="no">No — excluded in the terms</option>
    </SelectField>
  );
}

/** Fields shared by the add and edit forms. */
function DetailFields({
  prefix,
  suppliers,
  w,
}: {
  prefix: string;
  suppliers: { id: string; name: string }[];
  w?: Data["warranties"][number];
}) {
  return (
    <>
      <SelectField
        label="Supplier in the register (optional)"
        name="supplierId"
        id={`${prefix}-sup`}
        defaultValue={w?.supplierId ?? ""}
      >
        <option value="">— None —</option>
        {suppliers.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name}
          </option>
        ))}
      </SelectField>
      <InputField label="Reference number" name="reference" id={`${prefix}-ref`} defaultValue={w?.reference ?? ""} />
      <CoverageSelect id={`${prefix}-parts`} name="coversParts" label="Parts covered" value={w?.coversParts} />
      <CoverageSelect id={`${prefix}-labour`} name="coversLabour" label="Labour covered" value={w?.coversLabour} />
      <InputField
        label="Response target, hours (contracts only)"
        name="responseTargetHours"
        id={`${prefix}-resp`}
        type="number"
        min={1}
        defaultValue={w?.responseTargetHours ?? ""}
      />
      <InputField
        label="Where the document is kept"
        name="documentReference"
        id={`${prefix}-doc`}
        defaultValue={w?.documentReference ?? ""}
        hint="e.g. contract number and shared-drive folder. Files are not uploaded in this stage."
      />
      <TextArea
        id={`${prefix}-excl`}
        name="exclusions"
        label="Exclusions and limitations"
        defaultValue={w?.exclusions}
      />
      <TextArea id={`${prefix}-notes`} name="notes" label="Notes" defaultValue={w?.notes} />
    </>
  );
}

export function AssetWarranties({
  data,
  assetId,
  canManage,
  canClaim,
  suppliers,
  jobs,
}: {
  jobs: { id: string; number: string }[];
  data: Data;
  assetId: string;
  canManage: boolean;
  canClaim: boolean;
  suppliers: { id: string; name: string }[];
}) {
  const { warranties, claims, names, showMoney, today } = data;
  return (
    <Card id="warranties">
      <CardTitle>Warranties and service contracts</CardTitle>
      {warranties.length === 0 ? <Empty>No warranty or service contract is recorded for this device.</Empty> : null}
      {warranties.map((w) => (
        <section key={w.id} className="border-line flex flex-col gap-2 rounded-md border p-3 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <strong>{w.kind === "WARRANTY" ? "Warranty" : "Service contract"}</strong> ·{" "}
            {w.supplier?.name ?? w.provider}
            {w.reference ? <span className="text-ink-muted">ref {w.reference}</span> : null}
            <WarrantyTag state={w.state} />
          </div>
          <dl className="text-ink-muted grid gap-x-4 gap-y-1 sm:grid-cols-2">
            <div>
              Period: {w.startsOn ? fmtDate(w.startsOn) : "start not recorded"} – {fmtDate(w.endsOn)}
            </div>
            <div>Provider: {w.provider}</div>
            <div>Parts: {recorded(w.coversParts)}</div>
            <div>Labour: {recorded(w.coversLabour)}</div>
            {w.coverage ? <div className="sm:col-span-2">Coverage: {w.coverage}</div> : null}
            {w.exclusions ? <div className="sm:col-span-2">Exclusions: {w.exclusions}</div> : null}
            {w.responseTargetHours ? <div>Response target: {w.responseTargetHours} h</div> : null}
            {w.documentReference ? <div>Document: {w.documentReference}</div> : null}
            {w.notes ? <div className="sm:col-span-2">Notes: {w.notes}</div> : null}
          </dl>
          {canManage ? (
            <details>
              <summary className="cursor-pointer font-semibold text-teal-700">Edit or archive</summary>
              <ActionForm
                action={updateWarrantyAction}
                hidden={{ id: w.id }}
                label="Save changes"
                resetOnSuccess={false}
                className="mt-2 grid gap-3 sm:grid-cols-2"
              >
                <InputField label="Provider" name="provider" id={`w-${w.id}-prov`} defaultValue={w.provider} required />
                <InputField
                  label="Coverage summary"
                  name="coverage"
                  id={`w-${w.id}-cov`}
                  defaultValue={w.coverage ?? ""}
                />
                <InputField
                  label="Start date"
                  name="startsOn"
                  id={`w-${w.id}-start`}
                  type="date"
                  defaultValue={iso(w.startsOn)}
                />
                <InputField
                  label="End date"
                  name="endsOn"
                  id={`w-${w.id}-end`}
                  type="date"
                  defaultValue={iso(w.endsOn)}
                  required
                />
                <DetailFields prefix={`w-${w.id}`} suppliers={suppliers} w={w} />
              </ActionForm>
              <ActionForm
                action={archiveWarrantyAction}
                hidden={{ id: w.id }}
                label="Archive this record"
                variant="danger"
                confirm="Archive this warranty or contract? It stays in the history but no longer shows as current."
                className="mt-3"
              />
            </details>
          ) : null}
          {canClaim && w.state !== "not_started" ? (
            <details>
              <summary className="cursor-pointer font-semibold text-teal-700">
                Record a claim under this {w.kind === "WARRANTY" ? "warranty" : "contract"}
              </summary>
              <p className="text-ink-muted mt-2 text-xs">
                The claim starts as a draft. Recording it does not mean the supplier will accept it.
              </p>
              <ActionForm
                action={createClaimAction}
                hidden={{ warrantyId: w.id }}
                label="Record claim (draft)"
                className="mt-2 grid gap-3 sm:grid-cols-2"
              >
                <InputField label="Claim reference (optional)" name="claimReference" id={`c-${w.id}-ref`} />
                <SelectField
                  label="Related work order (optional)"
                  name="workOrderId"
                  id={`c-${w.id}-wo`}
                  defaultValue=""
                >
                  <option value="">— None —</option>
                  {jobs.map((j) => (
                    <option key={j.id} value={j.id}>
                      {j.number}
                    </option>
                  ))}
                </SelectField>
                {showMoney ? (
                  <>
                    <InputField
                      label="Amount claimed (optional)"
                      name="amountClaimed"
                      id={`c-${w.id}-amt`}
                      inputMode="decimal"
                    />
                    <InputField label="Currency" name="currency" id={`c-${w.id}-cur`} maxLength={3} />
                  </>
                ) : null}
                <TextArea id={`c-${w.id}-desc`} name="description" label="What is being claimed" required />
                <TextArea id={`c-${w.id}-ev`} name="evidence" label="Evidence supplied (optional)" />
              </ActionForm>
            </details>
          ) : null}
        </section>
      ))}

      <h3 className="text-sm font-semibold">Claims ({claims.length})</h3>
      {claims.length === 0 ? <Empty>No warranty claims recorded.</Empty> : null}
      {claims.map((c) => {
        const next = CLAIM_TRANSITIONS[c.status as ClaimStatusValue];
        return (
          <section key={c.id} className="border-line flex flex-col gap-2 rounded-md border p-3 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <strong>{c.warranty.provider}</strong>
              {c.claimReference ? <span className="text-ink-muted">claim {c.claimReference}</span> : null}
              <ClaimTag status={c.status} />
            </div>
            <p className="whitespace-pre-line">{c.description}</p>
            <dl className="text-ink-muted grid gap-x-4 gap-y-1 sm:grid-cols-2">
              <div>Submitted: {fmtDate(c.submittedOn)}</div>
              <div>Decided: {fmtDate(c.decidedOn)}</div>
              {c.evidence ? <div className="sm:col-span-2">Evidence: {c.evidence}</div> : null}
              {c.outcome ? <div className="sm:col-span-2">Outcome: {c.outcome}</div> : null}
              {showMoney && c.currency ? (
                <div className="sm:col-span-2">
                  Claimed: {c.amountClaimed ? `${c.currency} ${String(c.amountClaimed)}` : "—"} · Recovered:{" "}
                  {c.amountRecovered ? `${c.currency} ${String(c.amountRecovered)}` : "—"}
                </div>
              ) : null}
            </dl>
            <ol className="text-ink-muted text-xs">
              {c.events.map((e) => (
                <li key={e.id}>
                  {e.fromStatus ? `${CLAIM_STATUS_LABELS[e.fromStatus as ClaimStatusValue]} → ` : ""}
                  {CLAIM_STATUS_LABELS[e.toStatus as ClaimStatusValue]} · {names[e.actorId] ?? "Unknown"} ·{" "}
                  {fmtDateTime(e.createdAt)}
                  {e.note ? ` · ${e.note}` : ""}
                </li>
              ))}
            </ol>
            {canClaim && next.length ? (
              <details>
                <summary className="cursor-pointer font-semibold text-teal-700">Update status</summary>
                <ActionForm
                  action={claimStatusAction}
                  hidden={{ claimId: c.id, assetId }}
                  label="Save status"
                  className="mt-2 grid gap-3 sm:grid-cols-2"
                >
                  <SelectField label="New status" name="status" id={`cs-${c.id}-st`}>
                    {next.map((s) => (
                      <option key={s} value={s}>
                        {CLAIM_STATUS_LABELS[s]}
                      </option>
                    ))}
                  </SelectField>
                  <InputField
                    label="Date (submitted or decided)"
                    name="date"
                    id={`cs-${c.id}-date`}
                    type="date"
                    max={today}
                    defaultValue={today}
                  />
                  <InputField
                    label="Claim reference"
                    name="claimReference"
                    id={`cs-${c.id}-ref`}
                    defaultValue={c.claimReference ?? ""}
                  />
                  {showMoney ? (
                    <>
                      <InputField
                        label="Amount recovered (if decided)"
                        name="amountRecovered"
                        id={`cs-${c.id}-amt`}
                        inputMode="decimal"
                      />
                      <InputField
                        label="Currency"
                        name="currency"
                        id={`cs-${c.id}-cur`}
                        maxLength={3}
                        defaultValue={c.currency ?? ""}
                      />
                    </>
                  ) : null}
                  <TextArea id={`cs-${c.id}-out`} name="outcome" label="Supplier's decision / outcome (if decided)" />
                  <TextArea id={`cs-${c.id}-ev`} name="evidence" label="Evidence supplied" defaultValue={c.evidence} />
                  <TextArea id={`cs-${c.id}-note`} name="note" label="Note for the history" />
                </ActionForm>
              </details>
            ) : null}
          </section>
        );
      })}

      {canManage ? (
        <details>
          <summary className="cursor-pointer text-sm font-semibold text-teal-700">
            Add a warranty or service contract
          </summary>
          <ActionForm
            action={addWarrantyAction}
            hidden={{ assetId }}
            label="Add record"
            className="mt-2 grid gap-3 sm:grid-cols-2"
          >
            <SelectField label="Type" name="kind" id="wn-kind" defaultValue="WARRANTY">
              <option value="WARRANTY">Manufacturer warranty</option>
              <option value="SERVICE_CONTRACT">Service contract</option>
            </SelectField>
            <InputField label="Provider" name="provider" id="wn-prov" required />
            <InputField label="Start date" name="startsOn" id="wn-start" type="date" />
            <InputField label="End date" name="endsOn" id="wn-end" type="date" required />
            <InputField label="Coverage summary (optional)" name="coverage" id="wn-cov" />
            <DetailFields prefix="wn" suppliers={suppliers} />
          </ActionForm>
        </details>
      ) : null}
    </Card>
  );
}
