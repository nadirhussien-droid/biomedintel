import type { Metadata } from "next";
import { requireAccess } from "@/server/auth/session";
import { can } from "@/server/authz/access";
import { partOptions } from "@/server/services/inventory";
import { supplierOptions } from "@/server/services/suppliers";
import { PageHeader } from "@/components/shell/page-header";
import { Card } from "@/components/ui/card";
import { FieldShell, SelectField } from "@/components/ui/field";
import { ActionForm } from "@/components/forms/action-form";
import { createPurchaseAction } from "../../actions";

export const metadata: Metadata = { title: "New purchase request" };
const control = "min-h-11 w-full rounded-sm border border-line-strong bg-white px-3 text-sm text-ink";
type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function NewPurchasePage({ searchParams }: { searchParams: SearchParams }) {
  const ctx = await requireAccess();
  if (!can(ctx, "purchase.request")) {
    return (
      <Card>
        <p className="text-sm">Your role cannot create purchase requests.</p>
      </Card>
    );
  }
  const sp = await searchParams;
  const preset = Array.isArray(sp.part) ? sp.part[0] : sp.part;
  const presetQty = Array.isArray(sp.qty) ? sp.qty[0] : sp.qty;
  const [parts, suppliers] = await Promise.all([partOptions(ctx), supplierOptions(ctx)]);
  const showCost = can(ctx, "inventory.viewCost");
  return (
    <>
      <PageHeader
        title="New purchase request"
        description="Saved as a draft first. You then submit it, and a manager who is not you approves or rejects it. Nothing is ordered automatically."
      />
      <Card>
        <ActionForm
          action={createPurchaseAction}
          label="Save draft"
          className="flex flex-col gap-4"
          fieldLabels={{ lines: "Lines", hospitalId: "Hospital" }}
        >
          <div className="grid gap-3 md:grid-cols-2">
            <SelectField label="For hospital" name="hospitalId" id="pr-h">
              {ctx.hospitals.map((h) => (
                <option key={h.id} value={h.id}>
                  {h.code} · {h.name}
                </option>
              ))}
            </SelectField>
            <SelectField label="Preferred supplier (optional)" name="supplierId" id="pr-s">
              <option value="">—</option>
              {suppliers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </SelectField>
          </div>
          <FieldShell label="Reason for the request (optional)" name="justification">
            <textarea
              id="justification"
              name="justification"
              className="border-line-strong min-h-20 w-full rounded-sm border bg-white px-3 py-2 text-sm"
            />
          </FieldShell>
          <fieldset className="flex flex-col gap-2">
            <legend className="text-sm font-semibold">Parts (leave unused rows empty)</legend>
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <div
                key={i}
                className={`grid gap-2 ${showCost ? "md:grid-cols-[3fr_1fr_1fr_1fr]" : "md:grid-cols-[3fr_1fr]"}`}
              >
                <label className="sr-only" htmlFor={`lp-${i}`}>
                  Part, line {i + 1}
                </label>
                <select id={`lp-${i}`} name="linePart" defaultValue={i === 0 ? (preset ?? "") : ""} className={control}>
                  <option value="">— choose a part —</option>
                  {parts.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.partNumber} — {p.name}
                    </option>
                  ))}
                </select>
                <label className="sr-only" htmlFor={`lq-${i}`}>
                  Quantity, line {i + 1}
                </label>
                <input
                  id={`lq-${i}`}
                  name="lineQuantity"
                  type="number"
                  min={1}
                  placeholder="Quantity"
                  defaultValue={i === 0 ? (presetQty ?? "") : ""}
                  className={control}
                />
                {showCost ? (
                  <>
                    <label className="sr-only" htmlFor={`lc-${i}`}>
                      Estimated unit cost, line {i + 1}
                    </label>
                    <input
                      id={`lc-${i}`}
                      name="lineCost"
                      inputMode="decimal"
                      placeholder="Est. unit cost"
                      className={control}
                    />
                    <label className="sr-only" htmlFor={`lcur-${i}`}>
                      Currency, line {i + 1}
                    </label>
                    <input
                      id={`lcur-${i}`}
                      name="lineCurrency"
                      maxLength={3}
                      placeholder="Currency"
                      className={control}
                    />
                  </>
                ) : (
                  <>
                    <input type="hidden" name="lineCost" value="" />
                    <input type="hidden" name="lineCurrency" value="" />
                  </>
                )}
              </div>
            ))}
            <p className="text-ink-muted text-xs">
              Estimated costs are estimates only: they are labelled as such and never treated as recorded prices.
            </p>
          </fieldset>
        </ActionForm>
      </Card>
    </>
  );
}
